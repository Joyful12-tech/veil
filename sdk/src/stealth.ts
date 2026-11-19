/**
 * Stealth addresses for Veil names.
 *
 * A Veil name resolves to a `C…` contract account, which a classic Stellar
 * payment cannot address at all. A stealth meta-address is the second record
 * that makes the name payable by anyone: it is a single X25519 public key,
 * published by the name's holder, from which a sender derives a fresh `G…`
 * address for each payment. A classic-only sender can pay that address.
 *
 * ## The scheme
 *
 * The recipient publishes `viewPub = X25519(viewSecret)`. The sender:
 *
 *   ephemeralSecret = 32 random bytes
 *   ephemeralPub    = X25519(ephemeralSecret)
 *   shared          = X25519(ephemeralSecret, viewPub)
 *   seed            = SHA-256(DOMAIN || shared || ephemeralPub)
 *   address         = Ed25519(seed).publicKey()
 *
 * The recipient, holding `viewSecret` and seeing `ephemeralPub`, computes the
 * same `shared`, the same seed and the same keypair. Nothing secret is ever
 * sent: `ephemeralPub` is public, and the meta-address is meant to be handed
 * out.
 *
 * The one-time address is built from the long-term viewing secret, so that
 * secret **is** the ability to spend everything sent to any address derived
 * from it. It belongs on the holder's own device; it is not a "view-only" key,
 * and this SDK does not pretend otherwise.
 *
 * ## What this module does not do
 *
 * It does not scan the chain, store keys or publish records. Those are wallet
 * concerns; this is the arithmetic both sides must agree on byte for byte.
 */

import { StrKey, hash } from '@stellar/stellar-sdk';
import { ed25519, x25519 } from '@noble/curves/ed25519';

/** Bytes in a published meta-address, matching `META_ADDRESS_LEN` on-chain. */
export const META_ADDRESS_LENGTH = 32;

/** Domain separator, so this derivation can never collide with another one. */
export const STEALTH_DOMAIN = 'veil/stealth/one-time-address/v1';

/** A published stealth meta-address: one X25519 public key. */
export type StealthMetaAddress = Uint8Array;

/** The secret a holder keeps, and the record it publishes. */
export type StealthKeys = {
  viewingSecretKey: Uint8Array;
  metaAddress: StealthMetaAddress;
};

/** What a sender needs to pay: the fresh address and the public hint. */
export type StealthPayment = {
  /** `G…`, the one-time address a payment goes to. */
  address: string;
  /** Public; the recipient needs it (with the viewing secret) to recover the key. */
  ephemeralPublicKey: Uint8Array;
};

/** The recipient's recovered key: the address, and the raw 32-byte Ed25519 seed. */
export type StealthPrivateKey = {
  address: string;
  /** Raw seed. Pass to `Keypair.fromRawEd25519Seed` to sign a sweep. */
  secretKey: Uint8Array;
};

/** Anything this module refuses to derive from. */
export class StealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StealthError';
  }
}

function utils(): typeof x25519.utils {
  return x25519.utils;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function utf8(value: string): Uint8Array {
  return new Uint8Array(value.split('').map((c) => c.charCodeAt(0)));
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(hash(Buffer.from(data)));
}

/**
 * The Stellar address for a raw Ed25519 seed.
 *
 * Encoded here rather than through `Keypair`, whose internals reject a
 * `Buffer` from another realm (jsdom's, in tests) before the curve ever sees
 * it. `StrKey` takes bytes and returns the same 56-character `G…` address.
 */
function addressForSeed(seed: Uint8Array): string {
  return StrKey.encodeEd25519PublicKey(
    Buffer.from(ed25519.getPublicKey(Uint8Array.from(seed))),
  );
}

/**
 * Check that a value is a usable X25519 key.
 *
 * `x25519.getPublicKey` accepts any 32 bytes, so length is the only structural
 * check that can be made before the curve does its own validation of the point
 * when a secret is actually exchanged.
 */
function assertKeyLength(value: Uint8Array, label: string): void {
  if (!(value instanceof Uint8Array) || value.length !== META_ADDRESS_LENGTH) {
    throw new StealthError(`${label} must be ${META_ADDRESS_LENGTH} bytes.`);
  }
}

/**
 * Turn a long-term seed into the viewing secret and the record to publish.
 *
 * The seed is hashed first, so a seed that is itself a key is never used as
 * the X25519 secret directly. Deterministic: the same seed always yields the
 * same meta-address, which is what lets a wallet re-derive it from the same
 * passkey-backed secret on another device.
 */
export function deriveStealthKeys(seed: Uint8Array): StealthKeys {
  assertKeyLength(seed, 'seed');
  const viewingSecretKey = sha256(concatBytes(utf8(STEALTH_DOMAIN), seed));
  return {
    viewingSecretKey,
    metaAddress: x25519.getPublicKey(viewingSecretKey),
  };
}

/** Generate a fresh viewing secret. */
export function generateStealthKeys(): StealthKeys {
  return deriveStealthKeys(utils().randomPrivateKey());
}

/**
 * Validate published bytes before deriving anything from them.
 *
 * Refusing a wrong length here is the difference between "this name has no
 * privacy record" and "this name has a record nobody can be paid through".
 */
export function decodeMetaAddress(metaAddress: Uint8Array): StealthMetaAddress {
  assertKeyLength(metaAddress, 'meta-address');
  return new Uint8Array(metaAddress);
}

/**
 * Derive a one-time address from a published meta-address.
 *
 * `ephemeralSecret` exists for tests and for retrying a payment whose
 * derivation must be reproduced; production callers should omit it and get a
 * fresh random one.
 */
export function deriveStealthPayment(
  metaAddress: Uint8Array,
  ephemeralSecret?: Uint8Array,
): StealthPayment {
  const viewPub = decodeMetaAddress(metaAddress);
  const secret = ephemeralSecret ?? utils().randomPrivateKey();
  assertKeyLength(secret, 'ephemeral secret');

  const ephemeralPublicKey = x25519.getPublicKey(secret);
  const shared = x25519.getSharedSecret(secret, viewPub);
  const seed = sha256(concatBytes(utf8(STEALTH_DOMAIN), shared, ephemeralPublicKey));

  return {
    address: addressForSeed(seed),
    ephemeralPublicKey,
  };
}

/**
 * The recipient's side: recover the keypair behind a one-time address.
 *
 * The returned keypair is the only way to spend funds sent to that address;
 * the address itself is derivable by anyone with the meta-address, which is
 * why the secret never leaves the recipient.
 */
export function deriveStealthPrivateKey(
  viewingSecretKey: Uint8Array,
  ephemeralPublicKey: Uint8Array,
): StealthPrivateKey {
  assertKeyLength(viewingSecretKey, 'viewing secret key');
  assertKeyLength(ephemeralPublicKey, 'ephemeral public key');

  const shared = x25519.getSharedSecret(viewingSecretKey, ephemeralPublicKey);
  const seed = sha256(concatBytes(utf8(STEALTH_DOMAIN), shared, ephemeralPublicKey));
  return { address: addressForSeed(seed), secretKey: seed };
}

/** Base64 is how a meta-address travels in a SEP-2 JSON response. */
export function encodeMetaAddressBase64(metaAddress: Uint8Array): string {
  return Buffer.from(decodeMetaAddress(metaAddress)).toString('base64');
}

/** Decode the `meta_address` field of a SEP-2 answer. Throws if it is malformed. */
export function decodeMetaAddressBase64(value: string): StealthMetaAddress {
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  return decodeMetaAddress(bytes);
}

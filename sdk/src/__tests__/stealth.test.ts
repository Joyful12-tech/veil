import {
  META_ADDRESS_LENGTH,
  StealthError,
  decodeMetaAddress,
  decodeMetaAddressBase64,
  deriveStealthKeys,
  deriveStealthPayment,
  deriveStealthPrivateKey,
  encodeMetaAddressBase64,
  generateStealthKeys,
} from '../stealth';

const SEED = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));

describe('stealth meta-addresses', () => {
  it('derives a deterministic 32-byte record from a seed', () => {
    const first = deriveStealthKeys(SEED);
    const second = deriveStealthKeys(SEED);

    expect(first.metaAddress).toEqual(second.metaAddress);
    expect(first.viewingSecretKey).toEqual(second.viewingSecretKey);
    expect(first.metaAddress).toHaveLength(META_ADDRESS_LENGTH);
    // The published record is not the seed and not the secret.
    expect(Buffer.from(first.metaAddress).equals(Buffer.from(SEED))).toBe(false);
    expect(
      Buffer.from(first.metaAddress).equals(Buffer.from(first.viewingSecretKey)),
    ).toBe(false);
  });

  it('generates a different record each time', () => {
    expect(generateStealthKeys().metaAddress).not.toEqual(
      generateStealthKeys().metaAddress,
    );
  });

  it('refuses a seed of the wrong length', () => {
    expect(() => deriveStealthKeys(new Uint8Array(31))).toThrow(StealthError);
  });

  it('refuses a published record of the wrong length', () => {
    // A truncated record is not a smaller key; it is an underivable one.
    expect(() => decodeMetaAddress(new Uint8Array(31))).toThrow(StealthError);
    expect(() => decodeMetaAddress(new Uint8Array(64))).toThrow(StealthError);
  });
});

describe('one-time addresses', () => {
  it('gives a 56-character G address that is not the name holder', () => {
    const { metaAddress } = deriveStealthKeys(SEED);
    const payment = deriveStealthPayment(metaAddress);

    expect(payment.address).toHaveLength(56);
    expect(payment.address.startsWith('G')).toBe(true);
    expect(payment.ephemeralPublicKey).toHaveLength(32);
    expect(payment.address).not.toBe(metaAddress.toString());
  });

  it('derives a fresh address for every payment', () => {
    const { metaAddress } = deriveStealthKeys(SEED);
    const first = deriveStealthPayment(metaAddress);
    const second = deriveStealthPayment(metaAddress);

    expect(first.address).not.toBe(second.address);
    expect(first.ephemeralPublicKey).not.toEqual(second.ephemeralPublicKey);
  });

  it('is reproducible from a chosen ephemeral secret', () => {
    const { metaAddress } = deriveStealthKeys(SEED);
    const ephemeral = new Uint8Array(32).fill(9);

    expect(deriveStealthPayment(metaAddress, ephemeral)).toEqual(
      deriveStealthPayment(metaAddress, ephemeral),
    );
  });

  it('lets the recipient recover the key behind the address', () => {
    // The whole point: a sender who has only the public record can produce an
    // address whose spending key the recipient can reconstruct.
    const { metaAddress, viewingSecretKey } = deriveStealthKeys(SEED);
    const payment = deriveStealthPayment(metaAddress);

    const recovered = deriveStealthPrivateKey(
      viewingSecretKey,
      payment.ephemeralPublicKey,
    );

    expect(recovered.address).toBe(payment.address);
    // The recovered seed is what a sweep signs with, and it is a full Ed25519
    // seed rather than a public-only hint.
    expect(recovered.secretKey).toHaveLength(32);
  });

  it('does not let the wrong viewing secret spend it', () => {
    const alice = deriveStealthKeys(SEED);
    const bob = deriveStealthKeys(new Uint8Array(32).fill(77));
    const payment = deriveStealthPayment(alice.metaAddress);

    expect(
      deriveStealthPrivateKey(bob.viewingSecretKey, payment.ephemeralPublicKey).address,
    ).not.toBe(payment.address);
  });

  it('refuses malformed inputs instead of deriving a plausible address', () => {
    const { metaAddress, viewingSecretKey } = deriveStealthKeys(SEED);
    const payment = deriveStealthPayment(metaAddress);

    expect(() => deriveStealthPayment(new Uint8Array(31))).toThrow(StealthError);
    expect(() => deriveStealthPrivateKey(new Uint8Array(31), payment.ephemeralPublicKey)).toThrow(
      StealthError,
    );
    expect(() => deriveStealthPrivateKey(viewingSecretKey, new Uint8Array(31))).toThrow(
      StealthError,
    );
  });
});

describe('the SEP-2 encoding', () => {
  it('round-trips a record through base64', () => {
    const { metaAddress } = deriveStealthKeys(SEED);
    const encoded = encodeMetaAddressBase64(metaAddress);

    expect(encoded).toHaveLength(44);
    expect(decodeMetaAddressBase64(encoded)).toEqual(metaAddress);
  });

  it('refuses base64 that decodes to the wrong length', () => {
    expect(() => decodeMetaAddressBase64(Buffer.from('short').toString('base64'))).toThrow(
      StealthError,
    );
  });
});

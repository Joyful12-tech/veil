/**
 * Paying a Veil name privately.
 *
 * A Veil name resolves to a `C…` contract address, which a classic payment
 * cannot address at all. The registry can carry a second, opt-in record on the
 * name — a stealth meta-address — and a sender derives a one-time `G…` address
 * from it. This module is the decision half: given what the registry said,
 * either produce a payment plan or refuse.
 *
 * ## Refusal is the point
 *
 * A name with no meta-address must not quietly fall back to a public payment.
 * The whole reason somebody asked for a private payment is that they do not
 * want the recipient, the amount or the link between them on a public ledger,
 * and a fallback would produce exactly that while the screen still claimed
 * privacy. So every failure here returns `ok: false` and the caller has
 * nothing to send.
 *
 * Kept free of RPC and wallet imports so the refusal rules can be tested
 * without a ledger, a passkey or a browser.
 */

import {
  deriveStealthPayment,
  decodeMetaAddress,
  META_ADDRESS_LENGTH,
} from '@veil/stealth'

/** The domain a private payment can be addressed under. */
export const VEIL_NAME_DOMAIN = 'useveilapp.xyz'

/** The registry's answer about a name's privacy record. */
export type MetaAddressLookup =
  | { status: 'present'; metaAddress: Uint8Array }
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'unavailable' }

/** A private payment that can be made. */
export type PrivatePaymentPlan =
  | {
      ok: true
      /** The bare name the registry knows. */
      name: string
      /** The full `name*useveilapp.xyz` address that was resolved. */
      federatedAddress: string
      /** The one-time `G…` address the payment goes to. */
      address: string
      /** Public hint the recipient needs to recover the key. */
      ephemeralPublicKey: Uint8Array
      /** The record this was derived from — worth showing so it can be compared. */
      metaAddress: Uint8Array
    }
  | {
      ok: false
      reason: 'not-a-veil-name' | 'no-meta-address' | 'invalid-meta-address' | 'unavailable'
      /** Shown verbatim: says what was refused and that nothing was sent. */
      message: string
      name: string | null
    }

/**
 * Fold `Ada*UseVeilApp.XYZ` or `ada` to the bare registry name.
 *
 * Returns null for another domain, an empty name, or a name carrying the
 * suffix twice. Answering for somebody else's domain is how a payment goes to
 * a name this registry never issued.
 */
export function parseVeilName(input: string): string | null {
  const trimmed = (input || '').trim().toLowerCase()
  if (!trimmed) return null

  const parts = trimmed.split('*')
  if (parts.length === 1) return parts[0] || null
  if (parts.length !== 2) return null
  if (parts[1] !== VEIL_NAME_DOMAIN) return null
  return parts[0] || null
}

/** The full federated form of a bare name. */
export function federatedName(name: string): string {
  return `${name}*${VEIL_NAME_DOMAIN}`
}

/** What a meta-address should look like before it is derived from. */
export function isUsableMetaAddress(metaAddress: unknown): metaAddress is Uint8Array {
  return metaAddress instanceof Uint8Array && metaAddress.length === META_ADDRESS_LENGTH
}

/**
 * Decide what to do with the registry's answer.
 *
 * `ephemeralSecret` is for tests; production callers omit it so every payment
 * gets a fresh address.
 */
export function planPrivatePayment(
  input: string,
  lookup: MetaAddressLookup,
  ephemeralSecret?: Uint8Array,
): PrivatePaymentPlan {
  const name = parseVeilName(input)
  if (!name) {
    return {
      ok: false,
      reason: 'not-a-veil-name',
      name: null,
      message:
        `Only a name issued under ${VEIL_NAME_DOMAIN} can be paid privately. ` +
        'Nothing was sent.',
    }
  }

  const address = federatedName(name)

  switch (lookup.status) {
    case 'absent':
      return {
        ok: false,
        reason: 'no-meta-address',
        name,
        message:
          `${address} has not published a privacy record, so it cannot be paid privately. ` +
          'Nothing was sent — a plain payment would be public.',
      }
    case 'invalid':
      return {
        ok: false,
        reason: 'invalid-meta-address',
        name,
        message:
          `${address} has a privacy record this app cannot read. ` +
          'Nothing was sent — contact the name holder to publish it again.',
      }
    case 'unavailable':
      return {
        ok: false,
        reason: 'unavailable',
        name,
        message:
          `Could not check whether ${address} accepts private payments, so no payment was prepared. ` +
          'Refusing rather than sending publicly.',
      }
    case 'present': {
      let metaAddress: Uint8Array
      try {
        metaAddress = decodeMetaAddress(lookup.metaAddress)
      } catch {
        return {
          ok: false,
          reason: 'invalid-meta-address',
          name,
          message:
            `${address} has a privacy record this app cannot read. ` +
            'Nothing was sent — contact the name holder to publish it again.',
        }
      }

      const payment = deriveStealthPayment(metaAddress, ephemeralSecret)
      return {
        ok: true,
        name,
        federatedAddress: address,
        address: payment.address,
        ephemeralPublicKey: payment.ephemeralPublicKey,
        metaAddress,
      }
    }
  }
}

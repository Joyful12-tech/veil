/**
 * @jest-environment node
 *
 * The derivation module imports `@stellar/stellar-sdk`, whose bundle needs
 * `TextEncoder` at load time. jsdom does not provide it, and the same reason is
 * why `federationServer.test.ts` runs in the node environment.
 */

import {
  VEIL_NAME_DOMAIN,
  federatedName,
  isUsableMetaAddress,
  parseVeilName,
  planPrivatePayment,
} from '../stealthPayment'

import { deriveStealthKeys, META_ADDRESS_LENGTH } from '@veil/stealth'

const SEED = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1))
const EPHEMERAL = new Uint8Array(32).fill(5)

describe('parseVeilName', () => {
  it('accepts a bare name and the full federated form', () => {
    expect(parseVeilName('ada')).toBe('ada')
    expect(parseVeilName('Ada*UseVeilApp.XYZ')).toBe('ada')
    expect(parseVeilName('  ada*useveilapp.xyz  ')).toBe('ada')
  })

  it('refuses another domain rather than answering for it', () => {
    expect(parseVeilName('ada*lobstr.co')).toBeNull()
    expect(parseVeilName(`ada*${VEIL_NAME_DOMAIN}.attacker.com`)).toBeNull()
  })

  it('refuses more than one asterisk and an empty name', () => {
    expect(parseVeilName('ada*useveilapp.xyz*extra')).toBeNull()
    expect(parseVeilName('*useveilapp.xyz')).toBeNull()
    expect(parseVeilName('')).toBeNull()
  })
})

describe('planPrivatePayment', () => {
  const { metaAddress } = deriveStealthKeys(SEED)

  it('derives a one-time G address from a published record', () => {
    const plan = planPrivatePayment('ada', { status: 'present', metaAddress }, EPHEMERAL)

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected a payment plan')
    expect(plan.federatedAddress).toBe(`ada*${VEIL_NAME_DOMAIN}`)
    expect(plan.address.startsWith('G')).toBe(true)
    expect(plan.address).toHaveLength(56)
    expect(plan.ephemeralPublicKey).toHaveLength(32)
    expect(plan.metaAddress).toEqual(metaAddress)
  })

  it('refuses a name with no record instead of sending publicly', () => {
    // The acceptance criterion that matters: no silent public fallback.
    const plan = planPrivatePayment('ada', { status: 'absent' }, EPHEMERAL)

    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected a refusal')
    expect(plan.reason).toBe('no-meta-address')
    expect(plan.message).toContain('Nothing was sent')
    expect(plan.message).toContain('public')
    expect(plan).not.toHaveProperty('address')
  })

  it('refuses when the registry could not be asked', () => {
    const plan = planPrivatePayment('ada', { status: 'unavailable' }, EPHEMERAL)
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected a refusal')
    expect(plan.reason).toBe('unavailable')
    expect(plan.message).toContain('Refusing rather than sending publicly')
  })

  it('refuses a record it cannot read', () => {
    const plan = planPrivatePayment('ada', { status: 'invalid' }, EPHEMERAL)
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected a refusal')
    expect(plan.reason).toBe('invalid-meta-address')
  })

  it('refuses a malformed record even if it was labelled present', () => {
    // Defensive: the lookup helper validates, but a caller could pass bytes
    // straight through, and deriving from a 31-byte key would be nonsense.
    const plan = planPrivatePayment(
      'ada',
      { status: 'present', metaAddress: new Uint8Array(META_ADDRESS_LENGTH - 1) },
      EPHEMERAL,
    )
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected a refusal')
    expect(plan.reason).toBe('invalid-meta-address')
  })

  it('refuses a name outside our domain', () => {
    const plan = planPrivatePayment('ada*lobstr.co', { status: 'present', metaAddress })
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected a refusal')
    expect(plan.reason).toBe('not-a-veil-name')
  })

  it('derives a different address for each payment', () => {
    const first = planPrivatePayment('ada', { status: 'present', metaAddress })
    const second = planPrivatePayment('ada', { status: 'present', metaAddress })
    if (!first.ok || !second.ok) throw new Error('expected payment plans')
    expect(first.address).not.toBe(second.address)
  })
})

describe('isUsableMetaAddress', () => {
  it('accepts exactly 32 bytes and nothing else', () => {
    expect(isUsableMetaAddress(new Uint8Array(32))).toBe(true)
    expect(isUsableMetaAddress(new Uint8Array(31))).toBe(false)
    expect(isUsableMetaAddress('ada')).toBe(false)
    expect(isUsableMetaAddress(null)).toBe(false)
  })
})

describe('federatedName', () => {
  it('appends the fixed domain', () => {
    expect(federatedName('ada')).toBe(`ada*${VEIL_NAME_DOMAIN}`)
  })
})

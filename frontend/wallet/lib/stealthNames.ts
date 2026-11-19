/**
 * Reading and publishing Veil names' stealth meta-addresses.
 *
 * The registry is the source of truth (`contracts/veil-names`): `meta_address`
 * answers for an active name with a record, and answers `None` for every other
 * case — no record, expired name, unknown name. `null` from the read helper
 * means "could not ask", which is deliberately a different answer from "the
 * holder did not publish one", and neither becomes a public payment.
 *
 * Publishing is owner-only on-chain (`set_meta_address` requires the holder's
 * authorisation, which is the wallet's passkey), and it is always opt-in.
 * Nothing here writes a record without an explicit call.
 */

import { nativeToScVal, rpc as SorobanRpc } from '@stellar/stellar-sdk'
import type { WebAuthnSignature } from '@veil/sdk'
import { deriveStealthKeys } from '@veil/stealth'

import { getNetwork } from './network'
import { namesContractIdFor } from './namesContractId'
import { simulateRead } from './sorobanRead'
import { invokeAsWallet, type AuthEntrySigner } from './walletInvoke'
import {
  type MetaAddressLookup,
  type PrivatePaymentPlan,
  isUsableMetaAddress,
  planPrivatePayment,
} from './stealthPayment'

function namesContractId(): string | null {
  return namesContractIdFor(getNetwork().name)
}

/**
 * Ask the registry for a name's meta-address.
 *
 * The three outcomes are kept apart on purpose. `simulateRead` returns null
 * when the call itself failed, and `Option::None` natives to undefined, so a
 * transport failure never gets reported as "this name has no privacy record".
 */
export async function lookupNameMetaAddress(
  name: string,
  read: typeof simulateRead = simulateRead,
): Promise<MetaAddressLookup> {
  const contractId = namesContractId()
  if (!contractId) return { status: 'unavailable' }

  const net = getNetwork()
  const value = await read(
    new SorobanRpc.Server(net.rpcUrl),
    contractId,
    'meta_address',
    [nativeToScVal(name, { type: 'string' })],
    net.networkPassphrase,
  )

  if (value === null) return { status: 'unavailable' }
  if (value === undefined) return { status: 'absent' }
  if (!isUsableMetaAddress(value)) return { status: 'invalid' }
  return { status: 'present', metaAddress: Uint8Array.from(value) }
}

/**
 * Resolve a name and derive the one-time address to pay, or refuse.
 *
 * `lookup` is injectable so screens and tests can supply an answer without an
 * RPC round trip; the default reads the chain.
 */
export async function resolvePrivateNamePayment(
  input: string,
  lookup?: (name: string) => Promise<MetaAddressLookup>,
): Promise<PrivatePaymentPlan> {
  const parsed = planPrivatePayment(input, { status: 'unavailable' })
  if (!parsed.ok && parsed.reason === 'not-a-veil-name') return parsed

  // `planPrivatePayment` normalises the input; reuse that instead of a second
  // parser that could disagree about the domain.
  const name = parsed.name
  if (!name) return parsed

  const answer = lookup ? await lookup(name) : await lookupNameMetaAddress(name)
  return planPrivatePayment(input, answer)
}

/**
 * The viewing identity a wallet publishes.
 *
 * Derived from the wallet's existing signing seed with a domain separator, so
 * the same wallet reproduces the same meta-address on another device and there
 * is no second secret to back up. The seed itself is never published — only
 * the X25519 public key is.
 */
export function stealthIdentityFromSeed(seed: Uint8Array) {
  return deriveStealthKeys(seed)
}

/** Publish a meta-address for a name. Owner-only, enforced on-chain. */
export async function publishNameMetaAddress(params: {
  name: string
  metaAddress: Uint8Array
  walletAddress: string
  feePayerKeypair: import('@stellar/stellar-sdk').Keypair
  signAuthEntry: AuthEntrySigner
}): Promise<string> {
  const contractId = namesContractId()
  if (!contractId) throw new Error('Veil names are not available on this network.')

  const net = getNetwork()
  return invokeAsWallet({
    contractId,
    method: 'set_meta_address',
    args: [
      nativeToScVal(params.name, { type: 'string' }),
      nativeToScVal(Buffer.from(params.metaAddress), { type: 'bytes' }),
    ],
    walletAddress: params.walletAddress,
    feePayerKeypair: params.feePayerKeypair,
    signAuthEntry: params.signAuthEntry,
    rpcUrl: net.rpcUrl,
    networkPassphrase: net.networkPassphrase,
    label: 'names.meta_address',
  })
}

/** Withdraw a name's meta-address. After this the name refuses private payments. */
export async function removeNameMetaAddress(params: {
  name: string
  walletAddress: string
  feePayerKeypair: import('@stellar/stellar-sdk').Keypair
  signAuthEntry: AuthEntrySigner
}): Promise<string> {
  const contractId = namesContractId()
  if (!contractId) throw new Error('Veil names are not available on this network.')

  const net = getNetwork()
  return invokeAsWallet({
    contractId,
    method: 'remove_meta_address',
    args: [nativeToScVal(params.name, { type: 'string' })],
    walletAddress: params.walletAddress,
    feePayerKeypair: params.feePayerKeypair,
    signAuthEntry: params.signAuthEntry,
    rpcUrl: net.rpcUrl,
    networkPassphrase: net.networkPassphrase,
    label: 'names.remove_meta_address',
  })
}

export type { MetaAddressLookup, PrivatePaymentPlan }
export type { WebAuthnSignature }

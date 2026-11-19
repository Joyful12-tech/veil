'use client'

/**
 * /send/private — pay a Veil name at a one-time address.
 *
 * The ordinary send screen resolves `name*useveilapp.xyz` to the name's `C…`
 * contract address and builds a classic payment to it. That is fine when the
 * name resolves to an address you can pay, but it is public: the sender, the
 * amount and the recipient are all on the ledger, and a classic-only sender
 * cannot address the contract at all.
 *
 * This screen uses the name's optional stealth record instead. The registry's
 * meta-address is resolved, a fresh `G…` address is derived from it, and only
 * that address is handed to the ordinary send flow. Every payment gets a
 * different address, so two payments to the same name cannot be linked by
 * destination.
 *
 * ## Why it refuses so much
 *
 * If the name has no record, this screen says so and offers nothing to send. A
 * fallback to the public address would be worse than useless: the user asked
 * for a private payment, and the ledger would show a public one while the
 * screen said otherwise. The same is true when the registry cannot be read —
 * "we could not check" is a refusal here, not a reason to guess.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useInactivityLock } from '@/hooks/useInactivityLock'
import { resolvePrivateNamePayment } from '@/lib/stealthNames'
import { SUFFIX } from '@/lib/names'

export default function PrivateSendPage() {
  useInactivityLock()

  const [query, setQuery] = useState('')
  const [isResolving, setIsResolving] = useState(false)
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof resolvePrivateNamePayment>> | null>(
    null,
  )
  const [copied, setCopied] = useState(false)

  const handleResolve = async () => {
    const trimmed = query.trim()
    if (!trimmed) return
    setIsResolving(true)
    setPlan(null)
    setCopied(false)
    try {
      setPlan(await resolvePrivateNamePayment(trimmed))
    } finally {
      setIsResolving(false)
    }
  }

  const handleCopy = async () => {
    if (!plan?.ok) return
    try {
      await navigator.clipboard.writeText(plan.address)
      setCopied(true)
    } catch {
      // Clipboard access can be denied by the browser; the address is on
      // screen in full so it can still be selected by hand.
      setCopied(false)
    }
  }

  return (
    <main className="min-h-screen bg-near-black px-4 py-14 text-off-white">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-lora text-[clamp(30px,4vw,42px)] font-semibold italic leading-tight">
            Send privately
          </h1>
          <Link href="/send" className="text-sm text-off-white/60 underline hover:text-off-white">
            Normal send
          </Link>
        </div>

        <p className="text-[15px] leading-relaxed text-off-white/60">
          A private payment goes to a fresh address derived from the name&apos;s stealth record,
          not to the name&apos;s public wallet address. The name&apos;s holder has to publish that
          record first; it is opt-in, and a name without one cannot be paid privately.
        </p>

        <div className="rounded-3xl border border-border-dim bg-surface p-6">
          <label htmlFor="private-name" className="text-sm text-off-white/60">
            Veil name
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id="private-name"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPlan(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleResolve()
              }}
              placeholder={`ada${SUFFIX}`}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-pill border border-border-dim bg-[#161616] px-5 py-3 font-mono text-off-white outline-none focus:border-gold/50"
            />
            <button
              type="button"
              onClick={() => void handleResolve()}
              disabled={isResolving || query.trim().length === 0}
              className="rounded-pill bg-gold px-5 py-3 font-semibold text-near-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-md disabled:text-off-white/40"
            >
              {isResolving ? 'Checking…' : 'Find private address'}
            </button>
          </div>

          {plan && !plan.ok && (
            <p role="alert" className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm leading-relaxed text-red-200">
              {plan.message}
            </p>
          )}

          {plan && plan.ok && (
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <p className="text-sm text-off-white/60">One-time payment address</p>
                {/* The full address, never an ellipsis. A payment address that
                    cannot be compared character by character is not a payment
                    address, and this screen exists to avoid sending to the
                    wrong destination. */}
                <p className="mt-2 break-all rounded-2xl border border-border-dim bg-[#0F0F0F] p-4 font-mono text-[15px] leading-relaxed">
                  {plan.address}
                </p>
              </div>

              <p className="text-sm text-off-white/50">
                This address was derived for {plan.federatedAddress} and is used once. A new one
                is generated for the next payment.
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="rounded-pill border border-border-dim px-5 py-2.5 text-sm font-semibold hover:border-gold/40 hover:text-gold"
                >
                  {copied ? 'Copied' : 'Copy address'}
                </button>
                <Link
                  href={`/send?to=${encodeURIComponent(plan.address)}`}
                  className="rounded-pill bg-gold px-5 py-2.5 text-sm font-semibold text-near-black hover:opacity-90"
                >
                  Continue to send
                </Link>
              </div>

              <Link
                href="/send/private"
                onClick={() => setPlan(null)}
                className="text-sm text-off-white/50 underline hover:text-off-white"
              >
                Start over with a new address
              </Link>
            </div>
          )}
        </div>

        <p className="text-sm leading-relaxed text-off-white/40">
          The holder can withdraw the record at any time; after that this screen refuses the name
          instead of sending to it publicly. Publishing or removing a record is done from the
          name&apos;s page in this app.
        </p>
      </div>
    </main>
  )
}

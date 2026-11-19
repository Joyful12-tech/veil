---
"invisible-wallet-sdk": minor
---

Add stealth addresses for Veil names.

`deriveStealthKeys`, `deriveStealthPayment` and `deriveStealthPrivateKey`
implement the two sides of a one-time payment address: a holder publishes a
32-byte X25519 meta-address, a sender derives a fresh `G…` address from it, and
the holder recovers the spending key from the ephemeral public key. The
meta-address is also encoded and decoded from the base64 form a SEP-2
federation response carries.

This is what makes a Veil name payable by a classic-only sender, which cannot
address the name's `C…` contract account at all.

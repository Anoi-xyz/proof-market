# ProofMarket

A marketplace demo where users can claim digital items using one of two paths:

1. **Pay with Sepolia ETH** — send a fixed amount of testnet ETH to a Sepolia receiver address.
2. **Prove with PnL** — cryptographically prove your Binance spot PnL meets the tier threshold using [Primus zkTLS](https://docs.primuslabs.xyz/), without any money changing hands.

Built on top of the **ProofPnL** codebase. Stack: React + Vite + Tailwind + Vercel serverless + Upstash Redis.

---

## Project overview

```
src/
  items.js                    — item definitions (4 tiers: Starter, Silver, Gold, Platinum)
  App.jsx                     — root component: gate + nav + market + modals
  pages/MarketPage.jsx        — grid of 4 item cards
  components/
    StickyNav.jsx             — nav with wallet status and theme toggle
    ItemCard.jsx              — card for one item
    CheckoutModal.jsx         — ETH and PnL checkout flows
    ReceiptCard.jsx           — post-claim receipt with download
    UsernameGate.jsx          — username overlay (unchanged from ProofPnL)
    Footer.jsx                — site footer
    HowItWorksSection.jsx     — (kept, unused in market view)
    PrivacySection.jsx        — (kept, unused in market view)
  hooks/
    useWallet.js              — MetaMask connection + sendPayment()
    useMarketAttestation.js   — Primus attestation with dynamic wallet address
    usePrimusAttestation.js   — original hook (kept, unused)
    useTheme.js               — dark/light toggle
    useGaze.js                — owl eye tracking (kept)
    useScrollReveal.js        — scroll animations (kept)
api/
  sign.js                     — POST /api/sign — backend Primus signing
  claim.js                    — POST /api/claim — claim validation + Redis storage
```

---

## Two payment modes

### 💎 Pay with Sepolia ETH

1. User connects MetaMask and switches to Sepolia testnet (chain ID 11155111).
2. Clicks "Pay with Sepolia" on an item card.
3. CheckoutModal sends `0.001 ETH` to `VITE_RECEIVER_ADDRESS` via `ethers.BrowserProvider`.
4. After 1 on-chain confirmation, the tx hash is POSTed to `POST /api/claim` with `mode: 'eth'`.
5. Server validates the tx hash format, checks for duplicate claims in Redis, stores the claim, and returns a receipt.

> **Note:** The server validates the tx hash format (`0x` + 64 hex chars) but does **not** verify on-chain confirmation independently (that would require a Sepolia RPC URL). For a production system, add an RPC call in `api/claim.js` using `ethers` on the server to confirm the transaction.

### 🔒 Prove with PnL

1. User connects MetaMask (wallet address is passed to `generateRequestParams`).
2. Clicks "Prove with PnL" on an item card.
3. `useMarketAttestation` runs the full Primus zkTLS attestation flow:
   - Instantiates `PrimusZKTLS` and calls `init(APP_ID)` (requires the [Primus browser extension](https://chrome.google.com/webstore/detail/primus)).
   - Calls `generateRequestParams(TEMPLATE_ID, walletAddress)` — the wallet address is embedded in the request, binding the attestation to this specific wallet.
   - POSTs the request string to `/api/sign` for HMAC signing with `APP_SECRET`.
   - Calls `startAttestation(signedRequestStr)` — the extension opens a Binance login flow, fetches the PnL data via zkTLS, and returns a signed attestation object.
4. The attestation object is POSTed to `POST /api/claim` with `mode: 'pnl'`.
5. Server runs **6+ checks** (see below) and returns a receipt on success.

---

## Server-side checks in `api/claim.js`

For the PnL path, the server performs all of the following validations in order:

| # | Check | How |
|---|-------|-----|
| 1 | **Template ID enforcement (sign & claim)** | `/api/sign` parses `requestStr` and rejects any template ID other than `369e1db8-47c9-4dc6-85b5-037cd02d3383`; `/api/claim` also validates any template ID exposed on `attestation` |
| 2 | **Item exists** | `itemId` must be one of the 4 known item IDs (thresholds defined server-side, never trusted from client) |
| 3 | **Valid wallet address** | `walletAddress` must match `/^0x[0-9a-fA-F]{40}$/` |
| 4 | **Attestation present** | `attestation` must be a non-null object |
| 5 | **Cryptographic signature** | `primus.verifyAttestation(attestation)` — synchronous, validates the Primus attestor signature |
| 6 | **Recency** | `attestation.timestamp` must be within the last **10 minutes** (prevents replaying old attestations) |
| 7 | **Wallet binding** | `attestation.recipient.toLowerCase()` must equal `walletAddress.toLowerCase()` — the wallet that generated the proof must be the same one claiming the item |
| 8 | **PnL threshold** | Parse `JSON.parse(attestation.data).spotPnlRate`; must be `≥ item.minPnl` (server-defined) |
| 9 | **Replay protection** | SHA-256 hash of `attestation.signatures[0]` stored in Redis with 24h TTL; rejects if already used |
| 10 | **One claim per wallet per item** | Redis key `claim:pnl:{wallet}:{itemId}`; rejects if already set |

For the ETH path, the server checks:
- Item exists, valid wallet address, valid tx hash format, one-claim-per-wallet-per-item in Redis.

---

## Wallet security & transparency

ProofMarket implements strict safeguards to eliminate wallet security false positives:

1. **No connection on page load:** The app registers passive listeners only; `eth_requestAccounts` is never called until the user explicitly clicks "Connect Wallet".
2. **Explicit Sepolia transfer confirmation:** Before sending testnet ETH, the modal displays a dedicated review card with the exact amount (`0.001 Sepolia ETH`), the network (`Sepolia Testnet 11155111`), the full copyable receiver address, and a prominent banner: *"Sepolia testnet demo. No real funds."*
3. **Zero auto-signing & zero approvals:** The app never requests `personal_sign`, `eth_signTypedData`, or ERC-20 `approve`/permit allowances. The only wallet actions are explicit connection and the single user-confirmed testnet ETH transaction.
4. **Transparent demo notice:** A persistent top banner identifies the app as a testnet demo built for the Primus zkTLS challenge, accompanied by an in-depth About section explaining the security architecture.

---

- **PnL proof is a credential, not a payment.** The PnL path proves the user has a certain PnL rate on Binance but no money changes hands. The item is "claimed" on the app server — it has no on-chain representation.

- **The exact PnL rate is visible to the app server.** The server reads `spotPnlRate` from `attestation.data` to enforce the threshold. The rate is not returned to the client in the receipt (only the tier threshold), but it is logged/stored server-side.

- **No Binance account ID binding.** The Primus template for Binance PnL returns no account identifier. A single Binance account could back attestations for multiple wallets (one person, multiple MetaMask addresses, multiple claims of the same tier).

- **Template ID binding.** Template binding is enforced at the signing gateway: `/api/sign` parses `requestStr` and explicitly rejects any request with a template ID other than `369e1db8-47c9-4dc6-85b5-037cd02d3383`. In addition, `/api/claim` validates any template reference exposed by the attestation or request payload. In the Primus SDK `Attestation` type, the template ID itself is not a required root field; instead, cryptographic verification via `primus.verifyAttestation(attestation)` guarantees the attestor signature was derived from our signed request.

- **ETH tx not verified on-chain.** The ETH claim path only validates tx hash format. Add a Sepolia RPC call in `api/claim.js` to verify on-chain if needed for production.

---

## Setup

### Prerequisites

- Node.js 18+
- pnpm
- [Primus browser extension](https://chrome.google.com/webstore/detail/primus) installed in Chrome
- MetaMask with Sepolia testnet configured
- Upstash Redis account (free tier works)
- Primus developer account (get `APP_ID` and `APP_SECRET` from [primuslabs.xyz](https://primuslabs.xyz))

### Install

```bash
pnpm install
```

### Environment variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_APP_ID` | ✅ | Primus App ID (exposed to browser) |
| `APP_SECRET` | ✅ | Primus App Secret (server only — **never** prefix with `VITE_`) |
| `VITE_RECEIVER_ADDRESS` | ✅ | Sepolia ETH receiver address for payments |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis REST token |

### Development

```bash
pnpm dev
```

The local dev server runs at `http://localhost:5173`. API routes are proxied via `vite.config.js`.

### Deploy to Vercel

```bash
vercel deploy
```

Set all environment variables in the Vercel dashboard (Project → Settings → Environment Variables). The Upstash integration in the Vercel Marketplace can auto-provision `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

---

## Item tiers

| Tier | Price (USD equiv.) | Min PnL required |
|------|-------------------|-----------------|
| Starter | \$3 | ≥ +1% |
| Silver | \$5 | ≥ +3% |
| Gold | \$10 | ≥ +5% |
| Platinum | \$20 | ≥ +10% |

---

## Credits

Built by **anoi** · powered by [Primus zkTLS](https://primuslabs.xyz)

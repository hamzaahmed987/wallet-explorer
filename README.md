# Wallet Overview

A small multichain EVM wallet explorer. Paste a public wallet address to view its native balance, token holdings, and recent transaction history on **Ethereum**, **Base**, **Polygon**, **Arbitrum**, or **Optimism**.

> Public data only. Never enter a private key or recovery phrase.

## Features

- **Multi-chain** — pick a chain from the dropdown without retyping the address.
- **Balance** — native coin balance for the selected chain.
- **Transactions** — newest-first list of confirmed transactions with hash, direction (Sent/Received), from/to, value, date, and status.
- **Pagination** — browse older pages and step back to newer ones.
- **Tokens** — up to 12 priced token holdings with symbol, name, contract, formatted balance, and USD value (spam, dust, zero-balance and unpriced tokens filtered).
- **Deep links** — open any address, transaction, or token in Blockscout.
- **Copy address** — one-click copy of the full address.
- **Shareable URLs** — the address and chain are stored in the query string.
- **Server-side lookup** — all GoldRush requests go through a Next.js API route; the API key never reaches the browser.

## Tech stack

- [Next.js](https://nextjs.org/) 15 (App Router)
- React 19
- [GoldRush (Covalent)](https://www.covalenthq.com/) v1 API — one endpoint format for every supported chain
- Plain CSS with light/dark theme via `prefers-color-scheme`

## Getting started

### Prerequisites

- Node.js 20 or newer
- npm (bundled with Node)
- A free GoldRush API key

### Install & run

```bash
npm install
cp .env.example .env.local   # then add your GoldRush key
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production build

```bash
npm run build
npm run start
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `GOLDRUSH_API_KEY` | yes | Server-side GoldRush (Covalent) API key. Read only in `app/api/wallet/[address]/route.js`. |

Set it in `.env.local`, which is git-ignored. The key is never exposed with a `NEXT_PUBLIC_` prefix, never sent to the browser, and never logged.

Supported chains live in `lib/networks.js`. Each entry is `{ id, label, chainName, symbol, explorerUrl }`; adding a chain is a single new entry — the route and the UI both read from that map.

> **Sepolia is not supported.** GoldRush's free plan answers `404 "Chain eth-sepolia not supported"` for that chain, so it is deliberately left out of the registry.

## Usage

1. Pick a chain in the top-right dropdown.
2. Paste a 42-character `0x…` EVM address (wallet or contract) and press **Explore**.
3. Review the balance, transaction list, and token holdings.
4. Use **Copy** to copy the address, **Blockscout** to open it in the explorer, or the pager to load older transactions.

Notes:

- Balances and values are rendered from the raw integer amounts using `BigInt` scaling, so very large balances stay exact.
- Only normal (external) transactions are listed. Internal transactions and token transfers are not included.
- GoldRush returns 100 transactions per page (its `page-size` parameter is ignored on the free tier), newest first.
- Up to 12 token balances are shown.
- The wallet owner's **name** is only displayed when GoldRush provides a label for the address; otherwise the UI says "Name: not available".

## API

The app exposes a single server route:

```text
GET /api/wallet/:address?network=<id>&cursor=<base64url>
```

- `:address` — 42-character hex address (validated server-side with `^0x[a-fA-F0-9]{40}$`).
- `network` — one of the `id` values in `lib/networks.js` (`ethereum` default, `base`, `polygon`, `arbitrum`, `optimism`). Unknown values are rejected with `400`.
- `cursor` — opaque pagination cursor returned as `nextCursor`.

Response (JSON):

```json
{
  "address": "0x…",
  "network": "ethereum",
  "name": null,
  "balance": "1.234",
  "pendingCount": 0,
  "transactions": [
    {
      "hash": "0x…",
      "from": "0x…",
      "to": "0x…",
      "timestamp": "2026-…",
      "value": "0.5",
      "direction": "Sent",
      "status": "success"
    }
  ],
  "tokens": [
    {
      "address": "0x…",
      "name": "Token",
      "symbol": "TKN",
      "amount": "100",
      "quote": 12.34
    }
  ],
  "nextCursor": "…"
}
```

`balance`, transaction `value` and token `amount` are decimal **strings**, not floats. `pendingCount` is always `0`: GoldRush does not report pending transactions. `name` is `null` unless a provider label exists for the address.

Errors return `{ "error": "…" }` with HTTP 400 (invalid address or network), 404 (address not found), or 502 (upstream unavailable). Upstream details stay in the server log.

## Project structure

```text
.
├── app/
│   ├── api/wallet/[address]/route.js   # server-side GoldRush lookup, mapping + pagination
│   ├── globals.css                     # styles (light + dark)
│   ├── layout.js                       # root layout + metadata
│   └── page.js                         # client UI
├── lib/networks.js                     # supported chain registry (shared)
├── tests/wallet-route.test.mjs         # route tests with a mocked fetch
├── .env.example
└── package.json
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Run the production server. |
| `npm run lint` | Run ESLint. |
| `npm test` | Run the route tests (Node's built-in test runner, no network calls). |

## Limitations

- EVM chains only: Bitcoin and Solana need separate adapters.
- No combined "all chains at once" view yet.
- Normal transactions only; no internal transactions or token transfers in the history list.
- Token balances are as reported by GoldRush (requested with its server-side `no-spam` filter) and limited to 12 entries.
- Unofficial token contracts without a price are hidden, so some real holdings may not appear.
- Paging backward uses GoldRush page numbers, which can shift slightly if new transactions arrive between page loads.
- Data is cached/revalidated every 20 seconds server-side; upstream requests time out after 10 seconds. Busy wallets on slower chains (Optimism especially) can take close to that.
- Testnet support depends on GoldRush plan availability (Sepolia is unavailable on the free plan).

## Security

- Only public addresses are accepted; the app never requests or stores private keys or seed phrases.
- The GoldRush key is read from `process.env.GOLDRUSH_API_KEY` on the server only. Do not paste it into client code or a `NEXT_PUBLIC_` variable.
- Token names and symbols come from untrusted contracts and are rendered as plain text only — never as HTML or links.
- Do not paste a private key or recovery phrase into the address field.

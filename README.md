# TrustTrade

TrustTrade is a local-only blockchain escrow marketplace mini project. The React frontend, Hardhat chain, and contract all run on your computer. Sixteen product listings and seller accounts are demo data; escrow actions use real transactions on the local Hardhat blockchain and test ETH only.

## Requirements

- Node.js 20 or newer
- VS Code (or any editor) and MetaMask browser extension

Install dependencies once from the project folder:

```powershell
npm install
```

## Run locally

Open the project folder in VS Code. Start three terminals in the project directory.

**Terminal 1 — local blockchain:**

```powershell
npm run node
```

Leave this running. Hardhat prints local test accounts and their test-only private keys. They reset when the local node is restarted.

**Terminal 2 — deploy the escrow contract:**

```powershell
npm run deploy:local
```

This compiles and deploys `TrustTradeEscrow` to the local chain, then writes its local address and ABI to `frontend/public/contract-deployment.json`. The first Hardhat account is the arbitrator.

**Terminal 3 — start the marketplace:**

```powershell
npm run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). The app has no hosted APIs, RPC providers, databases, external images, or remote font dependencies.

## MetaMask setup

In MetaMask, add a network with these values:

| Setting | Value |
| --- | --- |
| Network name | Hardhat Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

Connect MetaMask to that network, then import a test account using a private key printed by the running `npm run node` terminal. These are disposable local accounts. Never use a real wallet or real funds for this demo. The sample listings use Hardhat accounts 1–3 as sellers; use a different account as the buyer. Use account 0 (the deployer) to resolve disputes.

## Tests and build

```powershell
npm test
npm run build
```

`npm test` runs the escrow contract tests. `npm run build` type-checks and builds the local frontend.

## Escrow lifecycle

- A buyer deposits test ETH when creating an escrow. The refund deadline is 24 hours after the sample purchase.
- The listed seller can mark a funded escrow delivered.
- The buyer can then release payment to the seller.
- If still funded after its deadline, the buyer can claim a refund.
- The buyer or seller can dispute a funded or delivered escrow. Only the immutable contract deployer/arbitrator can resolve it, choosing the buyer or seller as recipient.
- Winners withdraw their credited funds separately. The contract uses pull payments and prevents reentrant withdrawals.

All lifecycle checks are enforced by the Solidity contract; the frontend only enables matching actions for convenience.

## Marketplace cart

Add products to the cart while browsing, search or filter the sample listings, and review the subtotal before checkout. The cart is saved in the browser's local storage. Each cart item is a separate escrow in the current contract, so MetaMask asks you to confirm one local test transaction per item. If a later confirmation is cancelled, already-confirmed escrows remain on-chain and the unsubmitted items stay in the cart.

The interface includes a translucent glass treatment, a light/dark theme switch (saved locally), Lucide icons, and 16 locally stored photorealistic catalog photos in `frontend/public/images/`. The site does not request product images, fonts, or other assets from a remote service.

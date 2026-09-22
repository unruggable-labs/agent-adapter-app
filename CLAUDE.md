# agent-adapter-app

**The product in one sentence: profiles and reviews for AI agents** — the wallets agents do
business with get a lookup ("who operates this, and are they any good?"). Lead every surface
and explanation with that; introduce mechanism only as answers to attacks (impersonation →
mutual pointing, review-wiping → append-only log, cost → counterfactual claims, ownership →
deed bindings). Vocabulary: **the agent** (off-chain software) / **the record** (UBID, where
reputation lives) / **the deed** (what controls the record) / **the hands** (operating wallet).
Say "agent", never "bot". Copy is written in Thomas's plain voice: short sentences,
contractions, no jargon-first explanations, plain dashes (never em dashes) in all site copy,
tooltips kept to the fewest sentences that do the job.

## Map

- `indexer/` — event-sourced projection engine over the Adapter contracts (the adapter is
  emit-only; the indexer IS the database — state replays from chain events, no persistence).
  `SPEC.md` documents the projection rules. `serve.ts` = standalone chain indexer;
  `run-demo.ts` = anvil devnet + seeded scenario + assertions; `service.ts` = host-agnostic
  API core, also used by the Vercel function in `app/api/`.
- `app/` — Vite/React UI (Linear/Stripe-register design, tokens in `src/design.css`, light
  default + dark toggle). Dev-only: local-devnet network + anvil persona writes, chosen with
  VITE_NETWORK=local. Production picks Sepolia or Ethereum from the hostname; writes go through the user's
  connected wallet (wagmi + Reown AppKit, needs VITE_WC_PROJECT_ID). Personas are devnet-only.
- `contracts/` + `indexer/artifacts/` — vendored demo mock + build artifacts; regeneration
  from the contracts repo is documented in `indexer/src/abi.ts`.
- Contracts live in `unruggable-labs/adapter` (Prem's repo — audit-grade, don't put product
  code there). Sepolia proxy `0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92`, v0.0.17 cutover
  block 11661779. Ethereum proxy `0xde152AfB7db5373F34876E1499fbD893A82dD336`, not yet on
  v0.0.17 - its indexer waits on MAINNET_FROM_BLOCK.

## Commands

- `npm run dev:all` (repo root) — full local stack: :8787 local API, :8788 Sepolia API, :5173 app
- `cd indexer && npm test` — projection conformance tests
- `cd indexer && npx tsx src/run-demo.ts` — full e2e with assertions (must stay green)

## Deploy

Push to `main` = production deploy (GitHub Action → Hetzner box shared with ens8004.xyz →
systemd `adapter-indexer@<network>` + Caddy). Live at https://testnet.adapterscan.com (Sepolia);
https://adapterscan.com is Ethereum and redirects to testnet until the mainnet proxy runs
v0.0.17 and its indexer is enabled (deploy/README.md "Mainnet"). One static build serves both:
the app picks its network from the hostname. Server config is versioned in `deploy/`; box access:
`ssh ens8004` (deploy) or `root@178.105.235.22` (same key, admin). RPC is PublicNode's free
endpoint by default (`SEPOLIA_RPC_URL` in `/etc/adapter.env` overrides; beware: load-balanced
free RPCs have been observed returning incomplete logs — serve.ts verifies backfills).

## Open decisions

The product is Adapterscan at adapterscan.com; the repo name is still the old placeholder. The trust-flag
policy is disclosure-not-suppression by explicit decision (see indexer/SPEC.md §6).

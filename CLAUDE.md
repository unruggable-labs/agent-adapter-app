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
  emit-only; the indexer IS the database — state is a fold over chain events). The event log is
  kept in SQLite (`eventlog.ts`, `data/<network>.sqlite`, `node:sqlite`, no native deps): a
  restart folds from the file and syncs from its checkpoint; a reorg truncates the log at the
  fork point and refolds (`ingest.ts`). The file is a copy of the chain - delete it to re-index.
  `SPEC.md` documents the projection rules. `serve.ts` = standalone chain indexer;
  `run-demo.ts` = anvil devnet + seeded scenario + assertions; `service.ts` = host-agnostic
  API core; `views.ts` = identity views served from memory, with a worker that reads the chain
  facts around each identity (holder, name, trust base) on its own budget - no request reads the
  chain per identity. `server.ts` also serves the built
  app's HTML for page paths with title/description/social-card tags filled in (`meta.ts`), the
  card PNGs at `/og/*` (`og.ts`, satori + resvg), `robots.txt` and `sitemap.xml` - Caddy sends
  non-file paths to it. The app uses path routes (`/identity/<ubid>`), not hash routes.
- `app/` — Vite/React UI (Linear/Stripe-register design, tokens in `src/design.css`, light
  default + dark toggle). Two entries in one build: `index.html` (the explorer) and `docs.html`
  (`src/docs/`, the documentation site at docs.adapterscan.com - the model page, the protocol
  concepts, a quickstart, the contract map and deployments; the contract repo stays the source
  of truth and the docs link to it). Dev-only: local-devnet network + anvil persona writes, chosen with
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
systemd `adapter-indexer@<network>` + Caddy). One hostname per chain, one static build: the app
picks its network from the hostname. Live: testnet.adapterscan.com (Sepolia),
robinhood.adapterscan.com (Robinhood Chain, proxy 0x000000009d62675362a58911e3f32FEcf46F5E18,
v0.0.17 from block 75810067). Pending the v0.0.17 upgrade: base.adapterscan.com and the apex
(Ethereum) - the apex shows a chain picker until then (deploy/README.md "Mainnet"). Server config is versioned in `deploy/`; box access:
`ssh ens8004` (deploy) or `root@178.105.235.22` (same key, admin). RPC is PublicNode's free
endpoint by default (`SEPOLIA_RPC_URL` in `/etc/adapter.env` overrides; beware: load-balanced
free RPCs have been observed returning incomplete logs — serve.ts verifies backfills).

## Open decisions

The product is Adapterscan at adapterscan.com; the repo name is still the old placeholder. The trust-flag
policy is disclosure-not-suppression by explicit decision (see indexer/SPEC.md §6).

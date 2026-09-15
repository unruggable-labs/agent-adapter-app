# adapter-app

The product built on the [Adapter](https://github.com/unruggable-labs/adapter) protocol:
**profiles and reviews for AI agents** — an event-sourced indexer and a web app over the
adapter's on-chain identity, wallet-resolution, and attestation surfaces.

> Placeholder name — this repo renames when the product's domain/branding lands.

- **`indexer/`** — the projection engine (the adapter is emit-only, so the indexer is the
  database), REST API, local anvil demo, and `SPEC.md` documenting the projection rules.
  Runs as a Node service (`serve.ts`) or as the Vercel function in `app/api/`.
- **`app/`** — the UI: landing, explorer, profiles, create wizard, wallet page. Static
  Vite build; dev-only persona flows for the local devnet.
- **`deploy/`** — production config for the ens8004 Hetzner box (systemd + Caddy + the
  GitHub Action in `.github/workflows/deploy.yml`).
- **`contracts/DemoPunks.sol`** + **`indexer/artifacts/`** — the demo's contract mock and
  vendored build artifacts; regeneration from the contracts repo is documented in
  `indexer/src/abi.ts`.

## Quick start

```sh
cd indexer && npm install && npm test
npm run demo -- --serve          # anvil + seeded scenario + API on :8787
npm run serve:sepolia            # live Sepolia indexer on :8788 (optional)

cd ../app && npm install
npm run dev                      # http://localhost:5173
```

Extracted from `unruggable-labs/adapter` (branch `indexer`) with history; the contracts,
their tests, and deployment records live there.

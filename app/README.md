# @adapter/app

The product UI. See `packages/indexer` for the API it reads and the projection rules.

## Develop

```sh
# terminal 1 — local devnet + indexer on :8787
cd ../indexer && npm run demo -- --serve

# terminal 2 — Sepolia indexer on :8788 (optional)
cd ../indexer && npm run serve:sepolia

# terminal 3 — the app
npm run dev   # http://localhost:5173, Network selector in the sidebar
```

## Deploy (Vercel)

The app is a static Vite build; the Sepolia indexer ships alongside it as a serverless
function (`api/sepolia/[...path].ts`) that backfills on cold start and syncs incrementally
per request — no long-running process, so it fits the Hobby plan.

- Vercel project **Root Directory: `packages/app`**, framework Vite (auto-detected).
  Enable "Include source files outside of the Root Directory" — the function imports the
  projection core from `packages/indexer/src`.
- Optional env: `SEPOLIA_RPC_URL` (function), `VITE_SEPOLIA_API` / `VITE_SEPOLIA_RPC` (build).
  Defaults: same-origin `/api/sepolia` and the public Sepolia RPC.
- Production builds show Sepolia only (read-only); the local-devnet network and the
  writable persona flows exist only in dev builds.
- After an upstream ABI change, regenerate the vendored ABI:
  `jq .abi out/AdapterImplementation.sol/AdapterImplementation.json > ../indexer/src/adapter-abi.json`.

Note: Vercel's Hobby tier is licensed for non-commercial use — fine for a preview; move to
Pro when this becomes the public product.

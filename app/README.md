# @adapter/app

The product UI. See `indexer` for the API it reads and the projection rules.

## Develop

```sh
# terminal 1 — local devnet + indexer on :8787
cd ../indexer && npm run demo -- --serve

# terminal 2 — Sepolia indexer on :8788 (optional)
cd ../indexer && npm run serve:sepolia

# terminal 3 — the app
npm run dev   # http://localhost:5173, Network selector in the sidebar
```

## Deploy

Push to `main` deploys: one static build, one indexer service per chain, on the Hetzner box.
The server config is versioned in `../deploy/` and documented in `../deploy/README.md`.

After an upstream ABI change, regenerate the vendored ABI:
`jq .abi out/AdapterImplementation.sol/AdapterImplementation.json > ../indexer/src/adapter-abi.json`.

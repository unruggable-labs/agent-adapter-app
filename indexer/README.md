# @adapter/indexer

Event-sourced indexer, REST API, and demo UI for **Adapter8004 v0.0.17**: UBID identities,
counterfactual claims, wallet UBIDs, and attestations. The adapter is emit-only for everything but
`Binding` storage, so this indexer *is* the database — the projection rules it implements are
written down in [`SPEC.md`](./SPEC.md).

## Layout

- `src/ubid.ts` — off-chain derivation of the ERC-7930 interoperable address, the UBID
  (`keccak256(abi.encode(adapterIA, standard, boundAddress, tokenId))`), and the `attestationId`.
  Verified byte-for-byte against the contract's `hashBinding` in the demo.
- `src/projection.ts` — the pure fold: counterfactual latest-wins, registration join by UBID,
  wallet-UBID mutual verification, attestation projection (spec §5–§6), trust flags.
- `src/ingest.ts` — log poller; reorg strategy is replay-from-scratch.
- `src/server.ts` + `ui/index.html` — REST API and a single-page UBID explorer.
- `src/deploy.ts` / `src/demo.ts` / `src/run-demo.ts` — local stack (anvil) and the end-to-end
  product scenario with assertions.

## Run it

```sh
# from the repo root (artifacts must exist):
forge build

cd indexer
npm install
npm test          # 14 projection conformance tests
npm run demo      # spins anvil, deploys, runs the scenario, asserts 24 end-state checks
npm run demo -- --serve   # same, then serves API + UI on http://127.0.0.1:8787
```

The demo tells four stories: (A) Punk #7 — counterfactual claim, the two-party wallet handshake (Alice names the bot's operating key, the bot points back),
stars/ratings/review/interaction, a revocation resurrecting an older rating, then full ERC-8004
registration joining the same UBID; (B) Punk #9 — pre-mint collection bootstrap, owner takeover,
burn, and the collection re-claiming the reputed identity (surfaced as the
`collectionAuthoredAfterOwner` trust flag); (C) a bare EOA as an agent under `ACCOUNT`;
(D) an attestation landing before its target's first claim and acquiring meaning later.

## API

- `GET /api/overview` — counts, adapter, chain
- `GET /api/identities` — all identities with reputation and trust flags
- `GET /api/identity/:ubid` — one identity
- `GET /api/wallet/:address` — reverse resolution with the mutual-pointing verdict
- `GET /api/attestations` — raw attestation records, resolved or not

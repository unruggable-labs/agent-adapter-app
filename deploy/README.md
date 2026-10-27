# Box setup — adapter stack

Configuration for running the adapter indexer + app on the ens8004 Hetzner box
(178.105.235.22), versioned here so server config drift is visible in git.
Mirrors the conventions of the ens8004 repo's `deploy/` directory.

What runs where:

- `/srv/adapter` — this repo, `main` branch
- `adapter-indexer@sepolia` — the Sepolia indexer (`indexer`, port 8788, localhost)
- `adapter-indexer@hub` — the mainnets in one process (port 8792): Robinhood Chain, Base and,
  once its upgrade lands, Ethereum (`HUB_NETWORKS=` in `/etc/adapter.env` overrides the list).
  It serves adapterscan.com with every chain, and each chain's own hostname
  (`robinhood.adapterscan.com`, `base.adapterscan.com`) with that chain alone. A chain whose
  RPC fails stalls on its own and shows as `stalled` in `/api/overview`; the others carry on.
  RPCs: `ROBINHOOD_RPC_URL=` (the public one is rate-limited), `BASE_RPC_URL=` and
  `MAINNET_RPC_URL=` (PublicNode by default).
- `adapter-indexer@robinhood`, `@base`, `@mainnet` (ports 8791, 8790, 8789) — the mainnets'
  own indexers from before the hub. Retired by the cutover below; a chain runs in one process
  only (its event log is locked by whoever has it open).
- Caddy — one static `app/dist` behind every hostname. `testnet.adapterscan.com` (plus the
  older `adapter.ens8004.xyz` and `adapter.178-105-235-22.sslip.io`) routes `/api/*` to the
  Sepolia indexer; the apex and `stats.` go to the hub; `robinhood.` and `base.` redirect to
  the apex.
- The indexer's state is a fold over chain events. The event log is kept in
  `/srv/adapter/indexer/data/<network>.sqlite` (ignored by git, so it survives the
  deploy's `git reset --hard`; `ADAPTER_DATA_DIR=` in `/etc/adapter.env` moves it).
  A restart folds from the file and syncs from its checkpoint; a reorg truncates the
  log at the fork point and refolds. The file is only a copy of the chain: delete it
  to re-index from the cutover block. `/etc/adapter.env` is optional
  (`SEPOLIA_RPC_URL=` to use a dedicated RPC).
- `stats.adapterscan.com` is the usage page across every chain: an A record to the box, the
  Caddy block in `Caddyfile.adapter` (applied by `setup.sh`), nothing else - the page asks each
  chain's API itself.
- Wallet connection is Reown AppKit (the WalletConnect modal). It needs a project id
  from https://cloud.reown.com, free. Put it in `/srv/adapter/app/.env.production.local`
  as `VITE_WC_PROJECT_ID=…` once; Vite reads that file at build time, the deploy leaves it
  alone (it is git-ignored), and every later deploy picks it up. Without it the app falls
  back to plain injected-wallet buttons.

## First boot (once, needs sudo)

```bash
ssh deploy@178.105.235.22
curl -fsSL https://raw.githubusercontent.com/unruggable-labs/agent-adapter-app/main/deploy/setup.sh | bash
```

## DNS

A records → 178.105.235.22 for `adapterscan.com`, `www.adapterscan.com`,
`testnet.adapterscan.com`, `robinhood.adapterscan.com`, `base.adapterscan.com` and
`docs.adapterscan.com` (the documentation site, same build, entered through `docs.html`).
One hostname per chain: the app reads its network from the hostname, Caddy routes each
`/api` to that chain's indexer (sepolia 8788, mainnet 8789, base 8790, robinhood 8791).
The apex is the chain picker until Ethereum's adapter is upgraded. Caddy issues certificates on first request, so each
name must resolve before it is served. `adapter.ens8004.xyz` (GoDaddy) and the
sslip.io name keep working as aliases of testnet.

## Moving an existing box to the two-hostname setup

Re-run `deploy/setup.sh` (idempotent). It swaps the single `adapter-indexer`
unit for the `adapter-indexer@` template, replaces our block at the end of the
shared Caddyfile with the current `Caddyfile.adapter`, validates, reloads, and
starts `adapter-indexer@sepolia`. The sudoers file changes too, so run it as
root (or as deploy with a sudo password), not through the GitHub Action.

## Cutover to the hub (once, needs sudo)

The hub opens the same `data/<network>.sqlite` files the per-chain indexers have open, and
each file is locked by one process. Re-running `deploy/setup.sh` does the whole cutover: it
installs `Caddyfile.adapter` (the apex and `stats.` move to 8792, `robinhood.` and `base.`
redirect to the apex on the same path), disables `@robinhood`/`@base`/`@mainnet`, then enables
`@hub` and waits for its API. The files carry over: no re-index, only what came after their
checkpoints. Check `curl -s http://127.0.0.1:8792/api/overview` lists both chains as `live`.

Do this straight after the deploy that ships the multichain app: that build treats the apex as
the explorer for every mainnet, which needs the hub behind it.

While the hub starts the mainnet sites show the plain shell (Caddy's `handle_errors`), seconds
at most. To go back: disable the hub, re-enable the two units, restore the previous Caddyfile
(`/etc/caddy/Caddyfile.bak.*`).

## Mainnet

The Ethereum proxy `0xde152AfB7db5373F34876E1499fbD893A82dD336` is not on
v0.0.17 yet (the Safe's nonce-3 upgrade is queued), and events under the older
scheme must not be indexed into this namespace. Until then the hub skips it and
says so in its log. When the upgrade lands:

1. Put `MAINNET_FROM_BLOCK=<block the upgrade tx landed in>` in
   `/etc/adapter.env` (`MAINNET_RPC_URL=` optional, PublicNode by default).
2. `systemctl restart adapter-indexer@hub` and check Ethereum shows in
   `curl http://127.0.0.1:8792/api/overview`.

## Deploys

Every push to `main` triggers `.github/workflows/deploy.yml`:
ssh in as `deploy`, pull, `npm ci` + build, restart the indexer instances
(allowed passwordlessly via `/etc/sudoers.d/adapter`), health-check the APIs.
Repo settings carry `DEPLOY_HOST` / `DEPLOY_USER` (variables) and
`DEPLOY_SSH_KEY` (secret) — same key as the ens8004 repo.

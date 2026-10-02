# Box setup — adapter stack

Configuration for running the adapter indexer + app on the ens8004 Hetzner box
(178.105.235.22), versioned here so server config drift is visible in git.
Mirrors the conventions of the ens8004 repo's `deploy/` directory.

What runs where:

- `/srv/adapter` — this repo, `main` branch
- `adapter-indexer@sepolia` — the Sepolia indexer (`indexer`, port 8788, localhost)
- `adapter-indexer@robinhood` — the Robinhood Chain indexer (port 8791). The public RPC
  is rate-limited; `ROBINHOOD_RPC_URL=` in `/etc/adapter.env` for a dedicated one.
- `adapter-indexer@base` and `adapter-indexer@mainnet` (ports 8790, 8789) — dormant until
  those proxies run v0.0.17 (see "Mainnet" below; Base is the same with `BASE_FROM_BLOCK`)
- Caddy — one static `app/dist` behind two hostnames. `testnet.adapterscan.com`
  (plus the older `adapter.ens8004.xyz` and `adapter.178-105-235-22.sslip.io`)
  routes `/api/*` to the Sepolia indexer; `adapterscan.com` is Ethereum, and
  redirects to testnet until the mainnet indexer exists. The app reads its
  network from the hostname, so there is no network switch in production.
- The indexer's state is a fold over chain events. The event log is kept in
  `/srv/adapter/indexer/data/<network>.sqlite` (ignored by git, so it survives the
  deploy's `git reset --hard`; `ADAPTER_DATA_DIR=` in `/etc/adapter.env` moves it).
  A restart folds from the file and syncs from its checkpoint; a reorg truncates the
  log at the fork point and refolds. The file is only a copy of the chain: delete it
  to re-index from the cutover block. `/etc/adapter.env` is optional
  (`SEPOLIA_RPC_URL=` to use a dedicated RPC).
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

## Mainnet

The Ethereum proxy `0xde152AfB7db5373F34876E1499fbD893A82dD336` is not on
v0.0.17 yet, and events under the older scheme must not be indexed into this
namespace. When the upgrade lands:

1. Put `MAINNET_FROM_BLOCK=<block the upgrade tx landed in>` in
   `/etc/adapter.env` (`MAINNET_RPC_URL=` optional, PublicNode by default).
2. `systemctl enable --now adapter-indexer@mainnet` and check
   `curl http://127.0.0.1:8789/api/overview`.
3. In `deploy/Caddyfile.adapter`, replace the apex `redir` with
   `import adapterscan 8789`, commit, re-run `setup.sh` (or edit the box's
   Caddyfile the same way and `systemctl reload caddy`).

The GitHub Action restarts the mainnet instance automatically once it is
enabled.

## Deploys

Every push to `main` triggers `.github/workflows/deploy.yml`:
ssh in as `deploy`, pull, `npm ci` + build, restart the indexer instances
(allowed passwordlessly via `/etc/sudoers.d/adapter`), health-check the APIs.
Repo settings carry `DEPLOY_HOST` / `DEPLOY_USER` (variables) and
`DEPLOY_SSH_KEY` (secret) — same key as the ens8004 repo.

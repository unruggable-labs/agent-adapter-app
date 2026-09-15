# Box setup — adapter stack

Configuration for running the adapter indexer + app on the ens8004 Hetzner box
(178.105.235.22), versioned here so server config drift is visible in git.
Mirrors the conventions of the ens8004 repo's `deploy/` directory.

What runs where:

- `/srv/adapter` — this repo, `main` branch
- `adapter-indexer.service` — the Sepolia indexer (`indexer`, port 8788, localhost)
- Caddy — serves `app/dist` statically and proxies `/api/*` to the indexer,
  on `adapter.ens8004.xyz` + `adapter.178-105-235-22.sslip.io`
- No database: the indexer's state is derived from chain events and rebuilt on
  restart (seconds at current volume). `/etc/adapter.env` is optional
  (`SEPOLIA_RPC_URL=` to use a dedicated RPC).

## First boot (once, needs sudo)

```bash
ssh deploy@178.105.235.22
curl -fsSL https://raw.githubusercontent.com/unruggable-labs/agent-adapter-app/main/deploy/setup.sh | bash
```

## DNS

`adapter.ens8004.xyz` needs an A record → 178.105.235.22 at GoDaddy (where
ens8004.xyz's nameservers live). Until then the sslip.io hostname works.

## Deploys

Every push to `main` triggers `.github/workflows/deploy.yml`:
ssh in as `deploy`, pull, `npm ci` + build, restart the service (allowed
passwordlessly via `/etc/sudoers.d/adapter`), health-check the API.
Repo settings carry `DEPLOY_HOST` / `DEPLOY_USER` (variables) and
`DEPLOY_SSH_KEY` (secret) — same key as the ens8004 repo.

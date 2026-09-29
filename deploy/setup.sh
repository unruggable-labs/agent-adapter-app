#!/usr/bin/env bash
# One-time bootstrap for the adapter stack on the ens8004 Hetzner box.
#
# Run either as the deploy user (asks for its sudo password) or directly as root
# (e.g. via the Hetzner web console) — file ownership lands on deploy either way:
#
#   curl -fsSL https://raw.githubusercontent.com/unruggable-labs/agent-adapter-app/main/deploy/setup.sh | bash
#
# Idempotent: safe to re-run. Subsequent deploys are handled by the GitHub Action.
set -euo pipefail

REPO=https://github.com/unruggable-labs/agent-adapter-app.git
BRANCH=main
DIR=/srv/adapter

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
  as_deploy() { runuser -u deploy -- bash -c "$1"; }
else
  SUDO="sudo"
  as_deploy() { bash -c "$1"; }
fi

echo "== 1/6 repo =="
if [ ! -d "$DIR/.git" ]; then
  $SUDO mkdir -p "$DIR"
  $SUDO chown deploy:deploy "$DIR"
  as_deploy "git clone --branch $BRANCH $REPO $DIR"
else
  as_deploy "git -C $DIR fetch origin $BRANCH && git -C $DIR reset --hard origin/$BRANCH"
fi

echo "== 2/6 build =="
as_deploy "cd $DIR/indexer && npm ci --no-audit --no-fund 2>&1 | tail -2"
as_deploy "cd $DIR/app && npm ci --no-audit --no-fund 2>&1 | tail -2"
as_deploy "cd $DIR/app && VITE_SEPOLIA_API=/api npm run build 2>&1 | tail -3"

echo "== 3/6 sudoers (validated before install) =="
visudo -cf "$DIR/deploy/adapter.sudoers"
$SUDO install -m 0440 "$DIR/deploy/adapter.sudoers" /etc/sudoers.d/adapter

echo "== 4/6 systemd unit (one instance per network) =="
$SUDO install -m 0644 "$DIR/deploy/adapter-indexer@.service" /etc/systemd/system/adapter-indexer@.service
# The pre-template single unit, if this box still has it.
if [ -f /etc/systemd/system/adapter-indexer.service ]; then
  $SUDO systemctl disable --now adapter-indexer.service || true
  $SUDO rm -f /etc/systemd/system/adapter-indexer.service
fi
$SUDO systemctl daemon-reload

echo "== 5/6 caddy site block =="
# Our block sits at the end of the shared Caddyfile. Cut from its marker (or the pre-marker
# header) to end of file and append the current version, so re-runs replace rather than stack.
$SUDO cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
$SUDO awk '/^# --- adapterscan \(managed by deploy\/setup.sh/ || /^adapter.ens8004.xyz, adapter.178-105-235-22.sslip.io \{/ { exit } { print }' \
  /etc/caddy/Caddyfile > /tmp/Caddyfile.adapterscan
cat "$DIR/deploy/Caddyfile.adapter" >> /tmp/Caddyfile.adapterscan
$SUDO caddy validate --config /tmp/Caddyfile.adapterscan
$SUDO install -m 0644 /tmp/Caddyfile.adapterscan /etc/caddy/Caddyfile
$SUDO systemctl reload caddy

echo "== 6/6 services =="
# Chains on v0.0.17 with a known cutover start now; the others only once /etc/adapter.env
# carries their <NAME>_FROM_BLOCK (see serve.ts). Ports: sepolia 8788, mainnet 8789, base 8790, robinhood 8791.
start_indexer() { # name port - a start replays the chain, so wait for the API rather than a fixed sleep
  $SUDO systemctl enable --now "adapter-indexer@$1"
  for i in $(seq 1 24); do
    if curl -fsS "http://127.0.0.1:$2/api/overview" 2>/dev/null; then echo; return 0; fi
    [ "$($SUDO systemctl is-active "adapter-indexer@$1" || true)" = "failed" ] && break
    sleep 5
  done
  echo "adapter-indexer@$1 did not come up; last log lines:"; $SUDO journalctl -u "adapter-indexer@$1" -n 20 --no-pager; return 1
}
start_indexer sepolia 8788
start_indexer robinhood 8791
grep -qs '^BASE_FROM_BLOCK=.' /etc/adapter.env && start_indexer base 8790
grep -qs '^MAINNET_FROM_BLOCK=.' /etc/adapter.env && start_indexer mainnet 8789
echo "== done: testnet. / robinhood.adapterscan.com live; apex is the chain picker =="

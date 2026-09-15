#!/usr/bin/env bash
# One-time bootstrap for the adapter stack on the ens8004 Hetzner box.
# Run as a user with sudo (asks for your password once):
#
#   ssh deploy@178.105.235.22
#   curl -fsSL https://raw.githubusercontent.com/unruggable-labs/agent-adapter-app/main/deploy/setup.sh | bash
#
# Idempotent: safe to re-run. Subsequent deploys are handled by the GitHub Action.
set -euo pipefail

REPO=https://github.com/unruggable-labs/agent-adapter-app.git
BRANCH=main
DIR=/srv/adapter

echo "== 1/6 repo =="
if [ ! -d "$DIR/.git" ]; then
  sudo mkdir -p "$DIR"
  sudo chown deploy:deploy "$DIR"
  git clone --branch "$BRANCH" "$REPO" "$DIR"
else
  git -C "$DIR" fetch origin "$BRANCH"
  git -C "$DIR" reset --hard "origin/$BRANCH"
fi

echo "== 2/6 build =="
cd "$DIR/indexer" && npm ci --no-audit --no-fund 2>&1 | tail -2
cd "$DIR/app" && npm ci --no-audit --no-fund 2>&1 | tail -2
VITE_SEPOLIA_API=/api npm run build 2>&1 | tail -3

echo "== 3/6 sudoers (validated before install) =="
visudo -cf "$DIR/deploy/adapter.sudoers"
sudo install -m 0440 "$DIR/deploy/adapter.sudoers" /etc/sudoers.d/adapter

echo "== 4/6 systemd unit =="
sudo install -m 0644 "$DIR/deploy/adapter-indexer.service" /etc/systemd/system/adapter-indexer.service
sudo systemctl daemon-reload

echo "== 5/6 caddy site block =="
if ! sudo grep -q "adapter.ens8004.xyz" /etc/caddy/Caddyfile; then
  sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  sudo tee -a /etc/caddy/Caddyfile < "$DIR/deploy/Caddyfile.adapter" > /dev/null
fi
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy

echo "== 6/6 service =="
sudo systemctl enable --now adapter-indexer
sleep 8
sudo systemctl is-active adapter-indexer
curl -fsS http://127.0.0.1:8788/api/overview && echo
echo "== done: https://adapter.178-105-235-22.sslip.io (and adapter.ens8004.xyz once DNS exists) =="

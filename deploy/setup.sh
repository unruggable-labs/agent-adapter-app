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

echo "== 4/6 systemd unit =="
$SUDO install -m 0644 "$DIR/deploy/adapter-indexer.service" /etc/systemd/system/adapter-indexer.service
$SUDO systemctl daemon-reload

echo "== 5/6 caddy site block =="
if ! $SUDO grep -q "adapter.ens8004.xyz" /etc/caddy/Caddyfile; then
  $SUDO cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  $SUDO tee -a /etc/caddy/Caddyfile < "$DIR/deploy/Caddyfile.adapter" > /dev/null
fi
$SUDO caddy validate --config /etc/caddy/Caddyfile
$SUDO systemctl reload caddy

echo "== 6/6 service =="
$SUDO systemctl enable --now adapter-indexer
sleep 8
$SUDO systemctl is-active adapter-indexer
curl -fsS http://127.0.0.1:8788/api/overview && echo
echo "== done: https://adapter.178-105-235-22.sslip.io (and adapter.ens8004.xyz once DNS exists) =="

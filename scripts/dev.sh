#!/usr/bin/env bash
# The full local stack in one command:
#   anvil devnet + seeded demo + indexer API on :8787
#   live Sepolia indexer API on :8788
#   the app on :5173 - reads Sepolia unless VITE_NETWORK says otherwise (env or app/.env.local):
#   local = the devnet; robinhood / base / mainnet also start that chain's indexer (ports
#   8791 / 8790 / 8789, same as the box); select = the chain picker
#   The chain indexers run under `tsx watch`: edit anything under indexer/src and they restart
#   and replay (a few seconds). The devnet demo doesn't, since restarting it redeploys anvil.
# Ctrl-C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."

# clear leftovers from previous runs
pkill -f "tsx src/run-demo.ts" 2>/dev/null || true
pkill -f "tsx src/serve.ts" 2>/dev/null || true
pkill -f "tsx watch --clear-screen=false src/serve.ts" 2>/dev/null || true
pkill -f "anvil --port 8547" 2>/dev/null || true
pkill -f "vite --port 5173" 2>/dev/null || true
sleep 1

# VITE_NETWORK may also come from app/.env.local; read it the way Vite will.
NET="${VITE_NETWORK:-$(grep -s '^VITE_NETWORK=' app/.env.local | cut -d= -f2)}"

(cd indexer && exec npx tsx src/run-demo.ts --serve) &
(cd indexer && exec npx tsx watch --clear-screen=false src/serve.ts sepolia) &
case "$NET" in
  robinhood|base|mainnet) (cd indexer && exec npx tsx watch --clear-screen=false src/serve.ts "$NET") & ;;
esac
(cd app && exec npx vite --port 5173) &

trap 'kill 0' INT TERM
wait

#!/usr/bin/env bash
# The full local stack in one command:
#   anvil devnet + seeded demo + indexer API on :8787
#   live Sepolia indexer API on :8788
#   the app on :5173 - reads Sepolia unless VITE_NETWORK=local (env or app/.env.local)
# Ctrl-C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."

# clear leftovers from previous runs
pkill -f "tsx src/run-demo.ts" 2>/dev/null || true
pkill -f "tsx src/serve.ts" 2>/dev/null || true
pkill -f "anvil --port 8547" 2>/dev/null || true
pkill -f "vite --port 5173" 2>/dev/null || true
sleep 1

(cd indexer && exec npx tsx src/run-demo.ts --serve) &
(cd indexer && exec npx tsx src/serve.ts sepolia) &
(cd app && exec npx vite --port 5173) &

trap 'kill 0' INT TERM
wait

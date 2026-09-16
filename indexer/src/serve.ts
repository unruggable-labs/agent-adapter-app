import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { Ingester } from "./ingest.js";
import { ProjectionStore } from "./projection.js";
import { startServer } from "./server.js";

/**
 * Standalone indexer for a public chain. The local devnet is served by `run-demo.ts --serve`
 * (it deploys the stack it indexes); this entrypoint points at an already-deployed adapter.
 *
 *   npm run serve:sepolia
 */
const NETWORKS = {
  sepolia: {
    chain: sepolia,
    chainId: 11155111n,
    rpcUrl: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    adapter: "0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92" as Address, // the Safe-owned proxy
    // v0.0.17 was installed 2026-09-08; preflight rehearsal block. Events before the upgrade
    // are old-ABI/old-scheme history and MUST NOT be re-keyed into this namespace, so the
    // cutover doubles as the backfill start.
    fromBlock: 11_661_779n,
    port: 8788,
    pollMs: 12_000,
  },
} as const;

async function main() {
  const name = (process.argv[2] ?? "sepolia") as keyof typeof NETWORKS;
  const net = NETWORKS[name];
  if (!net) throw new Error(`unknown network ${String(name)}; known: ${Object.keys(NETWORKS).join(", ")}`);

  console.log(`Indexing ${name}: adapter ${net.adapter} from block ${net.fromBlock} via ${net.rpcUrl}`);
  const client = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
  const store = new ProjectionStore(net.chainId, net.adapter);
  const ingester = new Ingester(client, store, net.adapter, net.fromBlock);

  let syncedTo = net.fromBlock;
  const count = await ingester.sync((from, to, head) => {
    syncedTo = to;
    console.log(`  backfill ${from} … ${to} (head ${head})`);
  });
  console.log(
    `Synced: ${count} events → ${store.identities.size} identities, ${store.agents.size} agents, ` +
      `${store.attestations.size} attestations, ${store.dropped.length} dropped`,
  );

  // Load-balanced public RPCs can silently return incomplete logs for a chunk — observed in
  // the wild (a backfill came back one AgentBound short with no error). Cross-check the
  // chunked backfill against one full-range query; on mismatch, exit nonzero so systemd (or
  // the operator) restarts into a fresh, hopefully-honest replay. Skipped if the RPC caps
  // full-range queries.
  try {
    const fullRange = await client.getLogs({ address: net.adapter, fromBlock: net.fromBlock, toBlock: syncedTo });
    if (fullRange.length !== count) {
      console.error(
        `BACKFILL MISMATCH: chunked backfill applied ${count} events but a full-range query ` +
          `returned ${fullRange.length} — the RPC returned incomplete logs. Exiting to retry.`,
      );
      process.exit(1);
    }
    console.log(`Backfill verified: full-range recount matches (${count} events).`);
  } catch {
    console.warn("Backfill verification skipped: RPC rejected the full-range query.");
  }

  startServer(store, client, net.adapter, net.port, ingester, net.pollMs);
  console.log(`API + UI on http://127.0.0.1:${net.port} (polling every ${net.pollMs / 1000}s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

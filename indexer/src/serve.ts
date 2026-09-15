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

  const count = await ingester.sync((from, to, head) =>
    console.log(`  backfill ${from} … ${to} (head ${head})`),
  );
  console.log(
    `Synced: ${count} events → ${store.identities.size} identities, ${store.agents.size} agents, ` +
      `${store.attestations.size} attestations, ${store.dropped.length} dropped`,
  );

  startServer(store, client, net.adapter, net.port, ingester, net.pollMs);
  console.log(`API + UI on http://127.0.0.1:${net.port} (polling every ${net.pollMs / 1000}s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

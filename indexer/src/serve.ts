import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { base, mainnet, robinhood, sepolia } from "viem/chains";
import { EventLog } from "./eventlog.js";
import { Ingester } from "./ingest.js";
import { ProjectionStore } from "./projection.js";
import { startServer } from "./server.js";

/**
 * Standalone indexer for a public chain. The local devnet is served by `run-demo.ts --serve`
 * (it deploys the stack it indexes); this entrypoint points at an already-deployed adapter.
 *
 *   npm run serve:sepolia
 *   npx tsx src/serve.ts robinhood
 *   npx tsx src/serve.ts base       (needs BASE_FROM_BLOCK - see below)
 *   npx tsx src/serve.ts mainnet    (needs MAINNET_FROM_BLOCK)
 *
 * Ports: sepolia 8788, mainnet 8789, base 8790, robinhood 8791. Caddy routes each hostname's /api
 * to its port.
 *
 * The adapter's event log is kept in `data/<network>.sqlite` (ADAPTER_DATA_DIR overrides the
 * directory), so a restart folds from the file and asks the chain only for what came after. The
 * file is a copy of the chain: delete it to re-index.
 */
const NETWORKS = {
  sepolia: {
    chain: sepolia,
    chainId: 11155111n,
    rpcUrl: process.env.SEPOLIA_RPC_URL ?? "https://gateway.tenderly.co/public/sepolia",
    adapter: "0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92" as Address, // the Safe-owned proxy
    // v0.0.17 was installed 2026-09-08; preflight rehearsal block. Events before the upgrade
    // are old-ABI/old-scheme history and MUST NOT be re-keyed into this namespace, so the
    // cutover doubles as the backfill start.
    fromBlock: 11_661_779n,
    port: 8788,
    pollMs: 12_000,
  },
  mainnet: {
    chain: mainnet,
    chainId: 1n,
    rpcUrl: process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
    adapter: "0xde152AfB7db5373F34876E1499fbD893A82dD336" as Address, // the mainnet proxy
    // The mainnet proxy has not been upgraded to v0.0.17 yet. Events under the older scheme
    // MUST NOT be indexed into this namespace, so there is no default: the cutover block is
    // set in /etc/adapter.env when the upgrade lands, and until then this network refuses to
    // start. See the Sepolia note above for why the cutover doubles as the backfill start.
    fromBlock: process.env.MAINNET_FROM_BLOCK ? BigInt(process.env.MAINNET_FROM_BLOCK) : null,
    port: 8789,
    pollMs: 12_000,
  },
  base: {
    chain: base,
    chainId: 8453n,
    rpcUrl: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    adapter: "0x270d25D2c59A8bcA1B0f40ad95fF7806c0025c27" as Address, // the Base proxy
    // Same situation as mainnet: not on v0.0.17 yet, so no default cutover block.
    fromBlock: process.env.BASE_FROM_BLOCK ? BigInt(process.env.BASE_FROM_BLOCK) : null,
    port: 8790,
    pollMs: 6_000,
  },
  robinhood: {
    chain: robinhood,
    chainId: 4663n,
    // The public endpoint is rate-limited; ROBINHOOD_RPC_URL in /etc/adapter.env for a dedicated one.
    rpcUrl: process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
    adapter: "0x000000009d62675362a58911e3f32FEcf46F5E18" as Address, // deployed at v0.0.17
    // Fresh v0.0.17 deployment: the block the proxy's code first appeared in is the start.
    fromBlock: 75_810_067n,
    port: 8791,
    pollMs: 6_000, // 100 ms blocks: a poll covers ~60 blocks
    // Arbitrum Orbit: block.number inside a contract is the parent chain's block. Attestation
    // ids are hashed with it, so the ingester reads each block's l1BlockNumber.
    blockNumbers: "arbitrum" as const,
  },
} as const;

async function main() {
  const name = (process.argv[2] ?? "sepolia") as keyof typeof NETWORKS;
  const net = NETWORKS[name];
  if (!net) throw new Error(`unknown network ${String(name)}; known: ${Object.keys(NETWORKS).join(", ")}`);
  if (net.fromBlock === null)
    throw new Error(`${name}: no cutover block. Set ${name.toUpperCase()}_FROM_BLOCK to the block the v0.0.17 upgrade landed in; older events must not be indexed.`);

  console.log(`Indexing ${name}: adapter ${net.adapter} from block ${net.fromBlock} via ${net.rpcUrl}`);
  const client = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) }) as PublicClient;
  await preflight(client, net.rpcUrl, net.chainId, net.fromBlock);
  const store = new ProjectionStore(net.chainId, net.adapter);

  const dataDir = process.env.ADAPTER_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url));
  mkdirSync(dataDir, { recursive: true });
  const log = new EventLog(join(dataDir, `${name}.sqlite`), { chainId: net.chainId, adapter: net.adapter, fromBlock: net.fromBlock });
  const ingester = new Ingester(client, store, net.adapter, net.fromBlock, 10_000n, "blockNumbers" in net ? net.blockNumbers : "l2", {
    log,
    onReorg: (r) => console.warn(`Reorg: the chain dropped block ${r.previousHead}; rewound to ${r.fork}, ${r.droppedEvents} events refolded away`),
  });
  const replayed = ingester.replay();
  if (replayed > 0 || log.checkpoint()) console.log(`Loaded ${replayed} events from ${log.path}, synced to block ${log.checkpoint()?.number}`);

  let syncedTo = ingester.next - 1n;
  const fresh = await ingester.sync((from, to, head) => {
    syncedTo = to;
    if (head - from > 10_000n) console.log(`  backfill ${from} … ${to} (head ${head})`);
  });
  const count = log.count();
  console.log(
    `Synced: ${count} events (${fresh} new) → ${store.identities.size} identities, ${store.agents.size} agents, ` +
      `${store.attestations.size} attestations, ${store.dropped.length} dropped`,
  );

  // Load-balanced public RPCs can silently return incomplete logs for a chunk — observed in
  // the wild (a backfill came back one AgentBound short with no error). Cross-check the
  // log against one full-range query; on mismatch, forget the log and exit nonzero so systemd
  // (or the operator) restarts into a fresh, hopefully-honest backfill. Skipped if the RPC caps
  // full-range queries.
  try {
    const fullRange = await client.getLogs({ address: net.adapter, fromBlock: net.fromBlock, toBlock: syncedTo });
    if (fullRange.length > count) {
      console.error(
        `BACKFILL MISMATCH: the event log holds ${count} events but a full-range query ` +
          `returned ${fullRange.length} — the RPC returned incomplete logs. Forgetting the log and exiting to retry.`,
      );
      log.reset();
      process.exit(1);
    }
    if (fullRange.length < count) {
      // A verifier that undercounts is itself the broken party; the applied set stands.
      console.warn(`Backfill verification inconclusive: full-range recount saw ${fullRange.length} < ${count}.`);
    } else {
      console.log(`Backfill verified: full-range recount matches (${count} events).`);
    }
  } catch {
    console.warn("Backfill verification skipped: RPC rejected the full-range query.");
  }

  startServer(store, client, net.adapter, net.port, ingester, net.pollMs, { networkLabel: net.chain.name });
  console.log(`API + UI on http://127.0.0.1:${net.port} (polling every ${net.pollMs / 1000}s)`);
}

/**
 * Fail fast, in one line, on the two RPC misconfigurations that otherwise surface as a crash
 * loop with a stack trace: an endpoint for the wrong chain, and one that caps eth_getLogs
 * below the 10,000-block chunk the backfill uses (some free tiers allow 10). Both are fixed in
 * /etc/adapter.env, not in code, so the message says which endpoint and what it said.
 */
async function preflight(client: ReturnType<typeof createPublicClient>, rpcUrl: string, chainId: bigint, fromBlock: bigint) {
  const actual = BigInt(await client.getChainId());
  if (actual !== chainId) {
    throw new Error(`RPC ${rpcUrl} is chain ${actual}, not ${chainId}. Fix the *_RPC_URL in /etc/adapter.env.`);
  }
  try {
    await client.getLogs({ address: "0x0000000000000000000000000000000000000000", fromBlock, toBlock: fromBlock + 9_999n });
  } catch (err) {
    const said = (err as { details?: string; shortMessage?: string; message?: string });
    const detail = said.details ?? said.shortMessage ?? said.message ?? String(err);
    if (/block range|range|exceed|too many|limit/i.test(detail)) {
      throw new Error(`RPC ${rpcUrl} rejects a 10,000-block eth_getLogs range, which the backfill needs. It said: ${detail.slice(0, 200)}. Use an endpoint without that cap (PublicNode's free endpoint has none) or a higher tier.`);
    }
    // Anything else (a transient error) is left to the backfill, which retries.
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

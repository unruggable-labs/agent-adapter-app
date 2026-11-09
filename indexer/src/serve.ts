import { RpcBudget } from "./rpc-budget.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { base, mainnet, robinhood, sepolia } from "viem/chains";
import { EventLog } from "./eventlog.js";
import { configureGatewayCache } from "./gateway.js";
import { configurePictures } from "./pictures.js";
import { Ingester } from "./ingest.js";
import { ProjectionStore } from "./projection.js";
import { ChainRuntime } from "./runtime.js";
import { startServer } from "./server.js";

/**
 * The indexer for public chains. The local devnet is served by `run-demo.ts --serve` (it deploys
 * the stack it indexes); this entrypoint points at already-deployed adapters.
 *
 *   npm run serve:sepolia
 *   npx tsx src/serve.ts robinhood            one chain, on its own port
 *   npx tsx src/serve.ts robinhood base       several chains in one process, on HUB_PORT (8792)
 *   npx tsx src/serve.ts hub                  the mainnets: HUB_NETWORKS, default robinhood,base,mainnet
 *
 * One chain is a chain's own site; several are the multichain explorer at adapterscan.com, which
 * also answers for each chain's own hostname with that chain alone (server.ts). In the hub a
 * chain with no cutover block (a new chain before its v0.0.17 upgrade) is skipped and said so;
 * on its own it refuses to start. A bad RPC (wrong chain, capped log ranges) stops the process
 * either way, with the fix in one line.
 *
 * Ports: sepolia 8788, mainnet 8789, base 8790, robinhood 8791, the hub 8792.
 *
 * Each chain's event log is kept in `data/<network>.sqlite` (ADAPTER_DATA_DIR overrides the
 * directory), so a restart folds from the file and asks the chain only for what came after. The
 * file is a copy of the chain: delete it to re-index. Only one process may have a chain's file
 * open: run a chain in the hub or on its own, not both.
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
    host: "testnet.adapterscan.com",
    testnet: true,
  },
  mainnet: {
    chain: mainnet,
    chainId: 1n,
    rpcUrl: process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
    adapter: "0xde152AfB7db5373F34876E1499fbD893A82dD336" as Address, // the mainnet proxy
    // History from the proxy's deployment (0xf4d34051…f519). Unlike Sepolia's, the implementations
    // before v0.0.17 registered agents with the same events and the same binding hash (checked
    // against bindingHashOf), so their registrations are live agents and are indexed (SPEC H-1). Upgraded to v0.0.17 in 0xd94bed0c…3470 (Safe nonce 3); the
    // earlier events are marked as the older implementation's (ProjectionStore.upgradeBlock).
    fromBlock: process.env.MAINNET_FROM_BLOCK ? BigInt(process.env.MAINNET_FROM_BLOCK) : 24_821_152n,
    upgradeBlock: 26_285_388n,
    port: 8789,
    pollMs: 12_000,
  },
  base: {
    chain: base,
    chainId: 8453n,
    // PublicNode, as elsewhere: mainnet.base.org answers a handful of calls and then 429s.
    rpcUrl: process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com",
    adapter: "0x270d25D2c59A8bcA1B0f40ad95fF7806c0025c27" as Address, // the Base proxy
    // History from the proxy's deployment, for the same reason as Ethereum's (checked on a sample).
    // One counterfactual claim from then hashed its UBID the old way and is dropped (SPEC H-1).
    // Upgraded to v0.0.17 in 0x148b82c7…0626 (Safe nonce 1), marked as Ethereum's is.
    fromBlock: process.env.BASE_FROM_BLOCK ? BigInt(process.env.BASE_FROM_BLOCK) : 44_347_671n,
    upgradeBlock: 52_991_843n,
    port: 8790,
    host: "base.adapterscan.com",
    // 2 s blocks, so a poll covers ~15. 30 s keeps the poll under 3k calls a day, for when
    // BASE_RPC_URL in /etc/adapter.env points at a dedicated, metered endpoint.
    pollMs: 30_000,
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
    host: "robinhood.adapterscan.com",
    // 100 ms blocks, so a poll covers ~300 of them. The dedicated RPC is metered: a poll is
    // three calls (latest header, checkpoint check, logs), and 30 s keeps that under 10k a day.
    pollMs: 30_000,
    // Arbitrum Orbit: block.number inside a contract is the parent chain's block. Attestation
    // ids are hashed with it, so the ingester reads each block's l1BlockNumber.
    blockNumbers: "arbitrum" as const,
  },
} as const;

type NetworkName = keyof typeof NETWORKS;
const HUB_PORT = Number(process.env.HUB_PORT ?? 8792);
const LABELS: Record<NetworkName, string> = { sepolia: "Sepolia", mainnet: "Ethereum", base: "Base", robinhood: "Robinhood Chain" };

async function main() {
  const args = process.argv.slice(2);
  const hub = args.length === 1 && args[0] === "hub";
  const names = (hub ? (process.env.HUB_NETWORKS ?? "robinhood,base,mainnet").split(",").map((n) => n.trim()) : args.length ? args : ["sepolia"]) as NetworkName[];
  for (const n of names) if (!NETWORKS[n]) throw new Error(`unknown network ${n}; known: ${Object.keys(NETWORKS).join(", ")}`);
  const several = hub || names.length > 1;

  const dataDir = process.env.ADAPTER_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url));
  mkdirSync(dataDir, { recursive: true });
  configureGatewayCache(join(dataDir, "cache")); // ipfs/ar content, under its address
  configurePictures(join(dataDir, "pictures")); // our small copy of every picture shown (pictures.ts)

  // Fail closed until an operator explicitly sets a spending boundary.
  const budget = new RpcBudget(join(dataDir, "rpc-usage.sqlite"), Number(process.env.RPC_DAILY_REQUEST_LIMIT ?? 0), Number(process.env.RPC_MINUTE_REQUEST_LIMIT ?? 120), Date.now, {
    enrichment: { daily: Number(process.env.RPC_ENRICHMENT_DAILY_LIMIT ?? 0), minute: Number(process.env.RPC_ENRICHMENT_MINUTE_LIMIT ?? 0) },
    maintenance: { daily: Number(process.env.RPC_MAINTENANCE_DAILY_LIMIT ?? 0), minute: Number(process.env.RPC_MAINTENANCE_MINUTE_LIMIT ?? 0) },
  }, process.env.RPC_READS_UNTIL ? Date.parse(process.env.RPC_READS_UNTIL) : undefined, Number(process.env.RPC_MIN_GAP_MS ?? 0));
  const chains: ChainRuntime[] = [];
  for (const name of names) {
    const net = NETWORKS[name];
    if (net.fromBlock === null) {
      const fix = `Set ${name.toUpperCase()}_FROM_BLOCK to the block the v0.0.17 upgrade landed in; older events must not be indexed.`;
      if (!several) throw new Error(`${name}: no cutover block. ${fix}`);
      console.log(`[${name}] not indexed yet: no cutover block. ${fix}`);
      continue;
    }
    chains.push(await boot(name, net.fromBlock, dataDir, budget));
  }
  if (chains.length === 0) throw new Error(`none of ${names.join(", ")} can be indexed yet`);

  const port = several ? HUB_PORT : NETWORKS[names[0]].port;
  startServer(chains, port);
  console.log(`API + UI for ${chains.map((c) => c.slug).join(", ")} on http://127.0.0.1:${port}`);
}

/** Enrichment is opt-in; enabling indexing alone never bootstraps every existing profile. */
function enrichmentMode(): "off" | "events" | "bulk" {
  const mode = process.env.ENRICHMENT_MODE ?? "off";
  if (mode !== "off" && mode !== "events" && mode !== "bulk") throw new Error("ENRICHMENT_MODE must be off, events or bulk");
  return mode;
}

/** One chain up to the point of serving: the RPC checked, the stored log folded. Its first sync starts with the server. */
async function boot(name: NetworkName, fromBlock: bigint, dataDir: string, budget: RpcBudget): Promise<ChainRuntime> {
  const net = NETWORKS[name];
  console.log(`[${name}] adapter ${net.adapter} from block ${fromBlock}${"upgradeBlock" in net ? ` (v0.0.17 from ${net.upgradeBlock})` : ""} via configured RPC`);
  const client = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl, { fetchFn: budget.fetch(name), retryCount: 0 }) }) as PublicClient;
  const offline = process.env.ADAPTER_OFFLINE === "1" || budget.dailyLimit === 0;

  const upgradeBlock = "upgradeBlock" in net && net.upgradeBlock > fromBlock ? net.upgradeBlock : null;
  const store = new ProjectionStore(net.chainId, net.adapter, upgradeBlock);
  const log = new EventLog(join(dataDir, `${name}.sqlite`), { chainId: net.chainId, adapter: net.adapter, fromBlock, upgradeBlock });
  const ingester = new Ingester(client, store, net.adapter, fromBlock, 10_000n, "blockNumbers" in net ? net.blockNumbers : "l2", {
    log,
    onReorg: (r) => console.warn(`[${name}] Reorg: the chain dropped block ${r.previousHead}; rewound to ${r.fork}, ${r.droppedEvents} events refolded away`),
  });
  const replayed = ingester.replay();
  if (replayed > 0 || log.checkpoint()) console.log(`[${name}] Loaded ${replayed} events from ${log.path}, synced to block ${log.checkpoint()?.number}`);
  return new ChainRuntime({
    slug: name,
    label: LABELS[name],
    host: "host" in net ? net.host : undefined,
    testnet: "testnet" in net ? net.testnet : false,
    store,
    client,
    adapter: net.adapter,
    ingester,
    log,
    pollMs: Math.max(60_000, net.pollMs),
    enrichmentMode: enrichmentMode(),
    timestampBackfill: process.env.BACKFILL_TIMESTAMPS === "1",
    beforeSync: () => preflight(client, net.chainId),
    // A full-history verification is expensive maintenance, never an automatic startup job.
    verifyFrom: process.env.VERIFY_BACKFILL === "1" ? fromBlock : undefined,
    offline,
    rpcBudget: () => budget.snapshot(),
  });
}

/** Validate the configured chain in the background, so upstream outages don't take the cached API down. */
async function preflight(client: ReturnType<typeof createPublicClient>, chainId: bigint) {
  const actual = BigInt(await client.getChainId());
  if (actual !== chainId) throw new Error(`Configured RPC is chain ${actual}, not ${chainId}. Fix the *_RPC_URL in /etc/adapter.env.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

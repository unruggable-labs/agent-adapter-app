import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { Ingester } from "../../../indexer/src/ingest.js";
import { ProjectionStore } from "../../../indexer/src/projection.js";
import { handleApi } from "../../../indexer/src/service.js";

/**
 * The Sepolia indexer as a Vercel function: no long-running process, so the store lives in
 * module scope (survives warm invocations) and syncs on demand. Cold start = full chunked
 * backfill from the v0.0.17 cutover block (seconds at current event volume); warm requests
 * do a throttled incremental sync. Reorg handling stays replay: a fresh cold start is a
 * fresh replay.
 */
export const config = { maxDuration: 60 };

const ADAPTER = "0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92" as Address;
const CHAIN_ID = 11_155_111n;
const FROM_BLOCK = 11_661_779n; // v0.0.17 installed 2026-09-08; the cutover doubles as backfill start
const SYNC_THROTTLE_MS = 15_000;

let state: { store: ProjectionStore; client: PublicClient; ingester: Ingester; lastSync: number } | null = null;

async function getState() {
  if (!state) {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(process.env.SEPOLIA_RPC_URL ?? "https://gateway.tenderly.co/public/sepolia"),
    });
    const store = new ProjectionStore(CHAIN_ID, ADAPTER);
    const ingester = new Ingester(client, store, ADAPTER, FROM_BLOCK);
    await ingester.sync();
    state = { store, client, ingester, lastSync: Date.now() };
  } else if (Date.now() - state.lastSync > SYNC_THROTTLE_MS) {
    state.lastSync = Date.now();
    await state.ingester.sync().catch(() => {});
  }
  return state;
}

export default async function handler(
  req: { url?: string },
  res: { status: (n: number) => { setHeader: (k: string, v: string) => void; send: (b: string) => void } },
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const subpath = url.pathname.replace(/^\/api\/sepolia\/?/, "");
  try {
    const { store, client } = await getState();
    const { status, body } = await handleApi(store, client, ADAPTER, subpath);
    const out = res.status(status);
    out.setHeader("content-type", "application/json");
    out.setHeader("cache-control", "s-maxage=10, stale-while-revalidate=30");
    out.send(body);
  } catch (err) {
    const out = res.status(500);
    out.setHeader("content-type", "application/json");
    out.send(JSON.stringify({ error: String(err) }));
  }
}

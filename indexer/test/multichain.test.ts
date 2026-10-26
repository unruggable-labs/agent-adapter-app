import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { ProjectionStore, type LogEvent, type OrderKey } from "../src/projection.js";
import { addressView, attestationView, listAttestations, listIdentities, search, type ChainScope } from "../src/queries.js";
import { ChainRuntime } from "../src/runtime.js";
import { startServer } from "../src/server.js";
import { handleApi, type ApiChain } from "../src/service.js";
import { AttestationType, computeAttestationId, computeUbid, Standard } from "../src/ubid.js";
import { ViewCache } from "../src/views.js";

const ADAPTER = "0x000000009d62675362a58911e3f32FEcf46F5E18" as Address;
const PUNKS = "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9" as Address;
const ALICE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const BOB = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address;
const ZERO32 = `0x${"00".repeat(32)}` as Hex;

const quiet = { readContract: async () => { throw new Error("no chain in this test"); } } as unknown as PublicClient;

/**
 * A chain whose blocks were made at `secondsPerBlock` from `genesis`: the same token on two chains
 * is two records, and block 5 on a fast chain can be newer than block 50 on a slow one.
 */
function chain(slug: string, chainId: bigint, genesis: number, secondsPerBlock: number) {
  const store = new ProjectionStore(chainId, ADAPTER);
  const ubid = (t: bigint, std = Standard.ERC721, bound = PUNKS) => computeUbid(chainId, ADAPTER, std, bound, t);
  const register = (block: number, tokenId: bigint, emitter = ALICE, std = Standard.ERC721, bound = PUNKS) =>
    store.apply({ blockNumber: BigInt(block), logIndex: 0, eventName: "CounterfactualAgentRegistered", args: { ubid: ubid(tokenId, std, bound), boundAddress: bound, tokenId, standard: std, emitter, agentURI: null, metadata: [] } } as LogEvent);
  const star = (block: number, attester: Address, target: Hex) => {
    const attestationId = computeAttestationId(chainId, ADAPTER, attester, target, AttestationType.STAR, BigInt(block), ZERO32, "0x01");
    store.apply({ blockNumber: BigInt(block), logIndex: 1, eventName: "Attested", args: { attester, attestationType: AttestationType.STAR, ubid: target, attestationId, variant: ZERO32, data: "0x01" } } as LogEvent);
    return attestationId;
  };
  const views = new ViewCache(store, quiet);
  const scope: ApiChain = {
    slug,
    label: slug,
    chainId,
    adapter: ADAPTER,
    store,
    views,
    timeOf: (o: OrderKey) => genesis + Number(o.blockNumber) * secondsPerBlock,
    status: () => ({ state: "live", syncedTo: "0", head: "0", lastSyncAt: 0, error: null }),
  };
  return { scope, store, ubid, register, star };
}

const p = (o: Record<string, string>) => new URLSearchParams(o);

describe("several chains", () => {
  // Slow chain: 12 s blocks from t=1000. Fast chain: 1 s blocks from t=1000.
  const slow = chain("slow", 1n, 1000, 12);
  const fast = chain("fast", 8453n, 1000, 1);
  slow.register(10, 7n); // t = 1120
  fast.register(50, 7n); // t = 1050 - same token, another chain, another record
  fast.register(200, 8n); // t = 1200
  slow.register(20, 0n, BOB, Standard.ACCOUNT, BOB); // t = 1240, BOB as an agent on the slow chain (accounts are token 0)
  const starSlow = slow.star(30, BOB, slow.ubid(7n)); // t = 1360
  const starFast = fast.star(300, BOB, fast.ubid(8n)); // t = 1300
  const chains: ChainScope[] = [slow.scope, fast.scope];

  it("lists newest first by block time across chains, and each row says its chain", () => {
    const page = listIdentities(chains, p({ limit: "10" }));
    expect(page.total).toBe(4);
    expect(page.items.map((i) => [i.chain, i.tokenId])).toEqual([
      ["slow", 0n],
      ["fast", 8n],
      ["slow", 7n],
      ["fast", 7n],
    ]);
    expect(listIdentities(chains, p({ limit: "1", offset: "2" })).items[0].ubid).toBe(slow.ubid(7n));
  });

  it("keeps a chain's own order even where block times are missing", () => {
    const blind = { ...slow.scope, timeOf: () => null };
    expect(listIdentities([blind], p({ limit: "10" })).items.map((i) => i.tokenId)).toEqual([0n, 7n]);
  });

  it("finds a statement by id on whichever chain has it, and lists statements by time", () => {
    expect(attestationView(chains, starFast)?.chain).toBe("fast");
    expect(attestationView(chains, starSlow)?.target?.chain).toBe("slow");
    expect(listAttestations(chains, p({ limit: "10" })).items.map((a) => a.chain)).toEqual(["slow", "fast"]);
  });

  it("gathers an address from every chain", () => {
    const bob = addressView(chains, BOB);
    expect(bob.chains).toEqual(["slow", "fast"]);
    expect(bob.self?.chain).toBe("slow");
    expect(bob.statements.map((s) => s.chain)).toEqual(["slow", "fast"]);
    expect(bob.byChain.map((b) => [b.chain, !!b.self])).toEqual([
      ["slow", true],
      ["fast", false],
    ]);
  });

  it("searches every chain, an address once", () => {
    const hits = search(chains, BOB);
    expect(hits.filter((h) => h.kind === "address")).toHaveLength(1);
    const ids = search(chains, slow.ubid(7n).slice(0, 14));
    expect(ids.map((h) => (h.kind === "identity" ? h.identity.chain : h.kind))).toEqual(["slow"]);
  });

  it("the API: totals with each chain under them, ?chain= to narrow, stats per chain", async () => {
    const api = async (path: string) => JSON.parse((await handleApi([slow.scope, fast.scope], path)).body);
    const o = await api("overview");
    expect([o.identities, o.attestations, o.adapter, o.chainId]).toEqual([4, 2, null, null]);
    expect(o.chains.map((c: { chain: string; identities: number; state: string }) => [c.chain, c.identities, c.state])).toEqual([
      ["slow", 2, "live"],
      ["fast", 2, "live"],
    ]);
    const one = await api("overview?chain=fast");
    expect([one.identities, one.chainId, one.adapter]).toEqual([2, "8453", ADAPTER]);
    expect((await api("identities?chain=fast")).length).toBe(2); // ?chain= alone is still the whole list, of that chain
    expect((await api(`identity/${fast.ubid(7n)}`)).chain).toBe("fast");
    expect((await handleApi([slow.scope, fast.scope], "stats/overview")).status).toBe(400);
    expect((await handleApi([slow.scope, fast.scope], "overview?chain=nope")).status).toBe(400);
  });
});

describe("one process, several sites", () => {
  const servers: { close: () => void }[] = [];
  afterAll(() => servers.forEach((s) => s.close()));

  it("a chain's own hostname sees that chain alone; any other host sees them all", async () => {
    const a = chain("robinhood", 4663n, 1000, 1);
    const b = chain("base", 8453n, 1000, 2);
    a.register(1, 1n);
    b.register(1, 1n);
    b.register(2, 2n);
    const runtime = (c: ReturnType<typeof chain>, host: string) =>
      new ChainRuntime({ slug: c.scope.slug, label: c.scope.label, host, store: c.store, client: quiet, adapter: ADAPTER });
    const server = startServer([runtime(a, "robinhood.adapterscan.com"), runtime(b, "base.adapterscan.com")], 0);
    servers.push(server);
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    const count = async (host: string) => (await (await fetch(`http://127.0.0.1:${port}/api/overview`, { headers: { "x-forwarded-host": host } })).json()).identities;
    expect(await count("adapterscan.com")).toBe(3);
    expect(await count("robinhood.adapterscan.com")).toBe(1);
    expect(await count("base.adapterscan.com")).toBe(2);
  });
});

describe("a chain fails on its own", () => {
  function fakeIngester(script: (() => Promise<number>)[]) {
    let n = 0;
    const ing = {
      next: 101n,
      replays: 0,
      sync: async (onProgress?: (from: bigint, to: bigint, head: bigint) => void) => {
        onProgress?.(100n, 100n, 100n);
        return script[Math.min(n++, script.length - 1)]();
      },
      replay: () => {
        ing.replays++;
        return 0;
      },
      backfillTimestamps: async () => 0,
    };
    return ing;
  }

  it("retries a failed first sync, then goes live", async () => {
    const ing = fakeIngester([async () => Promise.reject(new Error("503 from the RPC")), async () => 3]);
    const store = new ProjectionStore(1n, ADAPTER);
    const r = new ChainRuntime({ slug: "x", label: "X", store, client: quiet, adapter: ADAPTER, ingester: ing as never, pollMs: 60_000, watchMs: 60_000 });
    expect(r.status().state).toBe("syncing");
    r.start();
    for (let i = 0; i < 400 && r.status().state !== "live"; i++) await new Promise((res) => setTimeout(res, 10));
    expect(r.status().state).toBe("live");
    expect(r.status().error).toBeNull();
    r.stop();
  });

  it("a backfill the RPC returned short re-indexes that chain in place, without exiting", async () => {
    const ing = fakeIngester([async () => 1]);
    let recounts = 0;
    const client = {
      ...quiet,
      // The recount: more events than the log on the first try (the RPC dropped one), equal after.
      getLogs: async () => (recounts++ === 0 ? [{}, {}] : [{}]),
    } as unknown as PublicClient;
    const log = { count: () => 1, reset: () => {}, connection: null, blockTimestamp: () => null };
    const store = new ProjectionStore(1n, ADAPTER);
    const r = new ChainRuntime({ slug: "y", label: "Y", store, client, adapter: ADAPTER, ingester: ing as never, log: log as never, pollMs: 60_000, watchMs: 60_000, verifyFrom: 1n });
    r.start();
    for (let i = 0; i < 200 && r.status().state !== "live"; i++) await new Promise((res) => setTimeout(res, 10));
    expect(r.status().state).toBe("live");
    expect(ing.replays).toBe(1); // folded again from an empty log
    expect(recounts).toBe(2);
    r.stop();
  });
});

import { describe, expect, it } from "vitest";
import { ContractFunctionRevertedError, ContractFunctionZeroDataError, HttpRequestError, type Address, type Hex, type PublicClient } from "viem";
import { ProjectionStore, type LogEvent } from "../src/projection.js";
import { AdvisoryStore } from "../src/advisories.js";
import { EventLog } from "../src/eventlog.js";
import { AttestationType, computeAttestationId, computeUbid, Standard } from "../src/ubid.js";
import { referencesIn, ViewCache } from "../src/views.js";

const CHAIN = 31337n;
const ADAPTER = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0" as Address;
const PUNKS = "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9" as Address;
const ALICE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const UBID7 = computeUbid(CHAIN, ADAPTER, Standard.ERC721, PUNKS, 7n);

function registered(block: number, tokenId = 7n): LogEvent {
  return {
    blockNumber: BigInt(block),
    logIndex: 0,
    eventName: "CounterfactualAgentRegistered",
    args: { ubid: computeUbid(CHAIN, ADAPTER, Standard.ERC721, PUNKS, tokenId), boundAddress: PUNKS, tokenId, standard: Standard.ERC721, emitter: ALICE, agentURI: null, metadata: [] },
  };
}

/** A chain that answers ownerOf and name, counting the calls, so the test can see when the chain was read.
 *  With `multicall3`, it also answers Multicall3 batches, the way a chain that has one does. */
function fakeChain(multicall3 = false) {
  const calls: string[] = [];
  const client = {
    chain: multicall3 ? { contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } } } : undefined,
    multicall: async ({ contracts }: { contracts: { functionName: string; args?: unknown[] }[] }) => {
      calls.push(`multicall ${contracts.map((c) => `${c.functionName} ${c.args?.[0] ?? ""}`.trim()).join(",")}`);
      return contracts.map((c) => (c.functionName === "ownerOf" ? { status: "success", result: ALICE } : { status: "failure", error: new Error("revert") }));
    },
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      calls.push(functionName === "ownerOf" ? `ownerOf ${args?.[0]}` : functionName);
      if (functionName === "ownerOf") return ALICE;
      if (functionName === "name") return "DemoPunks";
      if (functionName === "contractURI") return "data:application/json;base64," + Buffer.from(JSON.stringify({ name: "DemoPunks", description: "Ten punks.", image: "ipfs://bafyimg", external_link: "https://punks.example" })).toString("base64");
      throw new Error(`unexpected ${functionName}`);
    },
    getCode: async () => "0x",
    getStorageAt: async () => undefined,
  } as unknown as PublicClient;
  return { client, calls };
}

describe("identity views", () => {
  it("answers from memory before the chain has been read, with the chain facts unknown", () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    store.apply(registered(1));
    const { client, calls } = fakeChain();
    const views = new ViewCache(store, client);

    const [v] = views.views();
    expect(calls).toEqual([]); // no RPC on the request path
    expect(v.ubid).toBe(UBID7);
    expect(v.currentControllerHolder).toBeNull();
    expect(v.contractName).toBeNull();
    expect(v.subjectLabel).toBe("0xcf7e…0fc9 #7");
    expect(v.trustBase).toBeNull();
    expect(v.advisoryAt).toBeNull();
    expect(v.reputation.stars).toBe(0); // the record's own facts are always there
  });

  it("merges the advisory once the worker has read the chain, and still reads nothing on request", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    store.apply(registered(1));
    const { client, calls } = fakeChain();
    const views = new ViewCache(store, client);

    await views.refresh(store.identities.get(UBID7)!);
    const before = calls.length;
    const [v] = views.views();
    expect(calls.length).toBe(before);
    expect(v.currentControllerHolder).toBe(ALICE);
    expect(v.flags.currentlyOwnerless).toBe(false);
    expect(v.contractName).toBe("DemoPunks");
    expect(v.subjectLabel).toBe("DemoPunks #7");
    expect(v.trustBase?.isEoa).toBe(true);
    expect(v.advisoryAt).not.toBeNull();
    // the collection's own card, and its image standing in for a token that has none
    expect(v.collection).toEqual({ name: "DemoPunks", description: "Ten punks.", image: "/ipfs/bafyimg", externalLink: "https://punks.example" });
    expect(v.image).toBe("/ipfs/bafyimg");
  });

  it("the worker reads every identity once, then rests until something is stale or marked - a page view reads nothing", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    store.apply(registered(1));
    const { client, calls } = fakeChain();
    const views = new ViewCache(store, client, { gapMs: 0, tickMs: 5, staleMs: 60_000 });
    views.start();
    try {
      for (let i = 0; i < 50 && views.read < 1; i++) await new Promise((r) => setTimeout(r, 5));
      expect(views.read).toBe(1);
      const after = calls.length;
      await new Promise((r) => setTimeout(r, 30));
      expect(calls.length).toBe(after); // nothing stale: no further reads
      views.view(store.identities.get(UBID7)!); // someone opens the page
      views.views();
      await new Promise((r) => setTimeout(r, 30));
      expect(calls.length).toBe(after);
    } finally {
      views.stop();
    }
  });

  it("reads unread identities newest first, and one the collection watcher marked before those", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    for (const [block, token] of [[1, 1n], [2, 2n], [3, 3n], [4, 4n]] as const) store.apply(registered(block, token));
    const { client, calls } = fakeChain();
    const views = new ViewCache(store, client, { concurrency: 1, gapMs: 0, tickMs: 5 });
    views.mark({ holders: new Set([computeUbid(CHAIN, ADAPTER, Standard.ERC721, PUNKS, 2n)]), cards: new Set(), contracts: new Set() }); // #2 changed hands
    views.start();
    try {
      for (let i = 0; i < 100 && views.read < 4; i++) await new Promise((r) => setTimeout(r, 5));
      expect(calls.filter((c) => c.startsWith("ownerOf"))).toEqual(["ownerOf 2", "ownerOf 4", "ownerOf 3", "ownerOf 1"]);
    } finally {
      views.stop();
    }
  });

  it("reads a batch's holders in one Multicall3 call where the chain has one", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    for (const [block, token] of [[1, 1n], [2, 2n], [3, 3n], [4, 4n]] as const) store.apply(registered(block, token));
    const { client, calls } = fakeChain(true);
    const views = new ViewCache(store, client, { gapMs: 0, tickMs: 5 });
    views.start();
    try {
      for (let i = 0; i < 100 && views.read < 4; i++) await new Promise((r) => setTimeout(r, 5));
      // name() and contractURI are read once per address, so only the holder reads are asserted
      expect(calls.filter((c) => c.startsWith("multicall") || c.startsWith("ownerOf"))).toEqual(["multicall ownerOf 4,ownerOf 3,ownerOf 2,ownerOf 1"]);
      expect(views.views().every((v) => v.currentControllerHolder === ALICE && v.contractName === "DemoPunks")).toBe(true);
    } finally {
      views.stop();
    }
  });

  it("falls back to single calls only when Multicall3 itself is missing, and stays there", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    for (const [block, token] of [[1, 1n], [2, 2n]] as const) store.apply(registered(block, token));
    const { client, calls } = fakeChain(true);
    (client as unknown as { multicall: () => Promise<never> }).multicall = async () => {
      calls.push("multicall");
      throw new ContractFunctionZeroDataError({ functionName: "aggregate3" }); // no code at the Multicall3 address
    };
    const views = new ViewCache(store, client, { gapMs: 0, tickMs: 5, staleMs: 0 });
    await views.refreshMany([...store.identities.values()]);
    await views.refreshMany([...store.identities.values()]);
    expect(calls.filter((c) => c.startsWith("multicall"))).toEqual(["multicall"]);
    expect(calls.filter((c) => c.startsWith("ownerOf")).length).toBe(4);
    expect(views.views().every((v) => v.currentControllerHolder === ALICE)).toBe(true);
  });

  it("an RPC failure is no reading, not 'no holder' - the last reading stands and Multicall3 stays on", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    store.apply(registered(1));
    const { client, calls } = fakeChain(true);
    const views = new ViewCache(store, client, { gapMs: 0, tickMs: 5 });
    await views.refreshMany([...store.identities.values()]);
    expect(views.views()[0].currentControllerHolder).toBe(ALICE);

    const working = (client as unknown as { multicall: unknown }).multicall;
    (client as unknown as { multicall: () => Promise<never> }).multicall = async () => {
      calls.push("multicall (429)");
      throw new HttpRequestError({ url: "https://rpc.example", status: 429, details: "Too Many Requests" });
    };
    views.mark({ holders: new Set([UBID7]), cards: new Set(), contracts: new Set() }); // it was transferred
    await views.refreshMany([...store.identities.values()]);
    const [v] = views.views();
    expect(v.currentControllerHolder).toBe(ALICE); // kept, not wiped
    expect(v.flags.currentlyOwnerless).toBe(false); // and never a false "ownerless"
    expect(calls.filter((c) => c.startsWith("ownerOf"))).toEqual([]); // no burst of single calls

    (client as unknown as { multicall: unknown }).multicall = working; // the RPC recovers
    await views.refreshMany([...store.identities.values()]);
    expect(calls.filter((c) => c.startsWith("multicall")).length).toBe(3); // still batching
  });

  it("a token whose ownerOf reverts is ownerless; a read the RPC dropped is not", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    store.apply(registered(1, 1n));
    store.apply(registered(2, 2n));
    const { client } = fakeChain(false);
    (client as unknown as { readContract: (a: { functionName: string; args?: unknown[] }) => Promise<unknown> }).readContract = async ({ functionName, args }) => {
      if (functionName !== "ownerOf") throw new Error("unused");
      if (args?.[0] === 1n) throw new ContractFunctionRevertedError({ abi: [], functionName: "ownerOf", message: "ERC721NonexistentToken(1)" });
      throw new HttpRequestError({ url: "https://rpc.example", details: "timeout" });
    };
    const views = new ViewCache(store, client);
    await views.refreshMany([...store.identities.values()]);
    const byToken = new Map(views.views().map((v) => [v.tokenId, v]));
    expect(byToken.get(1n)!.flags.currentlyOwnerless).toBe(true); // burned
    expect(byToken.get(2n)!.flags.currentlyOwnerless).toBeNull(); // unknown, and said so
    expect(byToken.get(2n)!.advisoryAt).toBeNull();
  });

  it("keeps what it read in the database, so a restart starts warm and reads nothing", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    store.apply(registered(1));
    const log = new EventLog(":memory:", { chainId: CHAIN, adapter: ADAPTER, fromBlock: 0n });
    const first = fakeChain();
    await new ViewCache(store, first.client, {}, new AdvisoryStore(log.connection)).refresh(store.identities.get(UBID7)!);

    // The process restarts: a new store over the same file, a chain that counts from zero.
    const { client, calls } = fakeChain();
    const views = new ViewCache(store, client, { gapMs: 0, tickMs: 5 }, new AdvisoryStore(log.connection));
    const [v] = views.views();
    expect(v.currentControllerHolder).toBe(ALICE);
    expect(v.contractName).toBe("DemoPunks");
    expect(v.collection?.name).toBe("DemoPunks");
    views.start();
    try {
      await new Promise((r) => setTimeout(r, 30));
      expect(calls).toEqual([]); // nothing is stale, so nothing is read
    } finally {
      views.stop();
    }
  });

  it("reads a contract's facts once, and again only when the watcher marks the contract", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    store.apply(registered(1));
    const { client, calls } = fakeChain();
    const views = new ViewCache(store, client);
    const ids = [...store.identities.values()];
    await views.refreshMany(ids);
    await views.refreshMany(ids);
    expect(calls.filter((c) => c === "name")).toEqual(["name"]);
    views.mark({ holders: new Set(), cards: new Set(), contracts: new Set([PUNKS]) }); // it emitted Upgraded
    await views.refreshMany(ids);
    expect(calls.filter((c) => c === "name")).toEqual(["name", "name"]);
  });

  it("checks the transactions statements cite in the background, once", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    store.apply(registered(1));
    const real = `0x${"ab".repeat(32)}` as Hex;
    const made = `0x${"cd".repeat(32)}` as Hex;
    const zero = `0x${"00".repeat(32)}` as Hex;
    const rating = (block: number, variant: Hex) => ({
      blockNumber: BigInt(block),
      logIndex: 0,
      eventName: "Attested",
      args: { attester: ALICE, attestationType: AttestationType.RATING, ubid: UBID7, variant, data: "0x50", attestationId: computeAttestationId(CHAIN, ADAPTER, ALICE, UBID7, AttestationType.RATING, BigInt(block), variant, "0x50") },
    });
    store.apply(rating(2, real));
    store.apply(rating(3, made));
    const { client, calls } = fakeChain();
    let lookups = 0;
    (client as unknown as { getTransaction: (a: { hash: Hex }) => Promise<unknown> }).getTransaction = async ({ hash }) => {
      lookups++;
      if (hash === real) return { hash };
      throw new Error("not found");
    };
    const views = new ViewCache(store, client, { gapMs: 0, tickMs: 5 });
    expect(views.txRef(real)).toBeNull(); // not checked yet: the page shows no badge rather than reading the chain
    views.start();
    try {
      for (let i = 0; i < 100 && views.txRef(made) === null; i++) await new Promise((r) => setTimeout(r, 5));
      expect(views.txRef(real)).toBe("found");
      expect(views.txRef(made)).toBe("missing");
      await new Promise((r) => setTimeout(r, 30));
      expect(lookups).toBe(2);
    } finally {
      views.stop();
    }
    expect(referencesIn(AttestationType.RATING, zero, "0x50")).toEqual([]);
    expect(referencesIn(AttestationType.INTERACTION, zero, ("0x50" + "ef".repeat(32)) as Hex)).toEqual([`0x${"ef".repeat(32)}`]);
    expect(referencesIn(AttestationType.STAR, real, "0x01")).toEqual([]);
    expect(calls.filter((c) => c.startsWith("ownerOf")).length).toBeGreaterThan(0);
  });
});

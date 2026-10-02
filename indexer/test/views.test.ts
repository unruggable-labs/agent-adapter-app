import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { ProjectionStore, type LogEvent } from "../src/projection.js";
import { computeUbid, Standard } from "../src/ubid.js";
import { ViewCache } from "../src/views.js";

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

/** A chain that answers ownerOf and name, counting the calls, so the test can see when the chain was read. */
function fakeChain() {
  const calls: string[] = [];
  const client = {
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      calls.push(functionName === "ownerOf" ? `ownerOf ${args?.[0]}` : functionName);
      if (functionName === "ownerOf") return ALICE;
      if (functionName === "name") return "DemoPunks";
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
  });

  it("the worker reads every identity once, then rests until something is stale or asked for", async () => {
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
      views.want(UBID7); // fresh, so a request's interest does not force a re-read either
      await new Promise((r) => setTimeout(r, 30));
      expect(calls.length).toBe(after);
    } finally {
      views.stop();
    }
  });

  it("reads unread identities newest first, and one a request returned before those", async () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    for (const [block, token] of [[1, 1n], [2, 2n], [3, 3n], [4, 4n]] as const) store.apply(registered(block, token));
    const { client, calls } = fakeChain();
    const views = new ViewCache(store, client, { concurrency: 1, gapMs: 0, tickMs: 5 });
    views.viewWanted(store.identities.get(computeUbid(CHAIN, ADAPTER, Standard.ERC721, PUNKS, 2n))!); // someone is looking at #2
    views.start();
    try {
      for (let i = 0; i < 100 && views.read < 4; i++) await new Promise((r) => setTimeout(r, 5));
      expect(calls.filter((c) => c.startsWith("ownerOf"))).toEqual(["ownerOf 2", "ownerOf 4", "ownerOf 3", "ownerOf 1"]);
    } finally {
      views.stop();
    }
  });
});

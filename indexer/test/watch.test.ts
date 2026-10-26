import { describe, expect, it } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { AdvisoryStore } from "../src/advisories.js";
import { ProjectionStore, type LogEvent } from "../src/projection.js";
import { computeUbid, Standard } from "../src/ubid.js";
import { CollectionWatcher, WATCHED_TOPICS } from "../src/watch.js";

const CHAIN = 31337n;
const ADAPTER = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0" as Address;
const PUNKS = "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9" as Address;
const KITTIES = "0x5fbdb2315678afecb367f032d93f642f64180aa3" as Address;
const OWNED = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" as Address;
const ALICE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;

const pad = (v: bigint | string) => `0x${(typeof v === "bigint" ? v.toString(16) : v.slice(2)).padStart(64, "0")}` as Hex;
const [TRANSFER, , TRANSFER_SINGLE, TRANSFER_BATCH, OWNERSHIP, UPGRADED, , METADATA, BATCH_METADATA] = WATCHED_TOPICS;

function registered(block: number, bound: Address, tokenId: bigint, standard = Standard.ERC721): LogEvent {
  return {
    blockNumber: BigInt(block),
    logIndex: 0,
    eventName: "CounterfactualAgentRegistered",
    args: { ubid: computeUbid(CHAIN, ADAPTER, standard, bound, tokenId), boundAddress: bound, tokenId, standard, emitter: ALICE, agentURI: null, metadata: [] },
  };
}
const ubid = (bound: Address, tokenId: bigint, standard = Standard.ERC721) => computeUbid(CHAIN, ADAPTER, standard, bound, tokenId);

/** A chain that answers eth_getLogs from a fixed list, filtered the way a node filters, counting calls. */
function fakeChain(logs: { address: Address; topics: Hex[]; data?: Hex; block: bigint }[]) {
  const calls: { addresses: Address[]; from: bigint; to: bigint }[] = [];
  const client = {
    request: async ({ method, params }: { method: string; params: [{ address: Address[]; fromBlock: Hex; toBlock: Hex; topics: Hex[][] }] }) => {
      if (method !== "eth_getLogs") throw new Error(`unexpected ${method}`);
      const [f] = params;
      const from = BigInt(f.fromBlock);
      const to = BigInt(f.toBlock);
      calls.push({ addresses: f.address, from, to });
      return logs
        .filter((l) => f.address.includes(l.address) && l.block >= from && l.block <= to && f.topics[0].includes(l.topics[0]))
        .map((l) => ({ address: l.address, topics: l.topics, data: l.data ?? "0x" }));
    },
  } as unknown as PublicClient;
  return { client, calls };
}

function setup(logs: Parameters<typeof fakeChain>[0], opts: ConstructorParameters<typeof CollectionWatcher>[3] = {}) {
  const store = new ProjectionStore(CHAIN, ADAPTER);
  store.apply(registered(1, PUNKS, 7n));
  store.apply(registered(2, PUNKS, 8n));
  store.apply(registered(3, KITTIES, 1n));
  store.apply(registered(4, OWNED, 0n, Standard.CONTRACT_OWNABLE));
  store.apply(registered(5, ALICE, 0n, Standard.ACCOUNT));
  const advisories = new AdvisoryStore();
  const { client, calls } = fakeChain(logs);
  return { watcher: new CollectionWatcher(store, client, advisories, opts), calls, advisories };
}

describe("collection watcher", () => {
  it("follows every bound contract but plain accounts, most records first", () => {
    const { watcher } = setup([]);
    // PUNKS carries two records; KITTIES and OWNED one each, in address order. ALICE is a plain account.
    expect(watcher.watched()).toEqual([PUNKS, KITTIES, OWNED]);
  });

  it("only records where it starts on its first scan", async () => {
    const { watcher, calls, advisories } = setup([]);
    await watcher.scan(100n);
    expect(calls).toEqual([]);
    expect(advisories.watchedTo).toBe(100n);
  });

  it("marks the record whose token moved, and nothing for tokens no record is bound to or ERC-20-shaped transfers", async () => {
    const { watcher, advisories } = setup([
      { address: PUNKS, topics: [TRANSFER, pad(ALICE), pad(KITTIES), pad(7n)], block: 105n },
      { address: PUNKS, topics: [TRANSFER, pad(ALICE), pad(KITTIES), pad(99n)], block: 106n }, // unbound token
      { address: KITTIES, topics: [TRANSFER, pad(ALICE), pad(PUNKS)], data: pad(1n), block: 107n }, // ERC-20 shape: amount in data
    ]);
    advisories.write({ watchedTo: 100n });
    const d = await watcher.scan(110n);
    expect([...d.holders]).toEqual([ubid(PUNKS, 7n)]);
    expect(d.cards.size + d.contracts.size).toBe(0);
    expect(advisories.watchedTo).toBe(110n);
  });

  it("reads ERC-1155 single and batch transfers out of the data", async () => {
    const batch = (pad(64n) + pad(160n).slice(2) + pad(2n).slice(2) + pad(8n).slice(2) + pad(42n).slice(2) + pad(2n).slice(2) + pad(1n).slice(2) + pad(1n).slice(2)) as Hex;
    const { watcher, advisories } = setup([
      { address: KITTIES, topics: [TRANSFER_SINGLE, pad(ALICE), pad(ALICE), pad(PUNKS)], data: (pad(1n) + pad(1n).slice(2)) as Hex, block: 101n },
      { address: PUNKS, topics: [TRANSFER_BATCH, pad(ALICE), pad(ALICE), pad(KITTIES)], data: batch, block: 102n },
    ]);
    advisories.write({ watchedTo: 100n });
    const d = await watcher.scan(110n);
    expect(new Set(d.holders)).toEqual(new Set([ubid(KITTIES, 1n), ubid(PUNKS, 8n)]));
  });

  it("turns an ownership transfer, an upgrade and metadata updates into the right re-reads", async () => {
    const { watcher, advisories } = setup([
      { address: OWNED, topics: [OWNERSHIP, pad(ALICE), pad(PUNKS)], block: 101n },
      { address: PUNKS, topics: [UPGRADED, pad(KITTIES)], block: 102n },
      { address: PUNKS, topics: [METADATA], data: pad(8n), block: 103n },
      { address: KITTIES, topics: [BATCH_METADATA], data: (pad(0n) + pad(2n ** 255n).slice(2)) as Hex, block: 104n },
    ]);
    advisories.write({ watchedTo: 100n });
    const d = await watcher.scan(110n);
    expect([...d.holders]).toEqual([ubid(OWNED, 0n, Standard.CONTRACT_OWNABLE)]);
    expect([...d.contracts]).toEqual([PUNKS]);
    expect(new Set(d.cards)).toEqual(new Set([ubid(PUNKS, 8n), ubid(KITTIES, 1n)]));
  });

  it("asks for many contracts in one call, chunked, and blocks in ranges", async () => {
    const { watcher, calls, advisories } = setup([], { chunk: 2, maxRange: 10n });
    advisories.write({ watchedTo: 100n });
    await watcher.scan(115n);
    expect(calls.map((c) => [c.addresses.length, Number(c.from), Number(c.to)])).toEqual([
      [2, 101, 110],
      [1, 101, 110],
      [2, 111, 115],
      [1, 111, 115],
    ]);
  });

  it("past the cap follows only the contracts with the most records", () => {
    const { watcher } = setup([], { maxAddresses: 1 });
    expect(watcher.watched()).toEqual([PUNKS]);
  });

  it("after a long stop re-reads everything instead of scanning a gap that would cost more", async () => {
    const { watcher, calls, advisories } = setup([], { maxRange: 10n });
    advisories.write({ watchedTo: 100n });
    const d = await watcher.scan(10_000n);
    expect(calls).toEqual([]);
    expect(d.holders.size).toBe(4); // every record on a watched contract
    expect(d.contracts.size).toBe(3);
    expect(advisories.watchedTo).toBe(10_000n);
  });
});

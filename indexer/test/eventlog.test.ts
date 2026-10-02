import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { decodeArgs, encodeArgs, EventLog, type StoredEvent } from "../src/eventlog.js";

const ADAPTER = "0x000000009d62675362a58911e3f32FEcf46F5E18" as Address;
const identity = { chainId: 4663n, adapter: ADAPTER, fromBlock: 100n };
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

function ev(block: number, logIndex: number, extra: Partial<StoredEvent> = {}): StoredEvent {
  return {
    blockNumber: BigInt(block),
    logIndex,
    blockHash: h(block),
    eventName: "CounterfactualAgentRegistered",
    args: { tokenId: 7n, standard: 0, boundAddress: ADAPTER, metadata: [{ metadataKey: "k", metadataValue: "0x01" }], big: 2n ** 200n },
    transactionHash: h(1000 + block),
    ...extra,
  };
}

describe("event log", () => {
  it("round-trips events, bigints included, in log order", () => {
    const log = new EventLog(":memory:", identity);
    log.append([ev(102, 1), ev(101, 0, { contractBlockNumber: 50n })], { number: 110n, hash: h(110) });
    const back = [...log.events()];
    expect(back.map((e) => Number(e.blockNumber))).toEqual([101, 102]);
    expect(back[0]).toEqual(ev(101, 0, { contractBlockNumber: 50n }));
    expect(back[1].args.big).toBe(2n ** 200n);
    expect(typeof back[1].args.standard).toBe("number");
    expect(log.count()).toBe(2);
    expect(log.checkpoint()).toEqual({ number: 110n, hash: h(110) });
  });

  it("rewinds to a fork point: later events go, the checkpoint moves to the kept block", () => {
    const log = new EventLog(":memory:", identity);
    log.append([ev(101, 0)], { number: 105n, hash: h(105) });
    log.append([ev(107, 0), ev(109, 0)], { number: 110n, hash: h(110) });
    expect(log.recentBlocks().map((b) => Number(b.number))).toEqual([110, 109, 107, 105, 101]);
    log.rewindTo(105n);
    expect([...log.events()].map((e) => Number(e.blockNumber))).toEqual([101]);
    expect(log.checkpoint()).toEqual({ number: 105n, hash: h(105) });
    log.rewindTo(99n); // before anything stored: nothing left, no checkpoint
    expect(log.count()).toBe(0);
    expect(log.checkpoint()).toBeNull();
  });

  it("refuses to be reused for a different adapter, chain or cutover", () => {
    const path = `/tmp/claude-501/eventlog-${process.pid}-${Date.now()}.sqlite`;
    new EventLog(path, identity).close();
    expect(() => new EventLog(path, identity)).not.toThrow();
    expect(() => new EventLog(path, { ...identity, fromBlock: 101n })).toThrow(/fromBlock=100.*wants fromBlock=101/);
    expect(() => new EventLog(path, { ...identity, chainId: 1n })).toThrow(/chainId/);
  });

  it("encodes args losslessly", () => {
    const args = { a: 1n, b: [2n, { c: 3n }], d: "0x01", e: 4, f: null, g: { $big: 5 } };
    expect(decodeArgs(encodeArgs(args))).toEqual(args);
  });
});

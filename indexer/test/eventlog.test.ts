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

  it("replays a log larger than one chunk, in order, with several events per block", () => {
    const log = new EventLog(":memory:", identity);
    const batch: StoredEvent[] = [];
    for (let b = 100; b < 100 + 2500; b++) for (let i = 0; i < 2; i++) batch.push(ev(b, i));
    log.append(batch, { number: 3000n, hash: h(3000) });
    const back = [...log.events()];
    expect(back).toHaveLength(5000);
    expect(back[0]).toMatchObject({ blockNumber: 100n, logIndex: 0 });
    expect(back[1]).toMatchObject({ blockNumber: 100n, logIndex: 1 });
    expect(back[4999]).toMatchObject({ blockNumber: 2599n, logIndex: 1 });
    for (let k = 1; k < back.length; k++) {
      const a = back[k - 1], b = back[k];
      expect(a.blockNumber < b.blockNumber || (a.blockNumber === b.blockNumber && a.logIndex < b.logIndex)).toBe(true);
    }
  });

  it("encodes args losslessly", () => {
    const args = { a: 1n, b: [2n, { c: 3n }], d: "0x01", e: 4, f: null, g: { $big: 5 } };
    expect(decodeArgs(encodeArgs(args))).toEqual(args);
  });
});

describe("event log facts and timestamps (schema 2)", () => {
  const ALICE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
  const PUNKS = "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9" as Address;
  const UBID = `0x${"ab".repeat(32)}` as Hex;
  const AID = `0x${"cd".repeat(32)}` as Hex;
  const at = (block: number, logIndex: number, eventName: string, args: Record<string, unknown>, blockTimestamp?: number): StoredEvent =>
    ({ blockNumber: BigInt(block), logIndex, blockHash: h(block), eventName, args, blockTimestamp });

  it("pulls the facts out of each event, resolving agent-keyed and revocation events through earlier rows", () => {
    const log = new EventLog(":memory:", identity);
    log.append(
      [
        at(101, 0, "CounterfactualAgentRegistered", { ubid: UBID, boundAddress: PUNKS, tokenId: 7n, standard: 0, emitter: ALICE }, 1_700_000_000),
        at(102, 0, "AgentBound", { agentId: 42n, standard: 0, boundAddress: PUNKS, tokenId: 7n, registeredBy: ALICE }, 1_700_000_100),
        at(103, 0, "AgentURISet", { agentId: 42n, newURI: "ipfs://x" }, 1_700_000_200),
        at(104, 0, "Attested", { attester: ALICE, attestationType: 3, ubid: UBID, attestationId: AID, variant: h(0), data: "0x46" }, 1_700_000_300),
        at(105, 0, "AttestationRevoked", { attestationId: AID, revoker: ALICE }, 1_700_000_400),
      ],
      { number: 110n, hash: h(110), timestamp: 1_700_000_900 },
    );
    const rows = log.connection.prepare("SELECT event_name, ubid, bound_address, actor, attestation_type, attestation_id, agent_id FROM events ORDER BY block_number").all() as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ event_name: "CounterfactualAgentRegistered", ubid: UBID, bound_address: PUNKS, actor: ALICE });
    expect(rows[1]).toMatchObject({ event_name: "AgentBound", bound_address: PUNKS, actor: ALICE, agent_id: "42" });
    expect(typeof rows[1].ubid).toBe("string"); // derived from the coordinates
    expect(rows[2]).toMatchObject({ event_name: "AgentURISet", ubid: rows[1].ubid, bound_address: PUNKS, agent_id: "42" });
    expect(rows[3]).toMatchObject({ event_name: "Attested", ubid: UBID, actor: ALICE, attestation_type: 3, attestation_id: AID });
    expect(rows[4]).toMatchObject({ event_name: "AttestationRevoked", ubid: UBID, actor: ALICE, attestation_type: 3, attestation_id: AID });
    const stamps = log.connection.prepare("SELECT number, timestamp FROM blocks ORDER BY number").all() as { number: number; timestamp: number | null }[];
    expect(stamps.map((s) => [s.number, s.timestamp])).toEqual([[101, 1_700_000_000], [102, 1_700_000_100], [103, 1_700_000_200], [104, 1_700_000_300], [105, 1_700_000_400], [110, 1_700_000_900]]);
  });

  it("knows which event blocks still lack a timestamp, and takes them", () => {
    const log = new EventLog(":memory:", identity);
    log.append([at(101, 0, "Attested", { attester: ALICE, attestationType: 2, ubid: UBID, attestationId: AID, variant: h(0), data: "0x01" }), at(102, 0, "WalletUBIDCleared", { account: ALICE }, 5)], { number: 103n, hash: h(103) });
    expect(log.blocksWithoutTimestamp()).toEqual([101n]); // 102 has one; 103 carries no event
    log.setTimestamps(new Map([[101n, 9]]));
    expect(log.blocksWithoutTimestamp()).toEqual([]);
  });

  it("migrates a schema 1 file in place, filling the facts from the stored args", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const path = `/tmp/claude-501/eventlog-v1-${process.pid}-${Date.now()}.sqlite`;
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE events (block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, block_hash TEXT NOT NULL, tx_hash TEXT, event_name TEXT NOT NULL, args TEXT NOT NULL, contract_block INTEGER, PRIMARY KEY (block_number, log_index)) WITHOUT ROWID;
      CREATE TABLE blocks (number INTEGER PRIMARY KEY, hash TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema','1'),('chainId','${identity.chainId}'),('adapter','${identity.adapter.toLowerCase()}'),('fromBlock','${identity.fromBlock}'),('checkpoint','105:${h(105)}');
      INSERT INTO blocks VALUES (101, '${h(101)}'), (105, '${h(105)}');
    `);
    old.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)").run(101, 0, h(101), null, "Attested", encodeArgs({ attester: ALICE, attestationType: 2, ubid: UBID, attestationId: AID, variant: h(0), data: "0x01" }), null);
    old.close();

    const log = new EventLog(path, identity);
    const row = log.connection.prepare("SELECT ubid, actor, attestation_type FROM events").get() as Record<string, unknown>;
    expect(row).toEqual({ ubid: UBID, actor: ALICE, attestation_type: 2 });
    expect(log.checkpoint()).toEqual({ number: 105n, hash: h(105) });
    expect(log.blocksWithoutTimestamp()).toEqual([101n]);
    expect((log.connection.prepare("SELECT value FROM meta WHERE key='schema'").get() as { value: string }).value).toBe("2");
    log.close();
    expect(() => new EventLog(path, identity)).not.toThrow(); // and opens cleanly as schema 2
  });
});

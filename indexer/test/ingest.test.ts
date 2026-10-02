import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { Ingester } from "../src/ingest.js";
import { ProjectionStore } from "../src/projection.js";

const ADAPTER = "0x000000009d62675362a58911e3f32FEcf46F5E18" as Address;
describe("arbitrum block numbers", () => {
  it("recomputes attestation ids with the block's l1BlockNumber, so they verify", async () => {
    const { computeAttestationId, computeUbid, Standard } = await import("../src/ubid.js");
    const { encodeEventTopics, encodeAbiParameters } = await import("viem");
    const { adapterAbi } = await import("../src/abi-runtime.js");
    const chainId = 4663n;
    const attester = "0x81c11034fe2b2f0561e9975df9a45d99172183af" as Address;
    const ubid = computeUbid(chainId, ADAPTER, Standard.ACCOUNT, attester, 0n);
    const l2Block = 76_469_365n, l1Block = 26_089_908n;
    const variant = ("0x" + "00".repeat(32)) as `0x${string}`;
    const data = "0x01" as `0x${string}`;
    // the contract hashed block.number = the L1 block
    const attestationId = computeAttestationId(chainId, ADAPTER, attester, ubid, 2, l1Block, variant, data);
    const topics = encodeEventTopics({ abi: adapterAbi, eventName: "Attested", args: { attester, attestationType: 2, ubid } });
    const log = {
      address: ADAPTER, blockNumber: l2Block, logIndex: 0, transactionHash: "0x" + "ab".repeat(32), topics,
      data: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }], [attestationId, variant, data]),
    };
    const client = {
      getBlockNumber: async () => l2Block,
      getLogs: async () => [log],
      request: async ({ method, params }: { method: string; params: unknown[] }) => {
        if (method === "eth_getBlockByNumber" && params[0] === `0x${l2Block.toString(16)}`) return { l1BlockNumber: `0x${l1Block.toString(16)}` };
        throw new Error("unexpected " + method);
      },
    } as unknown as PublicClient;
    for (const semantics of ["l2", "arbitrum"] as const) {
      const store = new ProjectionStore(chainId, ADAPTER);
      await new Ingester(client, store, ADAPTER, l2Block, 10_000n, semantics).sync();
      if (semantics === "arbitrum") {
        expect(store.attestations.size).toBe(1);
        expect(store.dropped.length).toBe(0);
      } else {
        expect(store.attestations.size).toBe(0); // the L2 block would not verify - that was the bug
        expect(store.dropped.length).toBe(1);
      }
    }
  });
});

describe("event log write-through and reorgs", () => {
  /** A chain we control: blocks with hashes, some carrying one Attested log. Reorg = replace blocks. */
  async function fakeChain() {
    const { computeAttestationId, computeUbid, Standard } = await import("../src/ubid.js");
    const { encodeEventTopics, encodeAbiParameters } = await import("viem");
    const { adapterAbi } = await import("../src/abi-runtime.js");
    const chainId = 4663n;
    const attester = "0x81c11034fe2b2f0561e9975df9a45d99172183af" as Address;
    const ubid = computeUbid(chainId, ADAPTER, Standard.ACCOUNT, attester, 0n);
    const variant = ("0x" + "00".repeat(32)) as `0x${string}`;
    const blocks = new Map<bigint, { hash: `0x${string}`; data?: `0x${string}` }>();
    const hash = (n: bigint, fork = 0) => `0x${(n * 1000n + BigInt(fork)).toString(16).padStart(64, "0")}` as `0x${string}`;
    const setBlock = (n: bigint, fork: number, data?: `0x${string}`) => blocks.set(n, { hash: hash(n, fork), data });
    const idOf = (block: bigint, data: `0x${string}`) => computeAttestationId(chainId, ADAPTER, attester, ubid, 2, block, variant, data);
    const calls: string[] = [];
    const client = {
      getBlockNumber: async () => [...blocks.keys()].reduce((a, b) => (b > a ? b : a), 0n),
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push(`logs ${fromBlock}-${toBlock}`);
        const out = [];
        for (const [n, b] of blocks) {
          if (n < fromBlock || n > toBlock || !b.data) continue;
          const attestationId = idOf(n, b.data);
          out.push({
            address: ADAPTER, blockNumber: n, blockHash: b.hash, logIndex: 0, transactionHash: "0x" + "ab".repeat(32),
            topics: encodeEventTopics({ abi: adapterAbi, eventName: "Attested", args: { attester, attestationType: 2, ubid } }),
            data: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }], [attestationId, variant, b.data]),
          });
        }
        return out;
      },
      request: async ({ method, params }: { method: string; params: unknown[] }) => {
        if (method !== "eth_getBlockByNumber") throw new Error("unexpected " + method);
        const b = blocks.get(BigInt(params[0] as string));
        return b ? { hash: b.hash } : null;
      },
    } as unknown as PublicClient;
    return { chainId, client, calls, setBlock, idOf, blocks };
  }

  it("persists what it syncs, resumes from the checkpoint, and rewinds a reorg to the fork point", async () => {
    const { EventLog } = await import("../src/eventlog.js");
    const chain = await fakeChain();
    for (let n = 100n; n <= 110n; n++) chain.setBlock(n, 0);
    chain.setBlock(103n, 0, "0x01");
    chain.setBlock(108n, 0, "0x02");
    const log = new EventLog(":memory:", { chainId: chain.chainId, adapter: ADAPTER, fromBlock: 100n });

    // first boot: a backfill, written through
    const store1 = new ProjectionStore(chain.chainId, ADAPTER);
    const ing1 = new Ingester(chain.client, store1, ADAPTER, 100n, 1000n, "l2", { log });
    expect(ing1.replay()).toBe(0);
    expect(await ing1.sync()).toBe(2);
    expect(store1.attestations.size).toBe(2);
    expect(log.checkpoint()).toEqual({ number: 110n, hash: chain.blocks.get(110n)!.hash });

    // a restart: the fold comes from the file, and the chain is asked only for what came after
    chain.calls.length = 0;
    const store2 = new ProjectionStore(chain.chainId, ADAPTER);
    const reorgs: unknown[] = [];
    const ing2 = new Ingester(chain.client, store2, ADAPTER, 100n, 1000n, "l2", { log, onReorg: (r) => reorgs.push(r) });
    expect(ing2.replay()).toBe(2);
    expect(store2.attestations.size).toBe(2);
    chain.setBlock(111n, 0);
    await ing2.sync();
    expect(chain.calls).toEqual(["logs 111-111"]);

    // the chain reorganises from block 108: the statement there is replaced, blocks after it change hash
    for (let n = 108n; n <= 112n; n++) chain.setBlock(n, 1);
    chain.setBlock(108n, 1, "0x03");
    await ing2.sync();
    // Only event blocks and checkpoints have stored hashes, so the fork resolves to the newest of
    // those the chain still has - 103, not 107. Rewinding a little too far is safe; the resync
    // from 104 brings back whatever the canonical chain has there.
    expect(reorgs).toEqual([{ fork: 103n, previousHead: 111n, droppedEvents: 1 }]);
    expect(store2.attestations.has(chain.idOf(103n, "0x01"))).toBe(true);
    expect(store2.attestations.has(chain.idOf(108n, "0x02"))).toBe(false); // the orphaned statement is gone
    expect(store2.attestations.has(chain.idOf(108n, "0x03"))).toBe(true); // the canonical one is in
    expect([...log.events()].map((e) => Number(e.blockNumber))).toEqual([103, 108]);
    expect(log.checkpoint()).toEqual({ number: 112n, hash: chain.blocks.get(112n)!.hash });
  });
});

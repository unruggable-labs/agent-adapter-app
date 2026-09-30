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

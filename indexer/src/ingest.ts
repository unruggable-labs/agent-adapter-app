import { decodeEventLog, type Address, type Log, type PublicClient } from "viem";
import { adapterAbi } from "./abi-runtime.js";
import { ProjectionStore, type LogEvent } from "./projection.js";

/**
 * Pulls every adapter log from `fromBlock` to the current head and folds it into the store,
 * in (blockNumber, logIndex) order. Called repeatedly it acts as a poller; reorg handling is
 * replay-from-scratch (create a fresh store), which is exactly what conformance requires.
 */
export type BlockNumberSemantics = "l2" | "arbitrum";

export class Ingester {
  private nextBlock: bigint;

  constructor(
    private client: PublicClient,
    private store: ProjectionStore,
    private adapter: Address,
    fromBlock: bigint = 0n,
    /** Public RPCs cap eth_getLogs ranges; backfills are chunked to stay under the cap. */
    private maxRange: bigint = 10_000n,
    /**
     * What `block.number` means on this chain. "arbitrum": a contract sees the parent chain's
     * block, which the node exposes as the block's `l1BlockNumber`; the ingester reads it for
     * every block that carries adapter logs, so attestation ids recompute correctly.
     */
    private blockNumbers: BlockNumberSemantics = "l2",
  ) {
    this.nextBlock = fromBlock;
  }

  /** The contract's view of block.number for a block, per the chain's semantics. */
  private async contractBlockNumber(blockNumber: bigint, cache: Map<bigint, bigint>): Promise<bigint | undefined> {
    if (this.blockNumbers !== "arbitrum") return undefined;
    const hit = cache.get(blockNumber);
    if (hit !== undefined) return hit;
    const raw = (await this.client.request({
      method: "eth_getBlockByNumber",
      params: [`0x${blockNumber.toString(16)}`, false],
    } as never)) as { l1BlockNumber?: `0x${string}` } | null;
    if (!raw?.l1BlockNumber) throw new Error(`block ${blockNumber} has no l1BlockNumber; is this really an Arbitrum-style chain?`);
    const l1 = BigInt(raw.l1BlockNumber);
    cache.set(blockNumber, l1);
    return l1;
  }

  async sync(onProgress?: (from: bigint, to: bigint, head: bigint) => void): Promise<number> {
    const head = await this.client.getBlockNumber();
    let applied = 0;
    while (this.nextBlock <= head) {
      const to = this.nextBlock + this.maxRange - 1n > head ? head : this.nextBlock + this.maxRange - 1n;
      onProgress?.(this.nextBlock, to, head);
      const logs = await this.client.getLogs({
        address: this.adapter,
        fromBlock: this.nextBlock,
        toBlock: to,
      });
      const events = decodeAdapterLogs(logs);
      const cache = new Map<bigint, bigint>();
      for (const ev of events) {
        ev.contractBlockNumber = await this.contractBlockNumber(ev.blockNumber, cache);
        this.store.apply(ev);
      }
      applied += events.length;
      this.nextBlock = to + 1n;
    }
    return applied;
  }
}

export function decodeAdapterLogs(logs: Log[]): LogEvent[] {
  const events: LogEvent[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: adapterAbi,
        data: log.data,
        topics: log.topics,
      });
      events.push({
        blockNumber: log.blockNumber!,
        logIndex: log.logIndex!,
        eventName: decoded.eventName,
        args: decoded.args as unknown as Record<string, unknown>,
        transactionHash: log.transactionHash ?? undefined,
      });
    } catch {
      // A topic0 the adapter ABI does not know — not part of any projection.
    }
  }
  events.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  return events;
}

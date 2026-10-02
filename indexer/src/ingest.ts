import { decodeEventLog, type Address, type Hex, type Log, type PublicClient } from "viem";
import { adapterAbi } from "./abi-runtime.js";
import type { EventLog, StoredEvent } from "./eventlog.js";
import { ProjectionStore, type LogEvent } from "./projection.js";

/**
 * Pulls every adapter log from `fromBlock` to the current head and folds it into the store,
 * in (blockNumber, logIndex) order. Called repeatedly it acts as a poller.
 *
 * Given an EventLog it also writes through: each synced range is committed with the hash of
 * the block it reached before the store sees it, so a restart replays from the file and syncs
 * from the checkpoint. Each poll first checks that the chain still has the checkpoint block
 * under the stored hash; if not, the chain reorganised, and the newest stored block the chain
 * still has is the fork point - the log is truncated there, the store folded again from the
 * file, and syncing resumes from the next block. Without an EventLog the poller is what it
 * always was: in memory, reorg handling by a fresh replay (spec O-2).
 */
export type BlockNumberSemantics = "l2" | "arbitrum";

export interface Reorg {
  /** The newest block the chain and the log still agree on. */
  fork: bigint;
  /** The checkpoint that no longer held. */
  previousHead: bigint;
  droppedEvents: number;
}

export interface IngestOptions {
  log?: EventLog;
  onReorg?: (reorg: Reorg) => void;
}

export class Ingester {
  private nextBlock: bigint;
  private readonly log: EventLog | undefined;
  private readonly onReorg: ((reorg: Reorg) => void) | undefined;

  constructor(
    private client: PublicClient,
    private store: ProjectionStore,
    private adapter: Address,
    private fromBlock: bigint = 0n,
    /** Public RPCs cap eth_getLogs ranges; backfills are chunked to stay under the cap. */
    private maxRange: bigint = 10_000n,
    /**
     * What `block.number` means on this chain. "arbitrum": a contract sees the parent chain's
     * block, which the node exposes as the block's `l1BlockNumber`; the ingester reads it for
     * every block that carries adapter logs, so attestation ids recompute correctly.
     */
    private blockNumbers: BlockNumberSemantics = "l2",
    options: IngestOptions = {},
  ) {
    this.nextBlock = fromBlock;
    this.log = options.log;
    this.onReorg = options.onReorg;
  }

  /** Fold the stored log into the store and position the poller after the checkpoint. Returns how many events. */
  replay(): number {
    if (!this.log) return 0;
    let n = 0;
    for (const ev of this.log.events()) {
      this.store.apply(ev);
      n++;
    }
    const cp = this.log.checkpoint();
    this.nextBlock = cp ? cp.number + 1n : this.fromBlock;
    return n;
  }

  /** The block the next sync starts from. */
  get next(): bigint {
    return this.nextBlock;
  }

  /** The contract's view of block.number for a block, per the chain's semantics. */
  private async contractBlockNumber(blockNumber: bigint, cache: Map<bigint, bigint>): Promise<bigint | undefined> {
    if (this.blockNumbers !== "arbitrum") return undefined;
    const hit = cache.get(blockNumber);
    if (hit !== undefined) return hit;
    const raw = await this.block(blockNumber);
    if (!raw?.l1BlockNumber) throw new Error(`block ${blockNumber} has no l1BlockNumber; is this really an Arbitrum-style chain?`);
    const l1 = BigInt(raw.l1BlockNumber);
    cache.set(blockNumber, l1);
    return l1;
  }

  /** The raw block header, so chains with extra fields (Arbitrum's l1BlockNumber) need no formatter. */
  private async block(blockNumber: bigint): Promise<{ hash?: Hex; l1BlockNumber?: Hex } | null> {
    return (await this.client.request({
      method: "eth_getBlockByNumber",
      params: [`0x${blockNumber.toString(16)}`, false],
    } as never)) as { hash?: Hex; l1BlockNumber?: Hex } | null;
  }

  private async blockHash(blockNumber: bigint): Promise<Hex | null> {
    const raw = await this.block(blockNumber).catch(() => null);
    return raw?.hash ?? null;
  }

  async sync(onProgress?: (from: bigint, to: bigint, head: bigint) => void): Promise<number> {
    await this.rewindIfReorged();
    const head = await this.client.getBlockNumber();
    let applied = 0;
    while (this.nextBlock <= head) {
      const to = this.nextBlock + this.maxRange - 1n > head ? head : this.nextBlock + this.maxRange - 1n;
      onProgress?.(this.nextBlock, to, head);
      // The checkpoint hash is read before the logs. If the chain reorganises between the two
      // reads, the stored hash is the old chain's and the next poll notices.
      const toHash = this.log ? await this.blockHash(to) : null;
      if (this.log && !toHash) throw new Error(`block ${to} not found while syncing; head was ${head}`);
      const logs = await this.client.getLogs({
        address: this.adapter,
        fromBlock: this.nextBlock,
        toBlock: to,
      });
      const events = decodeAdapterLogs(logs);
      const cache = new Map<bigint, bigint>();
      for (const ev of events) ev.contractBlockNumber = await this.contractBlockNumber(ev.blockNumber, cache);
      if (this.log) this.log.append(events, { number: to, hash: toHash! });
      for (const ev of events) this.store.apply(ev);
      applied += events.length;
      this.nextBlock = to + 1n;
    }
    return applied;
  }

  /** Does the chain still have our checkpoint block? If not, find where the two histories part and rewind to it. */
  private async rewindIfReorged(): Promise<void> {
    if (!this.log) return;
    const cp = this.log.checkpoint();
    if (!cp) return;
    if ((await this.blockHash(cp.number)) === cp.hash) return;
    let fork: bigint | null = null;
    for (const b of this.log.recentBlocks()) {
      if (b.number >= cp.number) continue;
      if ((await this.blockHash(b.number)) === b.hash) {
        fork = b.number;
        break;
      }
    }
    // Deeper than every hash we kept: the whole log goes, and the next sync is a full backfill.
    const to = fork ?? this.fromBlock - 1n;
    const before = this.log.count();
    this.log.rewindTo(to);
    this.store.reset();
    const kept = this.replay();
    this.nextBlock = to + 1n;
    this.onReorg?.({ fork: to, previousHead: cp.number, droppedEvents: before - kept });
  }
}

export function decodeAdapterLogs(logs: Log[]): StoredEvent[] {
  const events: StoredEvent[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: adapterAbi,
        data: log.data,
        topics: log.topics,
      });
      if (!decoded.eventName) continue;
      events.push({
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
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

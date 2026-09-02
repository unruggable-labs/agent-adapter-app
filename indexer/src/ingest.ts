import { decodeEventLog, type Address, type Log, type PublicClient } from "viem";
import { adapterArtifact } from "./abi.js";
import { ProjectionStore, type LogEvent } from "./projection.js";

/**
 * Pulls every adapter log from `fromBlock` to the current head and folds it into the store,
 * in (blockNumber, logIndex) order. Called repeatedly it acts as a poller; reorg handling is
 * replay-from-scratch (create a fresh store), which is exactly what conformance requires.
 */
export class Ingester {
  private nextBlock: bigint;

  constructor(
    private client: PublicClient,
    private store: ProjectionStore,
    private adapter: Address,
    fromBlock: bigint = 0n,
  ) {
    this.nextBlock = fromBlock;
  }

  async sync(): Promise<number> {
    const head = await this.client.getBlockNumber();
    if (head < this.nextBlock) return 0;
    const logs = await this.client.getLogs({
      address: this.adapter,
      fromBlock: this.nextBlock,
      toBlock: head,
    });
    const events = decodeAdapterLogs(logs);
    for (const ev of events) this.store.apply(ev);
    this.nextBlock = head + 1n;
    return events.length;
  }
}

export function decodeAdapterLogs(logs: Log[]): LogEvent[] {
  const events: LogEvent[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: adapterArtifact.abi,
        data: log.data,
        topics: log.topics,
      });
      events.push({
        blockNumber: log.blockNumber!,
        logIndex: log.logIndex!,
        eventName: decoded.eventName,
        args: decoded.args as unknown as Record<string, unknown>,
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

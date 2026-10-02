import { DatabaseSync } from "node:sqlite";
import type { Address, Hex } from "viem";
import type { LogEvent } from "./projection.js";

/**
 * The adapter's event log, on disk: one SQLite file per network.
 *
 * The projection is still a fold over events and the chain is still the source of truth. What
 * this adds is a durable copy of the adapter's log, so a restart folds from the file and asks
 * the chain only for what came after, and so a reorg is a bounded operation: truncate the log
 * at the fork point and fold again. Nothing derived is stored here - the store is rebuilt from
 * these rows every boot, which keeps the conformance tests the whole story.
 *
 * Every event carries the hash of its block, and the ingester records the hash of the block it
 * has synced up to (the checkpoint) on every poll. Those hashes are how a reorg is noticed: if
 * the chain no longer has the checkpoint block under that hash, the newest stored block it does
 * still have is the fork point.
 *
 * The file is only a copy of the chain. Deleting it costs a re-index, never data.
 */

export interface Checkpoint {
  number: bigint;
  hash: Hex;
}

export interface StoredEvent extends LogEvent {
  blockHash: Hex;
}

export interface LogIdentity {
  chainId: bigint;
  adapter: Address;
  fromBlock: bigint;
}

const SCHEMA = "1";

/** How many blocks' hashes to keep beyond the ones that carry events: the reorg window. */
const HASH_WINDOW = 100_000n;

export class EventLog {
  private readonly db: DatabaseSync;

  constructor(
    readonly path: string,
    identity: LogIdentity,
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        block_number INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        tx_hash TEXT,
        event_name TEXT NOT NULL,
        args TEXT NOT NULL,
        contract_block INTEGER,
        PRIMARY KEY (block_number, log_index)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS blocks (number INTEGER PRIMARY KEY, hash TEXT NOT NULL);
    `);
    // A log is for one adapter on one chain from one cutover. Anything else is a different log,
    // and the fix is a re-index, not a guess - say so and stop.
    const want: Record<string, string> = {
      schema: SCHEMA,
      chainId: identity.chainId.toString(),
      adapter: identity.adapter.toLowerCase(),
      fromBlock: identity.fromBlock.toString(),
    };
    const rows = this.db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[];
    const have = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (rows.length === 0) {
      const put = this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
      for (const [k, v] of Object.entries(want)) put.run(k, v);
    } else {
      for (const [k, v] of Object.entries(want)) {
        if (have[k] !== v)
          throw new Error(
            `${path} is the event log for ${k}=${have[k] ?? "(unset)"}; this run wants ${k}=${v}. ` +
              `It is only a copy of the chain: delete the file to re-index.`,
          );
      }
    }
  }

  checkpoint(): Checkpoint | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'checkpoint'").get() as { value: string } | undefined;
    if (!row) return null;
    const [number, hash] = row.value.split(":");
    return { number: BigInt(number), hash: hash as Hex };
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  }

  /** Every stored event, in (block, log index) order - the input to the fold. */
  *events(): IterableIterator<StoredEvent> {
    const rows = this.db
      .prepare("SELECT block_number, log_index, block_hash, tx_hash, event_name, args, contract_block FROM events ORDER BY block_number, log_index")
      .iterate() as IterableIterator<{
      block_number: number;
      log_index: number;
      block_hash: string;
      tx_hash: string | null;
      event_name: string;
      args: string;
      contract_block: number | null;
    }>;
    for (const r of rows) {
      const ev: StoredEvent = {
        blockNumber: BigInt(r.block_number),
        logIndex: r.log_index,
        blockHash: r.block_hash as Hex,
        eventName: r.event_name,
        args: decodeArgs(r.args),
      };
      if (r.tx_hash) ev.transactionHash = r.tx_hash as Hex;
      if (r.contract_block !== null) ev.contractBlockNumber = BigInt(r.contract_block);
      yield ev;
    }
  }

  /** The newest stored block hashes, newest first: the candidates for a fork point. */
  recentBlocks(limit = 1024): Checkpoint[] {
    const rows = this.db.prepare("SELECT number, hash FROM blocks ORDER BY number DESC LIMIT ?").all(limit) as { number: number; hash: string }[];
    return rows.map((r) => ({ number: BigInt(r.number), hash: r.hash as Hex }));
  }

  /** One synced range: its events, the hashes of their blocks, and the new checkpoint, committed together. */
  append(events: StoredEvent[], checkpoint: Checkpoint): void {
    const putEvent = this.db.prepare(
      "INSERT OR REPLACE INTO events (block_number, log_index, block_hash, tx_hash, event_name, args, contract_block) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const putBlock = this.db.prepare("INSERT OR REPLACE INTO blocks (number, hash) VALUES (?, ?)");
    const putMeta = this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('checkpoint', ?)");
    const prune = this.db.prepare("DELETE FROM blocks WHERE number < ? AND number NOT IN (SELECT block_number FROM events)");
    this.db.exec("BEGIN");
    try {
      for (const ev of events) {
        putEvent.run(
          Number(ev.blockNumber),
          ev.logIndex,
          ev.blockHash,
          ev.transactionHash ?? null,
          ev.eventName,
          encodeArgs(ev.args),
          ev.contractBlockNumber === undefined ? null : Number(ev.contractBlockNumber),
        );
        putBlock.run(Number(ev.blockNumber), ev.blockHash);
      }
      putBlock.run(Number(checkpoint.number), checkpoint.hash);
      putMeta.run(`${checkpoint.number}:${checkpoint.hash}`);
      if (checkpoint.number > HASH_WINDOW) prune.run(Number(checkpoint.number - HASH_WINDOW));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Drop everything after `block` - the reorg rewind. The checkpoint becomes that block, or nothing if it was never stored. */
  rewindTo(block: bigint): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM events WHERE block_number > ?").run(Number(block));
      this.db.prepare("DELETE FROM blocks WHERE number > ?").run(Number(block));
      const kept = this.db.prepare("SELECT hash FROM blocks WHERE number = ?").get(Number(block)) as { hash: string } | undefined;
      if (kept) this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('checkpoint', ?)").run(`${block}:${kept.hash}`);
      else this.db.prepare("DELETE FROM meta WHERE key = 'checkpoint'").run();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Forget the chain entirely; the next boot re-indexes from the cutover block. */
  reset(): void {
    this.db.exec("BEGIN; DELETE FROM events; DELETE FROM blocks; DELETE FROM meta WHERE key = 'checkpoint'; COMMIT;");
  }

  close(): void {
    this.db.close();
  }
}

/** Decoded log args hold bigints, which JSON has no word for. Tag them so they come back as bigints. */
export function encodeArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v));
}

export function decodeArgs(text: string): Record<string, unknown> {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$big === "string" ? BigInt(v.$big) : v,
  );
}

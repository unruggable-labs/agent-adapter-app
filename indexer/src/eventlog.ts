import { DatabaseSync } from "node:sqlite";
import type { Address, Hex } from "viem";
import type { LogEvent } from "./projection.js";
import { computeUbid, type Standard } from "./ubid.js";

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
 * Two things ride along for the stats page (stats.ts). Each block row carries its timestamp, read
 * from the header the ingester already fetches, so events can be bucketed by day. And each event
 * row carries a few facts pulled out of its args - the UBID, the bound address, who acted, the
 * attestation type - in indexed columns, so "attestations per week by type" is one query rather
 * than a scan that parses JSON. Neither changes the fold; the store never reads them.
 *
 * The file is only a copy of the chain. Deleting it costs a re-index, never data.
 */

export interface Checkpoint {
  number: bigint;
  hash: Hex;
}

export interface StoredEvent extends LogEvent {
  blockHash: Hex;
  /** The block's timestamp, unix seconds, when the source knows it. */
  blockTimestamp?: number;
}

/** What an event says about itself, in columns. Null where the event has no such field. */
export interface EventFacts {
  ubid: Hex | null;
  boundAddress: Address | null;
  /** Who did it: the emitter, the registrant, the attester, the revoker, the account. */
  actor: Address | null;
  attestationType: number | null;
  attestationId: Hex | null;
  agentId: string | null;
}

export interface LogIdentity {
  chainId: bigint;
  adapter: Address;
  fromBlock: bigint;
}

const SCHEMA = "2";

/** How many blocks' hashes to keep beyond the ones that carry events: the reorg window. */
const HASH_WINDOW = 100_000n;
/** Rows per replay chunk. */
const REPLAY_CHUNK = 2000;

export class EventLog {
  private readonly db: DatabaseSync;

  constructor(
    readonly path: string,
    identity: LogIdentity,
  ) {
    this.chainId = identity.chainId;
    this.adapter = identity.adapter.toLowerCase() as Address;
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
        ubid TEXT,
        bound_address TEXT,
        actor TEXT,
        attestation_type INTEGER,
        attestation_id TEXT,
        agent_id TEXT,
        PRIMARY KEY (block_number, log_index)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS blocks (number INTEGER PRIMARY KEY, hash TEXT NOT NULL, timestamp INTEGER);
    `);
    // A log is for one adapter on one chain from one cutover. Anything else is a different log,
    // and the fix is a re-index, not a guess - say so and stop. The schema version is ours to
    // move: an older file is migrated in place.
    const want: Record<string, string> = {
      chainId: identity.chainId.toString(),
      adapter: this.adapter,
      fromBlock: identity.fromBlock.toString(),
    };
    const rows = this.db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[];
    const have = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (rows.length === 0) {
      const put = this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
      for (const [k, v] of Object.entries({ schema: SCHEMA, ...want })) put.run(k, v);
    } else {
      for (const [k, v] of Object.entries(want)) {
        if (have[k] !== v)
          throw new Error(
            `${path} is the event log for ${k}=${have[k] ?? "(unset)"}; this run wants ${k}=${v}. ` +
              `It is only a copy of the chain: delete the file to re-index.`,
          );
      }
      if (have.schema === "1") this.migrateFrom1();
      else if (have.schema !== SCHEMA) throw new Error(`${path} has event log schema ${have.schema}; this build reads ${SCHEMA}. Delete the file to re-index.`);
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS events_name_block ON events (event_name, block_number);
      CREATE INDEX IF NOT EXISTS events_ubid ON events (ubid);
      CREATE INDEX IF NOT EXISTS events_bound ON events (bound_address, block_number);
      CREATE INDEX IF NOT EXISTS events_actor ON events (actor);
      CREATE INDEX IF NOT EXISTS events_attestation ON events (attestation_id);
    `);
  }

  private readonly chainId: bigint;
  private readonly adapter: Address;

  /** The connection, for the read-only stats queries. Nothing else writes through it. */
  get connection(): DatabaseSync {
    return this.db;
  }

  /** Schema 1 had no timestamps and no fact columns. Add them, fill the facts from the stored args
   *  in log order (agent-keyed events look up the AgentBound row before them), and move on. */
  private migrateFrom1(): void {
    const cols = ["ubid TEXT", "bound_address TEXT", "actor TEXT", "attestation_type INTEGER", "attestation_id TEXT", "agent_id TEXT"];
    this.db.exec("BEGIN");
    try {
      for (const c of cols) this.db.exec(`ALTER TABLE events ADD COLUMN ${c}`);
      this.db.exec("ALTER TABLE blocks ADD COLUMN timestamp INTEGER");
      const rows = this.db.prepare("SELECT block_number, log_index, event_name, args FROM events ORDER BY block_number, log_index").all() as {
        block_number: number; log_index: number; event_name: string; args: string;
      }[];
      const put = this.db.prepare("UPDATE events SET ubid = ?, bound_address = ?, actor = ?, attestation_type = ?, attestation_id = ?, agent_id = ? WHERE block_number = ? AND log_index = ?");
      for (const r of rows) {
        const f = this.factsOf(r.event_name, decodeArgs(r.args));
        put.run(f.ubid, f.boundAddress, f.actor, f.attestationType, f.attestationId, f.agentId, r.block_number, r.log_index);
      }
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(SCHEMA);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** The facts in an event's args. Agent-keyed registry events (URI, metadata, wallet) name only the
   *  agent id; their UBID and bound address come from the AgentBound row already in the log. A
   *  revocation names only the attestation id; its UBID comes from the Attested row. */
  factsOf(eventName: string, args: Record<string, unknown>): EventFacts {
    const lower = (v: unknown) => (typeof v === "string" ? (v.toLowerCase() as Hex) : null);
    const none: EventFacts = { ubid: null, boundAddress: null, actor: null, attestationType: null, attestationId: null, agentId: null };
    switch (eventName) {
      case "CounterfactualAgentRegistered":
      case "CounterfactualAgentURISet":
      case "CounterfactualMetadataSet":
      case "CounterfactualMetadataBatchSet":
      case "CounterfactualAgentWalletSet":
      case "CounterfactualAgentWalletUnset":
        return { ...none, ubid: lower(args.ubid), boundAddress: lower(args.boundAddress) as Address | null, actor: lower(args.emitter) as Address | null };
      case "AgentBound": {
        const bound = lower(args.boundAddress) as Address | null;
        const ubid = bound && args.tokenId !== undefined ? computeUbid(this.chainId, this.adapter, Number(args.standard) as Standard, bound, BigInt(args.tokenId as bigint)) : null;
        return { ...none, ubid, boundAddress: bound, actor: lower(args.registeredBy) as Address | null, agentId: args.agentId === undefined ? null : String(args.agentId) };
      }
      case "AgentURISet":
      case "MetadataSet":
      case "AgentWalletSet":
      case "AgentWalletUnset": {
        const agentId = args.agentId === undefined ? null : String(args.agentId);
        const bound = agentId ? (this.db.prepare("SELECT ubid, bound_address FROM events WHERE event_name = 'AgentBound' AND agent_id = ? LIMIT 1").get(agentId) as { ubid: Hex; bound_address: Address } | undefined) : undefined;
        return { ...none, ubid: bound?.ubid ?? null, boundAddress: bound?.bound_address ?? null, agentId };
      }
      case "WalletUBIDSet":
        return { ...none, ubid: lower(args.ubid), boundAddress: lower(args.boundAddress) as Address | null, actor: lower(args.account) as Address | null };
      case "WalletUBIDCleared":
        return { ...none, actor: lower(args.account) as Address | null };
      case "Attested":
        return { ...none, ubid: lower(args.ubid), actor: lower(args.attester) as Address | null, attestationType: args.attestationType === undefined ? null : Number(args.attestationType), attestationId: lower(args.attestationId) };
      case "AttestationRevoked": {
        const attestationId = lower(args.attestationId);
        const a = attestationId ? (this.db.prepare("SELECT ubid, attestation_type FROM events WHERE event_name = 'Attested' AND attestation_id = ? LIMIT 1").get(attestationId) as { ubid: Hex; attestation_type: number } | undefined) : undefined;
        return { ...none, ubid: a?.ubid ?? null, actor: lower(args.revoker) as Address | null, attestationType: a?.attestation_type ?? null, attestationId };
      }
      default:
        return none;
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

  /** Every stored event, in (block, log index) order - the input to the fold.
   *  Read in keyed chunks rather than through `iterate()`: node:sqlite's iterator does not keep
   *  its statement alive, and a garbage collection mid-replay finalises it under the loop
   *  ("statement has been finalized"). Chunks hold nothing across yields. */
  *events(): IterableIterator<StoredEvent> {
    const page = this.db.prepare(
      `SELECT block_number, log_index, block_hash, tx_hash, event_name, args, contract_block FROM events
       WHERE block_number > ? OR (block_number = ? AND log_index > ?)
       ORDER BY block_number, log_index LIMIT ?`,
    );
    let afterBlock = -1;
    let afterIndex = -1;
    for (;;) {
      const rows = page.all(afterBlock, afterBlock, afterIndex, REPLAY_CHUNK) as {
        block_number: number;
        log_index: number;
        block_hash: string;
        tx_hash: string | null;
        event_name: string;
        args: string;
        contract_block: number | null;
      }[];
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
      if (rows.length < REPLAY_CHUNK) return;
      const last = rows[rows.length - 1];
      afterBlock = last.block_number;
      afterIndex = last.log_index;
    }
  }

  /** The newest stored block hashes, newest first: the candidates for a fork point. */
  recentBlocks(limit = 1024): Checkpoint[] {
    const rows = this.db.prepare("SELECT number, hash FROM blocks ORDER BY number DESC LIMIT ?").all(limit) as { number: number; hash: string }[];
    return rows.map((r) => ({ number: BigInt(r.number), hash: r.hash as Hex }));
  }

  /** One synced range: its events, the hashes of their blocks, and the new checkpoint, committed together. */
  append(events: StoredEvent[], checkpoint: Checkpoint & { timestamp?: number }): void {
    const putEvent = this.db.prepare(
      "INSERT OR REPLACE INTO events (block_number, log_index, block_hash, tx_hash, event_name, args, contract_block, ubid, bound_address, actor, attestation_type, attestation_id, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // A block's hash may be re-stated by a later range; its timestamp is kept if the new row has none.
    const putBlock = this.db.prepare("INSERT INTO blocks (number, hash, timestamp) VALUES (?, ?, ?) ON CONFLICT(number) DO UPDATE SET hash = excluded.hash, timestamp = COALESCE(excluded.timestamp, blocks.timestamp)");
    const putMeta = this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('checkpoint', ?)");
    const prune = this.db.prepare("DELETE FROM blocks WHERE number < ? AND number NOT IN (SELECT block_number FROM events)");
    this.db.exec("BEGIN");
    try {
      for (const ev of events) {
        const f = this.factsOf(ev.eventName, ev.args);
        putEvent.run(
          Number(ev.blockNumber),
          ev.logIndex,
          ev.blockHash,
          ev.transactionHash ?? null,
          ev.eventName,
          encodeArgs(ev.args),
          ev.contractBlockNumber === undefined ? null : Number(ev.contractBlockNumber),
          f.ubid,
          f.boundAddress,
          f.actor,
          f.attestationType,
          f.attestationId,
          f.agentId,
        );
        putBlock.run(Number(ev.blockNumber), ev.blockHash, ev.blockTimestamp ?? null);
      }
      putBlock.run(Number(checkpoint.number), checkpoint.hash, checkpoint.timestamp ?? null);
      putMeta.run(`${checkpoint.number}:${checkpoint.hash}`);
      if (checkpoint.number > HASH_WINDOW) prune.run(Number(checkpoint.number - HASH_WINDOW));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Event blocks whose timestamp is not known yet - the backfill's worklist, oldest first. */
  blocksWithoutTimestamp(limit = 200): bigint[] {
    const rows = this.db.prepare("SELECT DISTINCT e.block_number AS n FROM events e JOIN blocks b ON b.number = e.block_number WHERE b.timestamp IS NULL ORDER BY e.block_number LIMIT ?").all(limit) as { n: number }[];
    return rows.map((r) => BigInt(r.n));
  }

  setTimestamps(stamps: Map<bigint, number>): void {
    const put = this.db.prepare("UPDATE blocks SET timestamp = ? WHERE number = ?");
    this.db.exec("BEGIN");
    try {
      for (const [n, t] of stamps) put.run(t, Number(n));
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

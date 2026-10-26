import type { DatabaseSync } from "node:sqlite";
import type { Address, Hex } from "viem";
import type { Collection } from "./collection.js";
import type { Card } from "./images.js";
import type { TrustBase } from "./trustbase.js";

/**
 * What the chain says around each record, kept: who holds the controlling token, the bound
 * contract's name, trust base and collection document, the token's card, and whether a
 * referenced transaction exists. The adapter never emits these, so the view worker reads them
 * (views.ts) and writes them here. Pages read them from here and nothing else - no request, and
 * no page view, reads the chain.
 *
 * They live in the network's SQLite file beside the event log (eventlog.ts), in their own
 * tables, so a restart starts warm instead of re-reading the registry. Like the log they are
 * only a copy of the chain: deleting them costs re-reads, never data. Without a database (tests,
 * the in-memory demo) the same store runs in memory.
 */

export interface HolderFact {
  /** The address that passes the adapter's control check today, where that is one address. */
  holder: Address | null;
  /** True when the controlling token has no holder (burned or never minted); null where not a token. */
  ownerless: boolean | null;
  at: number;
}

export interface ContractFacts {
  trustBase: TrustBase | null;
  name: string | null;
  collection: Collection | null;
  at: number;
}

export interface CardFact {
  /** What the card was resolved from (token, standard, agent URI): a changed key is a stale card. */
  key: string;
  card: Card | null;
  at: number;
}

export interface TxRefFact {
  found: boolean;
  at: number;
}

/** Bumped when a stored shape changes. An older set of tables is dropped and read again. */
const SCHEMA = "1";

export class AdvisoryStore {
  private readonly holders = new Map<Hex, HolderFact>();
  private readonly contracts = new Map<Address, ContractFacts>();
  private readonly cards = new Map<Hex, CardFact>();
  private readonly txRefs = new Map<Hex, TxRefFact>();
  private watchCheckpoint: bigint | null = null;

  constructor(private readonly db: DatabaseSync | null = null) {
    if (!db) return;
    const version = (() => {
      try {
        return (db.prepare("SELECT value FROM advisory_meta WHERE key = 'schema'").get() as { value: string } | undefined)?.value;
      } catch {
        return undefined;
      }
    })();
    if (version !== undefined && version !== SCHEMA) {
      db.exec("DROP TABLE IF EXISTS advisory_holders; DROP TABLE IF EXISTS advisory_contracts; DROP TABLE IF EXISTS advisory_cards; DROP TABLE IF EXISTS advisory_txrefs; DROP TABLE IF EXISTS advisory_meta;");
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS advisory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS advisory_holders (ubid TEXT PRIMARY KEY, holder TEXT, ownerless INTEGER, at INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS advisory_contracts (address TEXT PRIMARY KEY, trust_base TEXT, name TEXT, collection TEXT, at INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS advisory_cards (ubid TEXT PRIMARY KEY, key TEXT NOT NULL, card TEXT, at INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS advisory_txrefs (hash TEXT PRIMARY KEY, found INTEGER NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID;
    `);
    db.prepare("INSERT OR REPLACE INTO advisory_meta (key, value) VALUES ('schema', ?)").run(SCHEMA);

    const parse = <T>(text: string | null): T | null => (text === null ? null : (JSON.parse(text) as T));
    for (const r of db.prepare("SELECT ubid, holder, ownerless, at FROM advisory_holders").all() as { ubid: Hex; holder: Address | null; ownerless: number | null; at: number }[]) {
      this.holders.set(r.ubid, { holder: r.holder, ownerless: r.ownerless === null ? null : r.ownerless === 1, at: r.at });
    }
    for (const r of db.prepare("SELECT address, trust_base, name, collection, at FROM advisory_contracts").all() as { address: Address; trust_base: string | null; name: string | null; collection: string | null; at: number }[]) {
      this.contracts.set(r.address, { trustBase: parse<TrustBase>(r.trust_base), name: r.name, collection: parse<Collection>(r.collection), at: r.at });
    }
    for (const r of db.prepare("SELECT ubid, key, card, at FROM advisory_cards").all() as { ubid: Hex; key: string; card: string | null; at: number }[]) {
      this.cards.set(r.ubid, { key: r.key, card: parse<Card>(r.card), at: r.at });
    }
    for (const r of db.prepare("SELECT hash, found, at FROM advisory_txrefs").all() as { hash: Hex; found: number; at: number }[]) {
      this.txRefs.set(r.hash, { found: r.found === 1, at: r.at });
    }
    const cp = db.prepare("SELECT value FROM advisory_meta WHERE key = 'watch_checkpoint'").get() as { value: string } | undefined;
    this.watchCheckpoint = cp ? BigInt(cp.value) : null;
  }

  holder(ubid: Hex): HolderFact | null {
    return this.holders.get(ubid) ?? null;
  }

  contract(address: Address): ContractFacts | null {
    return this.contracts.get(address.toLowerCase() as Address) ?? null;
  }

  card(ubid: Hex): CardFact | null {
    return this.cards.get(ubid) ?? null;
  }

  txRef(hash: Hex): TxRefFact | null {
    return this.txRefs.get(hash.toLowerCase() as Hex) ?? null;
  }

  /** How many identities have a holder reading - the worker's first-pass progress. */
  get holderCount(): number {
    return this.holders.size;
  }

  /** The last block the collection watcher scanned (watch.ts), or null before its first scan. */
  get watchedTo(): bigint | null {
    return this.watchCheckpoint;
  }

  /** One batch of readings, written together. */
  write(batch: {
    holders?: Map<Hex, HolderFact>;
    contracts?: Map<Address, ContractFacts>;
    cards?: Map<Hex, CardFact>;
    txRefs?: Map<Hex, TxRefFact>;
    watchedTo?: bigint;
  }): void {
    for (const [k, v] of batch.holders ?? []) this.holders.set(k, v);
    for (const [k, v] of batch.contracts ?? []) this.contracts.set(k.toLowerCase() as Address, v);
    for (const [k, v] of batch.cards ?? []) this.cards.set(k, v);
    for (const [k, v] of batch.txRefs ?? []) this.txRefs.set(k.toLowerCase() as Hex, v);
    if (batch.watchedTo !== undefined) this.watchCheckpoint = batch.watchedTo;
    const db = this.db;
    if (!db) return;
    const json = (v: unknown) => (v === null ? null : JSON.stringify(v));
    db.exec("BEGIN");
    try {
      const h = db.prepare("INSERT OR REPLACE INTO advisory_holders (ubid, holder, ownerless, at) VALUES (?, ?, ?, ?)");
      for (const [k, v] of batch.holders ?? []) h.run(k, v.holder, v.ownerless === null ? null : v.ownerless ? 1 : 0, v.at);
      const c = db.prepare("INSERT OR REPLACE INTO advisory_contracts (address, trust_base, name, collection, at) VALUES (?, ?, ?, ?, ?)");
      for (const [k, v] of batch.contracts ?? []) c.run(k.toLowerCase(), json(v.trustBase), v.name, json(v.collection), v.at);
      const d = db.prepare("INSERT OR REPLACE INTO advisory_cards (ubid, key, card, at) VALUES (?, ?, ?, ?)");
      for (const [k, v] of batch.cards ?? []) d.run(k, v.key, json(v.card), v.at);
      const t = db.prepare("INSERT OR REPLACE INTO advisory_txrefs (hash, found, at) VALUES (?, ?, ?)");
      for (const [k, v] of batch.txRefs ?? []) t.run(k.toLowerCase(), v.found ? 1 : 0, v.at);
      if (batch.watchedTo !== undefined) db.prepare("INSERT OR REPLACE INTO advisory_meta (key, value) VALUES ('watch_checkpoint', ?)").run(batch.watchedTo.toString());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

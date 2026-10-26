import type { Address, PublicClient } from "viem";
import { AdvisoryStore } from "./advisories.js";
import type { EventLog } from "./eventlog.js";
import type { Ingester } from "./ingest.js";
import type { OrderKey, ProjectionStore } from "./projection.js";
import { ViewCache } from "./views.js";
import { CollectionWatcher } from "./watch.js";

/**
 * One chain, running: its event log and fold, the poller that keeps it synced, the view worker
 * and the collection watcher. A server serves a list of these (server.ts) - one for a chain's own
 * site, several for the multichain explorer - and the code is the same either way.
 *
 * Each chain fails on its own. Its first sync runs after the server is up, so a chain backfilling
 * from its cutover doesn't keep the others off the air; a chain whose RPC stops answering stops
 * advancing and says so in its status, while the rest carry on. A backfill the RPC returned short
 * (see verifyBackfill) re-indexes that chain in place rather than taking the process down.
 */

export interface ChainInfo {
  /** The name in URLs and the API: robinhood, base, mainnet, sepolia, local. */
  slug: string;
  /** The name people read: "Robinhood Chain". */
  label: string;
  /** The public hostname of this chain's own site, if it has one. A request for it sees only this chain. */
  host?: string;
  testnet?: boolean;
}

export interface ChainStatus {
  /** syncing: the first sync hasn't finished. live: polling. stalled: no good poll for a while. */
  state: "syncing" | "live" | "stalled";
  /** The newest block folded in. */
  syncedTo: string | null;
  /** The chain's head when it was last asked. */
  head: string | null;
  /** When a poll last succeeded, unix ms. */
  lastSyncAt: number | null;
  error: string | null;
}

export interface RuntimeOptions extends ChainInfo {
  store: ProjectionStore;
  client: PublicClient;
  adapter: Address;
  ingester?: Ingester;
  log?: EventLog;
  pollMs?: number;
  /** How often the bound contracts are scanned (watch.ts). */
  watchMs?: number;
  /** The cutover block, for the full-range recount after the first sync. Omit to skip it. */
  verifyFrom?: bigint;
}

/** A poll this many intervals overdue makes the chain "stalled". */
const STALL_POLLS = 5;

export class ChainRuntime implements ChainInfo {
  readonly slug: string;
  readonly label: string;
  readonly host?: string;
  readonly testnet: boolean;
  readonly store: ProjectionStore;
  readonly client: PublicClient;
  readonly adapter: Address;
  readonly ingester?: Ingester;
  readonly log?: EventLog;
  readonly advisories: AdvisoryStore;
  readonly views: ViewCache;
  readonly watcher?: CollectionWatcher;
  readonly pollMs: number;
  private readonly watchMs: number;
  private readonly verifyFrom?: bigint;
  private state: ChainStatus["state"] = "syncing";
  private head: bigint | null = null;
  private lastSyncAt: number | null = null;
  private error: string | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(o: RuntimeOptions) {
    this.slug = o.slug;
    this.label = o.label;
    this.host = o.host;
    this.testnet = o.testnet ?? false;
    this.store = o.store;
    this.client = o.client;
    this.adapter = o.adapter;
    this.ingester = o.ingester;
    this.log = o.log;
    this.pollMs = o.pollMs ?? 2000;
    this.watchMs = o.watchMs ?? 5 * 60_000;
    this.verifyFrom = o.verifyFrom;
    // Chain facts around each identity are read by this worker, never on a request, and kept in the
    // network's SQLite file beside the event log so a restart starts warm.
    this.advisories = new AdvisoryStore(o.log?.connection ?? null);
    this.views = new ViewCache(o.store, o.client, { log: (line) => this.say(line) }, this.advisories);
    if (o.ingester) this.watcher = new CollectionWatcher(o.store, o.client, this.advisories, { log: (line) => this.say(line) });
    if (!o.ingester) this.state = "live"; // a store fed by someone else (tests): nothing to sync
  }

  get chainId(): bigint {
    return this.store.chainId;
  }

  /** When a block was made, unix seconds: what orders records across chains, whose block numbers don't compare. */
  timeOf(order: OrderKey): number | null {
    return this.log?.blockTimestamp(order.blockNumber) ?? null;
  }

  status(): ChainStatus {
    const overdue = this.lastSyncAt !== null && Date.now() - this.lastSyncAt > this.pollMs * STALL_POLLS;
    return {
      state: this.state === "live" && overdue ? "stalled" : this.state,
      syncedTo: this.ingester ? (this.ingester.next - 1n).toString() : null,
      head: this.head?.toString() ?? null,
      lastSyncAt: this.lastSyncAt,
      error: this.error,
    };
  }

  /** Start everything: the first sync (in the background), then the poller, the worker and the watcher. */
  start(): void {
    this.views.start();
    if (!this.ingester) return;
    void this.firstSync().then(() => {
      this.timers.push(setInterval(() => void this.poll(), this.pollMs));
      this.timers.push(setInterval(() => void this.scan(), this.watchMs));
      void this.scan();
      // Blocks stored before timestamps were kept get theirs now, in the background.
      this.ingester!.backfillTimestamps().then((n) => n > 0 && this.say(`Timestamps: filled ${n} blocks stored before they were kept`)).catch(() => {});
    });
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.views.stop();
  }

  private say(line: string) {
    console.log(`[${this.slug}] ${line}`);
  }

  /** The first sync, retried until it lands, then the recount. */
  private async firstSync(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const fresh = await this.ingester!.sync((from, to, head) => {
          this.head = head;
          if (head - from > 10_000n) this.say(`backfill ${from} … ${to} (head ${head})`);
        });
        this.lastSyncAt = Date.now();
        this.error = null;
        const s = this.store;
        this.say(`Synced: ${this.log?.count() ?? fresh} events (${fresh} new) → ${s.identities.size} identities, ${s.agents.size} agents, ${s.attestations.size} attestations, ${s.dropped.length} dropped`);
        if (await this.verifyBackfill()) {
          this.state = "live";
          return;
        }
      } catch (e) {
        this.error = firstLine(e);
        const wait = Math.min(60_000, 2_000 * 2 ** attempt);
        this.say(`First sync failed, trying again in ${wait / 1000}s: ${this.error}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  /**
   * Load-balanced public RPCs can silently return incomplete logs for a chunk - observed in the
   * wild (a backfill came back one AgentBound short with no error). Cross-check the log against
   * one full-range query; on mismatch, forget this chain's log and fold, and the caller syncs
   * again from the cutover. Skipped if the RPC caps full-range queries. True when the log stands.
   */
  private async verifyBackfill(): Promise<boolean> {
    if (this.verifyFrom === undefined || !this.log || !this.ingester) return true;
    const count = this.log.count();
    try {
      const fullRange = await this.client.getLogs({ address: this.adapter, fromBlock: this.verifyFrom, toBlock: this.ingester.next - 1n });
      if (fullRange.length > count) {
        this.say(`BACKFILL MISMATCH: the event log holds ${count} events but a full-range query returned ${fullRange.length} - the RPC returned incomplete logs. Re-indexing this chain.`);
        this.log.reset();
        this.store.reset();
        this.ingester.replay();
        return false;
      }
      if (fullRange.length < count) this.say(`Backfill verification inconclusive: full-range recount saw ${fullRange.length} < ${count}.`);
      else this.say(`Backfill verified: full-range recount matches (${count} events).`);
    } catch {
      this.say("Backfill verification skipped: RPC rejected the full-range query.");
    }
    return true;
  }

  private polling = false;
  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.ingester!.sync((_from, _to, head) => (this.head = head));
      this.lastSyncAt = Date.now();
      this.error = null;
    } catch (e) {
      this.error = firstLine(e);
    } finally {
      this.polling = false;
    }
  }

  private scanning = false;
  /** The bound contracts, up to the block the ingester has synced, so every event maps onto records the store has. */
  private async scan(): Promise<void> {
    if (this.scanning || !this.watcher || !this.ingester) return;
    this.scanning = true;
    try {
      const d = await this.watcher.scan(this.ingester.next - 1n);
      if (d.holders.size + d.cards.size + d.contracts.size > 0) this.say(`Watch: ${d.holders.size} holders, ${d.cards.size} cards, ${d.contracts.size} contracts to read again`);
      this.views.mark(d);
    } catch (e) {
      this.say(`Watch scan failed, retrying next round: ${firstLine(e)}`);
    } finally {
      this.scanning = false;
    }
  }
}

function firstLine(e: unknown): string {
  return e instanceof Error ? e.message.split("\n")[0] : String(e);
}

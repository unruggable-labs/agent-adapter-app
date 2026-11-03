import { withRpcWorkload, type RpcBudget, type RpcWorkload } from "./rpc-budget.js";
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
  state: "syncing" | "live" | "stalled" | "paused";
  /** The newest block folded in. */
  syncedTo: string | null;
  /** The chain's head when it was last asked. */
  head: string | null;
  /** When a poll last succeeded, unix ms. */
  lastSyncAt: number | null;
  error: string | null;
  rpcBudget?: ReturnType<RpcBudget["snapshot"]>;
  enrichmentMode?: "off" | "events" | "bulk";
}

export interface RuntimeOptions extends ChainInfo {
  offline?: boolean;
  enrichmentMode?: "off" | "events" | "bulk";
  timestampBackfill?: boolean;
  beforeSync?: () => Promise<void>;
  rpcBudget?: () => ReturnType<RpcBudget["snapshot"]>;
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
  private dating = false;
  private stopped = true;
  private checked = false;
  private readonly enrichmentMode: "off" | "events" | "bulk";
  private readonly timestampBackfill: boolean;
  private readonly beforeSync?: () => Promise<void>;
  private readonly offline: boolean;
  private readonly rpcBudget?: RuntimeOptions["rpcBudget"];
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(o: RuntimeOptions) {
    this.offline = o.offline ?? false;
    this.enrichmentMode = o.enrichmentMode ?? "off";
    this.timestampBackfill = o.timestampBackfill ?? false;
    this.beforeSync = o.beforeSync;
    this.rpcBudget = o.rpcBudget;
    this.slug = o.slug;
    this.label = o.label;
    this.host = o.host;
    this.testnet = o.testnet ?? false;
    this.store = o.store;
    this.client = o.client;
    this.adapter = o.adapter;
    this.ingester = o.ingester;
    this.log = o.log;
    this.pollMs = o.pollMs ?? 60_000;
    this.watchMs = o.watchMs ?? 5 * 60_000;
    this.verifyFrom = o.verifyFrom;
    // Chain facts around each identity are read by this worker, never on a request, and kept in the
    // network's SQLite file beside the event log so a restart starts warm.
    this.advisories = new AdvisoryStore(o.log?.connection ?? null);
    this.views = new ViewCache(o.store, o.client, { ...(this.enrichmentMode === "events" ? { eventOnly: true, batch: 10, concurrency: 1, gapMs: 1000 } : {}), canReadRpc: () => this.enrichmentMode !== "off" && this.canReadRpc("enrichment"), log: (line) => this.say(line) }, this.advisories);
    if (o.ingester) this.watcher = new CollectionWatcher(o.store, o.client, this.advisories, { log: (line) => this.say(line) });
    if (this.offline) this.state = "paused";
    else if (!o.ingester) this.state = "live"; // a store fed by someone else (tests): nothing to sync
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
      state: this.offline || (this.rpcBudget && (this.rpcBudget().expired || this.rpcBudget().workloads.ingestion.remaining === 0)) ? "paused" : this.state === "live" && overdue ? "stalled" : this.state,
      rpcBudget: this.rpcBudget?.(),
      enrichmentMode: this.enrichmentMode,
      syncedTo: this.ingester ? (this.ingester.next - 1n).toString() : null,
      head: this.head?.toString() ?? null,
      lastSyncAt: this.lastSyncAt,
      error: this.error,
    };
  }

  /** Start everything: the first sync (in the background), then the poller, the worker and the watcher. */
  start(): void {
    if (this.offline || !this.stopped) return;
    this.stopped = false;
    if (!this.ingester) {
      if (this.enrichmentMode !== "off") this.views.start();
      return;
    }
    void this.firstSync().then(() => {
      if (this.stopped) return;
      this.timers.push(setInterval(() => void this.poll(), this.pollMs));
      if (this.enrichmentMode !== "off") {
        this.views.start();
        this.timers.push(setInterval(() => void this.scan(), this.watchMs));
        void this.scan();
      }
      if (this.timestampBackfill) {
        void this.dateBlocks();
        this.timers.push(setInterval(() => void this.dateBlocks(), 5 * 60_000));
      }
    });
  }

  private async dateBlocks(): Promise<void> {
    if (this.dating || !this.ingester || !this.canReadRpc("maintenance")) return;
    this.dating = true;
    try {
      const filled = await withRpcWorkload("maintenance", "timestamps", () => this.ingester!.backfillTimestamps());
      if (filled > 0) this.say(`Timestamps: filled ${filled} blocks stored before they were kept`);
    } catch (error) {
      this.say(`Timestamps: retrying later (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      this.dating = false;
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.views.stop();
  }

  private say(line: string) {
    console.log(`[${this.slug}] ${line}`);
  }

  /** The first sync, retried until it lands, then the recount. */
  private async firstSync(): Promise<void> {
    for (let attempt = 0; !this.stopped; attempt++) {
      if (!this.canReadRpc()) {
        await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 60_000); timer.unref?.(); });
        continue;
      }
      try {
        if (!this.checked) {
          await withRpcWorkload("ingestion", "startup-check", async () => this.beforeSync?.());
          this.checked = true;
        }
        const fresh = await withRpcWorkload("ingestion", "sync", () => this.ingester!.sync((from, to, head) => {
          this.head = head;
          if (head - from > 10_000n) this.say(`backfill ${from} … ${to} (head ${head})`);
        }));
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
    if (this.verifyFrom === undefined || !this.log || !this.ingester || !this.canReadRpc("maintenance")) return true;
    const count = this.log.count();
    try {
      const fullRange = await withRpcWorkload("maintenance", "recount", () => this.client.getLogs({ address: this.adapter, fromBlock: this.verifyFrom!, toBlock: this.ingester!.next - 1n }));
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

  private canReadRpc(workload: RpcWorkload = "ingestion"): boolean {
    if (this.offline || this.stopped) return false;
    const budget = this.rpcBudget?.();
    if (!budget) return true;
    const allocation = budget.workloads[workload];
    return !budget.expired && budget.remaining > 0 && budget.minuteUsed < budget.minuteLimit && allocation.remaining > 0 && allocation.minuteUsed < allocation.minuteLimit;
  }

  private polling = false;
  private async poll(): Promise<void> {
    if (this.polling || !this.canReadRpc()) return;
    this.polling = true;
    try {
      await withRpcWorkload("ingestion", "sync", () => this.ingester!.sync((_from, _to, head) => (this.head = head)));
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
    if (this.scanning || !this.watcher || !this.ingester || !this.canReadRpc("enrichment")) return;
    this.scanning = true;
    try {
      const d = await withRpcWorkload("enrichment", "watcher", () => this.watcher!.scan(this.ingester!.next - 1n));
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

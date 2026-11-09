import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";

export type RpcWorkload = "ingestion" | "enrichment" | "maintenance";
export type RpcAllowance = { daily: number; minute: number };
export type RpcAllocations = Partial<Record<RpcWorkload, RpcAllowance>>;
const workloads: RpcWorkload[] = ["ingestion", "enrichment", "maintenance"];
const context = new AsyncLocalStorage<{ workload: RpcWorkload; purpose: string }>();
export function withRpcWorkload<T>(workload: RpcWorkload, purpose: string, fn: () => T): T {
  return context.run({ workload, purpose }, fn);
}
export function withRpcPurpose<T>(purpose: string, fn: () => T): T {
  return context.run({ workload: context.getStore()?.workload ?? "ingestion", purpose }, fn);
}

/** Reserves actual outbound requests before I/O. Independent workload allowances reserve
 * ingestion capacity; they are request limits, not estimates of billed provider credits. */
export class RpcBudget {
  private db: DatabaseSync;
  private allocations: Record<RpcWorkload, RpcAllowance>;
  /** When each chain's next request may go out: the pacing that keeps a backfill under a provider's burst limit. */
  private nextAt = new Map<string, number>();
  constructor(path: string, readonly dailyLimit: number, readonly minuteLimit = 120, private now: () => number = Date.now, allocations: RpcAllocations = {}, private expiresAt?: number, readonly gapMs = 0) {
    if (!Number.isFinite(gapMs) || gapMs < 0) throw new Error("RPC_MIN_GAP_MS must be a non-negative number of milliseconds");
    const enrichment = allocations.enrichment ?? { daily: 0, minute: 0 };
    const maintenance = allocations.maintenance ?? { daily: 0, minute: 0 };
    const ingestion = allocations.ingestion ?? { daily: dailyLimit - enrichment.daily - maintenance.daily, minute: minuteLimit - enrichment.minute - maintenance.minute };
    this.allocations = { ingestion, enrichment, maintenance };
    if ((expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt < 0)) || !Number.isSafeInteger(dailyLimit) || dailyLimit < 0 || !Number.isSafeInteger(minuteLimit) || minuteLimit < 1
      || workloads.some((w) => !Number.isSafeInteger(this.allocations[w].daily) || this.allocations[w].daily < 0 || !Number.isSafeInteger(this.allocations[w].minute) || this.allocations[w].minute < 0)
      || workloads.reduce((n, w) => n + this.allocations[w].daily, 0) > dailyLimit
      || workloads.reduce((n, w) => n + this.allocations[w].minute, 0) > minuteLimit) throw new Error("Invalid RPC request budget or workload allocations");
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS rpc_usage (day TEXT, chain TEXT, method TEXT, calls INTEGER NOT NULL, PRIMARY KEY(day, chain, method));
      CREATE TABLE IF NOT EXISTS rpc_window (id INTEGER PRIMARY KEY, minute INTEGER, calls INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rpc_work_usage (day TEXT, chain TEXT, workload TEXT, purpose TEXT, method TEXT, calls INTEGER NOT NULL, PRIMARY KEY(day, chain, workload, purpose, method));
      CREATE TABLE IF NOT EXISTS rpc_work_window (workload TEXT PRIMARY KEY, minute INTEGER, calls INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rpc_budget_meta (key TEXT PRIMARY KEY, value TEXT);`);
    // Preserve spent allowances from the previous ledger. No restart or upgrade refunds usage.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.db.prepare("SELECT value FROM rpc_budget_meta WHERE key = 'workloads'").get()) {
        this.db.exec(`INSERT INTO rpc_work_usage SELECT day, chain, 'ingestion', 'legacy', method, calls FROM rpc_usage;
          INSERT INTO rpc_work_window SELECT 'ingestion', minute, calls FROM rpc_window WHERE id = 1;
          INSERT INTO rpc_budget_meta VALUES ('workloads', '1');`);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  snapshot(workload: RpcWorkload = "ingestion") {
    const expired = this.expiresAt !== undefined && this.now() >= this.expiresAt;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const minute = Math.floor(this.now() / 60_000);
    const used = (this.db.prepare("SELECT COALESCE(SUM(calls), 0) AS n FROM rpc_usage WHERE day = ?").get(day) as { n: number }).n;
    const row = this.db.prepare("SELECT minute, calls FROM rpc_window WHERE id = 1").get() as { minute: number; calls: number } | undefined;
    const minuteUsed = row?.minute === minute ? row.calls : 0;
    const usage = this.db.prepare("SELECT chain, workload, purpose, method, calls FROM rpc_work_usage WHERE day = ? ORDER BY chain, workload, purpose, method").all(day) as { chain: string; workload: RpcWorkload; purpose: string; method: string; calls: number }[];
    const byWorkload = Object.fromEntries(workloads.map((w) => {
      const allowance = this.allocations[w];
      const workUsed = usage.filter((r) => r.workload === w).reduce((n, r) => n + r.calls, 0);
      const window = this.db.prepare("SELECT minute, calls FROM rpc_work_window WHERE workload = ?").get(w) as { minute: number; calls: number } | undefined;
      const workMinuteUsed = window?.minute === minute ? window.calls : 0;
      return [w, { limit: allowance.daily, used: workUsed, remaining: Math.max(0, allowance.daily - workUsed), minuteLimit: allowance.minute, minuteUsed: workMinuteUsed }];
    })) as Record<RpcWorkload, { limit: number; used: number; remaining: number; minuteLimit: number; minuteUsed: number }>;
    const selected = byWorkload[workload];
    return { day, limit: this.dailyLimit, used, remaining: Math.max(0, this.dailyLimit - used), minuteLimit: this.minuteLimit, minuteUsed,
      expiresAt: this.expiresAt ?? null, expired,
      allowed: !expired && used < this.dailyLimit && minuteUsed < this.minuteLimit && selected.remaining > 0 && selected.minuteUsed < selected.minuteLimit,
      workloads: byWorkload, usage };
  }
  consume(chain: string, methods: string[], scope = context.getStore() ?? { workload: "ingestion" as RpcWorkload, purpose: "rpc" }): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const s = this.snapshot(scope.workload);
      const w = s.workloads[scope.workload];
      if (!methods.length || methods.some((m) => typeof m !== "string" || !/^[a-zA-Z0-9_]+$/.test(m)) || !/^[a-zA-Z0-9_-]{1,64}$/.test(scope.purpose)) throw new Error("Invalid JSON-RPC request");
      if (s.expired || methods.length > s.remaining || s.minuteUsed + methods.length > this.minuteLimit || methods.length > w.remaining || w.minuteUsed + methods.length > w.minuteLimit) throw new Error("RPC request budget exhausted; serving stored data");
      const put = this.db.prepare("INSERT INTO rpc_usage VALUES (?, ?, ?, 1) ON CONFLICT(day, chain, method) DO UPDATE SET calls = calls + 1");
      const work = this.db.prepare("INSERT INTO rpc_work_usage VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(day, chain, workload, purpose, method) DO UPDATE SET calls = calls + 1");
      for (const method of methods) { put.run(s.day, chain, method); work.run(s.day, chain, scope.workload, scope.purpose, method); }
      const minute = Math.floor(this.now() / 60_000);
      this.db.prepare("INSERT INTO rpc_window VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET minute = excluded.minute, calls = excluded.calls").run(minute, s.minuteUsed + methods.length);
      this.db.prepare("INSERT INTO rpc_work_window VALUES (?, ?, ?) ON CONFLICT(workload) DO UPDATE SET minute = excluded.minute, calls = excluded.calls").run(scope.workload, minute, w.minuteUsed + methods.length);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /**
   * The transport's fetch: paced, then counted, then sent. With a gap, a chain's requests go out
   * at most one per `gapMs` - a backfill that would otherwise burst a few hundred header reads in
   * seconds, trip the provider's rate limit and sit out its penalty, flows steadily instead.
   */
  fetch(chain: string, fetchImpl: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
      if (typeof init?.body !== "string") throw new Error("RPC budget requires a JSON request body");
      const body = JSON.parse(init.body);
      const requests = Array.isArray(body) ? body : [body];
      if (this.gapMs > 0) {
        const at = Math.max(Date.now(), (this.nextAt.get(chain) ?? 0));
        this.nextAt.set(chain, at + this.gapMs);
        const wait = at - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      this.consume(chain, requests.map((r: { method: string }) => r.method));
      return fetchImpl(input, init);
    };
  }
  close() { this.db.close(); }
}

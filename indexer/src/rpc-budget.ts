import { DatabaseSync } from "node:sqlite";

/** Counts actual outbound JSON-RPC calls, including batches, before sending them.
 * Shared SQLite counters survive restarts and serialize separate indexer processes.
 * These are request limits, not an estimate of the provider's billable credits. */
export class RpcBudget {
  private db: DatabaseSync;
  constructor(path: string, readonly dailyLimit: number, readonly minuteLimit = 120, private now: () => number = Date.now) {
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 0 || !Number.isSafeInteger(minuteLimit) || minuteLimit < 1) throw new Error("Invalid RPC request budget");
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS rpc_usage (day TEXT, chain TEXT, method TEXT, calls INTEGER NOT NULL, PRIMARY KEY(day, chain, method));
      CREATE TABLE IF NOT EXISTS rpc_window (id INTEGER PRIMARY KEY, minute INTEGER, calls INTEGER NOT NULL);`);
  }
  snapshot() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const used = (this.db.prepare("SELECT COALESCE(SUM(calls), 0) AS n FROM rpc_usage WHERE day = ?").get(day) as { n: number }).n;
    const row = this.db.prepare("SELECT minute, calls FROM rpc_window WHERE id = 1").get() as { minute: number; calls: number } | undefined;
    const minuteUsed = row?.minute === Math.floor(this.now() / 60_000) ? row.calls : 0;
    return { day, limit: this.dailyLimit, used, remaining: Math.max(0, this.dailyLimit - used), minuteLimit: this.minuteLimit, minuteUsed, allowed: used < this.dailyLimit && minuteUsed < this.minuteLimit };
  }
  consume(chain: string, methods: string[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const s = this.snapshot();
      if (!methods.length || methods.some((m) => typeof m !== "string" || !/^[a-zA-Z0-9_]+$/.test(m))) throw new Error("Invalid JSON-RPC request");
      if (methods.length > s.remaining || s.minuteUsed + methods.length > this.minuteLimit) throw new Error("RPC request budget exhausted; serving stored data");
      const put = this.db.prepare("INSERT INTO rpc_usage VALUES (?, ?, ?, 1) ON CONFLICT(day, chain, method) DO UPDATE SET calls = calls + 1");
      for (const method of methods) put.run(s.day, chain, method);
      this.db.prepare("INSERT INTO rpc_window VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET minute = excluded.minute, calls = excluded.calls").run(Math.floor(this.now() / 60_000), s.minuteUsed + methods.length);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  fetch(chain: string, fetchImpl: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
      if (typeof init?.body !== "string") throw new Error("RPC budget requires a JSON request body");
      const body = JSON.parse(init.body);
      const requests = Array.isArray(body) ? body : [body];
      this.consume(chain, requests.map((r: { method: string }) => r.method));
      return fetchImpl(input, init);
    };
  }
  close() { this.db.close(); }
}

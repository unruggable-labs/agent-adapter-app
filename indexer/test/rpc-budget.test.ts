import { createPublicClient, http } from "viem";
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RpcBudget, withRpcWorkload, withRpcPurpose } from "../src/rpc-budget.js";

const request = (method = "eth_call") => ({ body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }) });

describe("outbound RPC budget", () => {
  it("reserves ingestion capacity independently from enrichment and maintenance", () => {
    const budget = new RpcBudget(":memory:", 10, 10, Date.now, { enrichment: { daily: 2, minute: 2 }, maintenance: { daily: 2, minute: 2 } });
    withRpcWorkload("enrichment", "ownership", () => budget.consume("base", ["eth_call", "eth_call"]));
    expect(() => withRpcWorkload("enrichment", "ownership", () => budget.consume("base", ["eth_call"]))).toThrow("budget exhausted");
    expect(budget.snapshot().allowed).toBe(true);
    budget.consume("base", Array(6).fill("eth_getLogs"));
    withRpcWorkload("maintenance", "timestamps", () => budget.consume("base", ["eth_getBlockByNumber", "eth_getBlockByNumber"]));
    expect(budget.snapshot().used).toBe(10);
    expect(budget.snapshot().workloads.ingestion.used).toBe(6);
    expect(budget.snapshot().workloads.enrichment.used).toBe(2);
    expect(budget.snapshot().usage).toContainEqual({ chain: "base", workload: "enrichment", purpose: "ownership", method: "eth_call", calls: 2 });
    budget.close();
  });

  it("keeps purpose attribution through concurrent asynchronous RPC requests", async () => {
    const budget = new RpcBudget(":memory:", 10, 10, Date.now, { enrichment: { daily: 4, minute: 4 } });
    const network = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
    const guarded = budget.fetch("base", network);
    await Promise.all([
      withRpcWorkload("enrichment", "profile", async () => { await Promise.resolve(); await withRpcPurpose("token-uri", () => guarded("https://rpc.example", request())); }),
      withRpcWorkload("ingestion", "sync", async () => { await Promise.resolve(); await guarded("https://rpc.example", request("eth_getLogs")); }),
    ]);
    expect(budget.snapshot().usage).toEqual(expect.arrayContaining([
      { chain: "base", workload: "enrichment", purpose: "token-uri", method: "eth_call", calls: 1 },
      { chain: "base", workload: "ingestion", purpose: "sync", method: "eth_getLogs", calls: 1 },
    ]));
    budget.close();
  });

  it("expires a controlled trial even when its request allowance has not been used", async () => {
    let now = Date.UTC(2026, 10, 3, 12);
    const budget = new RpcBudget(":memory:", 100, 120, () => now, {}, now + 30 * 60_000);
    const network = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
    await budget.fetch("base", network)("https://rpc.example", request());
    now += 30 * 60_000;
    expect(budget.snapshot().expired).toBe(true);
    await expect(budget.fetch("base", network)("https://rpc.example", request())).rejects.toThrow("budget exhausted");
    expect(network).toHaveBeenCalledTimes(1);
    budget.close();
  });

  it("preserves charges when upgrading a ledger created before workload accounting", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dir = mkdtempSync(join(tmpdir(), "rpc-ledger-upgrade-"));
    const path = join(dir, "usage.sqlite");
    const now = Date.UTC(2026, 10, 3, 12);
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE rpc_usage (day TEXT, chain TEXT, method TEXT, calls INTEGER, PRIMARY KEY(day, chain, method)); CREATE TABLE rpc_window (id INTEGER PRIMARY KEY, minute INTEGER, calls INTEGER)");
    old.prepare("INSERT INTO rpc_usage VALUES (?, ?, ?, ?)").run("2026-11-03", "base", "eth_call", 2);
    old.prepare("INSERT INTO rpc_window VALUES (1, ?, 2)").run(Math.floor(now / 60_000));
    old.close();
    const budget = new RpcBudget(path, 3, 10, () => now);
    try {
      expect(budget.snapshot().used).toBe(2);
      expect(budget.snapshot().workloads.ingestion.used).toBe(2);
      budget.consume("base", ["eth_getLogs"]);
      expect(() => budget.consume("base", ["eth_call"])).toThrow("budget exhausted");
    } finally { budget.close(); }
    const reopened = new RpcBudget(path, 3, 10, () => now);
    expect(reopened.snapshot().workloads.ingestion.used).toBe(3);
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("also blocks real viem transport calls before network I/O", async () => {
    const budget = new RpcBudget(":memory:", 0);
    const network = vi.fn<typeof fetch>();
    const client = createPublicClient({ transport: http("https://rpc.example", { fetchFn: budget.fetch("base", network), retryCount: 0 }) });
    await expect(client.getChainId()).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
    budget.close();
  });

  it("does not retry a failed viem request automatically", async () => {
    const budget = new RpcBudget(":memory:", 10);
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error("provider failed"));
    const client = createPublicClient({ transport: http("https://rpc.example", { fetchFn: budget.fetch("base", network), retryCount: 0 }) });
    await expect(client.getChainId()).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().used).toBe(1);
    budget.close();
  });

  it("cannot overspend its allowance under concurrent requests", async () => {
    const budget = new RpcBudget(":memory:", 3);
    const network = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
    const guarded = budget.fetch("base", network);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => guarded("https://rpc.example", request())));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(network).toHaveBeenCalledTimes(3);
    expect(budget.snapshot().used).toBe(3);
    budget.close();
  });

  it("sends nothing without an explicit positive budget", async () => {
    const budget = new RpcBudget(":memory:", 0);
    const network = vi.fn<typeof fetch>();
    await expect(budget.fetch("base", network)("https://rpc.example", request())).rejects.toThrow("budget exhausted");
    expect(network).not.toHaveBeenCalled();
    budget.close();
  });

  it("counts every batch member and failed outbound attempt before sending, across chains", async () => {
    const budget = new RpcBudget(":memory:", 3);
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error("upstream failed"));
    await expect(budget.fetch("base", network)("https://rpc.example", request())).rejects.toThrow("upstream failed");
    const batch = { body: JSON.stringify([{ method: "eth_getLogs" }, { method: "eth_getBlockByNumber" }]) };
    await expect(budget.fetch("robinhood", network)("https://rpc.example", batch)).rejects.toThrow("upstream failed");
    await expect(budget.fetch("mainnet", network)("https://rpc.example", request())).rejects.toThrow("budget exhausted");
    expect(network).toHaveBeenCalledTimes(2);
    expect(budget.snapshot().used).toBe(3);
    budget.close();
  });

  it("persists shared usage across processes/restarts and resets at the next UTC day", () => {
    const dir = mkdtempSync(join(tmpdir(), "rpc-budget-"));
    let now = Date.UTC(2026, 10, 3, 12);
    const path = join(dir, "usage.sqlite");
    const a = new RpcBudget(path, 2, 120, () => now);
    const b = new RpcBudget(path, 2, 120, () => now);
    try {
      a.consume("base", ["eth_call"]);
      b.consume("robinhood", ["eth_call"]);
      expect(() => a.consume("base", ["eth_call"])).toThrow("budget exhausted");
      expect(b.snapshot().used).toBe(2);
      now += 86400_000;
      expect(b.snapshot().used).toBe(0);
      b.consume("base", ["eth_call"]);
      expect(a.snapshot().used).toBe(1);
    } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects a batch atomically when it would exceed the per-minute allowance", () => {
    let now = Date.UTC(2026, 10, 3, 12);
    const budget = new RpcBudget(":memory:", 100, 2, () => now);
    budget.consume("base", ["eth_call"]);
    expect(() => budget.consume("base", ["eth_call", "eth_getLogs"])).toThrow("budget exhausted");
    expect(budget.snapshot().used).toBe(1);
    now += 60_000;
    budget.consume("base", ["eth_call", "eth_getLogs"]);
    expect(budget.snapshot().used).toBe(3);
    budget.close();
  });
});

import type { Address, Hex } from "viem";
import type { EventLog } from "./eventlog.js";
import { addressView, attestationView, collectionView, findIdentity, listAttestations, listCollections, listIdentities, search, type ChainScope } from "./queries.js";
import type { ChainStatus } from "./runtime.js";
import { BUCKETS, METRICS, overview as statsOverview, projects as statsProjects, projectsCsv, series as statsSeries, windowFrom, type Bucket, type Metric, type ProjectRow } from "./stats.js";
import { ATTESTATION_TYPE_NAMES } from "./ubid.js";

/** The API core, host-agnostic. Everything it answers is indexed: the stores' folds of the event
 *  logs, and the advisories the view workers keep (views.ts). No request reads the chain.
 *  It answers for a list of chains - one for a chain's own site, several for the multichain
 *  explorer - and rows say which chain they're on. `?chain=a,b` narrows any request to those.
 *  Subpaths are relative, with their query string:
 *    overview · identities[?limit&offset&standard&registration&bound&tokenId&q] · identity/<ubid> · history/<ubid>
 *    search?q= · address/<addr> · wallet/<addr> · txref/<hash> · attestations[?limit&offset&type&standard&attester&ubid]
 *    collections[?limit&offset&q&sort=newest] · collection/<addr> (its tokens: identities?bound=<addr>)
 *    attestation/<id> · stats/overview?from&to · stats/series?metric&bucket&from&to&by&project · stats/projects?...[&format=csv]
 *  `identities` and `attestations` answer a page: { items, total, offset, limit }, 25 rows unless
 *  `limit` says otherwise (at most 200). See queries.ts. They used to answer the whole registry
 *  with no query string; at tens of thousands of records that was one request costing as much as
 *  thousands, so it's a page too now.
 *  `stats/*` is per chain: with several chains it needs `?chain=` to name one. */

export interface ApiChain extends ChainScope {
  chainId: bigint;
  adapter: Address;
  log?: EventLog;
  status(): ChainStatus;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v,
  );
}

export interface ApiResponse {
  status: number;
  body: string; // JSON unless `type` says otherwise
  type?: string;
}

function chainOverview(c: ApiChain) {
  const ids = [...c.store.identities.values()];
  return {
    chain: c.slug,
    label: c.label,
    chainId: c.chainId.toString(),
    adapter: c.adapter,
    /** Where the adapter went to v0.0.17, when the indexed history starts before it; null otherwise. */
    upgradeBlock: c.store.upgradeBlock,
    identities: c.store.identities.size,
    agents: c.store.agents.size,
    /** Distinct collections and contracts identities are bound to - one collection with a hundred agents counts once. */
    projects: new Set(ids.map((i) => i.boundAddress)).size,
    /** Identities with an ERC-8004 agent minted; the rest are counterfactual claims. */
    registered: ids.filter((i) => i.agentIds.length > 0).length,
    attestations: c.store.attestations.size,
    dropped: c.store.dropped.length,
    inertRevocations: c.store.inertRevocations.length,
    ...c.status(),
  };
}

export async function handleApi(all: ApiChain[], subpath: string): Promise<ApiResponse> {
  const [path, query = ""] = subpath.split("?");
  const params = new URLSearchParams(query);
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  const [head, arg] = parts;

  // `?chain=` narrows; it isn't a filter the list endpoints should see as "a query".
  const wanted = params.get("chain")?.split(",").map((s) => s.trim()).filter(Boolean);
  params.delete("chain");
  const chains = wanted ? all.filter((c) => wanted.includes(c.slug)) : all;
  if (wanted && chains.length === 0) return { status: 400, body: toJson({ error: "unknown chain", chains: all.map((c) => c.slug) }) };

  if (head === "overview") {
    const per = chains.map(chainOverview);
    const sum = (k: "identities" | "agents" | "projects" | "registered" | "attestations" | "dropped" | "inertRevocations") => per.reduce((n, o) => n + o[k], 0);
    // One chain: the shape a chain's own site always had, plus its status. Several: the totals,
    // with each chain's figures and status under `chains`; adapter and chainId belong to a chain.
    const one = per.length === 1 ? per[0] : null;
    return {
      status: 200,
      body: toJson({
        adapter: one?.adapter ?? null,
        chainId: one?.chainId ?? null,
        identities: sum("identities"),
        agents: sum("agents"),
        projects: sum("projects"),
        registered: sum("registered"),
        attestations: sum("attestations"),
        dropped: sum("dropped"),
        inertRevocations: sum("inertRevocations"),
        chains: per,
      }),
    };
  }
  if (head === "identities") {
    return { status: 200, body: toJson(listIdentities(chains, params)) };
  }
  if (head === "collections") {
    return { status: 200, body: toJson(listCollections(chains, params)) };
  }
  if (head === "collection" && arg) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(arg)) return { status: 400, body: toJson({ error: "not an address", address: arg }) };
    const rows = collectionView(chains, arg);
    if (!rows.length) return { status: 404, body: toJson({ error: "no identities are bound to this contract's tokens", address: arg.toLowerCase() }) };
    return { status: 200, body: toJson({ collections: rows }) };
  }
  if (head === "search") {
    return { status: 200, body: toJson({ hits: search(chains, params.get("q") ?? "") }) };
  }
  if (head === "address" && arg) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(arg)) return { status: 400, body: toJson({ error: "not an address", address: arg }) };
    return { status: 200, body: toJson(addressView(chains, arg)) };
  }
  if (head === "identity" && arg) {
    const found = findIdentity(chains, arg);
    if (!found) return { status: 404, body: toJson({ error: "unknown identity", ubid: arg }) };
    return { status: 200, body: toJson({ ...found.c.views.view(found.id), chain: found.c.slug }) };
  }
  if (head === "history" && arg) {
    // The audit trail: every event that touched this identity, in log order, dropped and
    // inert ones included. Empty for a UBID nothing has touched.
    const key = arg.toLowerCase() as Hex;
    const c = chains.find((x) => x.store.history.has(key));
    return { status: 200, body: toJson(c?.store.history.get(key) ?? []) };
  }
  if (head === "wallet" && arg) {
    // An address can be an agent, or operate one, on more than one chain: the first chain that
    // knows it answers, as a chain's own site always did, and `chains` lists every chain's answer.
    const a = arg.toLowerCase() as Address;
    const answers = chains.map((c) => ({ chain: c.slug, wallet: c.store.resolveWallet(a) })).filter((x) => x.wallet);
    const first = answers[0];
    return { status: 200, body: toJson(first ? { ...first.wallet, chain: first.chain, chains: answers.map((x) => ({ chain: x.chain, ...x.wallet })) } : null) };
  }
  if (head === "txref" && arg) {
    // Whether a transaction a statement cites exists, as the worker found it. A hash names a
    // transaction on one chain; with several, any chain that found it says found. null: not checked yet.
    if (!/^0x[0-9a-fA-F]{64}$/.test(arg)) return { status: 400, body: toJson({ error: "not a transaction hash", hash: arg }) };
    const answers = chains.map((c) => c.views.txRef(arg as Hex));
    const status = answers.includes("found") ? "found" : answers.includes("missing") ? "missing" : null;
    return { status: 200, body: toJson({ hash: arg.toLowerCase(), status }) };
  }
  if (head === "stats") {
    if (chains.length !== 1) return { status: 400, body: toJson({ error: "stats are per chain: name one with ?chain=", chains: chains.map((c) => c.slug) }) };
    const c = chains[0];
    if (!c.log) return { status: 503, body: toJson({ error: "stats need the event log; this indexer runs without one" }) };
    const db = c.log.connection;
    const window = windowFrom(params);
    if (arg === "overview") return { status: 200, body: toJson(statsOverview(db, c.store, window)) };
    if (arg === "series") {
      const metric = (params.get("metric") ?? "identities") as Metric;
      const bucket = (params.get("bucket") ?? "day") as Bucket;
      if (!METRICS.includes(metric)) return { status: 400, body: toJson({ error: "unknown metric", metrics: METRICS }) };
      if (!BUCKETS.includes(bucket)) return { status: 400, body: toJson({ error: "unknown bucket", buckets: BUCKETS }) };
      const projects = params.get("project")?.split(",").filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) as Address[] | undefined;
      const by = params.get("by") === "type" ? ({ type: true } as const) : projects?.length ? { projects: projects.slice(0, 8) } : undefined;
      return { status: 200, body: toJson(statsSeries(db, metric, bucket, window, by)) };
    }
    if (arg === "projects") {
      const limit = Math.min(500, Math.max(1, Number(params.get("limit")) || 50));
      const page = statsProjects(db, c.store, c.views, {
        window,
        standard: params.get("standard")?.split(",").filter(Boolean),
        registration: (params.get("registration") as "registered" | "counterfactual" | null) ?? undefined,
        active: params.get("active") === "1",
        q: params.get("q") ?? undefined,
        sort: (params.get("sort") as keyof ProjectRow | null) ?? undefined,
        dir: (params.get("dir") as "asc" | "desc" | null) ?? undefined,
        limit: params.get("format") === "csv" ? 10_000 : limit,
        offset: params.get("format") === "csv" ? 0 : Math.max(0, Number(params.get("offset")) || 0),
      });
      if (params.get("format") === "csv") return { status: 200, body: projectsCsv(page.items), type: "text/csv; charset=utf-8" };
      return { status: 200, body: toJson(page) };
    }
    return { status: 404, body: toJson({ error: "not found" }) };
  }
  if (head === "attestation" && arg) {
    const v = attestationView(chains, arg as Hex);
    if (!v) return { status: 404, body: toJson({ error: "unknown attestation", attestationId: arg }) };
    return { status: 200, body: toJson(v) };
  }
  if (head === "attestations") {
    return { status: 200, body: toJson(listAttestations(chains, params)) };
  }

  return { status: 404, body: toJson({ error: "not found" }) };
}

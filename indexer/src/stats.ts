import type { DatabaseSync } from "node:sqlite";
import type { Address, Hex } from "viem";
import type { ProjectionStore } from "./projection.js";
import { ATTESTATION_TYPE_NAMES, STANDARD_NAMES } from "./ubid.js";
import type { ViewCache } from "./views.js";

/**
 * How used is the adapter: counts over the event log, by time. Every answer is a window of time
 * on one chain; the page combines chains in the browser. The queries read the event log's fact
 * columns and block timestamps (eventlog.ts) and nothing else, so they are plain SQL and stay
 * fast as the log grows. Events whose block has no timestamp yet (the backfill after an upgrade)
 * fall outside every window until it reaches them.
 */

export type Bucket = "day" | "week" | "month";
export const BUCKETS: Bucket[] = ["day", "week", "month"];

export type Metric = "identities" | "registrations" | "claims" | "attestations" | "revocations" | "attesters" | "wallets" | "active";
export const METRICS: Metric[] = ["identities", "registrations", "claims", "attestations", "revocations", "attesters", "wallets", "active"];

/** [from, to) in unix seconds. */
export interface Window {
  from: number;
  to: number;
}

/** Events that bring an identity into being or touch its record - the first of these per UBID is its creation. */
const CREATING = [
  "CounterfactualAgentRegistered",
  "CounterfactualAgentURISet",
  "CounterfactualMetadataSet",
  "CounterfactualMetadataBatchSet",
  "CounterfactualAgentWalletSet",
  "CounterfactualAgentWalletUnset",
  "AgentBound",
  "AgentURISet",
  "MetadataSet",
  "AgentWalletSet",
  "AgentWalletUnset",
];
const WALLET_LINKS = ["WalletUBIDSet", "AgentWalletSet", "CounterfactualAgentWalletSet"];
const list = (names: string[]) => names.map((n) => `'${n}'`).join(",");

/** The SQL that names a bucket from a block timestamp. Weeks start on Monday. */
function bucketExpr(bucket: Bucket): string {
  switch (bucket) {
    case "day":
      return "date(b.timestamp, 'unixepoch')";
    case "week":
      return "date(b.timestamp, 'unixepoch', '-6 days', 'weekday 1')";
    case "month":
      return "strftime('%Y-%m-01', b.timestamp, 'unixepoch')";
  }
}

/** The rows a metric counts: a FROM clause over events e joined to blocks b, and what to count. */
function metricSql(metric: Metric): { from: string; count: string } {
  const base = "events e JOIN blocks b ON b.number = e.block_number";
  switch (metric) {
    case "identities":
      // The first creating event per UBID, with that event's block.
      return {
        from: `(SELECT ubid, MIN(block_number) AS block_number FROM events WHERE ubid IS NOT NULL AND event_name IN (${list(CREATING)}) GROUP BY ubid) c JOIN events e ON e.ubid = c.ubid AND e.block_number = c.block_number AND e.event_name IN (${list(CREATING)}) JOIN blocks b ON b.number = e.block_number`,
        count: "COUNT(DISTINCT e.ubid)",
      };
    case "claims":
      return {
        from: `(SELECT ubid, MIN(block_number) AS block_number FROM events WHERE event_name = 'CounterfactualAgentRegistered' GROUP BY ubid) c JOIN events e ON e.ubid = c.ubid AND e.block_number = c.block_number AND e.event_name = 'CounterfactualAgentRegistered' JOIN blocks b ON b.number = e.block_number`,
        count: "COUNT(DISTINCT e.ubid)",
      };
    case "registrations":
      return { from: `${base} AND e.event_name = 'AgentBound'`, count: "COUNT(*)" };
    case "attestations":
      return { from: `${base} AND e.event_name = 'Attested'`, count: "COUNT(*)" };
    case "revocations":
      return { from: `${base} AND e.event_name = 'AttestationRevoked'`, count: "COUNT(*)" };
    case "attesters":
      return { from: `${base} AND e.event_name = 'Attested'`, count: "COUNT(DISTINCT e.actor)" };
    case "wallets":
      return { from: `${base} AND e.event_name IN (${list(WALLET_LINKS)})`, count: "COUNT(*)" };
    case "active":
      return { from: base, count: "COUNT(DISTINCT e.ubid)" };
  }
}

/** Metrics keyed by UBID rather than bound address; grouping them by project goes through the UBID map. */
const UBID_KEYED = new Set<Metric>(["attestations", "revocations", "attesters", "active"]);
/** The UBID → bound address map. */
const BOUND_OF = "(SELECT ubid, MIN(bound_address) AS bound_address FROM events WHERE ubid IS NOT NULL AND bound_address IS NOT NULL GROUP BY ubid)";

export interface Point {
  t: string;
  v: number;
}
export interface Series {
  key: string;
  points: Point[];
}

/** One metric per bucket across a window, zero-filled. `by` splits it: by attestation type, or by
 *  project for the given bound addresses (the total is always the first series). */
export function series(
  db: DatabaseSync,
  metric: Metric,
  bucket: Bucket,
  window: Window,
  by?: { type: true } | { projects: Address[] },
): { metric: Metric; bucket: Bucket; from: number; to: number; series: Series[] } {
  const m = metricSql(metric);
  const t = bucketExpr(bucket);
  const where = "b.timestamp >= ? AND b.timestamp < ?";
  const out: Series[] = [];
  const total = db.prepare(`SELECT ${t} AS t, ${m.count} AS v FROM ${m.from} WHERE ${where} GROUP BY t ORDER BY t`).all(window.from, window.to) as unknown as Point[];
  out.push({ key: "total", points: fill(total, bucket, window) });
  if (by && "type" in by && metric === "attestations") {
    const rows = db.prepare(`SELECT e.attestation_type AS k, ${t} AS t, COUNT(*) AS v FROM ${m.from} WHERE ${where} GROUP BY k, t ORDER BY k, t`).all(window.from, window.to) as { k: number; t: string; v: number }[];
    for (const [k, pts] of groupBy(rows, (r) => ATTESTATION_TYPE_NAMES[r.k] ?? String(r.k))) out.push({ key: k, points: fill(pts, bucket, window) });
  } else if (by && "projects" in by && by.projects.length) {
    const keyed = UBID_KEYED.has(metric) ? `${m.from} JOIN ${BOUND_OF} p ON p.ubid = e.ubid` : m.from;
    const col = UBID_KEYED.has(metric) ? "p.bound_address" : "e.bound_address";
    const marks = by.projects.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT ${col} AS k, ${t} AS t, ${m.count} AS v FROM ${keyed} WHERE ${where} AND ${col} IN (${marks}) GROUP BY k, t ORDER BY k, t`)
      .all(window.from, window.to, ...by.projects.map((a) => a.toLowerCase())) as { k: string; t: string; v: number }[];
    const got = new Map(groupBy(rows, (r) => r.k));
    for (const a of by.projects) out.push({ key: a.toLowerCase(), points: fill(got.get(a.toLowerCase()) ?? [], bucket, window) });
  }
  return { metric, bucket, from: window.from, to: window.to, series: out };
}

function groupBy<T extends { t: string; v: number }>(rows: T[], key: (r: T) => string): [string, Point[]][] {
  const m = new Map<string, Point[]>();
  for (const r of rows) {
    const k = key(r);
    const pts = m.get(k) ?? [];
    pts.push({ t: r.t, v: r.v });
    m.set(k, pts);
  }
  return [...m];
}

/** Every bucket in the window, in order, zero where nothing happened. */
export function fill(points: Point[], bucket: Bucket, window: Window): Point[] {
  const have = new Map(points.map((p) => [p.t, p.v]));
  const out: Point[] = [];
  let d = startOfBucket(new Date(window.from * 1000), bucket);
  const end = new Date(window.to * 1000);
  while (d < end) {
    const key = d.toISOString().slice(0, 10);
    out.push({ t: key, v: have.get(key) ?? 0 });
    d = next(d, bucket);
  }
  return out;
}

function startOfBucket(d: Date, bucket: Bucket): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (bucket === "week") x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  if (bucket === "month") x.setUTCDate(1);
  return x;
}
function next(d: Date, bucket: Bucket): Date {
  const x = new Date(d);
  if (bucket === "day") x.setUTCDate(x.getUTCDate() + 1);
  if (bucket === "week") x.setUTCDate(x.getUTCDate() + 7);
  if (bucket === "month") x.setUTCMonth(x.getUTCMonth() + 1);
  return x;
}

export interface Figure {
  value: number;
  /** The same count over the window of the same length just before. */
  prior: number;
}

/** The tiles: each metric over the window and over the window before it, plus the all-time totals. */
export function overview(db: DatabaseSync, store: ProjectionStore, window: Window) {
  const len = window.to - window.from;
  const prior: Window = { from: window.from - len, to: window.from };
  const count = (metric: Metric, w: Window): number => {
    const m = metricSql(metric);
    return (db.prepare(`SELECT ${m.count} AS v FROM ${m.from} WHERE b.timestamp >= ? AND b.timestamp < ?`).get(w.from, w.to) as { v: number }).v;
  };
  const newProjects = (w: Window): number =>
    (db.prepare(`SELECT COUNT(*) AS v FROM (SELECT e.bound_address, MIN(b.timestamp) AS first FROM events e JOIN blocks b ON b.number = e.block_number WHERE e.bound_address IS NOT NULL AND e.event_name IN (${list(CREATING)}) GROUP BY e.bound_address) WHERE first >= ? AND first < ?`).get(w.from, w.to) as { v: number }).v;
  const figures: Record<string, Figure> = {};
  for (const metric of METRICS) figures[metric] = { value: count(metric, window), prior: count(metric, prior) };
  figures.projects = { value: newProjects(window), prior: newProjects(prior) };
  const span = db.prepare("SELECT MIN(b.timestamp) AS first, MAX(b.timestamp) AS last FROM events e JOIN blocks b ON b.number = e.block_number").get() as { first: number | null; last: number | null };
  const unstamped = (db.prepare("SELECT COUNT(DISTINCT e.block_number) AS n FROM events e JOIN blocks b ON b.number = e.block_number WHERE b.timestamp IS NULL").get() as { n: number }).n;
  return {
    from: window.from,
    to: window.to,
    figures,
    totals: {
      identities: store.identities.size,
      registered: [...store.identities.values()].filter((i) => i.agentIds.length > 0).length,
      projects: new Set([...store.identities.values()].map((i) => i.boundAddress)).size,
      attestations: store.attestations.size,
      events: (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n,
      firstEvent: span.first,
      lastEvent: span.last,
      /** Event blocks still waiting for a timestamp - the figures above miss them until the backfill reaches them. */
      blocksWithoutTimestamp: unstamped,
    },
  };
}

export interface ProjectRow {
  address: Address;
  name: string | null;
  image: string | null;
  website: string | null;
  standards: string[];
  identities: number;
  registered: number;
  attestations: number;
  attesters: number;
  ratingAverage: number | null;
  ratings: number;
  stars: number;
  firstSeen: number | null;
  lastEvent: number | null;
  trustVerdict: string | null;
}

export interface ProjectsQuery {
  window: Window;
  standard?: string[];
  registration?: "registered" | "counterfactual";
  /** Only projects with an event inside the window. */
  active?: boolean;
  q?: string;
  sort?: keyof ProjectRow;
  dir?: "asc" | "desc";
  limit: number;
  offset: number;
}

/**
 * One row per project - a collection or contract identities are bound to - with its counts from
 * the log and its name, picture, reputation and trust base from the store and the view cache.
 * Reputation is folded only for identities that have statements, so a registry of thousands of
 * quiet identities costs nothing here.
 */
export function projects(db: DatabaseSync, store: ProjectionStore, views: ViewCache, q: ProjectsQuery): { items: ProjectRow[]; total: number; offset: number; limit: number } {
  const counts = db
    .prepare(
      `SELECT e.bound_address AS address, COUNT(DISTINCT e.ubid) AS identities, MIN(b.timestamp) AS first_seen, MAX(b.timestamp) AS last_event
       FROM events e JOIN blocks b ON b.number = e.block_number
       WHERE e.bound_address IS NOT NULL AND e.event_name IN (${list(CREATING)}) GROUP BY e.bound_address`,
    )
    .all() as { address: Address; identities: number; first_seen: number | null; last_event: number | null }[];
  const registered = new Map(
    (db.prepare("SELECT bound_address AS address, COUNT(DISTINCT ubid) AS n FROM events WHERE event_name = 'AgentBound' AND bound_address IS NOT NULL GROUP BY bound_address").all() as { address: Address; n: number }[]).map((r) => [r.address, r.n]),
  );
  const statements = new Map(
    (db.prepare(`SELECT p.bound_address AS address, COUNT(*) AS n, COUNT(DISTINCT e.actor) AS attesters FROM events e JOIN ${BOUND_OF} p ON p.ubid = e.ubid WHERE e.event_name = 'Attested' GROUP BY p.bound_address`).all() as { address: Address; n: number; attesters: number }[]).map((r) => [r.address, r]),
  );
  // Last event of any kind, statements included, per project.
  const lastAny = new Map(
    (db.prepare(`SELECT COALESCE(e.bound_address, p.bound_address) AS address, MAX(b.timestamp) AS last FROM events e LEFT JOIN ${BOUND_OF} p ON p.ubid = e.ubid JOIN blocks b ON b.number = e.block_number WHERE COALESCE(e.bound_address, p.bound_address) IS NOT NULL GROUP BY address`).all() as { address: Address; last: number | null }[]).map((r) => [r.address, r.last]),
  );

  // From the store: standards, and reputation for the identities that have any statement.
  const byProject = new Map<Address, { standards: Set<string>; ubids: Hex[]; sample: Hex }>();
  for (const id of store.identities.values()) {
    const p = byProject.get(id.boundAddress) ?? { standards: new Set<string>(), ubids: [], sample: id.ubid };
    p.standards.add(STANDARD_NAMES[id.standard]);
    p.ubids.push(id.ubid);
    byProject.set(id.boundAddress, p);
  }
  const attested = new Set([...store.attestations.values()].map((a) => a.ubid));

  let rows: ProjectRow[] = counts.map((c) => {
    const p = byProject.get(c.address);
    // Name, picture and trust base are per address, so any identity of the project whose chain
    // facts the worker has read will do - right after a boot that is the newest, not the oldest.
    const read = p?.ubids.find((u) => views.advisoryOf(u) !== null) ?? p?.sample;
    const sample = read ? store.identities.get(read) : undefined;
    const summary = sample ? views.summary(sample) : null;
    const advisory = sample ? views.advisoryOf(sample.ubid) : null;
    let ratingSum = 0;
    let ratings = 0;
    let stars = 0;
    for (const ubid of p?.ubids ?? []) {
      if (!attested.has(ubid)) continue;
      const r = store.reputation(ubid);
      stars += r.stars;
      for (const x of r.ratings) {
        ratingSum += x.value;
        ratings++;
      }
    }
    const s = statements.get(c.address);
    return {
      address: c.address,
      name: advisory?.collection?.name ?? summary?.contractName ?? null,
      image: advisory?.collection?.image ?? summary?.card?.image ?? null,
      website: advisory?.collection?.externalLink ?? null,
      standards: [...(p?.standards ?? [])],
      identities: c.identities,
      registered: registered.get(c.address) ?? 0,
      attestations: s?.n ?? 0,
      attesters: s?.attesters ?? 0,
      ratingAverage: ratings ? ratingSum / ratings : null,
      ratings,
      stars,
      firstSeen: c.first_seen,
      lastEvent: lastAny.get(c.address) ?? c.last_event,
      trustVerdict: advisory?.trustBase?.verdict ?? null,
    };
  });

  if (q.standard?.length) rows = rows.filter((r) => r.standards.some((s) => q.standard!.includes(s)));
  if (q.registration === "registered") rows = rows.filter((r) => r.registered > 0);
  if (q.registration === "counterfactual") rows = rows.filter((r) => r.registered === 0);
  if (q.active) rows = rows.filter((r) => r.lastEvent !== null && r.lastEvent >= q.window.from && r.lastEvent < q.window.to);
  if (q.q) {
    const needle = q.q.trim().toLowerCase();
    rows = rows.filter((r) => r.address.includes(needle) || (r.name ?? "").toLowerCase().includes(needle));
  }
  const sort = q.sort ?? "lastEvent";
  const dir = q.dir ?? "desc";
  rows.sort((a, b) => {
    const x = a[sort];
    const y = b[sort];
    const cmp = x === null || x === undefined ? 1 : y === null || y === undefined ? -1 : typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return dir === "asc" ? cmp : -cmp;
  });
  return { items: rows.slice(q.offset, q.offset + q.limit), total: rows.length, offset: q.offset, limit: q.limit };
}

/** The projects table as CSV, one line per row, for a spreadsheet. */
export function projectsCsv(rows: ProjectRow[]): string {
  const cols: (keyof ProjectRow)[] = ["address", "name", "standards", "identities", "registered", "attestations", "attesters", "ratingAverage", "ratings", "stars", "firstSeen", "lastEvent", "trustVerdict", "website"];
  const cell = (v: unknown) => {
    const s = Array.isArray(v) ? v.join("|") : v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

/** Parse a window from query parameters: `from` and `to` as unix seconds; defaults to the last 30 days. */
export function windowFrom(p: URLSearchParams, now = Math.floor(Date.now() / 1000)): Window {
  const to = Number(p.get("to")) || now;
  const from = Number(p.get("from")) || to - 30 * 86400;
  return { from: Math.min(from, to - 1), to };
}

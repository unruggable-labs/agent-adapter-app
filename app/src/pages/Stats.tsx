import { useEffect, useMemo, useState } from "react";
import { ChartLegend, LineChart, type ChartSeries } from "../components/chart";
import { ChainIcon } from "../components/chains";
import { MultiSelect, Pager, Skeleton, StandardBadge, Tip } from "../components/ui";
import { statsApi, type ProjectRow, type StatsBucket, type StatsOverview, type StatsSeries } from "../lib/api";
import { apiBaseFor, explorerOriginFor, NETWORKS, STANDARD_NAMES, type NetworkId } from "../lib/chain";
import { usePageParam } from "../lib/url";

/**
 * How used is the adapter. On a chain's explorer this shows that chain; on stats.adapterscan.com it
 * shows every chain, combined, with a chain mix to choose from. Each chain's indexer answers for
 * itself (/api/stats) and this page adds the answers up - there is no shared database. The window,
 * bucket and chain mix live in the URL so a view can be shared.
 */

type Range = "7d" | "30d" | "90d" | "all";
const RANGES: { id: Range; label: string }[] = [{ id: "7d", label: "7d" }, { id: "30d", label: "30d" }, { id: "90d", label: "90d" }, { id: "all", label: "All" }];
const DAY = 86400;
const PAGE = 25;

interface Loaded {
  overview: Record<NetworkId, StatsOverview>;
  claims: Record<NetworkId, StatsSeries>;
  registrations: Record<NetworkId, StatsSeries>;
  identities: Record<NetworkId, StatsSeries>;
  projects: (ProjectRow & { chain: NetworkId })[];
  failed: NetworkId[];
}

/** A project picked for the chart: which chain it is on and its bound address. In the URL as chain:address. */
interface Pick {
  chain: NetworkId;
  address: string;
}
const MAX_COMPARE = 6;
/** One hue per compared project, the app's named palette, in an order that stays apart on a chart. */
const COMPARE_COLORS = ["var(--c-blue)", "var(--c-pink)", "var(--c-orange)", "var(--c-violet)", "var(--c-teal)", "var(--c-amber)"];
const pickKey = (p: Pick) => `${p.chain}:${p.address}`;

function readUrl() {
  const p = new URLSearchParams(location.search);
  return {
    range: (RANGES.some((r) => r.id === p.get("range")) ? p.get("range") : "30d") as Range,
    bucket: (["day", "week", "month"].includes(p.get("bucket") ?? "") ? p.get("bucket") : "auto") as StatsBucket | "auto",
    chains: p.get("chains")?.split(",").filter(Boolean) ?? null,
    cumulative: p.get("cumulative") === "1",
    withTotal: p.get("total") !== "0",
    compare: (p.get("project")?.split(",") ?? [])
      .map((s) => {
        const [chain, address] = s.includes(":") ? s.split(":") : [null, s];
        return { chain, address: address?.toLowerCase() };
      })
      .filter((x): x is { chain: string | null; address: string } => !!x.address && /^0x[0-9a-f]{40}$/.test(x.address)),
  };
}

export function StatsPage({ chains: offered, allChains = false }: { chains: NetworkId[]; allChains?: boolean }) {
  const initial = useMemo(readUrl, []);
  const [range, setRange] = useState<Range>(initial.range);
  const [bucketChoice, setBucketChoice] = useState<StatsBucket | "auto">(initial.bucket);
  const [cumulative, setCumulative] = useState(initial.cumulative);
  // Testnets are off by default when combining chains; on a single chain's explorer there is no choice.
  const [chains, setChains] = useState<NetworkId[]>(() =>
    allChains ? (initial.chains?.filter((c) => offered.includes(c)) ?? offered.filter((c) => !NETWORKS[c].chain.testnet)) : offered,
  );
  // Projects on the chart. On a single chain's page the URL carries just the address.
  const [compare, setCompare] = useState<Pick[]>(() =>
    initial.compare.map((c) => ({ chain: (c.chain && offered.includes(c.chain) ? c.chain : offered[0]) as NetworkId, address: c.address })).slice(0, MAX_COMPARE),
  );
  const [compareSeries, setCompareSeries] = useState<Record<string, StatsSeries["series"][number]>>({});
  // Whether the whole stays on the chart while comparing. Off, the scale fits the compared projects alone.
  const [withTotal, setWithTotal] = useState(initial.withTotal);
  const [data, setData] = useState<Loaded | null>(null);
  const [firstEvent, setFirstEvent] = useState<number | null>(null);
  const [error, setError] = useState(false);

  // Keep the view in the URL.
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    for (const k of ["range", "bucket", "cumulative", "chains", "project", "total"]) p.delete(k);
    if (range !== "30d") p.set("range", range);
    if (bucketChoice !== "auto") p.set("bucket", bucketChoice);
    if (cumulative) p.set("cumulative", "1");
    if (allChains) p.set("chains", chains.join(","));
    if (compare.length) p.set("project", compare.map((c) => (allChains ? pickKey(c) : c.address)).join(","));
    if (compare.length && !withTotal) p.set("total", "0");
    const qs = p.toString();
    history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
  }, [range, bucketChoice, cumulative, chains, allChains, compare, withTotal]);

  const now = Math.floor(Date.now() / 1000 / 3600) * 3600; // to the hour, so the URL and the cache stay stable for a while
  const from = range === "7d" ? now - 7 * DAY : range === "30d" ? now - 30 * DAY : range === "90d" ? now - 90 * DAY : firstEvent ?? now - 365 * DAY;
  const window = { from, to: now };
  // Auto: days for anything up to two months, weeks up to about a year, months beyond - so "All" on a young chain still shows a shape.
  const span = now - from;
  const bucket: StatsBucket = bucketChoice !== "auto" ? bucketChoice : span <= 60 * DAY ? "day" : span <= 400 * DAY ? "week" : "month";

  useEffect(() => {
    let cancelled = false;
    setError(false);
    (async () => {
      const results = await Promise.all(
        chains.map(async (c) => {
          const s = statsApi(apiBaseFor(c));
          try {
            const [overview, claims, registrations, identities, projects] = await Promise.all([
              s.overview(window),
              s.series("claims", bucket, window),
              s.series("registrations", bucket, window),
              s.series("identities", bucket, window),
              s.projects({ ...window }),
            ]);
            return { c, overview, claims, registrations, identities, projects: projects.items.map((r) => ({ ...r, chain: c })), ok: true as const };
          } catch {
            return { c, ok: false as const };
          }
        }),
      );
      if (cancelled) return;
      const loaded: Loaded = { overview: {}, claims: {}, registrations: {}, identities: {}, projects: [], failed: [] };
      for (const r of results) {
        if (!r.ok) {
          loaded.failed.push(r.c);
          continue;
        }
        loaded.overview[r.c] = r.overview;
        loaded.claims[r.c] = r.claims;
        loaded.registrations[r.c] = r.registrations;
        loaded.identities[r.c] = r.identities;
        loaded.projects.push(...r.projects);
      }
      if (loaded.failed.length === chains.length && chains.length > 0) setError(true);
      setData(loaded);
      // "All" starts at the first event any selected chain has. Learned from the first answer, then applied.
      const firsts = Object.values(loaded.overview).map((o) => o.totals.firstEvent).filter((t): t is number => t !== null);
      if (firsts.length) setFirstEvent(Math.min(...firsts));
    })();
    return () => {
      cancelled = true;
    };
  }, [chains.join(","), bucket, from, now]);

  // One identities series per compared project, from its own chain.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, StatsSeries["series"][number]> = {};
      const byChain = new Map<NetworkId, string[]>();
      for (const c of compare) byChain.set(c.chain, [...(byChain.get(c.chain) ?? []), c.address]);
      await Promise.all(
        [...byChain].map(async ([chain, addrs]) => {
          try {
            const r = await statsApi(apiBaseFor(chain)).series("identities", bucket, window, { projects: addrs });
            for (const sr of r.series) if (sr.key !== "total") out[`${chain}:${sr.key}`] = sr;
          } catch {
            // the chain didn't answer; its lines stay off until the next change of view
          }
        }),
      );
      if (!cancelled) setCompareSeries(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [compare.map(pickKey).join(","), bucket, from, now]);

  const figures = useMemo(() => sumFigures(data ? Object.values(data.overview) : []), [data]);
  const chart = useMemo<ChartSeries[]>(() => {
    if (!data) return [];
    const sum = (byChain: Record<NetworkId, StatsSeries>) => sumSeries(Object.values(byChain).map((s) => s.series[0].points));
    const total = sum(data.identities);
    const claims = sum(data.claims);
    const regs = sum(data.registrations);
    const run = (pts: { t: string; v: number }[]) => (cumulative ? pts.reduce<{ t: string; v: number }[]>((acc, p) => [...acc, { t: p.t, v: (acc[acc.length - 1]?.v ?? 0) + p.v }], []) : pts);
    if (compare.length === 0)
      return [
        { key: "identities", label: "Identities", color: "var(--accent)", points: run(total) },
        { key: "claims", label: "Counterfactual claims", color: "var(--c-amber)", points: run(claims) },
        { key: "registrations", label: "ERC-8004 registrations", color: "var(--c-emerald)", points: run(regs) },
      ];
    // Comparing: the whole as a quiet line (unless hidden, so the scale fits the projects), each project in its own colour, on the same buckets as the total.
    const lines: ChartSeries[] = withTotal ? [{ key: "identities", label: "All identities", color: "var(--text-3)", points: run(total) }] : [];
    compare.forEach((c, i) => {
      const sr = compareSeries[pickKey(c)];
      const byT = new Map((sr?.points ?? []).map((p) => [p.t, p.v]));
      const row = data.projects.find((r) => r.chain === c.chain && r.address === c.address);
      const label = `${row?.name ?? `${c.address.slice(0, 8)}…${c.address.slice(-4)}`}${allChains ? ` · ${NETWORKS[c.chain].label}` : ""}`;
      lines.push({ key: pickKey(c), label, color: COMPARE_COLORS[i % COMPARE_COLORS.length], points: run(total.map((p) => ({ t: p.t, v: byT.get(p.t) ?? 0 }))) });
    });
    return lines;
  }, [data, cumulative, compare, compareSeries, allChains, withTotal]);

  const toggleCompare = (pick: Pick) =>
    setCompare((cur) => (cur.some((c) => pickKey(c) === pickKey(pick)) ? cur.filter((c) => pickKey(c) !== pickKey(pick)) : cur.length >= MAX_COMPARE ? cur : [...cur, pick]));

  return (
    <div className="page page-wide fade-in">
      <div className="page-head wrap">
        <h1 className="page-title">{allChains ? "Adapter usage" : `Adapter usage on ${NETWORKS[offered[0]].label}`}</h1>
        <div className="head-actions wrap" style={{ gap: 10 }}>
          <div className="seg">
            {RANGES.map((r) => <button key={r.id} className={range === r.id ? "active" : ""} onClick={() => setRange(r.id)}>{r.label}</button>)}
          </div>
          <select className="select" style={{ width: "auto" }} value={bucketChoice} onChange={(e) => setBucketChoice(e.target.value as StatsBucket | "auto")} aria-label="Bucket">
            <option value="auto">By {bucket} (auto)</option>
            <option value="day">By day</option>
            <option value="week">By week</option>
            <option value="month">By month</option>
          </select>
          <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={cumulative} onChange={(e) => setCumulative(e.target.checked)} /> Cumulative
          </label>
        </div>
      </div>
      <p className="page-sub">
        Identities created, statements made, and who is making them, from the adapter's own events.
        {allChains && " Every chain is counted by its own indexer and added up here."}
      </p>

      {allChains && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
          <span className="t3 small">Chains</span>
          {offered.map((c) => {
            const on = chains.includes(c);
            return (
              <button key={c} className={`btn btn-sm${on ? " is-active" : ""}`} onClick={() => setChains(on ? chains.filter((x) => x !== c) : [...chains, c])}>
                <ChainIcon id={c} size={14} />{NETWORKS[c].label}{NETWORKS[c].chain.testnet && <span className="t3"> · testnet</span>}
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="callout callout-warn" style={{ marginBottom: 14 }}><b>Can't reach the indexer{chains.length > 1 ? "s" : ""}.</b> Retrying on the next change of view.</div>}
      {data && data.failed.length > 0 && !error && (
        <div className="callout callout-warn" style={{ marginBottom: 14 }}><b>{data.failed.map((c) => NETWORKS[c].label).join(", ")} didn't answer.</b> The figures below leave {data.failed.length === 1 ? "it" : "them"} out.</div>
      )}

      <div className="stat-panels stats-tiles">
        <Tile label="Identities" tip="UBIDs brought into being in the window: a counterfactual claim or an ERC-8004 registration, whichever came first." figure={figures.identities} loading={!data} />
        <Tile label="ERC-8004 registrations" tip="Agents minted on the shared registry through the adapter." figure={figures.registrations} loading={!data} />
        <Tile label="Counterfactual claims" tip="Identities claimed in the event log without a mint." figure={figures.claims} loading={!data} />
        <Tile label="Attestations" tip="Stars, ratings, reviews, transaction records and account confirmations that verified." figure={figures.attestations} loading={!data} />
        <Tile label="Attesters" tip="Distinct addresses that made a statement in the window." figure={figures.attesters} loading={!data} />
        <Tile label="Wallet links" tip="Agents naming an operating wallet, and wallets pointing back at an agent." figure={figures.wallets} loading={!data} />
        <Tile label="New projects" tip="Collections and contracts whose first identity appeared in the window." figure={figures.projects} loading={!data} />
        <Tile label="Active identities" tip="UBIDs touched by any event in the window." figure={figures.active} loading={!data} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row spread wrap" style={{ marginBottom: 8 }}>
          <div className="section-label" style={{ margin: 0 }}>
            Identities per {bucket}{cumulative ? ", cumulative" : ""}{compare.length > 0 && ` · ${compare.length === 1 ? "one project" : `${compare.length} projects`} against the whole`}
          </div>
          <ChartLegend series={chart} />
        </div>
        {compare.length > 0 && (
          <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
            {chart.slice(withTotal ? 1 : 0).map((line, i) => (
              <span key={line.key} className="badge badge-outline" style={{ height: 24, gap: 6 }}>
                <span className="chart-swatch" style={{ background: line.color }} />{line.label}
                <button className="t3" aria-label={`Stop comparing ${line.label}`} title="Remove from the chart" onClick={() => toggleCompare(compare[i])}>✕</button>
              </span>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={() => setCompare([])}>Clear</button>
            <label className="row" style={{ gap: 6, fontSize: 12.5, marginLeft: "auto" }} title="Off, the scale fits the compared projects alone">
              <input type="checkbox" checked={withTotal} onChange={(e) => setWithTotal(e.target.checked)} /> Against all identities
            </label>
          </div>
        )}
        {data ? <LineChart series={chart} /> : <div className="chart-empty" style={{ height: 280 }}><Skeleton w="40%" /></div>}
        {data && Object.values(data.overview).some((o) => o.totals.blocksWithoutTimestamp > 0) && (
          <p className="hint" style={{ margin: "8px 0 0" }}>Some older blocks are still being dated by the indexer; they join the chart as that finishes.</p>
        )}
      </div>

      <ProjectsTable rows={data?.projects ?? null} allChains={allChains} window={window} compare={compare} onToggleCompare={toggleCompare} />

      {data && (
        <p className="hint" style={{ marginTop: 12 }}>
          All time: {sumTotals(data, "identities").toLocaleString()} identities across {sumTotals(data, "projects").toLocaleString()} projects, {sumTotals(data, "attestations").toLocaleString()} attestations, {sumTotals(data, "events").toLocaleString()} events.
          {" "}Times are UTC.
        </p>
      )}
    </div>
  );
}

function sumFigures(overviews: StatsOverview[]) {
  const keys = ["identities", "registrations", "claims", "attestations", "attesters", "wallets", "projects", "active", "revocations"] as const;
  const out = {} as Record<(typeof keys)[number], { value: number; prior: number }>;
  for (const k of keys) out[k] = { value: overviews.reduce((a, o) => a + (o.figures[k]?.value ?? 0), 0), prior: overviews.reduce((a, o) => a + (o.figures[k]?.prior ?? 0), 0) };
  return out;
}
function sumTotals(d: Loaded, k: "identities" | "projects" | "attestations" | "events"): number {
  return Object.values(d.overview).reduce((a, o) => a + o.totals[k], 0);
}
/** Series from several chains share buckets; add them point by point. */
function sumSeries(all: { t: string; v: number }[][]): { t: string; v: number }[] {
  const byT = new Map<string, number>();
  for (const pts of all) for (const p of pts) byT.set(p.t, (byT.get(p.t) ?? 0) + p.v);
  return [...byT].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => ({ t, v }));
}

function Tile({ label, tip, figure, loading }: { label: string; tip: string; figure: { value: number; prior: number }; loading: boolean }) {
  const delta = figure.prior === 0 ? null : Math.round(((figure.value - figure.prior) / figure.prior) * 100);
  return (
    <div className="stat-panel">
      <div className="stat-panel-n">{loading ? <Skeleton w={40} /> : figure.value.toLocaleString()}</div>
      <div className="stat-panel-l row spread">
        <Tip tip={tip}><span>{label}</span></Tip>
        {!loading && (
          delta === null
            ? figure.value > 0 && <span className="badge badge-outline" title="Nothing in the window before this one">new</span>
            : <span className={`badge ${delta > 0 ? "badge-ok" : delta < 0 ? "badge-danger" : ""}`} title={`${figure.prior.toLocaleString()} in the window before`}>{delta > 0 ? "+" : ""}{delta}%</span>
        )}
      </div>
    </div>
  );
}

type SortKey = "name" | "identities" | "registered" | "attestations" | "ratingAverage" | "stars" | "firstSeen" | "lastEvent";

function ProjectsTable({ rows, allChains, window, compare, onToggleCompare }: { rows: (ProjectRow & { chain: NetworkId })[] | null; allChains: boolean; window: { from: number; to: number }; compare: Pick[]; onToggleCompare: (p: Pick) => void }) {
  const compared = new Set(compare.map(pickKey));
  const full = compare.length >= MAX_COMPARE;
  const [standards, setStandards] = useState<string[]>([]);
  const [registration, setRegistration] = useState<"" | "registered" | "counterfactual">("");
  const [active, setActive] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("lastEvent");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = usePageParam(); // ?page=2 in the address bar, with the rest of the view
  useEffect(() => {
    if (page > 0) setPage(0, "replace");
  }, [standards.join(","), registration, active, q, sort, dir]);

  const shown = useMemo(() => {
    let list = rows ?? [];
    if (standards.length) list = list.filter((r) => r.standards.some((s) => standards.includes(s)));
    if (registration === "registered") list = list.filter((r) => r.registered > 0);
    if (registration === "counterfactual") list = list.filter((r) => r.registered === 0);
    if (active) list = list.filter((r) => r.lastEvent !== null && r.lastEvent >= window.from);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((r) => r.address.includes(needle) || (r.name ?? "").toLowerCase().includes(needle));
    return [...list].sort((a, b) => {
      const x = a[sort], y = b[sort];
      const cmp = x === null ? 1 : y === null ? -1 : typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [rows, standards, registration, active, q, sort, dir, window.from]);

  const head = (key: SortKey, label: string, cls = "") => (
    <th className={cls}>
      <button className={`th-sort${sort === key ? " is-on" : ""}`} onClick={() => (sort === key ? setDir(dir === "asc" ? "desc" : "asc") : (setSort(key), setDir(key === "name" ? "asc" : "desc")))}>
        {label}{sort === key && <span aria-hidden> {dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );

  function exportCsv() {
    const cols = ["chain", "address", "name", "standards", "identities", "registered", "attestations", "attesters", "ratingAverage", "ratings", "stars", "firstSeen", "lastEvent", "trustVerdict", "website"] as const;
    const cell = (v: unknown) => {
      const s = Array.isArray(v) ? v.join("|") : v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(","), ...shown.map((r) => cols.map((c) => cell(c === "chain" ? NETWORKS[r.chain].label : r[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `adapterscan-projects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const visible = shown.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <>
      <div className="row spread wrap" style={{ marginBottom: 8, alignItems: "flex-end", gap: 10 }}>
        <div>
          <div className="section-label" style={{ margin: "0 0 2px" }}>Projects</div>
          <span className="t2 small">{rows ? `${shown.length.toLocaleString()} of ${rows.length.toLocaleString()}` : "…"} collections and contracts with identities</span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input" style={{ width: 200 }} placeholder="Name or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
          <div style={{ width: 180 }}>
            <MultiSelect options={STANDARD_NAMES} values={standards} onChange={setStandards} placeholder="Any standard" render={(n) => <StandardBadge name={n} />} />
          </div>
          <select className="select" style={{ width: "auto" }} value={registration} onChange={(e) => setRegistration(e.target.value as typeof registration)} aria-label="Registration">
            <option value="">Any registration</option>
            <option value="registered">Has ERC-8004 registrations</option>
            <option value="counterfactual">Counterfactual only</option>
          </select>
          <label className="row" style={{ gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active in window</label>
          <button className="btn btn-sm" disabled={!rows || shown.length === 0} onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      <div className="card card-table table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th><Tip tip={`Tick projects to draw them on the chart above, up to ${MAX_COMPARE} at once. One shows its growth against the whole; two or more compare.`}>Chart</Tip></th>
              {head("name", "Project")}
              {allChains && <th>Chain</th>}
              <th>Standard</th>
              {head("identities", "Identities", "td-right")}
              {head("registered", "Registered", "td-right")}
              {head("attestations", "Attestations", "td-right")}
              {head("ratingAverage", "Rating", "td-right")}
              {head("stars", "Stars", "td-right")}
              {head("firstSeen", "First seen")}
              {head("lastEvent", "Last event")}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const href = `${explorerOriginFor(r.chain)}/address/${r.address}`;
              const key = `${r.chain}:${r.address}`;
              const on = compared.has(key);
              const color = on ? COMPARE_COLORS[compare.findIndex((c) => pickKey(c) === key) % COMPARE_COLORS.length] : undefined;
              return (
                <tr key={key} className={on ? "is-compared" : undefined}>
                  <td>
                    <label className="compare-toggle" title={!on && full ? `Up to ${MAX_COMPARE} projects on the chart - remove one first` : on ? "On the chart" : "Draw on the chart"}>
                      <input type="checkbox" checked={on} disabled={!on && full} onChange={() => onToggleCompare({ chain: r.chain, address: r.address })} aria-label={`Compare ${r.name ?? r.address}`} />
                      {on && <span className="chart-swatch" style={{ background: color }} />}
                    </label>
                  </td>
                  <td>
                    <a className="row" style={{ gap: 8 }} href={href}>
                      {r.image ? <img className="avatar-img" src={r.image} alt="" width={24} height={24} style={{ width: 24, height: 24 }} /> : <span className="search-item-addr" aria-hidden>@</span>}
                      <span style={{ display: "grid", lineHeight: 1.25 }}>
                        <span style={{ fontWeight: 600 }}>{r.name ?? `${r.address.slice(0, 8)}…${r.address.slice(-4)}`}</span>
                        {r.name && <span className="mono t3" style={{ fontSize: 11 }}>{r.address.slice(0, 8)}…{r.address.slice(-4)}</span>}
                      </span>
                    </a>
                  </td>
                  {allChains && <td><span className="badge badge-outline" style={{ gap: 5 }}><ChainIcon id={r.chain} size={13} />{NETWORKS[r.chain].label}</span></td>}
                  <td><span className="row wrap" style={{ gap: 4 }}>{r.standards.map((s) => <StandardBadge key={s} name={s} />)}</span></td>
                  <td className="td-right num">{r.identities.toLocaleString()}</td>
                  <td className="td-right num">{r.registered.toLocaleString()}{r.identities > 0 && <span className="t3 small"> · {Math.round((r.registered / r.identities) * 100)}%</span>}</td>
                  <td className="td-right num">{r.attestations.toLocaleString()}{r.attesters > 0 && <span className="t3 small"> · {r.attesters} {r.attesters === 1 ? "attester" : "attesters"}</span>}</td>
                  <td className="td-right num">{r.ratingAverage === null ? <span className="t3">—</span> : <>{Math.round(r.ratingAverage)}<span className="t3 small"> · {r.ratings}</span></>}</td>
                  <td className="td-right num">{r.stars || <span className="t3">0</span>}</td>
                  <td className="small t2">{r.firstSeen ? fmtDay(r.firstSeen) : "—"}</td>
                  <td className="small t2" title={r.lastEvent ? new Date(r.lastEvent * 1000).toUTCString() : ""}>{r.lastEvent ? ago(r.lastEvent) : "—"}</td>
                </tr>
              );
            })}
            {!rows && <tr className="is-static"><td colSpan={allChains ? 11 : 10}><div className="empty">Loading…</div></td></tr>}
            {rows && shown.length === 0 && <tr className="is-static"><td colSpan={allChains ? 11 : 10}><div className="empty">{rows.length === 0 ? "No projects yet." : "Nothing matches these filters."}</div></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
        <Pager offset={page * PAGE} limit={PAGE} total={shown.length} onChange={(o) => setPage(o / PAGE)} />
      </div>
    </>
  );
}

function fmtDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDay(ts);
}

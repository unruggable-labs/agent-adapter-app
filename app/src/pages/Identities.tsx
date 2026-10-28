import { useEffect, useState } from "react";
import { ChainFilter, ChainTag, useChainParam } from "../components/chains";
import { CollectionTile } from "../components/collections";
import { Addr, ControllerCell, Modal, MultiSelect, Pager, registrationOf, RegistrationMark, Skeleton, SkeletonRows, StandardBadge, StatusBadge, Tip, UbidCell, type Registration } from "../components/ui";
import { api, type IdentitiesQuery } from "../lib/api";
import { useApp, useLive } from "../lib/app-state";
import { IS_HUB, STANDARD_NAMES } from "../lib/chain";
import { setSearchParams, usePageParam, useSearchParams } from "../lib/url";

const PAGE_SIZE = 25;

type RegistrationFilter = NonNullable<IdentitiesQuery["registration"]>[number];
/** The two that matter. The API also takes `unclaimed` (settings made, nothing claimed), which is too rare to offer here. */
const REGISTRATIONS: RegistrationFilter[] = ["registered", "counterfactual"];
const REGISTRATION_LABEL: Record<RegistrationFilter, string> = { registered: "On-chain (ERC-8004)", counterfactual: "Counterfactual", unclaimed: "Unclaimed" };
const REGISTRATION_MARK: Record<RegistrationFilter, Registration> = { registered: "onchain", counterfactual: "claim", unclaimed: "none" };

/** A comma-separated list in the query string, as an array; only the values it may hold. */
function listParam<T extends string>(p: URLSearchParams, key: string, allowed: readonly T[]): T[] {
  return (p.get(key)?.split(",") ?? []).filter((v): v is T => (allowed as readonly string[]).includes(v));
}

/** Set or clear one query parameter, back to page one, without a history entry per change. */
function setParam(key: string, value: string) {
  setSearchParams((p) => {
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("page");
  }, "replace");
}

export function IdentitiesPage() {
  const { overview, navigate } = useApp();
  const [page, setPage] = usePageParam(); // ?page=2 in the address bar, so a page can be shared
  const chain = useChainParam(); // ?chain=base on the hub
  // One page at a time, newest first - the server orders and slices; nothing downloads the registry.
  // On the hub that is newest first across every chain, by when each block was made.
  // The filters live in the address bar too (?registration=registered&standard=ERC721&q=mina).
  const params = useSearchParams();
  const registration = listParam(params, "registration", REGISTRATIONS);
  const standard = listParam(params, "standard", STANDARD_NAMES);
  const q = params.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  const [showFilters, setShowFilters] = useState(false);
  // The box writes ?q a moment after typing stops, so each key isn't a request.
  useEffect(() => {
    if (typed.trim() === q) return;
    const t = setTimeout(() => setParam("q", typed.trim()), 250);
    return () => clearTimeout(t);
  }, [typed, q]);
  const filtered = registration.length + standard.length > 0 || q !== "";
  const { data, status } = useLive(
    () => api.identities({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, chain: chain ? [chain] : undefined, registration, standard, q: q || undefined }),
    [page, chain, registration.join(","), standard.join(","), q],
  );
  const total = data?.total ?? (filtered ? 0 : (overview?.identities ?? 0));
  const active = registration.length + standard.length;
  const visible = data?.items ?? [];

  return (
    <div className="page page-wide fade-in">
      <div className="page-head">
        <h1 className="page-title">Identities</h1>
        <div className="head-actions">
          <button className="btn" onClick={() => navigate("/create")}>Create identity</button>
        </div>
      </div>
      <p className="page-sub">
        Register an agent identity. <i>Anything</i> can be registered as an agent identity - it will receive a UBID, a unique hash representing it.
        {overview && overview.dropped > 0 && <span className="t3"> · {overview.dropped} events dropped at verification</span>}
      </p>

      <StatPanels />
      {page === 0 && !chain && !filtered && <CollectionStrip />}
      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {IS_HUB && <ChainFilter />}
        <input className="input" style={{ maxWidth: 240, padding: "6px 10px" }} placeholder="Filter by name" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Filter by name" />
        <button className={`btn btn-sm${active ? " is-active" : ""}`} onClick={() => setShowFilters(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" />
          </svg>
          Filter{active > 0 && <span className="num"> · {active}</span>}
        </button>
        {filtered && data && <span className="hint" style={{ margin: 0 }}>{data.total.toLocaleString()} {data.total === 1 ? "match" : "matches"}</span>}
      </div>

      <div className="card card-table table-scroll">
        <table className="table clickable">
          <thead>
            <tr>
              <th><Tip tip="The Universal Binding Identifier - the permanent hash naming this identity. Everything (reputation, wallet links, registration) attaches to this. The mark beside it: a chain link means an ERC-8004 agent is minted, a dashed ring means a counterfactual claim only.">UBID</Tip></th>
              {IS_HUB && <th>Chain</th>}
              <th><Tip tip="What kind of controller controls the identity: a token standard means whoever owns the token controls it; ACCOUNT means the address itself; CONTRACT_OWNABLE/ADMIN mean the contract's owner or admins.">Standard</Tip></th>
              <th><Tip tip="The thing that controls this identity: its collection (name when known, else the contract address) and token id. For account standards, the address itself.">Controller</Tip></th>
              <th><Tip tip="How the identity exists: 'ERC-8004 #ID' means a real agent was minted on the shared registry with that id; 'counterfactual' means it lives in the event log without a mint. Both share the same UBID and history.">Registration</Tip></th>
              <th className="td-center"><Tip tip="Average of each attester's latest live 0-100 rating.">Rating</Tip></th>
              <th className="td-center">Stars</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((id) => (
              <tr key={id.ubid} onClick={() => navigate(`/identity/${id.ubid}`)}>
                <td><UbidCell ubid={id.ubid} image={id.image} registration={registrationOf(id)} /></td>
                {IS_HUB && <td><ChainTag chain={id.chain} /></td>}
                <td><StandardBadge id={id} /></td>
                <td><ControllerCell id={id} /></td>
                <td><StatusBadge id={id} /></td>
                <td className="td-center num">{id.reputation.ratingAverage === null ? <span className="t3">—</span> : id.reputation.ratingAverage.toFixed(0)}</td>
                <td className="td-center num">{id.reputation.stars || <span className="t3">0</span>}</td>
              </tr>
            ))}
            {!data && status === "loading" && <SkeletonRows widths={IS_HUB ? [0, 40, 50, 60, 60, 30, 30] : [0, 50, 60, 60, 30, 30]} />}
            {!data && status === "error" && (
              <tr className="is-static"><td colSpan={IS_HUB ? 7 : 6}><div className="empty">Can't reach the indexer - retrying every few seconds.</div></td></tr>
            )}
            {data && data.total === 0 && (
              <tr className="is-static"><td colSpan={IS_HUB ? 7 : 6}><div className="empty">{filtered ? "Nothing matches these filters." : "No identities yet."}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row spread" style={{ marginTop: 10 }}>
        {overview?.adapter ? (
          <p className="hint" style={{ margin: 0 }}>
            <Addr value={overview.adapter} n={42} /> is the adapter every UBID is scoped to on chain <b>{overview.chainId}</b>.
          </p>
        ) : overview?.chains?.length ? (
          <p className="hint" style={{ margin: 0 }}>
            Every UBID is scoped to its chain's adapter, so the same token on two chains is two identities.
          </p>
        ) : (
          <span />
        )}
        <Pager offset={page * PAGE_SIZE} limit={PAGE_SIZE} total={total} onChange={(o) => setPage(o / PAGE_SIZE)} />
      </div>

      {showFilters && (
        <Modal title="Filter identities" onClose={() => setShowFilters(false)}>
          <div className="field">
            <label>Registration</label>
            <MultiSelect
              options={REGISTRATIONS}
              values={registration}
              onChange={(v) => setParam("registration", v.join(","))}
              placeholder="Any registration"
              render={(r) => <span className="row" style={{ gap: 6 }}><RegistrationMark r={REGISTRATION_MARK[r]} />{REGISTRATION_LABEL[r]}</span>}
            />
          </div>
          <div className="field">
            <label>Standard</label>
            <MultiSelect
              options={STANDARD_NAMES}
              values={standard}
              onChange={(v) => setParam("standard", v.join(","))}
              placeholder="Any standard"
              render={(n) => <StandardBadge name={n} />}
            />
          </div>
          <div className="row spread" style={{ marginTop: 16 }}>
            <button className="btn btn-ghost btn-sm" disabled={!active} onClick={() => { setParam("registration", ""); setParam("standard", ""); }}>Clear</button>
            <button className="btn btn-primary" onClick={() => setShowFilters(false)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const STRIP = 6;

/**
 * The biggest collections, as pictures, on the first page: a way in that isn't a table. Picked by
 * the numbers (the most agents), not by hand. Draws nothing until there are some.
 */
function CollectionStrip() {
  const { navigate } = useApp();
  const { data } = useLive(() => api.collections({ limit: STRIP }), []);
  if (data && data.items.length === 0) return null;
  return (
    <div style={{ margin: "4px 0 18px" }}>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div className="section-label" style={{ margin: 0 }}>Top collections</div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate("/collections")}>All {data ? data.total.toLocaleString() : ""} collections →</button>
      </div>
      <div className="tile-grid tile-strip">
        {data ? data.items.map((c) => <CollectionTile key={`${c.chain}:${c.address}`} c={c} />) : Array.from({ length: STRIP }, (_, i) => <div key={i} className="tile is-loading" />)}
      </div>
    </div>
  );
}

/**
 * The registry at a glance, above the table. A project is a distinct collection or contract that
 * identities are bound to - one collection with a hundred agents is one project. The indexer
 * counts them over the same state the table pages through, so they can't disagree with it.
 */
function StatPanels() {
  const { overview } = useApp();
  const n = (v: number | undefined) => (v === undefined ? <Skeleton w={40} /> : v.toLocaleString());
  return (
    <div className="stat-panels">
      <div className="stat-panel">
        <div className="stat-panel-n">{n(overview?.identities)}</div>
        <div className="stat-panel-l"><Tip tip={`Every identity the indexer knows ${IS_HUB ? "on every mainnet" : "on this network"} - claimed, registered, or referenced by an attestation.`}>UBIDs</Tip></div>
      </div>
      <div className="stat-panel">
        <div className="stat-panel-n">{n(overview?.projects)}</div>
        <div className="stat-panel-l"><Tip tip="Distinct collections and contracts that identities are bound to. A collection with a hundred agents counts once.">Projects</Tip></div>
      </div>
      <div className="stat-panel">
        <div className="stat-panel-n">{n(overview?.registered)}</div>
        <div className="stat-panel-l"><Tip tip="Identities with an ERC-8004 agent minted on the shared registry. The rest are counterfactual claims.">Registered on-chain</Tip></div>
      </div>
      <div className="stat-panel">
        <div className="stat-panel-n">{n(overview?.attestations)}</div>
        <div className="stat-panel-l"><Tip tip="Stars, ratings, reviews and transaction records, across every identity.">Attestations</Tip></div>
      </div>
    </div>
  );
}

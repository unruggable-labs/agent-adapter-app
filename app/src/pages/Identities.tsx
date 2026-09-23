import { useState } from "react";
import { useApp } from "../lib/app-state";
import { Addr, ControllerCell, registrationOf, Skeleton, StandardBadge, StatusBadge, Tip, UbidCell } from "../components/ui";

const PAGE_SIZE = 25;

export function IdentitiesPage() {
  const { identities, overview, status, navigate } = useApp();
  const [page, setPage] = useState(0);
  // Newest first: the identity created most recently sits at the top.
  const ordered = [...identities].sort((a, b) => {
    const ab = BigInt(a.created?.blockNumber ?? 0), bb = BigInt(b.created?.blockNumber ?? 0);
    if (ab !== bb) return ab > bb ? -1 : 1;
    return (b.created?.logIndex ?? 0) - (a.created?.logIndex ?? 0);
  });
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = ordered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

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

      <div className="card table-scroll" style={{ padding: "4px 14px" }}>
        <table className="table clickable">
          <thead>
            <tr>
              <th><Tip tip="The Universal Binding Identifier - the permanent hash naming this identity. Everything (reputation, wallet links, registration) attaches to this. The mark beside it: a chain link means an ERC-8004 agent is minted, a dashed ring means a counterfactual claim only.">UBID</Tip></th>
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
                <td><StandardBadge id={id} /></td>
                <td><ControllerCell id={id} /></td>
                <td><StatusBadge id={id} /></td>
                <td className="td-center num">{id.reputation.ratingAverage === null ? <span className="t3">—</span> : id.reputation.ratingAverage.toFixed(0)}</td>
                <td className="td-center num">{id.reputation.stars || <span className="t3">0</span>}</td>
              </tr>
            ))}
            {identities.length === 0 && status === "loading" && <SkeletonRows />}
            {identities.length === 0 && status === "error" && (
              <tr><td colSpan={6}><div className="empty">Can't reach the indexer - retrying every few seconds.</div></td></tr>
            )}
            {identities.length === 0 && status === "ready" && (
              <tr><td colSpan={6}><div className="empty">No identities yet - run the demo scenario or create one.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row spread" style={{ marginTop: 10 }}>
        {overview ? (
          <p className="hint" style={{ margin: 0 }}>
            <Addr value={overview.adapter} /> is the adapter every UBID is scoped to on chain {overview.chainId}.
          </p>
        ) : (
          <span />
        )}
        {pages > 1 && (
          <span className="row" style={{ gap: 8 }}>
            <span className="hint num">
              {current * PAGE_SIZE + 1}-{Math.min((current + 1) * PAGE_SIZE, identities.length)} of {identities.length}
            </span>
            <button className="btn btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Prev</button>
            <button className="btn btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The registry at a glance, above the table. A project is a distinct collection or contract that
 * identities are bound to - one collection with a hundred agents is one project. Counts come from
 * the same list the table shows, so they can't disagree with it.
 */
function StatPanels() {
  const { identities, overview } = useApp();
  const projects = new Set(identities.map((i) => i.boundAddress)).size;
  const registered = identities.filter((i) => i.agentIds.length > 0).length;
  const loading = identities.length === 0 && !overview;
  const n = (v: number) => (loading ? <Skeleton w={40} /> : v.toLocaleString());
  return (
    <div className="stat-panels">
      <div className="stat-panel">
        <div className="stat-panel-n">{n(identities.length)}</div>
        <div className="stat-panel-l"><Tip tip="Every identity the indexer knows on this network - claimed, registered, or referenced by an attestation.">UBIDs</Tip></div>
      </div>
      <div className="stat-panel">
        <div className="stat-panel-n">{n(projects)}</div>
        <div className="stat-panel-l"><Tip tip="Distinct collections and contracts that identities are bound to. A collection with a hundred agents counts once.">Projects</Tip></div>
      </div>
      <div className="stat-panel">
        <div className="stat-panel-n">{n(registered)}</div>
        <div className="stat-panel-l"><Tip tip="Identities with an ERC-8004 agent minted on the shared registry. The rest are counterfactual claims.">Registered on-chain</Tip></div>
      </div>
      <div className="stat-panel">
        <div className="stat-panel-n">{loading || !overview ? <Skeleton w={40} /> : overview.attestations.toLocaleString()}</div>
        <div className="stat-panel-l"><Tip tip="Stars, ratings, reviews and transaction records, across every identity.">Attestations</Tip></div>
      </div>
    </div>
  );
}

/** Placeholder rows in the real column shape, so the first paint says "coming" instead of "none". */
function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <tr key={i} className="skel-row" aria-hidden>
          <td><span className="row" style={{ gap: 8 }}><Skeleton size={28} /><Skeleton w={80} /></span></td>
          <td><Skeleton w={50} /></td>
          <td><Skeleton w={60} /></td>
          <td><Skeleton w={60} /></td>
          <td className="td-center"><Skeleton w={30} /></td>
          <td className="td-center"><Skeleton w={30} /></td>
        </tr>
      ))}
    </>
  );
}

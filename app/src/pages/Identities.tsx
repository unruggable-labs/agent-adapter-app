import { useApp } from "../lib/app-state";
import { displayName, shortHex } from "../lib/chain";
import { Addr, StatusBadge, TrustBadge } from "../components/ui";

export function IdentitiesPage() {
  const { identities, overview, navigate } = useApp();

  return (
    <div className="page fade-in">
      <div className="page-head">
        <h1 className="page-title">Identities</h1>
        <div className="head-actions">
          <button className="btn" onClick={() => navigate("/create")}>Create identity</button>
        </div>
      </div>
      <p className="page-sub">
        Every identity is a UBID — one hash naming a subject, whether it has only claimed
        counterfactually or fully registered as an ERC-8004 agent.
        {overview && overview.dropped > 0 && <span className="t3"> · {overview.dropped} events dropped at verification</span>}
      </p>

      <div className="card" style={{ padding: "4px 14px" }}>
        <table className="table clickable">
          <thead>
            <tr>
              <th>Agent</th>
              <th>UBID</th>
              <th>Standard</th>
              <th>Status</th>
              <th className="td-right">Rating</th>
              <th className="td-right">Stars</th>
              <th>Signals</th>
            </tr>
          </thead>
          <tbody>
            {identities.map((id) => (
              <tr key={id.ubid} onClick={() => navigate(`/identity/${id.ubid}`)}>
                <td>
                  <span style={{ fontWeight: 600 }}>{displayName(id)}</span>
                  {id.agentName && <span className="t3 small"> {id.subjectLabel}</span>}
                </td>
                <td className="mono t3">{shortHex(id.ubid, 10)}</td>
                <td><span className="badge badge-outline">{id.standardName}</span></td>
                <td><StatusBadge id={id} /></td>
                <td className="td-right num">{id.reputation.ratingAverage === null ? <span className="t3">—</span> : id.reputation.ratingAverage.toFixed(0)}</td>
                <td className="td-right num">{id.reputation.stars || <span className="t3">0</span>}</td>
                <td>
                  <span className="row wrap" style={{ gap: 4 }}>
                    {id.collectionAuthoredAfterOwner && <span className="badge badge-danger">post-owner claim</span>}
                    {id.flags.currentlyOwnerless && <span className="badge badge-warn">ownerless</span>}
                    <TrustBadge t={id.trustBase} compact />
                  </span>
                </td>
              </tr>
            ))}
            {identities.length === 0 && (
              <tr><td colSpan={7}><div className="empty">No identities yet — run the demo scenario or create one.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        <Addr value={overview?.adapter ?? ""} /> is the adapter every UBID is scoped to on chain {overview?.chainId}.
      </p>
    </div>
  );
}

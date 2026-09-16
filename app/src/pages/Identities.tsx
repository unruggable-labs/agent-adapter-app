import { useApp } from "../lib/app-state";
import { controlLine, displayName, shortHex, shortTokenId } from "../lib/chain";
import { Addr, Avatar, StatusBadge, Tip, TrustBadge } from "../components/ui";

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
        Every identity is a UBID - one hash naming a subject, whether it has only claimed
        counterfactually or fully registered as an ERC-8004 agent.
        {overview && overview.dropped > 0 && <span className="t3"> · {overview.dropped} events dropped at verification</span>}
      </p>

      <div className="card table-scroll" style={{ padding: "4px 14px" }}>
        <table className="table clickable">
          <thead>
            <tr>
              <th><Tip tip="The deed that controls this identity: its collection (name when known, else the contract address) and token id. For account standards, the address itself.">Subject</Tip></th>
              <th><Tip tip="The Universal Binding Identifier - the permanent hash naming this identity. Everything (reputation, wallet links, registration) attaches to this.">UBID</Tip></th>
              <th><Tip tip="What kind of deed controls the identity: a token standard means whoever owns the token controls it; ACCOUNT means the address itself; CONTRACT_OWNABLE/ADMIN mean the contract's owner or admins.">Standard</Tip></th>
              <th><Tip tip="How the identity exists: 'ERC-8004 #id' means a real agent was minted on the shared registry with that id; 'claim only' means it lives in the event log without a mint. Both share the same UBID and history.">Registration</Tip></th>
              <th className="td-right"><Tip tip="Average of each attester's latest live 0-100 rating.">Rating</Tip></th>
              <th className="td-right"><Tip tip="Count of attesters whose latest live star value is 1 - an endorsement toggle.">Stars</Tip></th>
              <th><Tip tip="Trust disclosures: warnings derived from the event history (e.g. a collection re-claimed a burned token's identity) and from probing the deed contract's code (burnable, upgradeable, ruggable). Disclosed, never censored.">Signals</Tip></th>
            </tr>
          </thead>
          <tbody>
            {identities.map((id) => (
              <tr key={id.ubid} onClick={() => navigate(`/identity/${id.ubid}`)}>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <Avatar seed={id.ubid} size={20} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
                      {(() => {
                        const stripped = (id.agentName ?? displayName(id)).replace(/ #\S+$/u, "");
                        return /^(0x|Account 0x)/.test(stripped)
                          ? <Addr value={id.boundAddress} n={8} />
                          : <span style={{ fontWeight: 600 }}>{stripped}</span>;
                      })()}
                      {id.standard < 5 && <span className="num t3 small">#{shortTokenId(id.tokenId)}</span>}
                    </span>
                  </span>
                </td>
                <td className="mono t3">{shortHex(id.ubid, 10)}</td>
                <td><Tip tip={`This identity is ${controlLine(id)}.`}><span className="badge badge-outline">{id.standardName}</span></Tip></td>
                <td><StatusBadge id={id} /></td>
                <td className="td-right num">{id.reputation.ratingAverage === null ? <span className="t3">—</span> : id.reputation.ratingAverage.toFixed(0)}</td>
                <td className="td-right num">{id.reputation.stars || <span className="t3">0</span>}</td>
                <td>
                  <span className="row wrap" style={{ gap: 4 }}>
                    {id.collectionAuthoredAfterOwner && (
                      <Tip tip="The collection contract wrote to this identity after a real owner had already spoken - the burn-reopen pattern. Its reputation may describe a previous claimant's agent.">
                        <span className="badge badge-danger">post-owner claim</span>
                      </Tip>
                    )}
                    {id.flags.currentlyOwnerless && (
                      <Tip tip="The bound token currently has no owner (ownerOf reverts or is zero), so the collection contract temporarily holds authority over this identity.">
                        <span className="badge badge-warn">ownerless</span>
                      </Tip>
                    )}
                    <TrustBadge t={id.trustBase} compact />
                  </span>
                </td>
              </tr>
            ))}
            {identities.length === 0 && (
              <tr><td colSpan={7}><div className="empty">No identities yet - run the demo scenario or create one.</div></td></tr>
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

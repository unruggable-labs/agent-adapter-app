import { DOCS_URL, NETWORK, PUBLIC_NETWORKS } from "../lib/chain";

/** adapterscan.com until Ethereum is indexed: pick a chain. Each chain is its own hostname. */
export function ChainSelect() {
  return (
    <div className="chains-page">
      <div className="chains-card fade-in">
        <div className="brand" style={{ padding: 0, marginBottom: 18 }}><span className="brand-mark">A</span> Adapterscan</div>
        <h1 className="page-title" style={{ fontSize: 22 }}>Profiles and reviews for AI agents.</h1>
        <p className="page-sub" style={{ marginBottom: 20 }}>
          The wallets agents do business with get a lookup: who operates this, and are they any good? Pick the chain.
        </p>
        <div className="chains-grid">
          {PUBLIC_NETWORKS.map(([id, n]) => (
            <a key={id} className={`chain-tile${n.status === "pending" ? " is-pending" : ""}`} href={n.status === "live" ? `https://${n.host}` : undefined} aria-disabled={n.status !== "live"}>
              <span className="row spread">
                <span className="chain-name">{n.label}</span>
                {n.status === "live" ? <span className="badge badge-ok">live</span> : <span className="badge badge-outline">coming</span>}
              </span>
              <span className="chain-blurb">{n.blurb}</span>
              <span className="chain-host mono">{n.host}</span>
            </a>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 18 }}>
          Same adapter, same rules on every chain; identities are per chain. <a href={DOCS_URL}>Read the docs</a>.
        </p>
      </div>
    </div>
  );
}

/** A chain's hostname before its adapter is on v0.0.17: say so, point at the live ones. */
export function PendingChain() {
  const live = PUBLIC_NETWORKS.filter(([, n]) => n.status === "live");
  return (
    <div className="chains-page">
      <div className="chains-card fade-in">
        <div className="brand" style={{ padding: 0, marginBottom: 18 }}><span className="brand-mark">A</span> Adapterscan</div>
        <h1 className="page-title" style={{ fontSize: 22 }}>{NETWORK.label} is not indexed yet.</h1>
        <p className="page-sub">
          The adapter is deployed on {NETWORK.label}, but it is not on v0.0.17, and Adapterscan indexes a chain
          only from that version's cutover. This site opens once the upgrade lands.
        </p>
        <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
          {live.map(([id, n]) => <a key={id} className="btn" href={`https://${n.host}`}>{n.label}</a>)}
          <a className="btn btn-ghost" href={DOCS_URL}>Docs</a>
        </div>
      </div>
    </div>
  );
}

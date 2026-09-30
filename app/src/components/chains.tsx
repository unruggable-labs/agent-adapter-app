import { DOCS_URL, NETWORK, PUBLIC_NETWORKS } from "../lib/chain";

/** A mark per chain, drawn inline so it takes the tile's colour treatment in both themes. */
export function ChainIcon({ id, size = 28 }: { id: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 32 32", "aria-hidden": true } as const;
  switch (id) {
    case "robinhood":
      return (
        <svg {...common} className="chain-icon chain-icon-robinhood">
          <circle cx="16" cy="16" r="16" fill="currentColor" opacity="0.14" />
          <path d="M22.5 8.5c-4.6.4-8.6 3.6-10.3 8.1-.9 2.4-1.2 4.9-1.7 7.4.5-.3 1-.7 1.4-1.1 1.9-1.9 3.6-4 5.6-5.8-1.2 2.6-2.9 4.9-4.7 7.1 3.2-.7 6.1-2.5 7.9-5.3 1.9-2.9 2.3-6.6 1.8-10.4z" fill="currentColor" />
        </svg>
      );
    case "base":
      return (
        <svg {...common} className="chain-icon chain-icon-base">
          <circle cx="16" cy="16" r="16" fill="currentColor" opacity="0.14" />
          <path d="M16 6a10 10 0 1 1-9.95 11h13.2v-2H6.05A10 10 0 0 1 16 6z" fill="currentColor" />
        </svg>
      );
    case "sepolia":
      return (
        <svg {...common} className="chain-icon chain-icon-sepolia">
          <circle cx="16" cy="16" r="16" fill="currentColor" opacity="0.14" />
          <path d="M16 5l7 11.4-7 4.2-7-4.2L16 5zm0 17.3l7-4.2L16 27l-7-8.9 7 4.2z" fill="currentColor" opacity="0.9" />
        </svg>
      );
    default:
      return (
        <svg {...common} className="chain-icon chain-icon-mainnet">
          <circle cx="16" cy="16" r="16" fill="currentColor" opacity="0.14" />
          <path d="M16 5l7 11.4-7 4.2-7-4.2L16 5zm0 17.3l7-4.2L16 27l-7-8.9 7 4.2z" fill="currentColor" />
        </svg>
      );
  }
}

/** The chain tiles: one per network, live ones linking to their hostname. Used by the apex
 *  picker and by the docs' "Open the explorer" dialog. */
export function ChainGrid() {
  return (
    <div className="chains-grid">
      {PUBLIC_NETWORKS.map(([id, n]) => (
        <a key={id} className={`chain-tile${n.status === "pending" ? " is-pending" : ""}`} href={n.status === "live" ? `https://${n.host}` : undefined} aria-disabled={n.status !== "live"}>
          <span className="row spread">
            <span className="row" style={{ gap: 10 }}>
              <ChainIcon id={id} />
              <span className="chain-name">{n.label}</span>
            </span>
            {n.status === "live" ? <span className="badge badge-ok">live</span> : <span className="badge badge-outline">coming</span>}
          </span>
          <span className="chain-host mono">{n.host}</span>
        </a>
      ))}
    </div>
  );
}

/** adapterscan.com until Ethereum is indexed: pick a chain. Each chain is its own hostname. */
export function ChainSelect() {
  return (
    <div className="chains-page">
      <div className="chains-card fade-in">
        <h1 className="page-title" style={{ fontSize: 24, marginBottom: 20 }}>Agent Identity</h1>
        <ChainGrid />
      </div>
      <p className="chains-foot">Adapterscan · <a href={DOCS_URL}>Docs</a></p>
    </div>
  );
}

/** A chain's hostname before its adapter is on v0.0.17: say so, point at the live ones. */
export function PendingChain() {
  const live = PUBLIC_NETWORKS.filter(([, n]) => n.status === "live");
  return (
    <div className="chains-page">
      <div className="chains-card fade-in">
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

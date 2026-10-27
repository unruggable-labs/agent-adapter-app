import { useApp } from "../lib/app-state";
import { chainLabel, IS_HUB, MAINNETS, NETWORKS } from "../lib/chain";
import { setSearchParams, useSearchParams } from "../lib/url";

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

/**
 * Which chain a record is on, as a small mark and its name. Only where it tells you something:
 * the multichain explorer. A chain's own site is all one chain, so there it draws nothing.
 * `bare` drops the name, for tight table cells (the name is still the tooltip).
 */
export function ChainTag({ chain, bare = false }: { chain: string; bare?: boolean }) {
  if (!IS_HUB) return null;
  return (
    <span className="chain-tag" title={chainLabel(chain)}>
      <ChainIcon id={chain} size={16} />
      {!bare && <span>{chainLabel(chain)}</span>}
    </span>
  );
}

/** The two explorers: every mainnet at adapterscan.com, the testnet on its own. Used by the
 *  header's chain button, the docs' "Open the explorer" and the stats site. */
export function ChainGrid() {
  const live = MAINNETS.filter((id) => NETWORKS[id]?.status === "live");
  const coming = MAINNETS.filter((id) => NETWORKS[id]?.status !== "live");
  const names = (ids: string[]) => ids.map(chainLabel).join(", ");
  return (
    <div className="chains-grid">
      <a className="chain-tile" href="https://adapterscan.com">
        <span className="row spread">
          <span className="row" style={{ gap: 6 }}>
            {MAINNETS.map((id) => (
              <span key={id} className={coming.includes(id) ? "is-dim" : undefined}><ChainIcon id={id} /></span>
            ))}
          </span>
          <span className="badge badge-ok">live</span>
        </span>
        <span className="chain-name">Mainnets</span>
        <span className="hint" style={{ margin: 0 }}>{names(live)}{coming.length > 0 && ` - ${names(coming)} soon`}</span>
        <span className="chain-host mono">adapterscan.com</span>
      </a>
      <a className="chain-tile" href={`https://${NETWORKS.sepolia.host}`}>
        <span className="row spread">
          <ChainIcon id="sepolia" />
          <span className="badge badge-outline">testnet</span>
        </span>
        <span className="chain-name">Sepolia</span>
        <span className="hint" style={{ margin: 0 }}>Free to try. Nothing here is worth anything.</span>
        <span className="chain-host mono">{NETWORKS.sepolia.host}</span>
      </a>
    </div>
  );
}

/** The chain a list is narrowed to, from ?chain= - null for every chain. Only the hub has a choice. */
export function useChainParam(): string | null {
  const p = useSearchParams();
  return IS_HUB ? p.get("chain") : null;
}

/** Every chain, or one: the hub's list filter, kept in ?chain= so the view can be shared. */
export function ChainFilter() {
  const { overview } = useApp();
  const chain = useChainParam();
  const chains = overview?.chains ?? [];
  if (!IS_HUB || chains.length < 2) return null;
  const pick = (c: string | null) =>
    setSearchParams((p) => {
      if (c) p.set("chain", c);
      else p.delete("chain");
      p.delete("page");
    });
  return (
    <div className="seg" role="group" aria-label="Chain">
      <button className={chain === null ? "active" : ""} onClick={() => pick(null)}>All chains</button>
      {chains.map((c) => (
        <button key={c.chain} className={chain === c.chain ? "active" : ""} onClick={() => pick(c.chain)}>
          <span className="row" style={{ gap: 6 }}>
            <ChainIcon id={c.chain} size={14} />
            {chainLabel(c.chain)}
            {c.state !== "live" && (
              <span className="chain-state" title={c.state === "stalled" ? "The indexer hasn't heard from this chain's RPC for a while. Its records are as of the last block it read." : "Still catching up with the chain."}>
                {c.state}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

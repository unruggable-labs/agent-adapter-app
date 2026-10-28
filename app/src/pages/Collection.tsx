import { ChainTag } from "../components/chains";
import { TileImage, TokenTile } from "../components/collections";
import { Badge, Pager, ProfileSkeleton, Stat } from "../components/ui";
import { api, NotFound } from "../lib/api";
import { useApp, useLive } from "../lib/app-state";
import { explorerAddressUrl, explorerName, STANDARD_NAMES } from "../lib/chain";
import { usePageParam } from "../lib/url";

const PAGE_SIZE = 48;
/** Token bindings only: a collection's agents are its tokens, not its owner or admins. */
const TOKEN_STANDARDS = STANDARD_NAMES.filter((n) => !["ACCOUNT", "CONTRACT_OWNABLE", "CONTRACT_ADMIN"].includes(n));

/**
 * One collection: what it says about itself, then its tokens that are agents, as pictures, newest
 * first. The header is /api/collection; the tokens page through /api/identities?bound=.
 */
export function CollectionPage({ chain, address }: { chain: string; address: string }) {
  const { navigate } = useApp();
  const addr = address.toLowerCase();
  const [page, setPage] = usePageParam();
  const { data: c, status, error } = useLive(() => api.collection(addr, chain), [addr, chain]);
  const { data: tokens } = useLive(
    () => api.identities({ bound: addr, chain: [chain], standard: TOKEN_STANDARDS, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [addr, chain, page],
  );

  if (!c && status === "loading") return <ProfileSkeleton />;
  if (!c)
    return (
      <div className="page">
        <p className="t2">
          {error instanceof NotFound ? "No agents are bound to this contract's tokens (yet)." : "Can't reach the indexer - retrying every few seconds."}{" "}
          <button className="btn btn-ghost" onClick={() => navigate("/collections")}>All collections</button>
        </p>
      </div>
    );

  const explorer = explorerAddressUrl(chain, c.address);
  return (
    <div className="page page-wide fade-in">
      <div className="collection-head">
        <span className="collection-pic"><TileImage image={c.image} seed={c.address} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <h1 className="page-title" style={{ fontSize: 22 }}>{c.name}</h1>
            <ChainTag chain={c.chain} />
            <Badge>{c.standardName}</Badge>
          </div>
          {c.description && <p className="collection-desc">{c.description}</p>}
          <p className="hint" style={{ margin: "6px 0 0" }}>
            <a href={`/address/${c.address}`} onClick={(e) => { e.preventDefault(); navigate(`/address/${c.address}`); }} className="mono">{c.address}</a>
            {c.externalLink && <> · <a href={c.externalLink} target="_blank" rel="noreferrer">Website ↗</a></>}
            {explorer && <> · <a href={explorer} target="_blank" rel="noreferrer">{explorerName(chain)} ↗</a></>}
          </p>
        </div>
      </div>

      <div className="row" style={{ gap: 28, margin: "18px 0 16px" }}>
        <Stat n={c.identities.toLocaleString()} label={c.identities === 1 ? "agent" : "agents"} />
        <Stat n={c.registered.toLocaleString()} label="registered on ERC-8004" />
      </div>

      <div className="tile-grid">
        {tokens ? tokens.items.map((id) => <TokenTile key={id.ubid} id={id} />) : Array.from({ length: 12 }, (_, i) => <div key={i} className="tile is-loading" />)}
      </div>
      {tokens && tokens.total > PAGE_SIZE && (
        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <Pager offset={page * PAGE_SIZE} limit={PAGE_SIZE} total={tokens.total} onChange={(o) => setPage(o / PAGE_SIZE)} />
        </div>
      )}
    </div>
  );
}

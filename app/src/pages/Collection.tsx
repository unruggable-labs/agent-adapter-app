import { useEffect, useState } from "react";
import { ChainTag } from "../components/chains";
import { TileImage, TokenTile } from "../components/collections";
import { Badge, Pager, ProfileSkeleton, Stat } from "../components/ui";
import { api, NotFound } from "../lib/api";
import { useApp, useLive } from "../lib/app-state";
import { explorerAddressUrl, explorerName, STANDARD_NAMES } from "../lib/chain";
import { setSearchParams, usePageParam, useSearchParams } from "../lib/url";

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
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  useEffect(() => setTyped(q), [q, addr, chain]);
  useEffect(() => {
    if (typed.trim() === q) return;
    const timer = setTimeout(() => setSearchParams((p) => {
      if (typed.trim()) p.set("q", typed.trim());
      else p.delete("q");
      p.delete("page");
    }, "replace"), 250);
    return () => clearTimeout(timer);
  }, [typed, q, addr, chain]);
  const { data: c, status, error } = useLive(() => api.collection(addr, chain), [addr, chain]);
  const { data: tokens, status: tokensStatus } = useLive(
    () => api.identities({ bound: addr, chain: [chain], standard: TOKEN_STANDARDS, limit: PAGE_SIZE, offset: page * PAGE_SIZE, q: q || undefined }),
    [addr, chain, page, q],
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

      <div className="row wrap" style={{ gap: 12, marginBottom: 16 }}>
        <input className="input" type="search" aria-label="Search this collection" placeholder="Search by name, token ID or ERC-8004 ID" style={{ maxWidth: 360 }} value={typed} onChange={(e) => setTyped(e.target.value)} />
        {q && <button className="btn btn-ghost btn-sm" onClick={() => setTyped("")}>Clear</button>}
        {q && tokens && <span className="hint" style={{ margin: 0 }}>{tokens.total.toLocaleString()} {tokens.total === 1 ? "match" : "matches"}</span>}
      </div>
      {!tokens && tokensStatus === "error" ? <div className="empty">Can't load this collection's agents. Retrying automatically.</div> : tokens?.total === 0 ? <div className="empty">{q ? "No agents match this search." : "No agents in this collection yet."}</div> : <div className="tile-grid">
        {tokens ? tokens.items.map((id) => <TokenTile key={id.ubid} id={id} />) : Array.from({ length: 12 }, (_, i) => <div key={i} className="tile is-loading" />)}
      </div>}
      {tokens && tokens.total > PAGE_SIZE && (
        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <Pager offset={page * PAGE_SIZE} limit={PAGE_SIZE} total={tokens.total} onChange={(o) => setPage(o / PAGE_SIZE)} />
        </div>
      )}
    </div>
  );
}

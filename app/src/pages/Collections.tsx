import { useEffect, useState } from "react";
import { ChainFilter, useChainParam } from "../components/chains";
import { CollectionTile } from "../components/collections";
import { Pager } from "../components/ui";
import { api } from "../lib/api";
import { useLive } from "../lib/app-state";
import { IS_HUB } from "../lib/chain";
import { setSearchParams, usePageParam, useSearchParams } from "../lib/url";

const PAGE_SIZE = 24;

/**
 * The collections agents are bound to, as pictures: the most agents first, or the newest. A
 * collection is one token contract on one chain. Everything in the URL (?chain, ?sort, ?q, ?page),
 * so a view can be shared.
 */
export function CollectionsPage() {
  const params = useSearchParams();
  const [page, setPage] = usePageParam();
  const chain = useChainParam();
  const sort = params.get("sort") === "newest" ? "newest" : undefined;
  const q = params.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  // The box writes ?q a moment after typing stops, so each key isn't a request.
  useEffect(() => {
    if (typed === q) return;
    const t = setTimeout(() => setSearchParams((p) => {
      if (typed.trim()) p.set("q", typed.trim());
      else p.delete("q");
      p.delete("page");
    }, "replace"), 250);
    return () => clearTimeout(t);
  }, [typed, q]);

  const { data, status } = useLive(
    () => api.collections({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, chain: chain ? [chain] : undefined, sort, q: q || undefined }),
    [page, chain, sort, q],
  );
  const pickSort = (s: "newest" | null) =>
    setSearchParams((p) => {
      if (s) p.set("sort", s);
      else p.delete("sort");
      p.delete("page");
    });

  return (
    <div className="page page-wide fade-in">
      <div className="page-head">
        <h1 className="page-title">Collections</h1>
      </div>
      <p className="page-sub">The collections agents are bound to. Each token can be an agent, with its own profile and reviews.</p>

      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {IS_HUB && <ChainFilter />}
        <div className="seg" role="group" aria-label="Order">
          <button className={!sort ? "active" : ""} onClick={() => pickSort(null)}>Most agents</button>
          <button className={sort === "newest" ? "active" : ""} onClick={() => pickSort("newest")}>Newest</button>
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Name or contract address" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Find a collection" />
      </div>

      {data && data.total === 0 ? (
        <div className="card"><div className="empty">{q ? "No collection matches that." : "No collections yet."}</div></div>
      ) : !data && status === "error" ? (
        <div className="card"><div className="empty">Can't reach the indexer - retrying every few seconds.</div></div>
      ) : (
        <div className="tile-grid">
          {data ? data.items.map((c) => <CollectionTile key={`${c.chain}:${c.address}`} c={c} />) : Array.from({ length: 12 }, (_, i) => <div key={i} className="tile is-loading" />)}
        </div>
      )}
      {data && data.total > PAGE_SIZE && (
        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <Pager offset={page * PAGE_SIZE} limit={PAGE_SIZE} total={data.total} onChange={(o) => setPage(o / PAGE_SIZE)} />
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { api, type SearchHit } from "../lib/api";
import { useApp } from "../lib/app-state";
import { displayName } from "../lib/chain";
import { Avatar, Badge, StandardBadge } from "./ui";

/**
 * The one search box, in the header of every page. It answers the product's question - who is
 * this? - for whatever gets pasted: a wallet address (the mutual-pointing lookup), a UBID or a
 * prefix of one, an ERC-8004 id, or part of a name. The indexer does the matching
 * (/api/search) and says why each hit matched; this box asks, debounced, and shows the answer.
 * Picking a hit opens its page.
 */
export function SearchBar() {
  const { navigate } = useApp();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  // The hits, with the query they answer: a stale answer stays up while the next one is in flight,
  // and "nothing matches" only shows once the answer for the current query has arrived.
  const [result, setResult] = useState<{ q: string; hits: SearchHit[] }>({ q: "", hits: [] });
  const box = useRef<HTMLDivElement | null>(null);

  const query = q.trim();
  useEffect(() => {
    if (!query) {
      setResult({ q: "", hits: [] });
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.search(query).then((r) => !cancelled && setResult({ q: query, hits: r.hits })).catch(() => {});
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const hits = result.hits;
  useEffect(() => setCursor(0), [query]);

  // Click anywhere else closes the menu; the input keeps whatever was typed.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  function pick(h: SearchHit) {
    navigate(h.kind === "address" ? `/address/${h.address}` : `/identity/${h.identity.ubid}`);
    setQ("");
    setOpen(false);
  }

  const answered = result.q === query;
  const showMenu = open && query.length > 0 && (hits.length > 0 || (answered && query.length >= 3));
  const nothing = "Nothing matches. Try a UBID, a name, an address, or an ERC-8004 ID.";

  return (
    <div className="search" ref={box}>
      <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        className="search-input"
        placeholder="Enter a UBID, name, address, or ERC-8004 ID"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && hits[cursor]) pick(hits[cursor]);
        }}
        aria-label="Search"
        aria-expanded={showMenu}
      />
      {showMenu && (
        <div className="search-menu" role="listbox">
          {hits.map((h, i) =>
            h.kind === "address" ? (
              <button
                key={`address-${h.address}`}
                type="button"
                role="option"
                aria-selected={i === cursor}
                className={`search-item${i === cursor ? " is-active" : ""}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(h)}
              >
                <span className="search-item-addr" aria-hidden>@</span>
                <span className="search-item-text">
                  <span className="search-item-ubid mono">{h.address.slice(0, 14)}…{h.address.slice(-6)}</span>
                  <span className="search-item-name t2">Everything for this address: what it is, holds, operates and has said</span>
                </span>
                <Badge tone="outline">address</Badge>
              </button>
            ) : (
              <button
                key={h.identity.ubid}
                type="button"
                role="option"
                aria-selected={i === cursor}
                className={`search-item${i === cursor ? " is-active" : ""}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(h)}
              >
                <Avatar seed={h.identity.ubid} image={h.identity.image} size={24} />
                <span className="search-item-text">
                  <span className="row" style={{ gap: 8 }}>
                    <span className="search-item-ubid mono">{h.identity.ubid.slice(0, 14)}…{h.identity.ubid.slice(-6)}</span>
                    <StandardBadge name={h.identity.standardName} />
                  </span>
                  <span className="search-item-name t2">{displayName(h.identity)}</span>
                </span>
                {h.note && <Badge tone={h.tone ?? "outline"}>{h.note}</Badge>}
              </button>
            ),
          )}
          {hits.length === 0 && answered && query.length >= 3 && <div className="search-empty t2 small">{nothing}</div>}
        </div>
      )}
    </div>
  );
}

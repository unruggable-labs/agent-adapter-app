import { useEffect, useMemo, useRef, useState } from "react";
import { isAddress } from "viem";
import { api, type Identity } from "../lib/api";
import { useApp } from "../lib/app-state";
import { displayName } from "../lib/chain";
import { Avatar, Badge, StandardBadge } from "./ui";

interface Hit {
  id: Identity;
  /** Why this matched, when it isn't obvious from the name. */
  note?: string;
  tone?: string;
}

const MAX = 8;

/**
 * The one search box, in the header of every page. It answers the product's question - who is
 * this? - for whatever gets pasted: a wallet address (the mutual-pointing lookup), a UBID or a
 * prefix of one, an ERC-8004 id, or part of a name. An address also finds what it holds or
 * controls: the NFTs it owns, the contracts it is owner of. Results are the identities themselves;
 * picking one opens its profile.
 */
export function SearchBar() {
  const { identities, navigate } = useApp();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [walletHit, setWalletHit] = useState<Hit | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  const query = q.trim().toLowerCase();
  const asAddress = isAddress(query);

  // Wallet lookups go to the indexer: it holds the reverse index, and the verified flag comes
  // from the mutual-pointing check, not from anything the wallet says about itself.
  useEffect(() => {
    setWalletHit(null);
    if (!asAddress) return;
    let cancelled = false;
    api.wallet(query).then((w) => {
      if (cancelled || !w) return;
      const ubid = w.self?.ubid ?? w.designation?.ubid;
      const id = ubid ? identities.find((i) => i.ubid === ubid) : undefined;
      if (!id) return;
      setWalletHit(
        w.self
          ? { id, note: "this address is the agent", tone: "ok" }
          : { id, note: w.verified ? "operating wallet, verified both ways" : "claims to operate this, not verified", tone: w.verified ? "ok" : "warn" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [query, asAddress, identities.length]);

  const hits = useMemo<Hit[]>(() => {
    if (!query) return [];
    const out: Hit[] = [];
    const seen = new Set<string>();
    const add = (h: Hit) => {
      if (seen.has(h.id.ubid) || out.length >= MAX) return;
      seen.add(h.id.ubid);
      out.push(h);
    };
    if (walletHit) add(walletHit);
    // Prefixes match from the first character, so results appear while a UBID or id is still
    // being typed or right after a paste - not only once it is complete.
    const hex = /^0x[0-9a-f]{1,64}$/.test(query);
    const agentId = /^#?\d+$/.test(query) ? query.replace("#", "") : null;
    for (const id of identities) {
      if (hex && id.ubid.startsWith(query)) add({ id, note: "UBID" });
      else if (asAddress && id.boundAddress === query) add({ id, note: id.standard === 5 ? "this address is the agent" : "bound to this contract" });
      else if (asAddress && id.agentWallet === query) add({ id, note: "operating wallet" });
      else if (asAddress && id.currentControllerHolder === query) add({ id, note: id.standard <= 4 ? "holds the token" : "controls it" });
      else if (agentId) {
        const match = id.agentIds.find((a) => a.startsWith(agentId));
        if (match) add({ id, note: `ERC-8004 #${match}` });
      }
    }
    if (!hex && !asAddress) {
      for (const id of identities) {
        const hay = [displayName(id), id.agentName, id.contractName, id.subjectLabel].filter(Boolean).join(" ").toLowerCase();
        if (hay.includes(query)) add({ id });
      }
    }
    return out;
  }, [query, identities, walletHit, asAddress]);

  useEffect(() => setCursor(0), [query]);

  // Click anywhere else closes the menu; the input keeps whatever was typed.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  function pick(h: Hit) {
    navigate(`/identity/${h.id.ubid}`);
    setQ("");
    setOpen(false);
  }

  const showMenu = open && query.length > 0 && (hits.length > 0 || query.length >= 3);
  const nothing = asAddress
    ? "No agent here. This address is just a number, and nothing vouches for it."
    : "Nothing matches. Try a UBID, a name, an address, or an ERC-8004 ID.";

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
          {hits.map((h, i) => (
            <button
              key={h.id.ubid}
              type="button"
              role="option"
              aria-selected={i === cursor}
              className={`search-item${i === cursor ? " is-active" : ""}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(h)}
            >
              <Avatar seed={h.id.ubid} image={h.id.image} size={24} />
              <span className="search-item-text">
                <span className="row" style={{ gap: 8 }}>
                  <span className="search-item-ubid mono">{h.id.ubid.slice(0, 14)}…{h.id.ubid.slice(-6)}</span>
                  <StandardBadge name={h.id.standardName} />
                </span>
                <span className="search-item-name t2">{displayName(h.id)}</span>
              </span>
              {h.note && <Badge tone={h.tone ?? "outline"}>{h.note}</Badge>}
            </button>
          ))}
          {hits.length === 0 && query.length >= 3 && <div className="search-empty t2 small">{nothing}</div>}
        </div>
      )}
    </div>
  );
}

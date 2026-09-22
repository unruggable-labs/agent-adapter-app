import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Identity } from "../lib/api";
import { controlLine, displayName, scanAgentUrl, shortHex, shortTokenId } from "../lib/chain";

/** The identity's picture: its NFT image (or agent card image) when it has one, else a mark
 *  derived from the UBID - the same identity renders the same face everywhere, forever. An
 *  image that fails to load falls back to the mark rather than a broken frame. */
export function Avatar({ seed, image, size = 26 }: { seed: string; image?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (image && !broken) {
    return <img className="avatar-img" src={image} alt="" width={size} height={size} style={{ width: size, height: size }} onError={() => setBroken(true)} />;
  }
  const a = parseInt(seed.slice(2, 8) || "0", 16);
  const b = parseInt(seed.slice(8, 14) || "0", 16);
  const h1 = a % 360;
  const h2 = (h1 + 50 + (b % 90)) % 360;
  const angle = (a + b) % 360;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "38%",
        flexShrink: 0,
        display: "inline-block",
        background: `linear-gradient(${angle}deg, hsl(${h1} 72% 58%), hsl(${h2} 70% 42%))`,
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
      }}
    />
  );
}

/**
 * Hover tooltip. Fixed-position so it never clips inside scroll containers, and measured after
 * render so it can stay on screen: it flips below the trigger when there isn't room above, and
 * its centre is clamped to the viewport so a pill near an edge doesn't push the bubble off it.
 */
export function Tip({ tip, children }: { tip: string; children: ReactNode }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const bubble = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !bubble.current) {
      setPos(null);
      return;
    }
    const GAP = 8;
    const b = bubble.current.getBoundingClientRect();
    // Above by default; below when the bubble wouldn't fit between the trigger and the top.
    const fitsAbove = anchor.top >= b.height + GAP;
    const top = fitsAbove ? anchor.top - GAP - b.height : anchor.bottom + GAP;
    // `left` is the bubble's centre (it is translated -50%), so clamp by half its width.
    const half = b.width / 2;
    const centre = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(centre, GAP + half), window.innerWidth - GAP - half);
    setPos({ left, top });
  }, [anchor, tip]);

  return (
    <span
      style={{ display: "inline-flex", cursor: "help" }}
      onMouseEnter={(e) => setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())}
      onMouseLeave={() => setAnchor(null)}
    >
      {children}
      {anchor && (
        <span
          ref={bubble}
          className="tip-bubble"
          // Rendered off-view for one frame so it can be measured before being placed.
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
        >
          {tip}
        </span>
      )}
    </span>
  );
}

export function Badge({ tone = "", tip, children }: { tone?: string; tip?: string; children: ReactNode }) {
  const badge = <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{children}</span>;
  return tip ? <Tip tip={tip}>{badge}</Tip> : badge;
}

export function Addr({ value, n = 10 }: { value: string; n?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="addr"
      title={value}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 900);
      }}
    >
      {copied ? "copied" : shortHex(value, n)}
    </button>
  );
}

/** How an identity exists, at a glance. */
export type Registration = "onchain" | "claim" | "none";

export function registrationOf(id: Identity): Registration {
  return id.agentIds.length ? "onchain" : id.claimed ? "claim" : "none";
}

const REGISTRATION_TIP: Record<Registration, string> = {
  onchain: "On-chain: an ERC-8004 agent is minted on the shared registry for this identity.",
  claim: "Counterfactual: claimed in the event log only, nothing minted. Same UBID either way.",
  none: "Unclaimed: this identity exists only because other events reference it.",
};

/** A small mark for the registration state: a solid chain link for on-chain, a dashed ring
 *  for a counterfactual claim, a faint dotted ring for unclaimed. Same everywhere it appears. */
export function RegistrationMark({ r }: { r: Registration }) {
  return (
    <Tip tip={REGISTRATION_TIP[r]}>
      <svg className={`reg-mark reg-${r}`} viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-label={REGISTRATION_TIP[r]}>
        {r === "onchain" ? (
          <>
            <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.9.9" />
            <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.9-.9" />
          </>
        ) : (
          <circle cx="8" cy="8" r="5.5" strokeDasharray={r === "claim" ? "3 2.4" : "1 2.6"} />
        )}
      </svg>
    </Tip>
  );
}

/** A UBID as a table cell: the identity's picture, its registration mark, and its short hash. */
export function UbidCell({ ubid, image, registration }: { ubid: string; image?: string | null; registration?: Registration }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <Avatar seed={ubid} image={image} size={28} />
      {registration && <RegistrationMark r={registration} />}
      <span className="mono t2">{shortHex(ubid, 10)}</span>
    </span>
  );
}

/** One hue per controller standard, the same everywhere a standard is named. */
export const STANDARD_HUE: Record<string, string> = {
  ERC721: "blue",
  ERC1155: "pink",
  ERC6909: "orange",
  ERC1155F: "rose",
  ERC6909F: "lime",
  ACCOUNT: "slate",
  CONTRACT_OWNABLE: "violet",
  CONTRACT_ADMIN: "cyan",
};

/** One hue per attestation type, and the plain word the app uses for it. */
export const TYPE_HUE: Record<string, string> = {
  CONFIRM_ACCOUNT: "teal",
  STAR: "amber",
  RATING: "indigo",
  REVIEW: "sky",
  INTERACTION: "emerald",
};
export const TYPE_LABEL: Record<string, string> = {
  CONFIRM_ACCOUNT: "confirm account",
  STAR: "star",
  RATING: "rating",
  REVIEW: "review",
  INTERACTION: "transaction",
};

/** The standard pill. Given an identity it explains the control relationship on hover;
 *  given just a name it is the bare pill. */
export function StandardBadge({ id, name }: { id?: Identity; name?: string }) {
  const standard = id?.standardName ?? name ?? "";
  const badge = <span className={`badge badge-hue-${STANDARD_HUE[standard] ?? "slate"}`}>{standard}</span>;
  return id ? <Tip tip={`This identity is ${controlLine(id)}.`}>{badge}</Tip> : badge;
}

/** The attestation-type pill, in the type's hue. */
export function TypeBadge({ name }: { name: string }) {
  return <span className={`badge badge-hue-${TYPE_HUE[name] ?? "slate"}`}>{TYPE_LABEL[name] ?? name}</span>;
}

/** What controls an identity, as a table cell: the collection or account (its name when it has
 *  one, else the address) and the token id for token standards. */
export function ControllerCell({ id }: { id: Identity }) {
  const stripped = (id.agentName ?? displayName(id)).replace(/ #\S+$/u, "");
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      {/^(0x|Account 0x)/.test(stripped)
        ? <Addr value={id.boundAddress} n={8} />
        : <span style={{ fontWeight: 600 }}>{stripped}</span>}
      {id.standard < 5 && <span className="num t3 small">#{shortTokenId(id.tokenId)}</span>}
    </span>
  );
}

export function Stat({ n, label }: { n: ReactNode; label: string }) {
  return (
    <div className="stat">
      <div className="stat-n">{n}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

export function Section({ label, children, actions }: { label: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 10 }}>
        <div className="section-label" style={{ margin: 0 }}>{label}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** An identity's ERC-8004 agent ids, each linking out to its 8004Scan page in a new tab. Plain
 *  text on a network 8004Scan doesn't index. Clicks stop at the link so a clickable table row
 *  underneath doesn't also navigate. */
export function AgentIds({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((agentId, i) => {
        const url = scanAgentUrl(agentId);
        return (
          <span key={agentId}>
            {i > 0 && ", "}
            {url ? (
              <a className="agent-link" href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                #{agentId}
              </a>
            ) : (
              <>#{agentId}</>
            )}
          </span>
        );
      })}
    </>
  );
}

export function StatusBadge({ id }: { id: Identity }) {
  if (id.agentIds.length)
    return (
      <Badge tone="ok" tip={`Fully registered: a real agent was minted on the shared ERC-8004 registry with id #${id.agentIds.join(", #")}. Click the id to open it on 8004Scan.`}>
        <span className="dot" /> ERC-8004 <AgentIds ids={id.agentIds} />
      </Badge>
    );
  if (id.claimed)
    return (
      <Badge tone="accent" tip="Claimed counterfactually: the identity lives in the event log only - one cheap transaction, nothing minted. Registering fully later keeps the same UBID and history.">
        <span className="dot" /> claim only
      </Badge>
    );
  return (
    <Badge tone="outline" tip="No registration claim yet - this identity exists only because other events (attestations or field updates) reference it.">
      unclaimed
    </Badge>
  );
}

/**
 * A multi-select dropdown. The trigger reads as a select and summarises the choice; opening it
 * unfolds a checklist in flow, so it works inside a scrolling dialog without being clipped.
 * An empty selection means "no filter" and the caller words that via `placeholder`.
 */
export function MultiSelect<T extends string>({
  options,
  values,
  onChange,
  placeholder,
  render,
}: {
  options: T[];
  values: T[];
  onChange: (next: T[]) => void;
  placeholder: string;
  /** How one option looks, in the list and in the summary. Defaults to the plain value. */
  render?: (v: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const show = render ?? ((v: T) => v);
  const toggle = (v: T) => onChange(values.includes(v) ? values.filter((x) => x !== v) : options.filter((o) => o === v || values.includes(o)));
  return (
    <div className={`ms${open ? " is-open" : ""}`}>
      <button type="button" className="select ms-trigger" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="row wrap" style={{ gap: 4, minWidth: 0 }}>
          {values.length === 0 ? <span className="t3">{placeholder}</span> : values.map((v) => <span key={v}>{show(v)}</span>)}
        </span>
        <span className="ms-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="ms-list" role="listbox" aria-multiselectable>
          {options.map((o) => {
            const on = values.includes(o);
            return (
              <label key={o} className={`ms-option${on ? " is-on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(o)} />
                {show(o)}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A centred dialog for a task that would crowd the page it belongs to. Escape and a backdrop
 *  click both close it; the caller owns the open state. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal fade-in" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row spread" style={{ marginBottom: 14 }}>
          <h2 className="h-section" style={{ margin: 0 }}>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Callout({ tone = "", title, children }: { tone?: string; title?: string; children: ReactNode }) {
  return (
    <div className={`callout ${tone ? `callout-${tone}` : ""}`}>
      {title && <b>{title}</b>} {children}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" />;
}

/** A grey bar standing in for text that hasn't arrived. A bare number is a percentage, so a row
 *  of these keeps the real column rhythm and the table doesn't jump when the data lands.
 *  `size` renders the square-ish avatar placeholder instead of a text bar. */
export function Skeleton({ w = "100%", size }: { w?: number | string; size?: number }) {
  const style = size
    ? { width: size, height: size, borderRadius: "38%" }
    : { width: typeof w === "number" ? `${w}%` : w };
  return <span className="skel" style={style} />;
}

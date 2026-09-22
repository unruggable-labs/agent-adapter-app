import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Identity, TrustBase } from "../lib/api";
import { controlLine, displayName, scanAgentUrl, shortHex, shortTokenId } from "../lib/chain";

/** Deterministic identity mark derived from the UBID - imagery that means something:
 *  the same identity renders the same face everywhere, forever. */
export function Avatar({ seed, size = 26 }: { seed: string; size?: number }) {
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

/** A UBID as a table cell: the identity's mark and its short hash. */
export function UbidCell({ ubid }: { ubid: string }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <Avatar seed={ubid} size={20} />
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
 * Every trust signal the app can show, defined once. The identity page's header pill and
 * banners and the create wizard's callout all render from this list, so a signal can never
 * look or read one way in one place and another way elsewhere.
 */
export type SignalKey =
  | "ownerless"
  | "ruggable"
  | "upgradeable"
  | "burnable"
  | "delegated"
  | "solid"
  | "eoa";

/**
 * How a signal was established, because they are not equally trustworthy and saying so is part
 * of the disclosure. `trustbase.ts` states that "every consumer-facing surface labels the
 * heuristics as such" - this field is how that promise is kept.
 *
 *  - "log"       replayed from the event log; exact
 *  - "chain"     read from chain state at request time; exact, but only true right now
 *  - "heuristic" a 4-byte selector was (or was not) found by scanning deployed bytecode;
 *                misses non-standard dispatch, and can trip on ordinary data bytes
 */
export type Detection = "log" | "chain" | "heuristic";

export const DETECTION_NOTE: Record<Detection, string> = {
  log: "Established by replaying the event log - exact.",
  chain: "Read from the chain when this page loaded - true as of now, and it can change.",
  heuristic:
    "Detected by scanning the contract's bytecode for known function selectors. This is a guess: a contract using non-standard dispatch can hide a capability, and ordinary data bytes can occasionally look like one.",
};

export interface SignalSpec {
  key: SignalKey;
  label: string;
  tone: string;
  /** The pill's tooltip, and the banner's body. One source, so the two can't drift. */
  meaning: string;
  /** How it was established. Rendered next to the signal wherever it is explained. */
  detection: Detection;
  /** Reassuring/neutral signals are listed apart from the warnings on /how. */
  reassuring?: boolean;
}

export const SIGNALS: SignalSpec[] = [
  {
    key: "ownerless",
    label: "ownerless",
    tone: "ownerless",
    detection: "chain",
    meaning:
      "The bound token currently has no owner (ownerOf reverts or is zero), so the collection contract temporarily holds authority over this identity.",
  },
  {
    key: "ruggable",
    label: "ruggable trust base",
    tone: "ruggable",
    detection: "heuristic",
    meaning:
      "A burn function and an outbound-call surface both appear in the collection's bytecode - together those would let it seize a bound identity without the owner acting.",
  },
  {
    key: "upgradeable",
    label: "upgradeable trust base",
    tone: "upgradeable",
    detection: "chain",
    meaning:
      "The collection is an upgradeable proxy - an EIP-1967 implementation or beacon slot is set.",
  },
  {
    key: "burnable",
    label: "burnable",
    tone: "burnable",
    detection: "heuristic",
    meaning:
      "A burn function appears in the collection's bytecode, and destroying a token reopens the collection's authority window over the identity.",
  },
  {
    key: "delegated",
    label: "7702-delegated EOA",
    tone: "delegated",
    detection: "chain",
    meaning:
      "This address is an EOA with an EIP-7702 delegation installed - anyone who can drive its delegate contract can act for the identity, not just the key holder.",
  },
  {
    key: "solid",
    label: "solid trust base",
    tone: "ok",
    detection: "heuristic",
    meaning:
      "No burn function or outbound-call surface was found in the bytecode, and it is not a proxy.",
    reassuring: true,
  },
  {
    key: "eoa",
    label: "EOA",
    tone: "outline",
    detection: "chain",
    meaning: "A plain externally-owned account - no code at the address.",
    reassuring: true,
  },
];

const BY_KEY = Object.fromEntries(SIGNALS.map((s) => [s.key, s])) as Record<SignalKey, SignalSpec>;

/** Callout severity for a signal, for the surfaces that show these as banners rather than pills. */
const SEVERITY: Record<SignalKey, string> = {
  ruggable: "danger",
  ownerless: "warn",
  upgradeable: "warn",
  burnable: "warn",
  delegated: "warn",
  solid: "ok",
  eoa: "",
};

/** The one way to render a signal pill, anywhere in the app. A heuristic signal always carries
 *  its caveat in the tooltip - the pill can appear far from anything that explains it. */
export function Signal({ k }: { k: SignalKey }) {
  const s = BY_KEY[k];
  return <Badge tone={s.tone} tip={signalTip(k)}>{s.label}</Badge>;
}

/** The same wording as the pill, as a banner - for pages with room to state it outright. */
export function SignalCallout({ k }: { k: SignalKey }) {
  const s = BY_KEY[k];
  return (
    <Callout tone={SEVERITY[k]} title={`${s.label}.`}>
      {s.meaning}
      {s.detection === "heuristic" && <span className="t3"> {DETECTION_NOTE.heuristic}</span>}
    </Callout>
  );
}

/** True for signals that mean "nothing to worry about here". */
export function isReassuringSignal(k: SignalKey): boolean {
  return Boolean(BY_KEY[k].reassuring);
}

export function signalTip(k: SignalKey): string {
  const s = BY_KEY[k];
  return s.detection === "heuristic" ? `${s.meaning}\n\n${DETECTION_NOTE.heuristic}` : s.meaning;
}

/** Which trust-base signal a probe result maps to. One verdict yields at most one pill. */
export function trustSignal(t: TrustBase | null): SignalKey | null {
  if (!t) return null;
  if (t.verdict === "eoa") return t.delegated7702 ? "delegated" : "eoa";
  if (t.verdict === "ruggable") return "ruggable";
  if (t.verdict === "unstable") return "upgradeable";
  if (t.verdict === "burnable") return "burnable";
  return "solid";
}

/**
 * Every signal that applies to one identity, in severity order. The single place that decides
 * what applies, so a signal cannot appear on one surface and be missing from another.
 * `compact` drops the reassuring ones, for places where only warnings earn space.
 */
export function signalsFor(id: Identity, { compact = false }: { compact?: boolean } = {}): SignalKey[] {
  const keys: SignalKey[] = [];
  if (id.flags.currentlyOwnerless) keys.push("ownerless");
  const trust = trustSignal(id.trustBase);
  if (trust) keys.push(trust);
  return compact ? keys.filter((k) => !BY_KEY[k].reassuring) : keys;
}

export function TrustBadge({ t, compact = false }: { t: TrustBase | null; compact?: boolean }) {
  const k = trustSignal(t);
  if (!k || (compact && BY_KEY[k].reassuring)) return null;
  return <Signal k={k} />;
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

import { useState, type ReactNode } from "react";
import type { Identity, TrustBase } from "../lib/api";
import { shortHex } from "../lib/chain";

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

/** Hover tooltip. Fixed-position so it never clips inside scroll containers. */
export function Tip({ tip, children }: { tip: string; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      style={{ display: "inline-flex", cursor: "help" }}
      onMouseEnter={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.top });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <span className="tip-bubble" style={{ left: pos.x, top: pos.y }}>
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

export function StatusBadge({ id }: { id: Identity }) {
  if (id.agentIds.length)
    return (
      <Badge tone="ok" tip={`Fully registered: a real agent was minted on the shared ERC-8004 registry with id #${id.agentIds.join(", #")}.`}>
        <span className="dot" /> ERC-8004 #{id.agentIds.join(",")}
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

export function TrustBadge({ t, compact = false }: { t: TrustBase | null; compact?: boolean }) {
  if (!t) return null;
  if (t.verdict === "eoa")
    return t.delegated7702
      ? <Badge tone="delegated" tip="This address is an EOA with an EIP-7702 delegation installed - anyone who can drive its delegate contract can act for the identity, not just the key holder.">7702-delegated EOA</Badge>
      : compact ? null : <Badge tone="outline" tip="A plain externally-owned account: authority is key possession, nothing else.">EOA</Badge>;
  if (t.verdict === "ruggable") return <Badge tone="ruggable" tip="The collection's code can burn tokens AND make outbound calls - it could seize a bound identity without the owner acting. Binding here adopts that rule.">ruggable trust base</Badge>;
  if (t.verdict === "unstable") return <Badge tone="upgradeable" tip="The collection is an upgradeable proxy: today's code proves nothing about tomorrow's rules.">upgradeable trust base</Badge>;
  if (t.verdict === "burnable") return <Badge tone="burnable" tip="Tokens in this collection can be destroyed, which reopens the collection's authority window over the identity. No outbound-call surface was detected, so the risk is residual.">burnable</Badge>;
  return compact ? null : <Badge tone="ok" tip="No burn function, no arbitrary-call surface, not a proxy - the deed's rules can't change out from under the owner.">solid trust base</Badge>;
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

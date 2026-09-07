import { useState, type ReactNode } from "react";
import type { Identity, TrustBase } from "../lib/api";
import { shortHex } from "../lib/chain";

/** Deterministic identity mark derived from the UBID — imagery that means something:
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

export function Badge({ tone = "", children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{children}</span>;
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
  if (id.agentIds.length) return <Badge tone="ok"><span className="dot" /> registered #{id.agentIds.join(",")}</Badge>;
  if (id.claimed) return <Badge tone="accent"><span className="dot" /> counterfactual</Badge>;
  return <Badge tone="outline">unclaimed</Badge>;
}

export function TrustBadge({ t, compact = false }: { t: TrustBase | null; compact?: boolean }) {
  if (!t) return null;
  if (t.verdict === "eoa")
    return t.delegated7702 ? <Badge tone="warn">7702-delegated EOA</Badge> : compact ? null : <Badge tone="outline">EOA</Badge>;
  if (t.verdict === "ruggable") return <Badge tone="danger">ruggable trust base</Badge>;
  if (t.verdict === "unstable") return <Badge tone="warn">upgradeable trust base</Badge>;
  if (t.verdict === "burnable") return <Badge tone="warn">burnable</Badge>;
  return compact ? null : <Badge tone="ok">solid trust base</Badge>;
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

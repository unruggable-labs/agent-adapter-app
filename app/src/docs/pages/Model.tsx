import type { ReactNode } from "react";

type PartKey = "agent" | "profile" | "controller" | "wallet";

interface Part {
  name: string;
  what: string;
  icon: ReactNode;
  body: ReactNode;
  demo: ReactNode;
  more: { href: string; label: string };
}

const PARTS: Record<PartKey, Part> = {
  agent: {
    name: "The agent",
    what: "Software, off-chain",
    icon: <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 4V2M15 4V2M9 22v-2M15 22v-2M4 9H2M4 15H2M22 9h-2M22 15h-2" /></>,
    body: <>The agent's underlying software, running on a server somewhere. The profile points to it.</>,
    demo: <>PunkBot, running on somebody's server.</>,
    more: { href: "#/reputation", label: "What people say about it" },
  },
  profile: {
    name: "The profile",
    what: "What people look up",
    icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M5.8 16c.7-1.3 1.8-2 3.2-2s2.5.7 3.2 2M15 10h4M15 13.5h3" /></>,
    body: <>Contains details about an agent - its name, description, operating wallet, and <b>reputation</b>. The agent and its profile are identified by a unique identifier, the UBID.</>,
    demo: <>PunkBot's profile shows its ratings and reviews, and points to where you can interact with it.</>,
    more: { href: "#/identities", label: "Identities and UBIDs" },
  },
  controller: {
    name: "The controller",
    what: "What controls the profile",
    icon: <><circle cx="15" cy="9" r="3.5" /><path d="M12.5 11.5L4 20M7 17l2 2M9.5 14.5l2 2" /></>,
    body: <>The token, contract, or address the profile is bound to. Whoever holds it can update the profile. The controller is the thing; the <b>holder</b> is whoever controls that thing right now.</>,
    demo: <>The NFT DemoPunks #7. Alice holds it today, so Alice is who can change the profile.</>,
    more: { href: "#/standards", label: "Controllers and standards" },
  },
  wallet: {
    name: "The operating wallet",
    what: "The key the agent signs with",
    icon: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10.5h18" /><circle cx="17" cy="14.8" r="1.2" /></>,
    body: <>The key the agent actually signs transactions with. It can be a hot wallet, is easily replaceable, and it holds <b>no inherent authority</b> over the profile.</>,
    demo: <>The wallet PunkBot signs transactions with.</>,
    more: { href: "#/wallets", label: "Operating wallets" },
  },
};

const isPartKey = (v: string | undefined): v is PartKey => !!v && v in PARTS;

/** The mental model behind everything else. The selection lives in the hash (#/model/<part>). */
export function Model({ part: routePart }: { part?: string }) {
  const sel: PartKey = isPartKey(routePart) ? routePart : "profile";
  const setSel = (k: PartKey) => (location.hash = `#/model/${k}`);
  const part = PARTS[sel];
  const on = (...keys: PartKey[]) => (keys.includes(sel) ? " is-on" : "");

  return (
    <div className="how-page">
      <h1 className="page-title">Agent identity</h1>
      <p className="page-sub">
        Adapterscan is profiles and reviews for AI agents: the wallets agents do business with get a lookup -
        who operates this, and are they any good? Four parts make that work. Click one.
      </p>

      <div className="model">
        <div className="model-grid">
          <Node k="agent" sel={sel} onPick={setSel} at="agent" tag="off-chain" />
          <div className={`stem${on("agent", "profile")}`} />
          <Node k="controller" sel={sel} onPick={setSel} at="1" />
          <Edge label="controls" active={sel === "controller" || sel === "profile"} at="2" />
          <Node k="profile" sel={sel} onPick={setSel} at="3" />
          <Edge label="signs from" active={sel === "profile" || sel === "wallet"} at="4" />
          <Node k="wallet" sel={sel} onPick={setSel} at="5" />
        </div>
      </div>

      <div className="model-detail fade-in" key={sel}>
        <div className="row wrap" style={{ gap: 10, alignItems: "baseline" }}>
          <span className="model-detail-name">{part.name}</span>
          <span className="model-detail-what">{part.what}</span>
        </div>
        <p style={{ margin: "9px 0 0", fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>{part.body}</p>
        <p className="hint" style={{ margin: "10px 0 0" }}><b>As an example:</b> {part.demo}</p>
        <p style={{ margin: "12px 0 0", fontSize: 13 }}><a href={part.more.href}>{part.more.label} →</a></p>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <h2 className="h-section">Why an adapter at all</h2>
        <p style={{ marginTop: 0 }}>
          ERC-8004 gives agents an on-chain identity record, but it ties each record to a single ERC-721-style
          owner. Most things people would want to give an identity to don't fit that shape: an NFT in an
          existing collection, a token with many holders, a contract, a plain address. The adapter sits in
          front of the registry and lets any of those be the controller, while the registry's own rules stay
          intact.
        </p>
        <p style={{ marginBottom: 0 }}>
          It also lets an identity exist before anything is minted. A <a href="#/counterfactual">counterfactual
          claim</a> is one cheap transaction that emits an event; the identity, its reputation and its wallet
          link all attach to a hash that is the same whether or not a full registration ever happens.
        </p>
      </div>
    </div>
  );
}

function Node({ k, sel, onPick, at, tag }: { k: PartKey; sel: PartKey; onPick: (k: PartKey) => void; at: string; tag?: string }) {
  const p = PARTS[k];
  const active = sel === k;
  return (
    <button type="button" aria-pressed={active} className={`node at-${at}${active ? " is-on" : ""}`} onClick={() => onPick(k)}>
      <span className="node-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{p.icon}</svg>
      </span>
      <span>
        <span className="node-label">{p.name}</span>
        {tag && <span className="node-tag">{tag}</span>}
      </span>
    </button>
  );
}

function Edge({ label, active, at }: { label: string; active: boolean; at: string }) {
  return (
    <span className={`edge at-${at}${active ? " is-on" : ""}`} aria-hidden>
      <span className="edge-label">{label}</span>
      <svg className="edge-arrow" viewBox="0 0 40 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4h36M34 1l3 3-3 3" /></svg>
    </span>
  );
}

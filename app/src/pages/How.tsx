import type { ReactNode } from "react";
import { Badge, DETECTION_NOTE, Signal, SIGNALS, type Detection } from "../components/ui";
import { useApp } from "../lib/app-state";

/** Short badge shown after each legend entry; the full wording is in DETECTION_NOTE. */
const DETECTION_LABEL: Record<Detection, string> = {
  log: "from the event log",
  chain: "read from chain",
  heuristic: "heuristic - may be wrong",
};

type PartKey = "agent" | "profile" | "controller" | "wallet";

interface Part {
  name: string;
  what: string;
  icon: ReactNode;
  body: ReactNode;
  demo: ReactNode;
}

const PARTS: Record<PartKey, Part> = {
  agent: {
    name: "The agent",
    what: "Software, off-chain",
    icon: <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 4V2M15 4V2M9 22v-2M15 22v-2M4 9H2M4 15H2M22 9h-2M22 15h-2" /></>,
    body: (
      <>
        The agent's underlying software - running on a server somewhere. The profile
        points to it.
      </>
    ),
    demo: <>PunkBot, running on somebody's server.</>,
  },
  profile: {
    name: "The profile",
    what: "What people look up",
    icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M5.8 16c.7-1.3 1.8-2 3.2-2s2.5.7 3.2 2M15 10h4M15 13.5h3" /></>,
    body: (
      <>
        Contains details about an agent - its name, description, operating wallet, and <b>reputation</b>. The agent and its associated profile is identified by a unique identifier - the UBID.
      </>
    ),
    demo: <>PunkBot's profile outlines it ratings, and reviews. It directs the reader to the off-chain location where one can interact with the agent.</>,
  },
  controller: {
    name: "The controller",
    what: "What controls the profile",
    icon: <><circle cx="15" cy="9" r="3.5" /><path d="M12.5 11.5L4 20M7 17l2 2M9.5 14.5l2 2" /></>,
    body: (
      <>
        The token, contract, or address the profile is bound to. Whoever holds it can update the
        profile. The controller is the thing; the <b>holder</b> is whoever controls that thing
        right now.
      </>
    ),
    demo: <>The NFT DemoPunks #7. Alice holds it today, so Alice is who can change the profile.</>,
  },
  wallet: {
    name: "The operating wallet",
    what: "The key the agent signs with",
    icon: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10.5h18" /><circle cx="17" cy="14.8" r="1.2" /></>,
    body: (
      <>
        The key the agent actually signs transactions with. It can be a hot wallet, is easily replaceable, and
        it holds <b>no inherent authority</b> over the profile.
      </>
    ),
    demo: <>The wallet PunkBot signs transactions with.</>,
  },
};

const isPartKey = (v: string | undefined): v is PartKey => !!v && v in PARTS;

/**
 * The mental model behind every other page, in the order the questions actually come up.
 *
 * The selection lives in the URL (`/how/<part>`) rather than in component state, so a reload
 * restores it, back and forward step through it, and a link can point at one component.
 * An unknown or missing part falls back to the profile - the centre of the model.
 */
export function HowPage({ part: routePart }: { part?: string }) {
  const { navigate } = useApp();
  const sel: PartKey = isPartKey(routePart) ? routePart : "profile";
  const setSel = (k: PartKey) => navigate(`/how/${k}`);
  const part = PARTS[sel];

  const on = (...keys: PartKey[]) => (keys.includes(sel) ? " is-on" : "");

  return (
    <div className="page fade-in how-page">
      <h1 className="page-title">Agent identity</h1>
      <p className="page-sub">
        There are four important components involved in agent identity. Click an item in the
        flowchart to find out more.
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
        <p className="hint" style={{ margin: "10px 0 0" }}>
          <b>As an example:</b> {part.demo}
        </p>
      </div>

      <div className="stack" style={{ marginTop: 22 }} key={`s-${sel}`}>
        <Block title="Controller types" show={sel === "controller"}>
          <table className="table">
            <thead><tr><th>Type</th><th>Holder</th><th>Character</th></tr></thead>
            <tbody>
              <tr><td><Badge tone="outline">ERC721 / 1155 / 6909</Badge></td><td>whoever owns the token</td><td>transferable - the agent is a sellable asset</td></tr>
              <tr><td><Badge tone="outline">ACCOUNT</Badge></td><td>the address itself, and nothing else</td><td>permanent - no token, nothing to sell or lose</td></tr>
              <tr><td><Badge tone="outline">CONTRACT_OWNABLE</Badge></td><td>the contract's current <span className="mono">owner()</span></td><td>follows ownership transfers of the contract</td></tr>
              <tr><td><Badge tone="outline">CONTRACT_ADMIN</Badge></td><td>holders of the contract's admin role</td><td>for AccessControl contracts with no owner()</td></tr>
            </tbody>
          </table>
        </Block>

        <Block title="Universal Binding Identifiers" show={sel === "profile"}>
          <p style={{ marginTop: 0 }}>
            A UBID is <b>deterministically derived</b>, not issued - it is a hash of the controller's coordinates.
            So a 10,000-token collection already has 10,000 profiles, computable offline, without
            a single transaction ever being sent. Reviews and attestations can be associated with a UBID <b>without</b> any up front on-chain registration.
          </p>

          <p style={{ marginTop: 0 }}>
            A <b>counterfactual</b> registration transaction does basic validation, and emits an event. The cost of such a transaction is minimal because there are no external calls to other contracts, nor is anything stored in on-chain storage. 
          </p>


          <table className="table compare">
            <thead>
              <tr>
                <th />
                <th>Untouched</th>
                <th>Claimed <span className="t3">(counterfactual)</span></th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Costs</th>
                <td>nothing</td>
                <td>one cheap transaction</td>
                <td>one transaction</td>
              </tr>
              <tr>
                <th scope="row">Has a UBID</th>
                <td><b>yes</b> - derivable by anyone</td>
                <td><b>yes</b> - the same one</td>
                <td><b>yes</b> - the same one</td>
              </tr>
              <tr>
                <th scope="row">Can receive reviews</th>
                <td><b>yes</b></td>
                <td><b>yes</b></td>
                <td><b>yes</b></td>
              </tr>
              <tr>
                <th scope="row">Can set its own URI and wallet</th>
                <td>no</td>
                <td>yes</td>
                <td>yes</td>
              </tr>
              <tr>
                <th scope="row">Stored in</th>
                <td>nowhere</td>
                <td>the event log</td>
                <td>the adapter's storage</td>
              </tr>
              <tr>
                <th scope="row">Registrations</th>
                <td>none</td>
                <td>none</td>
                <td>ERC-8004</td>
              </tr>
            </tbody>
          </table>

          <div className="converge">
            <div className="converge-in">
              <span className="chip">Untouched</span>
              <span className="chip">Claimed</span>
              <span className="chip">Registered</span>
            </div>
            <svg className="converge-join" viewBox="0 0 56 72" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M0 12 C 22 12, 20 36, 40 36" />
              <path d="M0 36 H 40" />
              <path d="M0 60 C 22 60, 20 36, 40 36" />
              <path d="M37 33l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="converge-out">
              <span className="converge-out-label">the same UBID throughout</span>
              <span className="mono t2 converge-hash">0x989abafdb21e6029…9eb199fcb9</span>
            </div>
          </div>
        </Block>

        <Block title="Why the wallet link takes two steps" show={sel === "wallet"}>
          <ul className="claim-list">
            <li>
              A profile saying <b>"my operating wallet is X"</b> is a claim by whoever controls
              the profile - it needed no permission from X.
            </li>
            <li>
              A wallet saying <b>"I work for agent Y"</b> is a claim by that wallet - it needed
              no permission from Y.
            </li>
          </ul>
          <p>
            Either alone is trivially faked: a scam agent can name a famous wallet, a random
            wallet can claim that it is associated with a famous agent.
          </p>
          <p style={{ marginBottom: 0 }}>
            Verification requires <b>both statements from both signers</b>. This holds however
            the profile exists - claimed or registered, the wallet link is the same two
            statements, because the link is made against the profile's coordinates rather than
            any registration.
          </p>
        </Block>

        <Block title="Reputation" show={sel === "profile"}>
          <p style={{ marginTop: 0 }}>
            Anyone can attest to the reputation of an agent using its UBID.
          </p>
          <div className="attest-grid">
            <Attest
              label="Star"
              rule="Counted"
              icon={<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8-4.2-4.1 5.9-.9z" />}
            >
              A cheap thumbs up.
            </Attest>
            <Attest
              label="Rating"
              rule="Averaged per attester"
              icon={<><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4.5-5" strokeLinecap="round" /></>}
            >
              A numerical rating from 0-100.
            </Attest>
            <Attest
              label="Review"
              rule="Accumulated"
              icon={<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />}
            >
              A freeform text review.
            </Attest>
            <Attest
              label="Transaction"
              rule="Accumulated"
              icon={<><path d="M4 8h13M14 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 16H7M10 13l-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" /></>}
            >
              A scored record pointing at the transaction.
            </Attest>
          </div>
        </Block>

        <Block title="Signals you'll see on a profile" show={sel === "controller"}>
          <div className="section-label legend-head">The good ones</div>
          <SignalLegend reassuring />

          <div className="section-label legend-head">The less good ones</div>
          <SignalLegend />
        </Block>
      </div>
    </div>
  );
}

/** One selectable box in the diagram. Placement lives in CSS (`at-*`), not inline styles, so the
 *  narrow-viewport media query can re-flow the grid into a single column. */
function Node({
  k,
  sel,
  onPick,
  at,
  tag,
}: {
  k: PartKey;
  sel: PartKey;
  onPick: (k: PartKey) => void;
  at: string;
  tag?: string;
}) {
  const p = PARTS[k];
  const active = sel === k;
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`node at-${at}${active ? " is-on" : ""}`}
      onClick={() => onPick(k)}
    >
      <span className="node-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {p.icon}
        </svg>
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
      <svg className="edge-arrow" viewBox="0 0 40 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 4h36M34 1l3 3-3 3" />
      </svg>
    </span>
  );
}

/** The signal legend, split by whether a signal is reassuring. Each entry renders the real
 *  `Signal` pill plus how it was established, so the page can't drift from the table. */
function SignalLegend({ reassuring = false }: { reassuring?: boolean }) {
  return (
    <dl className="legend">
      {SIGNALS.filter((s) => Boolean(s.reassuring) === reassuring).map((s) => (
        <div key={s.key} className="legend-row">
          <dt><Signal k={s.key} /></dt>
          <dd>
            {s.meaning}{" "}
            <span className={`how-known how-known-${s.detection}`} title={DETECTION_NOTE[s.detection]}>
              {DETECTION_LABEL[s.detection]}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One kind of attestation, with the rule for how many of them add up to a score. */
function Attest({
  label,
  rule,
  icon,
  children,
}: {
  label: string;
  rule: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="attest">
      <span className="attest-head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          {icon}
        </svg>
        <b>{label}</b>
      </span>
      <span className="attest-rule">{rule}</span>
      <p>{children}</p>
    </div>
  );
}

/** A section that belongs to one or two of the four parts, and only appears when one of them is
 *  selected. The heading carries weight rather than being a whispered grey label. */
function Block({ title, children, show }: { title: string; children: ReactNode; show: boolean }) {
  if (!show) return null;
  return (
    <div className="card fade-in">
      <h2 className="h-section">{title}</h2>
      {children}
    </div>
  );
}

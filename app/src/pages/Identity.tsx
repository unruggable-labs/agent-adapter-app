import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { Addr, Badge, Callout, Section, Spinner, Stat, StatusBadge, TrustBadge } from "../components/ui";
import type { Identity } from "../lib/api";
import { useApp, settle } from "../lib/app-state";
import {
  ATTESTATION_TYPES,
  ZERO32,
  adapterAbi,
  controlLine,
  displayName,
  shortHex,
  toByteHex,
  utf8ToHex,
} from "../lib/chain";
import { sendTx } from "../lib/tx";

export function IdentityPage({ ubid }: { ubid: string }) {
  const { identities, overview, navigate } = useApp();
  const id = identities.find((i) => i.ubid === ubid);

  if (!id)
    return (
      <div className="page">
        <p className="t2">Identity not found (yet). <button className="btn btn-ghost" onClick={() => navigate("/identities")}>Back</button></p>
      </div>
    );
  if (!overview) return <div className="page"><Spinner /></div>;

  return (
    <div className="page fade-in">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate("/identities")}>← Identities</button>
      <div className="page-head wrap" style={{ marginTop: 10, rowGap: 6 }}>
        <h1 className="page-title" style={{ fontSize: 18 }}>{displayName(id)}</h1>
        <span className="row" style={{ gap: 8 }}>
          <StatusBadge id={id} />
          <Badge tone="outline">{id.standardName}</Badge>
          <TrustBadge t={id.trustBase} />
        </span>
      </div>
      <p className="page-sub" style={{ marginBottom: 4 }}>
        Agent identity anchored to {id.subjectLabel} (<Addr value={id.boundAddress} n={44} />) on
        chain {overview.chainId} — {controlLine(id)}.
      </p>
      <p className="mono t3 small" style={{ margin: "0 0 18px", overflowWrap: "anywhere" }}>{id.ubid}</p>

      <div className="stack">
        <Flags id={id} />
        <ConfirmBanner id={id} />

        <Section label="Reputation">
          <div className="stat-row" style={{ marginBottom: 14 }}>
            <Stat n={id.reputation.stars} label="stars" />
            <Stat n={id.reputation.ratingAverage === null ? "—" : id.reputation.ratingAverage.toFixed(0)} label={`avg rating · ${id.reputation.ratings.length} rater${id.reputation.ratings.length === 1 ? "" : "s"}`} />
            <Stat n={id.reputation.reviews.length} label="reviews" />
            <Stat n={id.reputation.interactions.length} label="interactions" />
          </div>
          {id.reputation.reviews.map((r) => (
            <div key={r.attestationId} className="review-item">
              <div>"{r.text}"</div>
              <div className="t3 small">— <span className="mono">{shortHex(r.attester, 8)}</span> · block {r.order.blockNumber}</div>
            </div>
          ))}
          {id.reputation.interactions.map((x) => (
            <div key={x.attestationId} className="review-item">
              <div><span className="num">{x.score}/100</span> {x.text && <span className="t2">· {x.text}</span>}</div>
              <div className="t3 small">interaction · ref <span className="mono">{shortHex(x.reference, 10)}</span> — <span className="mono">{shortHex(x.attester, 8)}</span></div>
            </div>
          ))}
          {id.reputation.confirmedAccounts.length > 0 && (
            <div style={{ marginTop: 12 }} className="row wrap">
              <span className="t3 small">Confirmed accounts:</span>
              {id.reputation.confirmedAccounts.map((c) => (
                <span key={c.attester} className="row" style={{ gap: 5 }}>
                  <Addr value={c.attester} n={8} />
                  {c.verified ? <Badge tone="ok">verified</Badge> : <Badge tone="warn">not in forward metadata</Badge>}
                </span>
              ))}
            </div>
          )}
        </Section>

        <AttestPanel id={id} />

        <Section label="Record">
          <dl className="kv">
            <dt>UBID</dt><dd className="mono">{id.ubid}</dd>
            <dt>Agent URI</dt><dd className="mono">{id.agentURI ?? <span className="t3">not set</span>}</dd>
            <dt>Agent wallet</dt>
            <dd>
              {id.agentWallet ? (
                <span className="row">
                  <Addr value={id.agentWallet} />
                  {id.flags.walletUnverified
                    ? <Badge tone="warn">one-directional claim</Badge>
                    : <Badge tone="ok">mutually verified</Badge>}
                </span>
              ) : <span className="t3">not set</span>}
            </dd>
            <dt>ERC-8004 agent</dt>
            <dd>{id.agentIds.length ? `#${id.agentIds.join(", #")} — joined by UBID, no link assertion needed` : <span className="t3">not registered</span>}</dd>
            <dt>Last event</dt>
            <dd className="small t2">
              {id.lastEvent
                ? <>{id.lastEvent.eventName} · block <span className="num">{id.lastEvent.blockNumber}</span> · by <span className="mono">{shortHex(id.lastEvent.emitter, 8)}</span>{id.lastEventCollectionAuthored && <span className="t3"> (collection-authored)</span>}</>
                : "—"}
            </dd>
          </dl>
          {Object.keys(id.metadata).length > 0 && (
            <>
              <hr className="divider" />
              <div className="section-label">Metadata</div>
              <dl className="kv">
                {Object.entries(id.metadata).map(([k, v]) => (
                  <span style={{ display: "contents" }} key={k}><dt>{k}</dt><dd className="mono">{v}</dd></span>
                ))}
              </dl>
            </>
          )}
        </Section>

        <ManagePanel id={id} />
      </div>
    </div>
  );
}

function Flags({ id }: { id: Identity }) {
  const t = id.trustBase;
  return (
    <>
      {id.collectionAuthoredAfterOwner && (
        <Callout tone="danger" title="Post-owner collection claim.">
          The current state includes collection-authored events emitted after a real owner had
          spoken — the burn-reopen pattern. The reputation below may describe a previous
          claimant's agent.
        </Callout>
      )}
      {id.flags.currentlyOwnerless && (
        <Callout tone="warn" title="Bound token is currently ownerless.">
          <span> </span>ownerOf reverts or returns zero, so the collection-authority window is open right now.
        </Callout>
      )}
      {t?.verdict === "ruggable" && (
        <Callout tone="danger" title="Ruggable trust base.">
          The collection can burn tokens and can be made to call out — a post-burn re-claim of
          this identity is possible by code, without the owner acting. Binding here adopts that rule.
        </Callout>
      )}
      {t?.verdict === "unstable" && (
        <Callout tone="warn" title="Upgradeable trust base.">
          The collection is a proxy: today's code proves nothing about tomorrow's capabilities.
        </Callout>
      )}
    </>
  );
}

/** Shown when the acting persona is named in the identity's forward account[...] metadata
 *  but has not yet confirmed — the chain-derived inbox pattern, no parameters trusted. */
function ConfirmBanner({ id }: { id: Identity }) {
  const { actor, actorIndex, overview, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);

  const named = Object.entries(id.metadata).some(
    ([k, v]) => (k === "account" || k.startsWith("account[")) && v.toLowerCase().includes(actor.address.slice(2)),
  );
  const confirmed = id.reputation.confirmedAccounts.some((c) => c.attester === actor.address);
  if (!named || confirmed || !overview) return null;

  return (
    <Callout tone="ok" title={`This identity names ${actor.name}'s address as an additional account.`}>
      <span> </span>Confirming is a self-assertion recorded on-chain; it moves no assets and grants nothing.
      <span> </span>
      <button
        className="btn btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await sendTx(actorIndex, overview.adapter, adapterAbi, "confirmAdditionalAccount", [id.ubid]);
          toast(r.message);
          await settle(refresh);
          setBusy(false);
        }}
      >
        {busy ? <Spinner /> : "Confirm"}
      </button>
    </Callout>
  );
}

function AttestPanel({ id }: { id: Identity }) {
  const { actor, actorIndex, overview, refresh, toast } = useApp();
  const [mode, setMode] = useState<"star" | "rate" | "review" | "interaction">("star");
  const [rating, setRating] = useState(80);
  const [text, setText] = useState("");
  const [score, setScore] = useState(90);
  const [busy, setBusy] = useState(false);

  if (!overview) return null;

  async function attest(type: number, data: Hex) {
    setBusy(true);
    const r = await sendTx(actorIndex, overview!.adapter, adapterAbi, "attest", [type, id.ubid, ZERO32, data]);
    toast(r.ok ? `Attested as ${actor.name} — ${r.message}` : r.message);
    if (r.ok) { setText(""); await settle(refresh); }
    setBusy(false);
  }

  return (
    <Section
      label={`Attest as ${actor.name}`}
      actions={
        <div className="seg">
          {(["star", "rate", "review", "interaction"] as const).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>{m}</button>
          ))}
        </div>
      }
    >
      {mode === "star" && (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => attest(ATTESTATION_TYPES.STAR, "0x01")}>{busy ? <Spinner /> : "★ Star"}</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => attest(ATTESTATION_TYPES.STAR, "0x00")}>Unstar</button>
          <span className="hint">A toggle: your latest live value counts. Unstar is a position, not a deletion.</span>
        </div>
      )}
      {mode === "rate" && (
        <div className="row">
          <input type="range" min={0} max={100} value={rating} onChange={(e) => setRating(Number(e.target.value))} style={{ width: 220 }} />
          <span className="num" style={{ width: 40 }}>{rating}</span>
          <button className="btn" disabled={busy} onClick={() => attest(ATTESTATION_TYPES.RATING, toByteHex(rating))}>{busy ? <Spinner /> : "Rate"}</button>
          <span className="hint">Latest live rating per attester; averaged across attesters.</span>
        </div>
      )}
      {mode === "review" && (
        <div>
          <textarea className="textarea" placeholder="On-chain, permanent, revocable-but-recorded. Calldata is on you." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" disabled={busy || !text.trim()} onClick={() => attest(ATTESTATION_TYPES.REVIEW, utf8ToHex(text.trim()))}>{busy ? <Spinner /> : "Publish review"}</button>
          </div>
        </div>
      )}
      {mode === "interaction" && (
        <div>
          <div className="row">
            <span className="small t2">Outcome</span>
            <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} style={{ width: 160 }} />
            <span className="num" style={{ width: 34 }}>{score}</span>
          </div>
          <input className="input" style={{ marginTop: 8 }} placeholder="Optional note about the dealing" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn"
              disabled={busy}
              onClick={() => attest(ATTESTATION_TYPES.INTERACTION, (toByteHex(score) + ZERO32.slice(2) + utf8ToHex(text).slice(2)) as Hex)}
            >
              {busy ? <Spinner /> : "Record interaction"}
            </button>
            <span className="hint">score ‖ reference ‖ note — a stream entry, one per dealing.</span>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Owner-side actions. Authority is checked by simulation — the contract's own guards decide. */
function ManagePanel({ id }: { id: Identity }) {
  const { actor, actorIndex, overview, refresh, toast } = useApp();
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!overview) return null;
  const coords = [id.standard, id.boundAddress, BigInt(id.tokenId)] as const;

  async function run(label: string, fn: string, args: unknown[]) {
    setBusy(label);
    const r = await sendTx(actorIndex, overview!.adapter, adapterAbi, fn, args);
    toast(r.message);
    if (r.ok) await settle(refresh);
    setBusy(null);
  }

  return (
    <Section
      label={`Manage as ${actor.name}`}
      actions={<button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>}
    >
      {!open ? (
        <p className="hint" style={{ margin: 0 }}>
          Update this identity's claim — available to whoever passes the {id.standardName} authority
          check. Unauthorized attempts fail in simulation before anything is sent.
        </p>
      ) : (
        <div className="stack">
          <div className="row">
            <input className="input" placeholder="New agent URI (counterfactual update)" value={uri} onChange={(e) => setUri(e.target.value)} />
            <button className="btn" disabled={!!busy || !uri.trim()} onClick={() => run("uri", "counterfactualSetAgentURI", [...coords, uri.trim()])}>
              {busy === "uri" ? <Spinner /> : "Set URI"}
            </button>
          </div>
          <div className="row wrap">
            <button className="btn" disabled={!!busy} onClick={() => run("wallet", "counterfactualSetAgentWalletAndUBID", [...coords])}>
              {busy === "wallet" ? <Spinner /> : "Link my wallet (both directions)"}
            </button>
            <span className="hint">One call: names {actor.name}'s address as this agent's wallet and points that wallet back — mutually verified by construction.</span>
          </div>
          <div className="row wrap">
            <button className="btn" disabled={!!busy} onClick={() => run("restate", "counterfactualRegister", [...coords, id.agentURI ?? ""])}>
              {busy === "restate" ? <Spinner /> : "Re-state claim"}
            </button>
            <span className="hint">A fresh registration event replacing prior state — the move after buying a bound token.</span>
          </div>
          {!id.agentIds.length && (
            <div className="row wrap">
              <button className="btn" disabled={!!busy} onClick={() => run("register", "register", [...coords, id.agentURI ?? ""])}>
                {busy === "register" ? <Spinner /> : "Register fully (mint ERC-8004 agent)"}
              </button>
              <span className="hint">Same UBID — the counterfactual history and reputation join automatically.</span>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

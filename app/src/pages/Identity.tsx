import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { Addr, Avatar, Badge, Callout, Modal, Section, SignalCallout, signalsFor, Spinner, Stat, StatusBadge, TrustBadge } from "../components/ui";
import type { Identity } from "../lib/api";
import { useApp, settle } from "../lib/app-state";
import {
  ATTESTATION_TYPES,
  ZERO32,
  adapterAbi,
  controlLine,
  displayName,
  plural,
  pluralise,
  shortHex,
  toByteHex,
  hexToUtf8,
  utf8ToHex,
} from "../lib/chain";
import { canSend, sendTx } from "../lib/tx";

export function IdentityPage({ ubid }: { ubid: string }) {
  const { identities, overview, status, navigate } = useApp();
  const id = identities.find((i) => i.ubid === ubid);

  // "not found" is only true once the indexer has actually answered — on a deep link the first
  // render has no identities yet, and claiming the UBID doesn't exist would be a lie.
  if (!id && status === "loading") return <div className="page"><Spinner /></div>;
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
      <div className="page-head wrap" style={{ marginTop: 10, rowGap: 6, alignItems: "center" }}>
        <Avatar seed={id.ubid} size={30} />
        <h1 className="page-title" style={{ fontSize: 18 }}>{displayName(id)}</h1>
        <span className="row" style={{ gap: 8 }}>
          <StatusBadge id={id} />
          <Badge tone="outline">{id.standardName}</Badge>
          <TrustBadge t={id.trustBase} />
        </span>
        <div className="head-actions">
          <StarButton id={id} />
        </div>
      </div>
      <p className="mono t3 small" style={{ margin: "0 0 18px", overflowWrap: "anywhere" }}>{id.ubid}</p>

      <div className="stack">
        <Flags id={id} />
        <ConfirmBanner id={id} />

        <Section label="Reputation">
          <div className="stat-row" style={{ marginBottom: 14 }}>
            {/* Stars live on the header button, where the action and the total sit together. */}
            <Stat
              n={id.reputation.ratingAverage === null ? "—" : id.reputation.ratingAverage.toFixed(0)}
              label={`avg rating · ${plural(id.reputation.ratings.length, "rater")}`}
            />
            <Stat n={id.reputation.reviews.length} label={pluralise(id.reputation.reviews.length, "review")} />
            <Stat n={id.reputation.interactions.length} label={pluralise(id.reputation.interactions.length, "transaction")} />
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
              <div className="t3 small">transaction · ref <span className="mono">{shortHex(x.reference, 10)}</span> - <span className="mono">{shortHex(x.attester, 8)}</span></div>
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
            <dd>{id.agentIds.length ? `#${id.agentIds.join(", #")}` : <span className="t3">not registered</span>}</dd>
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

/** Every applicable signal as a banner, worded exactly as the pills and the /how legend word it.
 *  Reassuring signals are pills elsewhere on the page; a banner is for what needs attention. */
function Flags({ id }: { id: Identity }) {
  return (
    <>
      {signalsFor(id, { compact: true }).map((k) => (
        <SignalCallout key={k} k={k} />
      ))}
    </>
  );
}

/** Shown when the acting persona is named in the identity's forward account[...] metadata
 *  but has not yet confirmed - the chain-derived inbox pattern, no parameters trusted. */
function ConfirmBanner({ id }: { id: Identity }) {
  const { signer, overview, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);

  const named = Object.entries(id.metadata).some(
    ([k, v]) => (k === "account" || k.startsWith("account[")) && signer !== null && v.toLowerCase().includes(signer.address.slice(2)),
  );
  const confirmed = id.reputation.confirmedAccounts.some((c) => c.attester === signer?.address);
  if (!named || confirmed || !overview) return null;

  return (
    <Callout tone="ok" title={`This identity names your address as an additional account.`}>
      <span> </span>Confirming is a self-assertion recorded on-chain; it moves no assets and grants nothing.
      <span> </span>
      <button
        className="btn btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await sendTx(signer, overview.adapter, adapterAbi, "confirmAdditionalAccount", [id.ubid]);
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

/** One attest() call. Shared by the star toggle, the feedback form and the transaction modal. */
function useAttest(id: Identity) {
  const { signer, overview, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);

  async function attest(type: number, data: Hex) {
    if (!overview) return false;
    setBusy(true);
    const r = await sendTx(signer, overview.adapter, adapterAbi, "attest", [type, id.ubid, ZERO32, data]);
    toast(r.ok ? `Attested - ${r.message}` : r.message);
    if (r.ok) await settle(refresh);
    setBusy(false);
    return r.ok;
  }

  return { attest, busy, signer, ready: !!overview };
}

/** The star toggle, for the page header. Filled when this signer's live value is 1. */
export function StarButton({ id }: { id: Identity }) {
  const { attest, busy, signer, ready } = useAttest(id);
  // What the indexer says, and what we just did. `settle` refreshes after a fixed delay that is
  // shorter than a public indexer's poll interval, so the confirmed value can lag the
  // transaction by several seconds. Hold the new state locally until the indexer agrees,
  // otherwise the spinner would clear onto the old answer.
  const [pending, setPending] = useState<boolean | null>(null);
  const indexed = !!signer && (id.reputation.starredBy ?? []).includes(signer.address);

  useEffect(() => {
    if (pending !== null && indexed === pending) setPending(null);
  }, [indexed, pending]);

  if (!ready) return null;
  const starred = pending ?? indexed;
  // The total moves with the optimistic state too, so the button doesn't say "Starred" next to
  // a count that hasn't budged.
  const count = id.reputation.stars + (starred === indexed ? 0 : starred ? 1 : -1);

  return (
    <button
      className={`btn btn-star${starred ? " is-starred" : ""}`}
      disabled={busy || !signer}
      aria-pressed={starred}
      title={
        !signer
          ? "Connect a wallet to star this agent"
          : starred
            ? "You've starred this agent. Click to withdraw it - a position, not a deletion."
            : "One star per address, withdrawable later."
      }
      onClick={async () => {
        const next = !starred;
        if (await attest(ATTESTATION_TYPES.STAR, next ? "0x01" : "0x00")) setPending(next);
      }}
    >
      {busy ? (
        <Spinner />
      ) : (
        <>
          {starred ? "★" : "☆"} {starred ? "Starred" : "Star"}
          {count > 0 && <span className="btn-star-count num">{count}</span>}
        </>
      )}
    </button>
  );
}

/**
 * Rating and review in one form. They are separate attestation types and `attest` takes one type
 * per call, so writing a review means two transactions - said up front rather than discovered
 * when the second wallet prompt appears.
 */
function AttestPanel({ id }: { id: Identity }) {
  const { attest, busy, signer, ready } = useAttest(id);
  const [rating, setRating] = useState(80);
  const [text, setText] = useState("");
  const [showInteraction, setShowInteraction] = useState(false);

  if (!ready) return null;
  const review = text.trim();

  async function submit() {
    if (!(await attest(ATTESTATION_TYPES.RATING, toByteHex(rating)))) return;
    if (!review) return;
    if (await attest(ATTESTATION_TYPES.REVIEW, utf8ToHex(review))) setText("");
  }

  return (
    <Section
      label={signer ? `Leave feedback as ${signer.label}` : "Leave feedback (connect a wallet)"}
      actions={
        <button className="btn btn-sm" disabled={!signer} onClick={() => setShowInteraction(true)}>
          Record transaction
        </button>
      }
    >
      <div className="field">
        <label>Rating</label>
        <div className="row">
          <input type="range" min={0} max={100} value={rating} onChange={(e) => setRating(Number(e.target.value))} style={{ width: 220 }} />
          <span className="num" style={{ width: 40, fontWeight: 600 }}>{rating}</span>
          <span className="hint">Replaces any rating you gave before. The profile shows the average across raters.</span>
        </div>
      </div>

      <div className="field">
        <label>Review <span className="t3">(optional)</span></label>
        <textarea
          className="textarea"
          placeholder="On-chain and permanent - revoking one is itself recorded."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn-primary" disabled={busy || !signer} onClick={submit}>
          {busy ? <Spinner /> : review ? "Submit rating and review" : "Submit rating"}
        </button>
        <span className="hint">
          {review
            ? "Two transactions: the rating, then the review. They are separate records on-chain."
            : "One transaction. Write something above to publish a review alongside it."}
        </span>
      </div>

      {showInteraction && <InteractionModal id={id} onClose={() => setShowInteraction(false)} />}
    </Section>
  );
}

/** Recording a transaction is evidence, not opinion: it carries the tx hash that proves it
 *  happened, which is the only thing separating it from a review. Its own dialog, so the field
 *  that matters is not buried in a tab. */
function InteractionModal({ id, onClose }: { id: Identity; onClose: () => void }) {
  const { attest, busy } = useAttest(id);
  const [score, setScore] = useState(90);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const ref = reference.trim();
  const refValid = ref === "" || /^0x[0-9a-fA-F]{64}$/.test(ref);
  const refWord = (refValid && ref ? ref : ZERO32).slice(2).toLowerCase();

  return (
    <Modal title="Record a transaction" onClose={onClose}>
      <p className="t2 small" style={{ margin: "0 0 14px" }}>
        A record of a transaction you had with this agent.
      </p>

      <div className="field">
        <label>Rating</label>
        <div className="row">
          <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} style={{ width: 180 }} />
          <span className="num" style={{ width: 34, fontWeight: 600 }}>{score}</span>
        </div>
      </div>

      <div className="field">
        <label>Transaction hash</label>
        <input
          className="input mono"
          placeholder="0x…"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <span className="hint" style={!refValid ? { color: "var(--danger)" } : undefined}>
          {!refValid
            ? "A transaction hash is 0x followed by 64 hex characters."
            : ref
              ? "Anyone reading this record can check the hash against the chain."
              : "Optional, but recommended."}
        </span>
      </div>

      <div className="field">
        <label>Note</label>
        <input className="input" placeholder="Optional note about this transaction" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="btn btn-primary"
          disabled={busy || !refValid}
          onClick={async () => {
            const ok = await attest(
              ATTESTATION_TYPES.INTERACTION,
              (toByteHex(score) + refWord + utf8ToHex(note).slice(2)) as Hex,
            );
            if (ok) onClose();
          }}
        >
          {busy ? <Spinner /> : "Record transaction"}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

/** Owner-side actions. Authority is checked by simulation - the contract's own guards decide. */
/**
 * Owner-side actions, shown only to the address that can actually use them.
 *
 * `currentControllerHolder` is the test, with two deliberate gaps: it is null for standards with
 * no single holder, and a delegate.xyz delegate passes the contract's check without ever matching
 * it. So an unknown holder shows the panel rather than hiding it, and a mismatch leaves a way in
 * instead of a dead end. Authority itself is still decided by simulation - the contract's guards
 * are the only real gate.
 */
function ManagePanel({ id }: { id: Identity }) {
  const { signer, overview, refresh, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [canManage, setCanManage] = useState<boolean | null>(null);

  // Ask the contract rather than guess. Re-stating the current URI is authority-gated and is a
  // no-op even if it were sent, so it is a safe probe; the simulation never leaves the node.
  useEffect(() => {
    if (!signer || !overview) {
      setCanManage(false);
      return;
    }
    let cancelled = false;
    canSend(signer, overview.adapter, adapterAbi, "counterfactualSetAgentURI", [
      id.standard,
      id.boundAddress,
      BigInt(id.tokenId),
      id.agentURI ?? "",
    ]).then((ok) => {
      if (!cancelled) setCanManage(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [signer?.address, overview?.adapter, id.ubid, id.agentURI, id.standard, id.boundAddress, id.tokenId]);

  if (!overview || !signer || canManage === null) return null;
  if (!canManage) {
    const holder = id.currentControllerHolder;
    return (
      <p className="hint" style={{ margin: "2px 0 0" }}>
        {holder ? (
          <>This profile is controlled by <Addr value={holder} n={8} />, so its settings aren't yours to change.</>
        ) : (
          <>This profile's settings aren't yours to change.</>
        )}
      </p>
    );
  }

  return <ManageForm id={id} busy={busy} setBusy={setBusy} refresh={refresh} toast={toast} adapter={overview.adapter} signer={signer} />;
}

function ManageForm({
  id,
  busy,
  setBusy,
  refresh,
  toast,
  adapter,
  signer,
}: {
  id: Identity;
  busy: string | null;
  setBusy: (v: string | null) => void;
  refresh: () => Promise<void>;
  toast: (m: string) => void;
  adapter: `0x${string}`;
  signer: NonNullable<ReturnType<typeof useApp>["signer"]>;
}) {
  const [uri, setUri] = useState(id.agentURI ?? "");
  const [metaKey, setMetaKey] = useState("");
  const [metaValue, setMetaValue] = useState("");

  const coords = [id.standard, id.boundAddress, BigInt(id.tokenId)] as const;
  const entries = Object.entries(id.metadata);
  const walletIsMine = id.agentWallet === signer.address;

  async function run(label: string, fn: string, args: unknown[]) {
    setBusy(label);
    const r = await sendTx(signer, adapter, adapterAbi, fn, args);
    toast(r.message);
    if (r.ok) await settle(refresh);
    setBusy(null);
  }

  return (
    <>
      <Section label="Profile settings">
        <div className="field">
          <label>Agent URI</label>
          <div className="row">
            <input className="input" placeholder="ipfs://… or https://…/agent.json" value={uri} onChange={(e) => setUri(e.target.value)} />
            <button
              className="btn"
              disabled={!!busy || uri.trim() === (id.agentURI ?? "")}
              onClick={() => run("uri", "counterfactualSetAgentURI", [...coords, uri.trim()])}
            >
              {busy === "uri" ? <Spinner /> : "Save"}
            </button>
          </div>
          <span className="hint">Where the agent's card lives. The Save button enables once you change it.</span>
        </div>

        <div className="field">
          <label>Metadata</label>
          {entries.length > 0 && (
            <div className="stack" style={{ marginBottom: 6 }}>
              {entries.map(([k, v]) => {
                const text = hexToUtf8(v);
                return (
                  <div key={k} className="row spread meta-row">
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className="mono small" style={{ fontWeight: 600 }}>{k}</span>
                      <span className="t2 small mono" style={{ overflowWrap: "anywhere" }}>{text ?? v}</span>
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setMetaKey(k); setMetaValue(text ?? v); }}>
                      Edit
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="row">
            <input className="input mono" style={{ maxWidth: 220 }} placeholder="key" value={metaKey} onChange={(e) => setMetaKey(e.target.value)} />
            <input className="input" placeholder="value" value={metaValue} onChange={(e) => setMetaValue(e.target.value)} />
            <button
              className="btn"
              disabled={!!busy || !metaKey.trim()}
              onClick={async () => {
                await run("meta", "counterfactualSetMetadata", [...coords, metaKey.trim(), utf8ToHex(metaValue)]);
                setMetaKey("");
                setMetaValue("");
              }}
            >
              {busy === "meta" ? <Spinner /> : entries.some(([k]) => k === metaKey.trim()) ? "Update" : "Add"}
            </button>
          </div>
          <span className="hint">
            Values are stored as bytes; text is encoded as UTF-8. Setting an existing key
            overwrites it - there is no delete, so an empty value is how you clear one.
          </span>
        </div>
      </Section>

      <Section label="Operating wallet">
        {id.agentWallet ? (
          <div className="row wrap" style={{ gap: 10 }}>
            <Addr value={id.agentWallet} />
            {id.flags.walletUnverified
              ? <Badge tone="warn">one-directional claim</Badge>
              : <Badge tone="ok">mutually verified</Badge>}
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run("unset", "counterfactualUnsetAgentWallet", [...coords])}>
              {busy === "unset" ? <Spinner /> : "Unset"}
            </button>
          </div>
        ) : (
          <p className="t2 small" style={{ margin: 0 }}>
            No wallet set. Until one is, nothing resolves when someone looks up an address for
            this agent.
          </p>
        )}
        {!walletIsMine && (
          <div className="row wrap" style={{ marginTop: 12 }}>
            <button className="btn" disabled={!!busy} onClick={() => run("wallet", "counterfactualSetAgentWalletAndUBID", [...coords])}>
              {busy === "wallet" ? <Spinner /> : "Use my address as the operating wallet"}
            </button>
            <span className="hint">
              One transaction, because you are both parties: it names your address as this agent's
              wallet and points that wallet back, so it comes out mutually verified.
            </span>
          </div>
        )}
        <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
          To use a different address, that address has to speak for itself - open{" "}
          <b>My wallet</b> while connected as it and confirm this agent's claim.
        </p>
      </Section>

      {!id.agentIds.length && (
        <Section label="ERC-8004 registration">
          <div className="row wrap">
            <button className="btn" disabled={!!busy} onClick={() => run("register", "register", [...coords, id.agentURI ?? ""])}>
              {busy === "register" ? <Spinner /> : "Add an ERC-8004 registration"}
            </button>
            <span className="hint">
              Mints an agent on the shared ERC-8004 registry, bound to this same profile. The UBID
              doesn't change, so the reputation above carries over untouched.
            </span>
          </div>
        </Section>
      )}
    </>
  );
}

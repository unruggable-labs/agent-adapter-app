import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { Addr, AgentIds, Avatar, Badge, Callout, ProfileSkeleton, Section, Spinner, StandardBadge, Stat, StatusBadge, Tip } from "../components/ui";
import { api, NotFound, type HistoryEntry, type Identity } from "../lib/api";
import { useApp, useLive, settle } from "../lib/app-state";
import {
  ATTESTATION_TYPES,
  ZERO32,
  adapterAbi,
  controlLine,
  displayName,
  explorerAddressUrl,
  explorerBlockUrl,
  explorerName,
  explorerTxUrl,
  publicClient,
  scanAgentUrl,
  plural,
  pluralise,
  shortHex,
  toByteHex,
  hexToUtf8,
  utf8ToHex,
} from "../lib/chain";
import { canSend, sendTx } from "../lib/tx";
import { ConnectWalletButton } from "../components/connect";

type Tab = "profile" | "history";

export function IdentityPage({ ubid }: { ubid: string }) {
  const { overview, navigate } = useApp();
  // This one identity, from the indexer, re-fetched on every poll and after every write.
  const { data: id, status, error } = useLive(() => api.identity(ubid), [ubid]);
  const [tab, setTab] = useState<Tab>("profile");

  // "not found" is only true once the indexer has actually answered - on a deep link the first
  // render has nothing yet, and claiming the UBID doesn't exist would be a lie.
  if (!id && status === "loading") return <ProfileSkeleton />;
  if (!id && error instanceof NotFound)
    return (
      <div className="page">
        <p className="t2">Identity not found (yet). <button className="btn btn-ghost" onClick={() => navigate("/identities")}>Back</button></p>
      </div>
    );
  if (!id)
    return (
      <div className="page">
        <p className="t2">Can't reach the indexer - retrying every few seconds. <button className="btn btn-ghost" onClick={() => navigate("/identities")}>Back</button></p>
      </div>
    );
  if (!overview) return <ProfileSkeleton />;

  return (
    <div className="page fade-in">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate("/identities")}>← Identities</button>
      <div className="page-head wrap" style={{ marginTop: 10, gap: 16, alignItems: "center", marginBottom: 18 }}>
        <Avatar seed={id.ubid} image={id.image} size={72} />
        <div style={{ display: "grid", gap: 6, minWidth: 0, flex: 1 }}>
          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <h1 className="page-title" style={{ fontSize: 18 }}>{displayName(id)}</h1>
            <StatusBadge id={id} />
            <StandardBadge id={id} />
          </div>
          <p className="mono t3 small" style={{ margin: 0, overflowWrap: "anywhere" }}>{id.ubid}</p>
          {id.card?.name && id.card.name !== displayName(id) && (
            <p className="t2 small" style={{ margin: 0 }}>{id.card.name}<span className="t3"> · from the {id.card.source === "token" ? "token's" : "agent card's"} metadata</span></p>
          )}
        </div>
        <div className="head-actions">
          <StarButton id={id} />
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>Profile</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>History</button>
      </div>

      {tab === "history" && <HistoryPanel id={id} />}

      <div className="stack" hidden={tab !== "profile"}>
        {id.card?.description && (
          <Section label={id.card.source === "token" ? "About this token" : "About this agent"}>
            <p className="t2" style={{ margin: 0, whiteSpace: "pre-line", lineHeight: 1.6 }}>{id.card.description}</p>
            <p className="hint" style={{ margin: "8px 0 0" }}>From the {id.card.source === "token" ? "token's own metadata" : "agent card at the agent URI"}, as published by whoever controls it. Adapterscan repeats it, it doesn't vouch for it.</p>
          </Section>
        )}
        <ConfirmBanner id={id} />
        <WalletLinkBanner id={id} />

        <ControllerSection id={id} />

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
              <div>{r.score !== null && r.score !== undefined && <span className="num" style={{ marginRight: 8 }}>{r.score}/100</span>}"{r.text}"</div>
              <div className="t3 small">
                — <AddressLink address={r.attester} /> · block {r.order.blockNumber}
                {r.reference && r.reference !== ZERO32 && <> · ref <TxRef hash={r.reference} /></>}
                {" · "}<button className="agent-link" onClick={() => navigate(`/attestation/${r.attestationId}`)}>statement</button>
              </div>
            </div>
          ))}
          {id.reputation.interactions.map((x) => (
            <div key={x.attestationId} className="review-item">
              <div><span className="num">{x.score}/100</span> {x.text && <span className="t2">· {x.text}</span>}</div>
              <div className="t3 small">transaction · ref <TxRef hash={x.reference} /> · by <AddressLink address={x.attester} /> · <button className="agent-link" onClick={() => navigate(`/attestation/${x.attestationId}`)}>statement</button></div>
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
            <dd>{id.agentIds.length ? <AgentIds ids={id.agentIds} /> : <span className="t3">not registered</span>}</dd>
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

/**
 * The thing that controls this identity - the collection, contract or address it is bound to -
 * with the ways to go and look at it: the chain explorer, its own page here, its website. For a
 * token, whether it exists yet and who holds it. The collection's own card (contractURI) leads
 * when the contract publishes one.
 */
function ControllerSection({ id }: { id: Identity }) {
  const { navigate } = useApp();
  const isToken = id.standard <= 4;
  const col = id.collection ?? null;
  const explorer = explorerAddressUrl(id.boundAddress);
  const holder = id.currentControllerHolder;
  return (
    <Section label="Controller">
      {col && (col.name || col.description) && (
        <div className="row" style={{ gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
          {col.image && <Avatar seed={id.boundAddress} image={col.image} size={44} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{col.name ?? id.contractName}</div>
            {col.description && <p className="t2 small" style={{ margin: "2px 0 0", lineHeight: 1.5 }}>{col.description}</p>}
          </div>
        </div>
      )}
      <dl className="kv">
        <dt>{id.standard === 5 ? "Address" : isToken ? "Collection" : "Contract"}</dt>
        <dd>
          <span className="row wrap" style={{ gap: 8 }}>
            {id.contractName && !col?.name && <span style={{ fontWeight: 600 }}>{id.contractName}</span>}
            <Addr value={id.boundAddress} n={10} />
            <button className="agent-link small" onClick={() => navigate(`/address/${id.boundAddress}`)}>Everything about this address</button>
            {explorer && <a className="agent-link small" href={explorer} target="_blank" rel="noopener noreferrer">View on {explorerName()}</a>}
          </span>
        </dd>
        {isToken && (
          <>
            <dt>Token</dt>
            <dd>
              <span className="row wrap" style={{ gap: 8 }}>
                <span className="num">#{id.tokenId.length > 12 ? `${id.tokenId.slice(0, 6)}…${id.tokenId.slice(-4)}` : id.tokenId}</span>
                {id.flags.currentlyOwnerless === true && (
                  <Badge tone="warn" tip="The collection answers that no one owns this id: the token isn't minted yet, or was burned. A collection can claim an identity ahead of the mint; the first owner inherits it, picture and all.">not minted yet</Badge>
                )}
                {holder && <span className="t2 small">held by <AddressLink address={holder} /></span>}
              </span>
            </dd>
          </>
        )}
        {!isToken && id.standard !== 5 && holder && (
          <>
            <dt>Controlled by</dt>
            <dd><AddressLink address={holder} /></dd>
          </>
        )}
        {col?.externalLink && (
          <>
            <dt>Website</dt>
            <dd><a className="agent-link small" href={col.externalLink} target="_blank" rel="noopener noreferrer">{col.externalLink.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></dd>
          </>
        )}
        <dt>Rule</dt>
        <dd className="t2 small"><Tip tip={`This identity is ${controlLine(id)}.`}><span>{controlLine(id).replace(/^controlled by /, "")[0].toUpperCase() + controlLine(id).replace(/^controlled by /, "").slice(1)}</span></Tip></dd>
      </dl>
    </Section>
  );
}

/**
 * The audit trail. The indexer keeps no database - this identity's state is replayed from
 * exactly these events - so the list is the whole story, newest first. Rows that did not
 * count (a forged claim, a revocation by the wrong address) are shown and marked, because
 * seeing what was attempted is part of reading the record.
 */
function HistoryPanel({ id }: { id: Identity }) {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState(false);
  const last = id.lastEvent ? `${id.lastEvent.blockNumber}:${id.lastEvent.logIndex}` : "";

  // Re-fetch when the identity's latest event moves, so a fresh transaction shows up here too.
  useEffect(() => {
    let cancelled = false;
    api.history(id.ubid).then((h) => !cancelled && setRows(h)).catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [id.ubid, last, id.reputation.stars, id.reputation.reviews.length, id.reputation.interactions.length]);

  if (error) return <Section label="History"><p className="t2 small" style={{ margin: 0 }}>Couldn't load the history.</p></Section>;
  if (!rows) return <Section label="History"><Spinner /></Section>;
  const newestFirst = [...rows].reverse();

  return (
    <Section label={`History · ${plural(rows.length, "event")}`}>
      <p className="t2 small" style={{ margin: "0 0 12px" }}>
        Every on-chain event that touched this identity, newest first.
      </p>
      {rows.length === 0 ? (
        <div className="empty">Nothing has touched this identity yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th className="td-right">Block</th><th>Event</th><th>By</th><th>What it did</th><th>Tx</th></tr>
            </thead>
            <tbody>
              {newestFirst.map((h) => {
                const url = h.transactionHash ? explorerTxUrl(h.transactionHash) : null;
                return (
                  <tr key={`${h.order.blockNumber}:${h.order.logIndex}`} className={h.outcome !== "applied" ? "is-muted" : undefined}>
                    <td className="td-right num">
                      {explorerBlockUrl(h.order.blockNumber)
                        ? <a className="agent-link" href={explorerBlockUrl(h.order.blockNumber)!} target="_blank" rel="noopener noreferrer">{h.order.blockNumber}</a>
                        : h.order.blockNumber}
                    </td>
                    <td><span className="mono small">{h.eventName}</span></td>
                    <td>{h.actor ? <Addr value={h.actor} n={8} /> : <span className="t3">—</span>}</td>
                    <td className="td-wrap">
                      {h.outcome !== "applied" && <Badge tone={h.outcome === "dropped" ? "danger" : "warn"}>{h.outcome}</Badge>}
                      {h.outcome !== "applied" && " "}
                      <span className="small"><Effect text={h.effect} /></span>
                    </td>
                    <td>
                      {h.transactionHash ? (
                        url
                          ? <a className="agent-link mono small" href={url} target="_blank" rel="noopener noreferrer">{shortHex(h.transactionHash, 8)}</a>
                          : <span className="mono small t2">{shortHex(h.transactionHash, 8)}</span>
                      ) : <span className="t3">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** A full address, linking to its page in this explorer. */
export function AddressLink({ address }: { address: string }) {
  const { navigate } = useApp();
  return <button className="agent-link mono" title={address} onClick={() => navigate(`/address/${address}`)}>{shortHex(address, 10)}</button>;
}

/**
 * A referenced transaction hash, in full, linked to the chain's explorer, and checked against
 * the chain: a reference is a claim until the transaction is found. Zero means "no reference".
 */
const txChecks = new Map<string, Promise<"found" | "missing">>();
export function TxRef({ hash }: { hash: string }) {
  const [state, setState] = useState<"checking" | "found" | "missing">("checking");
  useEffect(() => {
    if (hash === ZERO32) return;
    let cancelled = false;
    if (!txChecks.has(hash)) {
      txChecks.set(hash, publicClient.getTransaction({ hash: hash as Hex }).then(() => "found" as const).catch(() => "missing" as const));
    }
    txChecks.get(hash)!.then((r) => !cancelled && setState(r));
    return () => {
      cancelled = true;
    };
  }, [hash]);
  if (hash === ZERO32) return <span className="t3">none</span>;
  const url = explorerTxUrl(hash);
  const label = <span className="mono" title={hash}>{shortHex(hash, 12)}</span>;
  return (
    <>
      {url ? <a className="agent-link" href={url} target="_blank" rel="noopener noreferrer">{label}</a> : label}{" "}
      {state === "found" && <Badge tone="ok">on chain</Badge>}
      {state === "missing" && <Badge tone="warn" tip="No transaction with this hash was found on this chain. The reference is the attester's claim.">not found</Badge>}
    </>
  );
}

/** An effect line with any "ERC-8004 agent #id" / "ERC-8004 #id" linked to its 8004Scan page. */
function Effect({ text }: { text: string }) {
  const parts = text.split(/(ERC-8004 (?:agent )?#\d+)/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^ERC-8004 (agent )?#(\d+)$/.exec(part);
        const url = m ? scanAgentUrl(m[2]) : null;
        return url ? (
          <span key={i}>ERC-8004 {m![1] ?? ""}<a className="agent-link" href={url} target="_blank" rel="noopener noreferrer">#{m![2]}</a></span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
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

/**
 * Shown to the wallet this agent names as its operating wallet. The agent's side of the link
 * is a claim that needed no permission from the wallet; this is where the wallet answers.
 * Confirming makes the link verified both ways. Unlinking withdraws the wallet's half.
 */
function WalletLinkBanner({ id }: { id: Identity }) {
  const { signer, overview, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  if (!signer || !overview || !id.agentWallet || id.agentWallet !== signer.address) return null;

  async function run(fn: string, args: unknown[]) {
    setBusy(true);
    const r = await sendTx(signer, overview!.adapter, adapterAbi, fn, args);
    toast(r.message);
    if (r.ok) await settle(refresh);
    setBusy(false);
  }

  if (id.flags.walletUnverified)
    return (
      <Callout tone="warn" title="This agent names your address as its operating wallet.">
        <span> </span>That's a claim by whoever controls the agent, and it proves nothing by itself. If this
        really is your agent, confirm it and the link becomes verified both ways. Confirming moves
        no assets and grants no authority; ignoring a false claim is always safe.
        <span> </span>
        <button className="btn btn-sm" disabled={busy} onClick={() => run("setWalletUBID", [id.standard, id.boundAddress, BigInt(id.tokenId)])}>
          {busy ? <Spinner /> : "Confirm it's mine"}
        </button>
      </Callout>
    );
  return (
    <Callout tone="ok" title="Your wallet is this agent's operating wallet, verified both ways.">
      <span> </span>Anyone who checks your address will see it belongs to {displayName(id)}. Your wallet carries its reputation.
      <span> </span>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run("clearWalletUBID", [])}>
        {busy ? <Spinner /> : "Unlink"}
      </button>
    </Callout>
  );
}

/** One attest() call. Shared by the star toggle and the feedback form. `reference` fills the
 *  contract's caller-interpreted `variant` slot - here, the hash of the transaction the
 *  statement is about, or zero when there isn't one. */
function useAttest(id: Identity) {
  const { signer, overview, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);

  async function attest(type: number, data: Hex, reference: Hex = ZERO32) {
    if (!overview) return false;
    setBusy(true);
    const r = await sendTx(signer, overview.adapter, adapterAbi, "attest", [type, id.ubid, reference, data]);
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

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * One form, one call. Without a transaction hash it is a RATING - the attester's opinion of the
 * agent as a whole, score plus optional review text, one live per attester, latest wins. With a
 * hash it is an INTERACTION - a record of that one dealing, score plus hash plus optional text,
 * which does not touch the agent-level rating.
 */
function AttestPanel({ id }: { id: Identity }) {
  const { attest, busy, signer, ready } = useAttest(id);
  // The connected wallet's live rating, if it has one: the slider starts there and the button
  // says "update", because a new rating replaces it rather than adding to it.
  const mine = signer ? id.reputation.ratings.find((r) => r.attester === signer.address)?.value : undefined;
  const [rating, setRating] = useState(mine ?? 80);
  const [text, setText] = useState("");
  const [reference, setReference] = useState("");
  useEffect(() => {
    if (mine !== undefined) setRating(mine);
  }, [mine, id.ubid]);

  if (!ready) return null;
  const review = text.trim();
  const ref = reference.trim();
  const refValid = ref === "" || TX_HASH.test(ref);
  const txHash = (refValid && ref ? ref.toLowerCase() : ZERO32) as Hex;
  const hasTx = txHash !== ZERO32;

  async function submit() {
    const ok = hasTx
      ? await attest(ATTESTATION_TYPES.INTERACTION, (toByteHex(rating) + txHash.slice(2) + utf8ToHex(review).slice(2)) as Hex, txHash)
      : await attest(ATTESTATION_TYPES.RATING, (toByteHex(rating) + utf8ToHex(review).slice(2)) as Hex);
    if (!ok) return;
    setText("");
    setReference("");
  }

  return (
    <Section label={signer ? `Leave feedback as ${signer.label}` : "Leave feedback"}>
      <div className="field">
        <label>Rating</label>
        <div className="row">
          <input type="range" min={0} max={100} value={rating} onChange={(e) => setRating(Number(e.target.value))} style={{ flex: "1 1 120px", maxWidth: 220, minWidth: 0 }} />
          <span className="num" style={{ width: 40, fontWeight: 600, flexShrink: 0 }}>{rating}</span>
          {mine !== undefined && !hasTx && <span className="hint">You rated this {mine}. Moving the slider updates it.</span>}
        </div>
      </div>

      <div className="field">
        <label>{hasTx ? "Note" : "Review"} <span className="t3">(optional)</span></label>
        <textarea
          className="textarea"
          placeholder={hasTx ? "What happened in this transaction." : "Review your experience with this agent…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Transaction hash <span className="t3">(optional)</span></label>
        <input
          className="input mono"
          placeholder="0x…"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <span className="hint" style={!refValid ? { color: "var(--danger)" } : undefined}>
          {!refValid
            ? "A transaction hash is 0x followed by 64 hex characters."
            : hasTx
              ? "You are rating a specific transaction."
              : "Rating a specific transaction? Paste its hash."}
        </span>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        {signer ? (
          <button className="btn btn-primary" disabled={busy || !refValid} onClick={submit}>
            {busy ? <Spinner /> : hasTx ? "Record transaction" : mine !== undefined ? "Update rating" : "Submit rating"}
          </button>
        ) : (
          <ConnectWalletButton />
        )}
        <span className="hint">
          {!signer
            ? "Feedback is signed by your wallet, so connect one first. What you've typed stays."
            : hasTx
              ? "One transaction - a record of this interaction."
              : mine !== undefined
                ? "One transaction. Replaces your current rating and review; the old ones stay in the history."
                : "One transaction."}
        </span>
      </div>
    </Section>
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
  // Not the holder: the manage panel simply doesn't appear. Who controls it is on the record.
  if (!canManage) return null;

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
          <div className="row wrap">
            <input className="input mono" style={{ flex: "1 1 120px", maxWidth: 220 }} placeholder="key" value={metaKey} onChange={(e) => setMetaKey(e.target.value)} />
            <input className="input" style={{ flex: "1 1 160px" }} placeholder="value" value={metaValue} onChange={(e) => setMetaValue(e.target.value)} />
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
          To use a different address, that address has to speak for itself: connect as it, open
          this profile, and confirm the claim in the banner at the top.
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

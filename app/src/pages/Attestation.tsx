import { useState } from "react";
import { Addr, Badge, Modal, Section, Spinner, StandardBadge, StatusBadge, Tip, TypeBadge, UbidCell, registrationOf } from "../components/ui";
import { api, NotFound, type AttestationView } from "../lib/api";
import { useApp, useLive, settle } from "../lib/app-state";
import { adapterAbi, displayName, explorerBlockUrl, explorerTxUrl, ZERO32 } from "../lib/chain";
import { sendTx } from "../lib/tx";
import { decodePayload } from "./Attestations";
import { AddressLink, TxRef } from "./Identity";

const TYPE_WORD: Record<string, string> = {
  STAR: "star",
  RATING: "rating",
  REVIEW: "review",
  INTERACTION: "transaction record",
  CONFIRM_ACCOUNT: "account confirmation",
};

/**
 * One statement, in full: what it says, who said it about whom, whether it still stands, and
 * the fields its id was recomputed from when the indexer let it in. The reputation on a profile
 * is a fold over statements like this one; this page is one of the inputs, unfolded.
 */
export function AttestationPage({ id }: { id: string }) {
  const { navigate } = useApp();
  const { data: a, status, error } = useLive(() => api.attestation(id), [id]);
  const [showPreimage, setShowPreimage] = useState(false);

  if (!a && status === "loading") return <div className="page"><Spinner /></div>;
  if (!a && error instanceof NotFound)
    return (
      <div className="page">
        <p className="t2">No statement with this id. <span className="t3">A statement whose id did not match its fields is dropped at indexing and never shown.</span> <button className="btn btn-ghost" onClick={() => navigate("/attestations")}>Back</button></p>
      </div>
    );
  if (!a) return <div className="page"><p className="t2">Can't reach the indexer - retrying every few seconds.</p></div>;

  const payload = decodePayload(a);
  const word = TYPE_WORD[a.typeName] ?? "statement";
  const about = a.target ? displayName(a.target) : `${a.ubid.slice(0, 12)}…`;
  const stands = !a.revoked && !a.supersededBy;

  return (
    <div className="page fade-in">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate("/attestations")}>← Attestations</button>
      <div className="page-head wrap" style={{ marginTop: 10, gap: 10, alignItems: "center", marginBottom: 4 }}>
        <h1 className="page-title" style={{ fontSize: 18 }}>A {word} about {about}</h1>
        <TypeBadge name={a.typeName} />
        {a.revoked ? <Badge tone="danger">revoked</Badge> : a.supersededBy ? <Badge tone="warn">replaced</Badge> : <Badge tone="ok">live</Badge>}
        {!payload.valid && <Badge tone="warn" tip="The payload does not follow this type's encoding, so it is on the record but does not count toward anything.">invalid payload</Badge>}
        <div className="head-actions"><RevokeButton a={a} /></div>
      </div>
      <p className="page-sub">
        {stands
          ? "This statement stands: it is counted in the profile's reputation."
          : a.revoked
            ? "Withdrawn by its attester. It stays on the record and in the history, and counts for nothing."
            : "A later statement by the same attester stands instead. For stars, ratings and account confirmations, the latest one per attester is the one that counts; the earlier ones stay in the history."}
      </p>

      <div className="stack">
        <Section label="The statement">
          <dl className="kv">
            <dt>About</dt>
            <dd>
              {a.target ? (
                <span className="row wrap" style={{ gap: 8 }}>
                  <button className="row" style={{ gap: 8 }} onClick={() => navigate(`/identity/${a.ubid}`)}>
                    <UbidCell ubid={a.ubid} image={a.target.image} registration={registrationOf(a.target)} />
                    <span className="agent-link">{displayName(a.target)}</span>
                  </button>
                  <StandardBadge id={a.target} />
                  <StatusBadge id={a.target} />
                </span>
              ) : (
                <span className="row wrap" style={{ gap: 8 }}>
                  <span className="mono t2">{a.ubid}</span>
                  <Badge tone="warn" tip="No claim or binding matches this UBID yet. The statement is kept and gains meaning if one arrives.">unresolved</Badge>
                </span>
              )}
            </dd>
            <dt>By</dt>
            <dd><AddressLink address={a.attester} /></dd>
            {a.typeName === "STAR" && (
              <>
                <dt>Value</dt>
                <dd>{payload.star ? "★ starred" : "withdrawn (0)"}</dd>
              </>
            )}
            {(a.typeName === "RATING" || a.typeName === "INTERACTION") && (
              <>
                <dt>Score</dt>
                <dd className="num">{payload.score ?? "?"}<span className="t3">/100</span></dd>
              </>
            )}
            {payload.text !== undefined && (
              <>
                <dt>{a.typeName === "INTERACTION" ? "Note" : "Review"}</dt>
                <dd style={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>{payload.text ? `"${payload.text}"` : <span className="t3">none</span>}</dd>
              </>
            )}
            {payload.reference !== undefined && (
              <>
                <dt>Transaction it is about</dt>
                <dd>{payload.reference ? <TxRef hash={payload.reference} /> : <span className="t3">none</span>}</dd>
              </>
            )}
            {a.typeName === "CONFIRM_ACCOUNT" && (
              <>
                <dt>Means</dt>
                <dd className="t2 small">The attester confirms it is an additional account of this identity. It counts while the identity's own metadata names the attester.</dd>
              </>
            )}
          </dl>
        </Section>

        <Section label="On the record">
          <dl className="kv">
            <dt>Attestation id</dt>
            <dd>
              <button className="agent-link mono" style={{ overflowWrap: "anywhere", textAlign: "left" }} title="What this id is a hash of" onClick={() => setShowPreimage(true)}>{a.attestationId}</button>
            </dd>
            <dt>Made in</dt>
            <dd className="small">
              {explorerBlockUrl(a.order.blockNumber) ? <a className="agent-link num" href={explorerBlockUrl(a.order.blockNumber)!} target="_blank" rel="noopener noreferrer">block {a.order.blockNumber}</a> : <span className="num">block {a.order.blockNumber}</span>}
              <span className="t3"> · log {a.order.logIndex}</span>
              {a.transactionHash && <> · {explorerTxUrl(a.transactionHash) ? <a className="agent-link mono" href={explorerTxUrl(a.transactionHash)!} target="_blank" rel="noopener noreferrer">{a.transactionHash.slice(0, 14)}…{a.transactionHash.slice(-6)}</a> : <span className="mono">{a.transactionHash.slice(0, 14)}…</span>}</>}
            </dd>
            <dt>State</dt>
            <dd>
              {a.revoked && a.revocation ? (
                <span className="small">
                  <Badge tone="danger">revoked</Badge> by <AddressLink address={a.revocation.revoker} /> in block <span className="num">{a.revocation.order.blockNumber}</span>
                  {a.revocation.transactionHash && explorerTxUrl(a.revocation.transactionHash) && <> · <a className="agent-link mono" href={explorerTxUrl(a.revocation.transactionHash)!} target="_blank" rel="noopener noreferrer">{a.revocation.transactionHash.slice(0, 14)}…</a></>}
                </span>
              ) : a.revoked ? (
                <Badge tone="danger">revoked</Badge>
              ) : a.supersededBy ? (
                <span className="small">
                  <Badge tone="warn">replaced</Badge> by a later {word} in block <span className="num">{a.supersededBy.order.blockNumber}</span> ·{" "}
                  <button className="agent-link" onClick={() => navigate(`/attestation/${a.supersededBy!.attestationId}`)}>open it</button>
                </span>
              ) : (
                <Badge tone="ok">live</Badge>
              )}
            </dd>
            <dt>Raw payload</dt>
            <dd className="mono small" style={{ overflowWrap: "anywhere" }}>{a.data === "0x" ? <span className="t3">empty</span> : a.data}</dd>
            <dt><Tip tip="The contract's 32-byte variant slot: hashed into the id, never interpreted by the contract. The explorer uses it for the transaction a statement is about. All zeros means none.">Reference</Tip></dt>
            <dd className="mono small" style={{ overflowWrap: "anywhere" }}>{a.variant === ZERO32 ? <span className="t3">none</span> : a.variant}</dd>
          </dl>
        </Section>

      </div>

      {showPreimage && (
        <Modal title="How the Attestation ID is calculated" width={760} onClose={() => setShowPreimage(false)}>
          <p className="t2 small" style={{ margin: "0 0 12px" }}>
            The ID is a hash of the eight fields below. The indexer recomputes it from the event's own fields before letting a statement in; one that doesn't match is dropped and never shown. So a statement on this page is one whose ID checks out.
          </p>
          <dl className="kv small">
            <dt>Chain</dt><dd className="num">{a.preimage.chainId}</dd>
            <dt>Adapter</dt><dd><Addr value={a.preimage.adapter} n={42} /></dd>
            <dt>Attester</dt><dd><Addr value={a.preimage.attester} n={42} /></dd>
            <dt>UBID</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{a.preimage.ubid}</dd>
            <dt>Type</dt><dd className="num">{a.preimage.attestationType} <span className="t3">({a.typeName})</span></dd>
            <dt>Block</dt>
            <dd className="num">{a.preimage.blockNumber}</dd>
            <dt><Tip tip="The reference slot, as hashed - zero when the statement is about no particular transaction.">Variant</Tip></dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{a.preimage.variant}</dd>
            <dt>Data</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{a.preimage.data}</dd>
            <dt>Attestation ID</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{a.attestationId}</dd>
          </dl>
          {a.preimage.blockNumber !== a.order.blockNumber && (
            <p className="hint" style={{ margin: "12px 0 0" }}>
              The block in the hash is the contract's block.number, which on this chain is the parent chain's block. The log itself is in block {a.order.blockNumber}.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

/** The attester's own way out: one transaction, and the statement stays on the record as revoked. */
function RevokeButton({ a }: { a: AttestationView }) {
  const { signer, overview, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  if (!signer || !overview || a.attester !== signer.address || a.revoked) return null;
  return (
    <button
      className="btn btn-sm btn-danger"
      disabled={busy}
      title="Withdraw this statement. It stays in the history as revoked - a position, not a deletion."
      onClick={async () => {
        setBusy(true);
        const r = await sendTx(signer, overview.adapter, adapterAbi, "revoke", [a.attestationId]);
        toast(r.message);
        await settle(refresh);
        setBusy(false);
      }}
    >
      {busy ? <Spinner /> : "Revoke"}
    </button>
  );
}

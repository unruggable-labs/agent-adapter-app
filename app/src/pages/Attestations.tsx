import { useEffect, useState } from "react";
import { Addr, Badge, ControllerCell, Modal, MultiSelect, registrationOf, SkeletonRows, Spinner, StandardBadge, Tip, TYPE_HUE, TypeBadge, UbidCell } from "../components/ui";
import { api, type AttestationRow } from "../lib/api";
import { useApp, useLive, settle } from "../lib/app-state";
import { adapterAbi, STANDARD_NAMES } from "../lib/chain";
import { sendTx } from "../lib/tx";

const PAGE_SIZE = 25;

export function AttestationsPage() {
  const { signer, overview, navigate, refresh, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [types, setTypes] = useState<string[]>([]);
  const [standards, setStandards] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);

  // The indexer filters, orders and slices; each row comes with the identity it is about.
  const attester = mineOnly && signer ? signer.address : undefined;
  const { data, status } = useLive(
    () => api.attestations({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, type: types, standard: standards, attester }),
    [page, types.join(","), standards.join(","), attester],
  );
  useEffect(() => setPage(0), [types.join(","), standards.join(","), attester]);

  const loading = !data && status === "loading";
  const shown = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const active = types.length + standards.length + (mineOnly ? 1 : 0);

  return (
    <div className="page page-wide fade-in">
      <div className="page-head">
        <h1 className="page-title">Attestations</h1>
        <div className="head-actions">
          <button className={`btn btn-sm${active ? " is-active" : ""}`} onClick={() => setShowFilters(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" />
            </svg>
            Filter{active > 0 && <span className="num"> · {active}</span>}
          </button>
        </div>
      </div>
      <p className="page-sub">
        Public statements about agents.
      </p>

      <div className="card card-table table-scroll">
        <table className="table clickable">
          <thead>
            <tr>
              <th><Tip tip="The identity the statement is about. The mark beside it: a chain link means an ERC-8004 agent is minted for it, a dashed ring means it is a counterfactual claim only, a dotted ring means nothing has claimed it yet.">UBID</Tip></th><th>Type</th><th>Standard</th><th>Controller</th><th>Attester</th><th>Payload</th><th className="td-right">Block</th><th>State</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => {
              const target = a.target ?? null;
              return (
                <tr key={a.attestationId} className={target ? undefined : "is-static"} onClick={target ? () => navigate(`/identity/${a.ubid}`) : undefined}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <UbidCell ubid={a.ubid} image={target?.image} registration={target ? registrationOf(target) : "none"} />
                      {!target && <Badge tone="warn" tip="No claim or binding matches this UBID yet. The statement is kept and gains meaning if one arrives.">unresolved</Badge>}
                    </span>
                  </td>
                  <td><TypeBadge name={a.typeName} /></td>
                  <td>{target ? <StandardBadge id={target} /> : <span className="t3">—</span>}</td>
                  <td>{target ? <ControllerCell id={target} /> : <span className="t3">—</span>}</td>
                  <td><Addr value={a.attester} n={8} /></td>
                  <td className="mono t2" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {payloadPreview(a)}
                  </td>
                  <td className="td-right num">{a.order.blockNumber}</td>
                  <td>{a.revoked ? <Badge tone="danger">revoked</Badge> : <Badge tone="ok">live</Badge>}</td>
                  <td className="td-right">
                    {a.attester === signer?.address && !a.revoked && (
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy === a.attestationId}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setBusy(a.attestationId);
                          const r = await sendTx(signer, overview!.adapter, adapterAbi, "revoke", [a.attestationId]);
                          toast(r.message);
                          await settle(refresh);
                          setBusy(null);
                        }}
                      >
                        {busy === a.attestationId ? <Spinner /> : "Revoke"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {loading && <SkeletonRows widths={[0, 40, 50, 60, 55, 70, 35, 30, 20]} />}
            {!data && status === "error" && (
              <tr className="is-static"><td colSpan={9}><div className="empty">Can't reach the indexer - retrying every few seconds.</div></td></tr>
            )}
            {data && total === 0 && (
              <tr className="is-static"><td colSpan={9}><div className="empty">{active ? "Nothing matches these filters." : "No attestations yet."}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="row" style={{ marginTop: 10, justifyContent: "flex-end", gap: 8 }}>
          <span className="hint num">
            {current * PAGE_SIZE + 1}-{Math.min((current + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <button className="btn btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Prev</button>
          <button className="btn btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      )}

      {showFilters && (
        <Modal title="Filter attestations" onClose={() => setShowFilters(false)}>
          <div className="field">
            <label>Type</label>
            <MultiSelect
              options={Object.keys(TYPE_HUE)}
              values={types}
              onChange={setTypes}
              placeholder="Any type"
              render={(t) => <TypeBadge name={t} />}
            />
          </div>
          <div className="field">
            <label>Standard</label>
            <MultiSelect
              options={STANDARD_NAMES}
              values={standards}
              onChange={setStandards}
              placeholder="Any standard"
              render={(n) => <StandardBadge name={n} />}
            />
            <span className="hint">A standard filter hides statements about UBIDs nothing has claimed yet.</span>
          </div>
          {signer && (
            <div className="field">
              <label className="ms-option" style={{ padding: 0, fontSize: 12.5 }}>
                <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                Only statements made by {signer.label}
              </label>
            </div>
          )}
          <div className="row spread" style={{ marginTop: 16 }}>
            <button className="btn btn-ghost btn-sm" disabled={!active} onClick={() => { setTypes([]); setStandards([]); setMineOnly(false); }}>Clear</button>
            <button className="btn btn-primary" onClick={() => setShowFilters(false)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function payloadPreview(a: AttestationRow): string {
  if (a.typeName === "STAR") return a.data === "0x01" ? "★ 1" : "0";
  if (a.typeName === "RATING") {
    const text = a.data.length > 4 ? utf8("0x" + a.data.slice(4)) : "";
    return `${parseInt(a.data.slice(2, 4), 16)}/100${text ? ` ${text}` : ""}`;
  }
  if (a.typeName === "CONFIRM_ACCOUNT") return "—";
  if (a.typeName === "REVIEW") return utf8(a.data);
  if (a.typeName === "INTERACTION") {
    const raw = a.data.slice(2);
    return `${parseInt(raw.slice(0, 2), 16)}/100 ${utf8("0x" + raw.slice(66))}`;
  }
  return a.data;
}

function utf8(hex: string): string {
  const bytes = hex.slice(2).match(/.{2}/g) ?? [];
  try {
    return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
  } catch {
    return hex;
  }
}

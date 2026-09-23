import { useEffect, useState } from "react";
import { Addr, Badge, ControllerCell, Modal, MultiSelect, registrationOf, Spinner, StandardBadge, Tip, TYPE_HUE, TypeBadge, UbidCell } from "../components/ui";
import { api, type AttestationRow } from "../lib/api";
import { useApp, settle } from "../lib/app-state";
import { adapterAbi, shortHex, STANDARD_NAMES } from "../lib/chain";
import { sendTx } from "../lib/tx";

export function AttestationsPage() {
  const { signer, overview, identities, navigate, refresh, toast } = useApp();
  const [rows, setRows] = useState<AttestationRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [types, setTypes] = useState<string[]>([]);
  const [standards, setStandards] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const load = () => api.attestations().then(setRows).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  if (!rows || !overview) return <div className="page"><Spinner /></div>;
  const standardOf = (ubid: string) => identities.find((i) => i.ubid === ubid)?.standardName ?? null;
  const shown = rows
    .filter((r) => !mineOnly || r.attester === signer?.address)
    .filter((r) => types.length === 0 || types.includes(r.typeName))
    .filter((r) => standards.length === 0 || standards.includes(standardOf(r.ubid) ?? ""))
    .sort((a, b) => Number(b.order.blockNumber) - Number(a.order.blockNumber) || b.order.logIndex - a.order.logIndex);
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

      <div className="card table-scroll" style={{ padding: "4px 14px" }}>
        <table className="table clickable">
          <thead>
            <tr>
              <th><Tip tip="The identity the statement is about. The mark beside it: a chain link means an ERC-8004 agent is minted for it, a dashed ring means it is a counterfactual claim only, a dotted ring means nothing has claimed it yet.">UBID</Tip></th><th>Type</th><th>Standard</th><th>Controller</th><th>Attester</th><th>Payload</th><th className="td-right">Block</th><th>State</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => {
              const target = identities.find((i) => i.ubid === a.ubid);
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
                          const r = await sendTx(signer, overview.adapter, adapterAbi, "revoke", [a.attestationId]);
                          toast(r.message);
                          await settle(refresh);
                          await load();
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
            {shown.length === 0 && (
              <tr><td colSpan={9}><div className="empty">{active ? "Nothing matches these filters." : "Nothing here yet."}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

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
  if (a.typeName === "RATING") return `${parseInt(a.data.slice(2), 16)}/100`;
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

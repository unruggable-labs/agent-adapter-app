import { useEffect, useState, type ReactNode } from "react";
import { Addr, Badge, ControllerCell, Spinner, StandardBadge, TYPE_HUE, TypeBadge, UbidCell } from "../components/ui";
import { api, type AttestationRow } from "../lib/api";
import { useApp, settle } from "../lib/app-state";
import { adapterAbi, shortHex, STANDARD_NAMES } from "../lib/chain";
import { sendTx } from "../lib/tx";

export function AttestationsPage() {
  const { signer, overview, identities, navigate, refresh, toast } = useApp();
  const [rows, setRows] = useState<AttestationRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [standardFilter, setStandardFilter] = useState<string | null>(null);

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
    .filter((r) => !typeFilter || r.typeName === typeFilter)
    .filter((r) => !standardFilter || standardOf(r.ubid) === standardFilter)
    .sort((a, b) => Number(b.order.blockNumber) - Number(a.order.blockNumber) || b.order.logIndex - a.order.logIndex);
  const filtered = typeFilter !== null || standardFilter !== null;

  return (
    <div className="page page-wide fade-in">
      <div className="page-head">
        <h1 className="page-title">Attestations</h1>
        <div className="head-actions">
          <div className="seg">
            <button className={!mineOnly ? "active" : ""} onClick={() => setMineOnly(false)}>All</button>
            <button className={mineOnly ? "active" : ""} onClick={() => setMineOnly(true)}>{signer ? `${signer.label}'s` : "Mine"}</button>
          </div>
        </div>
      </div>
      <p className="page-sub">
        Public statements about agents.
      </p>

      <div className="filters">
        <span className="filters-label">Type</span>
        <span className="filters-row">
          <FilterChip on={typeFilter === null} onClick={() => setTypeFilter(null)}><Badge tone="outline">all</Badge></FilterChip>
          {Object.keys(TYPE_HUE).map((t) => (
            <FilterChip key={t} on={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? null : t)}><TypeBadge name={t} /></FilterChip>
          ))}
        </span>
        <span className="filters-label">Standard</span>
        <span className="filters-row">
          <FilterChip on={standardFilter === null} onClick={() => setStandardFilter(null)}><Badge tone="outline">all</Badge></FilterChip>
          {STANDARD_NAMES.map((n) => (
            <FilterChip key={n} on={standardFilter === n} onClick={() => setStandardFilter(standardFilter === n ? null : n)}><StandardBadge name={n} /></FilterChip>
          ))}
        </span>
      </div>

      <div className="card table-scroll" style={{ padding: "4px 14px" }}>
        <table className="table clickable">
          <thead>
            <tr>
              <th>UBID</th><th>Type</th><th>Standard</th><th>Controller</th><th>Attester</th><th>Payload</th><th className="td-right">Block</th><th>State</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => {
              const target = identities.find((i) => i.ubid === a.ubid);
              return (
                <tr key={a.attestationId} className={target ? undefined : "is-static"} onClick={target ? () => navigate(`/identity/${a.ubid}`) : undefined}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <UbidCell ubid={a.ubid} />
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
              <tr><td colSpan={9}><div className="empty">{filtered ? "Nothing matches these filters." : "Nothing here yet."}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A badge as a toggle. The badge supplies the colour; this supplies the on/off state. */
function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`filter-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function payloadPreview(a: AttestationRow): string {
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

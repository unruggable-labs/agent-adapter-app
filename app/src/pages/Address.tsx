import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { Addr, Badge, ControllerCell, registrationOf, Section, StandardBadge, Spinner, Stat, StatusBadge, TypeBadge, UbidCell } from "../components/ui";
import { api, type AttestationRow, type Identity } from "../lib/api";
import { useApp } from "../lib/app-state";
import { displayName, explorerAddressUrl, plural, pluralise } from "../lib/chain";
import { payloadPreview } from "./Attestations";

/**
 * Everything the registry knows about one address: whether it is an agent itself, which agent it
 * operates (and whether that link is verified both ways), what it holds or controls, what is bound
 * to it, and every statement it has made. Read-only; the actions live on the profiles.
 */
export function AddressPage({ address }: { address: string }) {
  const { identities, status, navigate } = useApp();
  const addr = address.toLowerCase();
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof api.wallet>> | undefined>(undefined);
  const [rows, setRows] = useState<AttestationRow[] | null>(null);

  useEffect(() => {
    if (!isAddress(addr)) return;
    let cancelled = false;
    api.wallet(addr).then((w) => !cancelled && setWallet(w)).catch(() => !cancelled && setWallet(null));
    api.attestations().then((r) => !cancelled && setRows(r.filter((a) => a.attester === addr))).catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [addr, identities.length]);

  if (!isAddress(addr)) return <div className="page"><p className="t2">That's not an address.</p></div>;

  const self = identities.find((i) => i.standard === 5 && i.boundAddress === addr) ?? null;
  const operates: Identity | null = wallet?.designation ? identities.find((i) => i.ubid === wallet!.designation!.ubid) ?? null : null;
  const namedBy = identities.filter((i) => i.agentWallet === addr && i.ubid !== operates?.ubid);
  const holds = identities.filter((i) => i.currentControllerHolder === addr && i.boundAddress !== addr);
  const boundHere = identities.filter((i) => i.boundAddress === addr && i.standard !== 5);
  const explorer = explorerAddressUrl(addr);
  const loading = status === "loading" && identities.length === 0;

  return (
    <div className="page fade-in">
      <div className="page-head wrap" style={{ gap: 12, alignItems: "center", marginBottom: 18 }}>
        <span className="addr-mark" aria-hidden>@</span>
        <div style={{ display: "grid", gap: 4, minWidth: 0, flex: 1 }}>
          <h1 className="page-title mono" style={{ fontSize: 16, overflowWrap: "anywhere" }}>{addr}</h1>
          <span className="row wrap" style={{ gap: 8 }}>
            <Addr value={addr} n={10} />
            {explorer && <a className="agent-link small" href={explorer} target="_blank" rel="noopener noreferrer">Etherscan</a>}
          </span>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 18 }}>
        <Stat n={self ? "Yes" : "No"} label="is an agent itself" />
        <Stat n={operates ? (wallet?.verified ? "Yes" : "Claimed") : "No"} label="operates an agent" />
        <Stat n={holds.length} label={(holds.length === 1 ? "identity" : "identities") + " held or controlled"} />
        <Stat n={rows ? rows.length : "…"} label={pluralise(rows?.length ?? 0, "statement") + " made"} />
      </div>

      <div className="stack">
        <Section label="As an agent">
          {loading ? <Spinner /> : self ? (
            <IdentityTable rows={[{ id: self, note: "this address is the agent", tone: "ok" }]} />
          ) : (
            <p className="t2 small" style={{ margin: 0 }}>Not an agent itself. Nothing has claimed this address as an ACCOUNT identity.</p>
          )}
        </Section>

        <Section label="Operates">
          {wallet === undefined ? <Spinner /> : operates ? (
            <IdentityTable rows={[{ id: operates, note: wallet?.verified ? "verified both ways" : "this wallet says so; the agent doesn't say it back", tone: wallet?.verified ? "ok" : "warn" }]} />
          ) : (
            <p className="t2 small" style={{ margin: 0 }}>This address doesn't point at any agent as its operating wallet.</p>
          )}
          {namedBy.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="section-label">Named as operating wallet by</div>
              <IdentityTable rows={namedBy.map((id) => ({ id, note: "one-directional claim", tone: "warn" }))} />
              <p className="hint" style={{ marginTop: 8 }}>These agents name this wallet, but the wallet has not pointed back. Either half alone is easy to fake.</p>
            </div>
          )}
        </Section>

        <Section label={`Holds or controls · ${holds.length} ${holds.length === 1 ? "identity" : "identities"}`}>
          {loading ? <Spinner /> : holds.length === 0 ? (
            <p className="t2 small" style={{ margin: 0 }}>No tokens or contracts this address currently controls have identities.</p>
          ) : (
            <IdentityTable rows={holds.map((id) => ({ id, note: id.standard <= 4 ? "holds the token" : "owner" }))} />
          )}
        </Section>

        {boundHere.length > 0 && (
          <Section label={`Bound to this address · ${boundHere.length} ${boundHere.length === 1 ? "identity" : "identities"}`}>
            <p className="t2 small" style={{ margin: "0 0 8px" }}>This address is a contract that identities are bound to - a collection, or a contract controlled by its owner or admins.</p>
            <IdentityTable rows={boundHere.slice(0, 25).map((id) => ({ id }))} />
            {boundHere.length > 25 && <p className="hint">and {boundHere.length - 25} more</p>}
          </Section>
        )}

        <Section label={`Statements made · ${rows ? plural(rows.length, "statement") : "…"}`}>
          {!rows ? <Spinner /> : rows.length === 0 ? (
            <p className="t2 small" style={{ margin: 0 }}>This address has not attested to anything.</p>
          ) : (
            <div className="table-scroll">
              <table className="table clickable">
                <thead><tr><th>Type</th><th>About</th><th>Payload</th><th className="td-right">Block</th><th>State</th></tr></thead>
                <tbody>
                  {[...rows].sort((a, b) => Number(b.order.blockNumber) - Number(a.order.blockNumber) || b.order.logIndex - a.order.logIndex).map((a) => {
                    const target = identities.find((i) => i.ubid === a.ubid);
                    return (
                      <tr key={a.attestationId} className={target ? undefined : "is-static"} onClick={target ? () => navigate(`/identity/${a.ubid}`) : undefined}>
                        <td><TypeBadge name={a.typeName} /></td>
                        <td>{target ? <span className="row" style={{ gap: 8 }}><UbidCell ubid={a.ubid} image={target.image} registration={registrationOf(target)} /><span className="t2 small">{displayName(target)}</span></span> : <span className="mono t3">{a.ubid.slice(0, 12)}…</span>}</td>
                        <td className="mono t2" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{payloadPreview(a)}</td>
                        <td className="td-right num">{a.order.blockNumber}</td>
                        <td>{a.revoked ? <Badge tone="danger">revoked</Badge> : <Badge tone="ok">live</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/** Identities as a table, in the identities page's columns, plus why each one is listed here. */
function IdentityTable({ rows }: { rows: { id: Identity; note?: string; tone?: string }[] }) {
  const { navigate } = useApp();
  const withNotes = rows.some((r) => r.note);
  return (
    <div className="table-scroll">
      <table className="table clickable">
        <thead>
          <tr><th>UBID</th><th>Standard</th><th>Controller</th><th>Registration</th>{withNotes && <th>Why it's here</th>}</tr>
        </thead>
        <tbody>
          {rows.map(({ id, note, tone }) => (
            <tr key={id.ubid} onClick={() => navigate(`/identity/${id.ubid}`)}>
              <td><UbidCell ubid={id.ubid} image={id.image} registration={registrationOf(id)} /></td>
              <td><StandardBadge id={id} /></td>
              <td><ControllerCell id={id} /></td>
              <td><StatusBadge id={id} /></td>
              {withNotes && <td>{note && <Badge tone={tone ?? "outline"}>{note}</Badge>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

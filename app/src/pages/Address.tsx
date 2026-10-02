import { useState } from "react";
import { isAddress } from "viem";
import { Badge, ControllerCell, registrationOf, Section, StandardBadge, Spinner, Stat, StatusBadge, Tip, TypeBadge, UbidCell } from "../components/ui";
import { api, type Identity } from "../lib/api";
import { useApp, useLive } from "../lib/app-state";
import { displayName, explorerAddressUrl, explorerName, plural, pluralise } from "../lib/chain";
import { payloadPreview } from "./Attestations";

/**
 * Everything the registry knows about one address: whether it is an agent, which agent it
 * operates (and whether that link is verified both ways), what it holds or controls, what is bound
 * to it, and every statement it has made. One question to the indexer (/api/address), kept live.
 * Read-only; the actions live on the profiles.
 */
export function AddressPage({ address }: { address: string }) {
  const { navigate } = useApp();
  const addr = address.toLowerCase();
  const { data, status } = useLive(() => (isAddress(addr) ? api.address(addr) : null), [addr]);

  if (!isAddress(addr)) return <div className="page"><p className="t2">That's not an address.</p></div>;

  const self = data?.self ?? null;
  const operates = data?.operates ?? null;
  const namedBy = data?.namedBy ?? [];
  const holds = data?.holds ?? [];
  const boundHere = data?.boundHere ?? [];
  const rows = data?.statements ?? null;
  const explorer = explorerAddressUrl(addr);
  const loading = !data && status === "loading";

  return (
    <div className="page fade-in">
      <div className="page-head wrap" style={{ gap: 12, alignItems: "center", marginBottom: 18 }}>
        <span className="addr-mark" aria-hidden>@</span>
        <div style={{ display: "grid", gap: 4, minWidth: 0, flex: 1 }}>
          <h1 className="page-title mono" style={{ fontSize: 16, overflowWrap: "anywhere" }}>{addr}</h1>
          <span className="row wrap" style={{ gap: 8 }}>
            <CopyAddress value={addr} />
            {explorer && <a className="agent-link small" href={explorer} target="_blank" rel="noopener noreferrer">View on {explorerName()}</a>}
          </span>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 18 }}>
        <Stat n={loading ? "…" : self ? "Yes" : "No"} label="is an agent" />
        <Stat n={loading ? "…" : operates ? (operates.verified ? "Yes" : "Claimed") : "No"} label="operating wallet of an agent" />
        <Stat n={loading ? "…" : holds.length} label={(holds.length === 1 ? "identity" : "identities") + " held or controlled"} />
        <Stat n={rows ? rows.length : "…"} label={pluralise(rows?.length ?? 0, "statement") + " made"} />
      </div>

      {!data && status === "error" && <div className="empty">Can't reach the indexer - retrying every few seconds.</div>}

      <div className="stack">
        <Section label="Agent">
          {loading ? <Spinner /> : self ? (
            <IdentityTable rows={[{ id: self }]} />
          ) : (
            <p className="t2 small" style={{ margin: 0 }}>This address is not an agent.</p>
          )}
        </Section>

        <Section label="Operating wallet">
          {loading ? <Spinner /> : !operates && namedBy.length === 0 ? (
            <p className="t2 small" style={{ margin: 0 }}>This address is not the operating wallet for any known agent.</p>
          ) : (
            <IdentityTable
              rows={[
                ...(operates ? [{ id: operates.identity, link: (operates.verified ? "both" : "wallet-only") as LinkState }] : []),
                ...namedBy.map((id) => ({ id, link: "agent-only" as LinkState })),
              ]}
            />
          )}
        </Section>

        <Section label={`Holds or controls · ${holds.length} ${holds.length === 1 ? "identity" : "identities"}`}>
          {loading ? <Spinner /> : holds.length === 0 ? (
            <p className="t2 small" style={{ margin: 0 }}>No tokens or contracts this address currently controls have agent identities.</p>
          ) : (
            <IdentityTable rows={holds.map((id) => ({ id, note: id.standard <= 4 ? "holds the token" : "owner" }))} />
          )}
        </Section>

        {boundHere.length > 0 && (
          <Section label={`Bound to this address · ${data!.boundHereTotal} ${data!.boundHereTotal === 1 ? "identity" : "identities"}`}>
            <p className="t2 small" style={{ margin: "0 0 8px" }}>This address is a contract that identities are bound to - a collection, or a contract controlled by its owner or admins.</p>
            <IdentityTable rows={boundHere.map((id) => ({ id }))} />
            {data!.boundHereTotal > boundHere.length && <p className="hint">and {data!.boundHereTotal - boundHere.length} more</p>}
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
                  {rows.map((a) => {
                    const target = a.target ?? null;
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

/** A small copy control for the address shown in full above it. */
function CopyAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 900); }}>
      {copied ? "Copied" : "Copy address"}
    </button>
  );
}

/** How a wallet link stands between this address and an agent. */
type LinkState = "both" | "wallet-only" | "agent-only";

const LINK_TIP: Record<LinkState, string> = {
  both: "Verified both ways: this wallet points at the agent, and the agent names this wallet.",
  "wallet-only": "One way: this wallet points at the agent, but the agent does not name this wallet. Not verified.",
  "agent-only": "One way: the agent names this wallet, but this wallet has not pointed back. Not verified.",
};

/** Two arrows for a verified link, one arrow in the direction of the single claim. */
function LinkMark({ state }: { state: LinkState }) {
  const tone = state === "both" ? "var(--ok)" : "var(--warn)";
  return (
    <Tip tip={LINK_TIP[state]}>
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke={tone} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-label={LINK_TIP[state]}>
        {state !== "agent-only" && <path d="M2 4h13M12 1l3 3-3 3" />}
        {state !== "wallet-only" && <path d="M16 10H3M6 7l-3 3 3 3" />}
      </svg>
    </Tip>
  );
}

/** Identities as a table, in the identities page's columns, plus why each one is listed here. */
function IdentityTable({ rows }: { rows: { id: Identity; note?: string; tone?: string; link?: LinkState }[] }) {
  const { navigate } = useApp();
  const withNotes = rows.some((r) => r.note);
  const withLink = rows.some((r) => r.link);
  return (
    <div className="table-scroll">
      <table className="table clickable">
        <thead>
          <tr><th>UBID</th><th>Standard</th><th>Controller</th><th>Registration</th>{withLink && <th><Tip tip="Whether the wallet link is confirmed from both sides. Either side alone is a claim.">Link</Tip></th>}{withNotes && <th>Why it's here</th>}</tr>
        </thead>
        <tbody>
          {rows.map(({ id, note, tone, link }) => (
            <tr key={id.ubid} onClick={() => navigate(`/identity/${id.ubid}`)}>
              <td><UbidCell ubid={id.ubid} image={id.image} registration={registrationOf(id)} /></td>
              <td><StandardBadge id={id} /></td>
              <td><ControllerCell id={id} /></td>
              <td><StatusBadge id={id} /></td>
              {withLink && <td>{link && <LinkMark state={link} />}</td>}
              {withNotes && <td>{note && <Badge tone={tone ?? "outline"}>{note}</Badge>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

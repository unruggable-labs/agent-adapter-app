import { useState } from "react";
import { Addr, Badge, Callout, Section, Spinner } from "../components/ui";
import { useApp, settle } from "../lib/app-state";
import { adapterAbi, shortHex } from "../lib/chain";
import { sendTx } from "../lib/tx";

/** The acting persona's own view: their UBID designation, verification state, and the
 *  chain-derived inbox — identities that name this wallet, with the reciprocal action inline. */
export function WalletPage() {
  const { actor, actorIndex, identities, overview, navigate, refresh, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);

  if (!overview) return <div className="page"><Spinner /></div>;

  const designated = identities.find(
    (i) => i.agentWallet === actor.address || false,
  );
  // wallet -> ubid designation comes from the identity list: an identity whose agentWallet is us
  // AND whose flags say mutual. For the designation itself we use the identities' walletUnverified flag.
  const pointingAtMe = identities.filter((i) => i.agentWallet === actor.address);
  const namingMe = identities.filter((i) =>
    Object.entries(i.metadata).some(
      ([k, v]) => (k === "account" || k.startsWith("account[")) && v.toLowerCase().includes(actor.address.slice(2)),
    ),
  );

  async function run(key: string, fn: string, args: unknown[]) {
    setBusy(key);
    const r = await sendTx(actorIndex, overview!.adapter, adapterAbi, fn, args);
    toast(r.message);
    if (r.ok) await settle(refresh);
    setBusy(null);
  }

  return (
    <div className="page page-narrow fade-in">
      <div className="page-head">
        <h1 className="page-title">My wallet</h1>
        <Badge tone="outline">{actor.name}</Badge>
      </div>
      <p className="page-sub"><Addr value={actor.address} n={16} /></p>

      <div className="stack">
        <Section label="Identities naming this wallet">
          {pointingAtMe.length === 0 && <div className="empty">No identity currently names {actor.name}'s address as its agent wallet.</div>}
          {pointingAtMe.map((i) => (
            <div key={i.ubid} className="row spread" style={{ padding: "6px 0" }}>
              <span className="row">
                <button className="addr" onClick={() => navigate(`/identity/${i.ubid}`)}>{shortHex(i.ubid, 12)}</button>
                <span className="t3 small">{i.standardName}{i.standard < 5 ? ` #${i.tokenId}` : ""}</span>
                {i.flags.walletUnverified ? <Badge tone="warn">not pointed back</Badge> : <Badge tone="ok">mutually verified</Badge>}
              </span>
              {i.flags.walletUnverified && (
                <button
                  className="btn btn-sm"
                  disabled={busy === i.ubid}
                  onClick={() => run(i.ubid, "setWalletUBID", [i.standard, i.boundAddress, BigInt(i.tokenId)])}
                >
                  {busy === i.ubid ? <Spinner /> : "Point back"}
                </button>
              )}
            </div>
          ))}
          <p className="hint" style={{ marginTop: 8 }}>
            Pointing back is a self-assertion: it moves no assets, grants nothing, and you can
            overwrite or clear it at any time. Verification exists only when both directions agree.
          </p>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn btn-sm btn-ghost" disabled={busy === "clear"} onClick={() => run("clear", "clearWalletUBID", [])}>
              {busy === "clear" ? <Spinner /> : "Clear my designation"}
            </button>
          </div>
        </Section>

        {namingMe.length > 0 && (
          <Callout tone="ok" title="Pending confirmations.">
            <span> </span>{namingMe.length} identit{namingMe.length === 1 ? "y" : "ies"} list this address in their
            forward account metadata — open {namingMe.map((i, ix) => (
              <span key={i.ubid}>{ix > 0 && ", "}<button className="addr" onClick={() => navigate(`/identity/${i.ubid}`)}>{shortHex(i.ubid, 10)}</button></span>
            ))} to confirm or ignore.
          </Callout>
        )}

        {designated && null}
      </div>
    </div>
  );
}

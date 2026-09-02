import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { Addr, Badge, Callout, Section, Spinner, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { useApp, settle } from "../lib/app-state";
import { adapterAbi, displayName } from "../lib/chain";
import { sendTx } from "../lib/tx";

/**
 * The wallet holder's side of the system, in their terms: which agent speaks for this wallet,
 * which agents claim it, and the reciprocal actions. Every prompt here is derived from indexed
 * chain state — never from link parameters.
 */
export function WalletPage() {
  const { actor, actorIndex, identities, overview, navigate, refresh, toast } = useApp();
  const [designatedUbid, setDesignatedUbid] = useState<Hex | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setDesignatedUbid(null);
    api.wallet(actor.address).then((w) => setDesignatedUbid(w?.designation?.ubid ?? null)).catch(() => {});
  }, [actor.address, identities]);

  if (!overview) return <div className="page"><Spinner /></div>;

  const myAgent = designatedUbid ? identities.find((i) => i.ubid === designatedUbid) ?? null : null;
  const myAgentVerified = myAgent?.agentWallet === actor.address;
  const claims = identities.filter((i) => i.agentWallet === actor.address && i.ubid !== designatedUbid);
  const listingMe = identities.filter(
    (i) =>
      Object.entries(i.metadata).some(
        ([k, v]) => (k === "account" || k.startsWith("account[")) && v.toLowerCase().includes(actor.address.slice(2)),
      ) && !i.reputation.confirmedAccounts.some((c) => c.attester === actor.address),
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
      <p className="page-sub">
        <Addr value={actor.address} n={44} />
      </p>
      <p className="t2 small" style={{ margin: "0 0 18px", maxWidth: 560 }}>
        On its own, an address is just a number. Anyone who sees a transaction from this wallet
        can ask <i>"who operates it?"</i> — this page controls the answer.
      </p>

      <div className="stack">
        <Section label="What this address resolves to">
          {myAgent ? (
            <>
              <div className="row wrap" style={{ gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{displayName(myAgent)}</span>
                <span className="t3 small">{myAgent.subjectLabel}</span>
                <StatusBadge id={myAgent} />
                {myAgentVerified
                  ? <Badge tone="ok">verified both ways</Badge>
                  : <Badge tone="warn">agent doesn't say it back</Badge>}
              </div>
              <p className="t2 small" style={{ margin: "8px 0 0" }}>
                {myAgentVerified
                  ? <>Someone looking up this address finds {displayName(myAgent)} — and can trust it, because {displayName(myAgent)} also names this wallet as its own. Your wallet carries its reputation.</>
                  : <>You say this wallet is operated by {displayName(myAgent)}, but {displayName(myAgent)} doesn't currently say it back. Until its controller names this wallet on the agent's side, lookups will show the link as unverified — either half alone is easy to fake.</>}
              </p>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => navigate(`/identity/${myAgent.ubid}`)}>View agent</button>
                <button className="btn btn-ghost" disabled={busy === "clear"} onClick={() => run("clear", "clearWalletUBID", [])}>
                  {busy === "clear" ? <Spinner /> : "Unlink"}
                </button>
              </div>
            </>
          ) : (
            <p className="t2" style={{ margin: 0 }}>
              Nothing — lookups of this address find no agent. To change that, accept a request
              below, or open an agent you control and use "Link my wallet".
            </p>
          )}
        </Section>

        {claims.length > 0 && (
          <Section label="Agents that say this is their wallet">
            {claims.map((i) => (
              <div key={i.ubid} className="row spread" style={{ padding: "7px 0" }}>
                <span className="row wrap" style={{ gap: 8 }}>
                  <button style={{ fontWeight: 600 }} onClick={() => navigate(`/identity/${i.ubid}`)}>{displayName(i)}</button>
                  <span className="t3 small">{i.subjectLabel}</span>
                  <StatusBadge id={i} />
                </span>
                <button
                  className="btn btn-sm"
                  disabled={busy === i.ubid}
                  onClick={() => run(i.ubid, "setWalletUBID", [i.standard, i.boundAddress, BigInt(i.tokenId)])}
                >
                  {busy === i.ubid ? <Spinner /> : "Confirm it's mine"}
                </button>
              </div>
            ))}
            <p className="hint" style={{ marginTop: 8 }}>
              Each of these declared "{actor.name}'s address is my operating wallet" — a claim
              that needed no permission from you and proves nothing by itself. If one really is
              your agent, confirm it and the link becomes verified. Confirming moves no assets
              and grants no authority; ignoring a false claim is always safe.
            </p>
          </Section>
        )}

        {listingMe.length > 0 && (
          <Callout tone="ok" title="One more thing:">
            <span> </span>
            {listingMe.map((i, ix) => (
              <span key={i.ubid}>
                {ix > 0 && " · "}
                <b>{displayName(i)}</b> lists your address among its accounts —{" "}
                <button className="addr" onClick={() => navigate(`/identity/${i.ubid}`)}>review and confirm</button>
              </span>
            ))}
          </Callout>
        )}

        {!myAgent && claims.length === 0 && listingMe.length === 0 && (
          <p className="hint">
            Nothing needs your attention. When an agent names this wallet, the request will
            appear here for you to accept or ignore.
          </p>
        )}
      </div>
    </div>
  );
}

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
      <p className="page-sub"><Addr value={actor.address} n={44} /></p>

      <div className="stack">
        <Section label="The agent that speaks for this wallet">
          {myAgent ? (
            <>
              <div className="row wrap" style={{ gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{displayName(myAgent)}</span>
                <span className="t3 small">{myAgent.subjectLabel}</span>
                <StatusBadge id={myAgent} />
                {myAgentVerified
                  ? <Badge tone="ok">verified both ways</Badge>
                  : <Badge tone="warn">not confirmed by the agent</Badge>}
              </div>
              <p className="t2 small" style={{ margin: "8px 0 0" }}>
                {myAgentVerified
                  ? <>You chose this agent and it names your wallet back, so anyone checking the link can trust it.</>
                  : <>You chose this agent, but it doesn't currently name your wallet — the link won't pass verification until its controller adds your wallet on the agent's side.</>}
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
              None yet. A wallet can name one agent as the one that acts for it — accept a
              request below, or open an agent you control and use "Link my wallet".
            </p>
          )}
        </Section>

        {claims.length > 0 && (
          <Section label="Agents that claim this wallet">
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
                  {busy === i.ubid ? <Spinner /> : "Accept as my agent"}
                </button>
              </div>
            ))}
            <p className="hint" style={{ marginTop: 8 }}>
              Each of these says "{actor.name}'s wallet is my operating wallet." That claim costs
              them nothing and needed no permission from you — it only becomes meaningful if you
              accept it. Accepting moves no assets and grants nothing, replaces any current choice
              above, and you can unlink at any time. Ignoring it is always safe.
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

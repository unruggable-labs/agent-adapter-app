import { useEffect, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { Addr, Avatar, Badge, Callout, Section, Spinner, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { useApp, settle } from "../lib/app-state";
import { adapterAbi, controlLine, displayName } from "../lib/chain";
import { sendTx } from "../lib/tx";

/**
 * The wallet holder's side of the system, in their terms: which agent speaks for this wallet,
 * which agents claim it, and the reciprocal actions. Every prompt here is derived from indexed
 * chain state - never from link parameters.
 */
export function WalletPage() {
  const { signer, identities, overview, navigate, refresh, toast } = useApp();
  const [designatedUbid, setDesignatedUbid] = useState<Hex | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setDesignatedUbid(null);
    if (signer) api.wallet(signer.address).then((w) => setDesignatedUbid(w?.designation?.ubid ?? null)).catch(() => {});
  }, [signer?.address, identities]);

  if (!overview) return <div className="page"><Spinner /></div>;
  if (!signer)
    return (
      <div className="page page-narrow fade-in">
        <h1 className="page-title">My wallet</h1>
        <p className="t2">Connect a wallet (bottom of the sidebar) to see what your address resolves to and act on requests naming it.</p>
      </div>
    );

  // An address stands in up to three different relationships to agent records, and none of them
  // implies another:
  //   selfRecord - the address IS an agent (ACCOUNT record, controller is the address itself)
  //   myAgent    - the address is the OPERATING WALLET of an agent controlled elsewhere
  //   claims     - agents asking to use this address as their operating wallet, unconfirmed
  const selfRecord = identities.find((i) => i.standard === 5 && i.boundAddress === signer.address) ?? null;
  const myAgent = designatedUbid ? identities.find((i) => i.ubid === designatedUbid) ?? null : null;
  const myAgentVerified = myAgent?.agentWallet === signer.address;
  const claims = identities.filter(
    (i) => i.agentWallet === signer.address && i.ubid !== designatedUbid && i.ubid !== selfRecord?.ubid,
  );
  // Controllers this address holds. selfRecord is excluded - an ACCOUNT record's holder is the address
  // itself, so it would otherwise appear in both section 1 and section 3.
  const controlled = identities.filter(
    (i) => i.currentControllerHolder === signer.address && i.ubid !== selfRecord?.ubid,
  );
  const listingMe = identities.filter(
    (i) =>
      Object.entries(i.metadata).some(
        ([k, v]) => (k === "account" || k.startsWith("account[")) && v.toLowerCase().includes(signer.address.slice(2)),
      ) && !i.reputation.confirmedAccounts.some((c) => c.attester === signer.address),
  );

  async function run(key: string, fn: string, args: unknown[]) {
    setBusy(key);
    const r = await sendTx(signer, overview!.adapter, adapterAbi, fn, args);
    toast(r.message);
    if (r.ok) await settle(refresh);
    setBusy(null);
  }

  return (
    <div className="page page-narrow fade-in">
      <div className="page-head">
        <h1 className="page-title">My wallet</h1>
        {/* Only personas have a name worth showing; a connected wallet's "label" is just the
            address again, and the full address is printed directly below. */}
        {signer.isPersona && <Badge tone="outline">{signer.label}</Badge>}
      </div>
      <p className="page-sub">
        <Addr value={signer.address} n={44} />
      </p>
      <p className="t2 small" style={{ margin: "0 0 18px", maxWidth: 560 }}>
        An address can stand in three different relationships to an agent, and they don't imply
        each other. Each section below answers one of them for this wallet.
      </p>

      <div className="stack">
        {/* 1. IS - the controller is the address itself. */}
        <Section label="Is this address an agent?">
          <Explainer>
            An agent can be bound to an address itself. Its reputation is the address's own, and
            it can never be sold or transferred away.
          </Explainer>
          {selfRecord ? (
            <>
              <div className="row wrap" style={{ gap: 10 }}>
                <Avatar seed={selfRecord.ubid} image={selfRecord.image} size={24} />
                <span style={{ fontSize: 15, fontWeight: 600 }}>{displayName(selfRecord)}</span>
                <StatusBadge id={selfRecord} />
                <Badge tone="ok">nothing to fake</Badge>
              </div>
              <p className="t2 small" style={{ margin: "8px 0 0" }}>
                Yes. Look this address up and you get this agent - its reviews, ratings and deal
                history. No second confirmation is needed: only this address could have created
                the record.
              </p>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => navigate(`/identity/${selfRecord.ubid}`)}>Open its profile</button>
              </div>
            </>
          ) : (
            <>
              <p className="t2" style={{ margin: 0 }}>
                <b>No.</b> Nothing comes back when someone looks this address up, so a counterparty
                has no reviews and no history to go on.
              </p>
              <div className="row wrap" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={() => navigate("/create")}>Register this address as an agent</button>
              </div>
            </>
          )}
        </Section>

        {/* 2. WORKS FOR - the operating wallet of an agent controlled elsewhere. Grants no authority. */}
        <Section label="Does this address work for an agent?">
          <Explainer>
            A wallet can be where an agent does business while the agent's controller lives elsewhere - a
            token, a contract. That agent's reputation rides on this address, but this address
            can't change it.
          </Explainer>
          {myAgent ? (
            <>
              <div className="row wrap" style={{ gap: 10 }}>
                <Avatar seed={myAgent.ubid} image={myAgent.image} size={24} />
                <span style={{ fontSize: 15, fontWeight: 600 }}>{displayName(myAgent)}</span>
                <span className="t3 small">{controlLine(myAgent)}</span>
                <StatusBadge id={myAgent} />
                {myAgentVerified
                  ? <Badge tone="ok">verified both ways</Badge>
                  : <Badge tone="warn">agent doesn't say it back</Badge>}
              </div>
              <p className="t2 small" style={{ margin: "8px 0 0" }}>
                {myAgentVerified
                  ? <>Anyone who checks this address - a counterparty's software, an explorer, another agent - will see it belongs to {displayName(myAgent)}, and can trust that because {displayName(myAgent)} also names this wallet as its own. Your wallet carries its reputation.</>
                  : <>You say this wallet is operated by {displayName(myAgent)}, but {displayName(myAgent)} doesn't currently say it back. Until its controller names this wallet on the agent's side, anyone checking will see the link as unverified - either half alone is easy to fake.</>}
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
              <b>No.</b> No agent names this wallet as the one it does business from. To set that
              up, open an agent you control and use "Link my wallet" from its own page.
            </p>
          )}

          {claims.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="section-label" style={{ marginTop: 0 }}>Waiting on you</div>
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
                Each of these says this wallet is the one it does business from - a claim that
                needed no permission from you and proves nothing by itself. If one really is your
                agent, confirm it and the link becomes verified. Confirming moves no assets and
                grants no authority; ignoring a false claim is always safe.
              </p>
            </div>
          )}
          {claims.length === 0 && (
            <p className="hint" style={{ marginTop: 10 }}>
              If an agent names this wallet as its own, the request appears here for you to accept
              or ignore. Nobody can link your wallet without you.
            </p>
          )}
        </Section>

        {/* 3. CONTROLS - holds the controller. Authority over the record, but not its reputation. */}
        <Section label="Which agents does this address control?">
          <Explainer>
            Holding an agent's controller - owning the token it's bound to, or being the contract's
            owner - lets you change what it says about itself and swap the wallet it works from.
            Its reputation stays its own, not this address's.
          </Explainer>
          {controlled.length > 0 ? (
            <>
              {controlled.map((i) => (
                <div key={i.ubid} className="row spread" style={{ padding: "7px 0" }}>
                  <span className="row wrap" style={{ gap: 8 }}>
                    <Avatar seed={i.ubid} image={i.image} size={20} />
                    <button style={{ fontWeight: 600 }} onClick={() => navigate(`/identity/${i.ubid}`)}>{displayName(i)}</button>
                    <span className="t3 small">{controlLine(i)}</span>
                    <StatusBadge id={i} />
                  </span>
                  <button className="btn btn-sm" onClick={() => navigate(`/identity/${i.ubid}`)}>Manage</button>
                </div>
              ))}
            </>
          ) : (
            <p className="t2" style={{ margin: 0 }}>
              <b>None.</b> This address doesn't hold the controller to any agent here.
            </p>
          )}
          <p className="hint" style={{ marginTop: 10 }}>
            Only controllers with a single nameable holder are listed - token owners, an ownable
            contract's owner. Balance-based standards, contract admin roles and delegated control
            all grant authority without showing up here.
          </p>
        </Section>

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

      </div>
    </div>
  );
}

/** The one-line "what is this section even asking" note that sits under every section label. */
function Explainer({ children }: { children: ReactNode }) {
  return <p className="hint" style={{ margin: "0 0 12px", maxWidth: 540 }}>{children}</p>;
}

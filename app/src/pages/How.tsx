import { Badge, Callout, Section } from "../components/ui";
import { useApp } from "../lib/app-state";

/** The mental model behind every other page, in the order the questions actually come up. */
export function HowPage() {
  const { navigate } = useApp();
  return (
    <div className="page page-narrow fade-in">
      <h1 className="page-title">How identity works here</h1>
      <p className="page-sub">Four things, three of which are easy to mistake for each other.</p>

      <div className="stack">
        <Section label="The cast">
          <div className="role-grid">
            <div className="role">
              <div className="role-name">The agent</div>
              <div className="role-what">Software, off-chain</div>
              <p>A bot running on a server somewhere. The chain never sees it directly — everything below exists to represent it.</p>
            </div>
            <div className="role">
              <div className="role-name">The record</div>
              <div className="role-what">Its identity, on-chain</div>
              <p>Name, description URI, operating wallet — and the place <b>reputation</b> accumulates. Identified forever by one hash, the UBID.</p>
            </div>
            <div className="role">
              <div className="role-name">The deed</div>
              <div className="role-what">What controls the record</div>
              <p>An on-chain thing you own — an NFT, a contract, or an address itself. Whoever holds the deed can update the record. Sell the deed, sell the agent and its reputation.</p>
            </div>
            <div className="role">
              <div className="role-name">The hands</div>
              <div className="role-what">The operating wallet</div>
              <p>The key the bot actually signs transactions with. Hot, replaceable, worth little. If it leaks, the deed holder points the record at a fresh key — reputation survives, because it lives on the record.</p>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            In this demo: PunkBot (the agent) is described by a record whose deed is the NFT
            DemoPunks #7 (owned by Alice), and it signs from the "PunkBot server" wallet.
            Three different addresses, three different jobs.
          </p>
        </Section>

        <Section label="Kinds of deed">
          <table className="table">
            <thead><tr><th>Binding</th><th>Who controls the record</th><th>Character</th></tr></thead>
            <tbody>
              <tr><td><Badge tone="outline">ERC721 / 1155 / 6909</Badge></td><td>whoever owns the token, at any moment</td><td>transferable — the agent is a sellable asset</td></tr>
              <tr><td><Badge tone="outline">ACCOUNT</Badge></td><td>the address itself, and nothing else</td><td>permanent — no token, nothing to sell or lose</td></tr>
              <tr><td><Badge tone="outline">CONTRACT_OWNABLE</Badge></td><td>the contract's current <span className="mono">owner()</span></td><td>follows ownership transfers of the contract</td></tr>
              <tr><td><Badge tone="outline">CONTRACT_ADMIN</Badge></td><td>holders of the contract's admin role</td><td>for AccessControl contracts with no owner()</td></tr>
            </tbody>
          </table>
        </Section>

        <Section label="Two ways for a record to exist">
          <p style={{ marginTop: 0 }}>
            <b>Claim (counterfactual).</b> One cheap transaction writes the record into the event
            log. Nothing is minted; indexers like this one assemble the state from events.
          </p>
          <p>
            <b>Register.</b> Mints a real ERC-8004 agent on the registry, bound to the same deed.
          </p>
          <p style={{ marginBottom: 0 }}>
            The crucial property: <b>both produce the same UBID</b>, because the hash is derived
            from the deed's coordinates, not from how you registered. So an agent can operate for
            months on a cheap claim, accumulate ratings, then register fully — and every prior
            attestation already points at the right identity. Nothing transfers, because nothing
            needs to.
          </p>
        </Section>

        <Section label="Why the wallet link takes two steps">
          <p style={{ marginTop: 0 }}>
            The record saying "my operating wallet is X" is a claim by the <i>deed holder</i> —
            it needed no permission from X. A wallet saying "I am operated by agent Y" needed no
            permission from Y. Either alone is trivially faked: a scam agent can name a famous
            wallet, a random wallet can claim a famous agent.
          </p>
          <p style={{ marginBottom: 0 }}>
            So verification requires <b>both statements from both signers</b>: the record names
            the wallet, and the wallet points back. That's what "verified both ways" means on
            <button className="addr" onClick={() => navigate("/wallet")} style={{ margin: "0 4px" }}>My wallet</button>
            — and why confirming there is always safe: it moves no assets and grants no authority;
            it only countersigns a statement.
          </p>
        </Section>

        <Section label="Reputation">
          <p style={{ marginTop: 0 }}>
            Anyone can attest to any UBID — stars (counted), ratings (averaged per attester),
            reviews and interaction records (accumulated) — even before the identity's first
            claim. Statements are permanent history: revoking one withdraws its effect but the
            record that it was made, and revoked, stays. Only the original attester's revocation
            counts, and revoking your latest rating resurfaces your previous one.
          </p>
          <p style={{ marginBottom: 0 }}>
            Reputation attaches to the record, never to the wallet — so rotating a compromised
            operating key costs nothing, and buying the deed acquires the history.
          </p>
        </Section>

        <Section label="The warnings you'll see">
          <p style={{ marginTop: 0 }}>Binding to a deed adopts the deed's rules, so the app discloses what those rules allow:</p>
          <div className="stack" style={{ marginTop: 10 }}>
            <Callout tone="danger" title="Post-owner collection claim."> The token was burned and the collection re-claimed the identity — the reputation may describe a previous claimant's agent.</Callout>
            <Callout tone="warn" title="Ownerless token."> Nobody owns the bound token right now, so the collection contract temporarily holds the authority.</Callout>
            <Callout tone="danger" title="Ruggable trust base."> The collection's code can burn tokens <i>and</i> call out — it could seize a bound identity without the owner acting.</Callout>
            <Callout tone="warn" title="Upgradeable trust base."> The collection is a proxy; today's code proves nothing about tomorrow's rules.</Callout>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            None of these are censored — the log is the log. The app's job is to make sure you
            read reputation with the trust base in view.
          </p>
        </Section>
      </div>
    </div>
  );
}

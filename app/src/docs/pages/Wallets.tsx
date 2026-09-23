import { Code, H2, Note } from "../Docs";

export function Wallets() {
  return (
    <>
      <h1 className="page-title">Operating wallets</h1>
      <p className="page-sub">The wallet an agent signs from is the address other agents actually meet. Linking it to a profile takes two statements.</p>

      <H2 id="two-steps">Why the link takes two steps</H2>
      <ul className="claim-list">
        <li>A profile saying <b>"my operating wallet is X"</b> is a claim by whoever controls the profile - it needed no permission from X.</li>
        <li>A wallet saying <b>"I work for agent Y"</b> is a claim by that wallet - it needed no permission from Y.</li>
      </ul>
      <p>
        Either alone is trivially faked: a scam agent can name a famous wallet, a random wallet can claim to be a
        famous agent's. Verification requires <b>both statements from both signers</b>. The explorer shows a
        one-directional claim as exactly that, and never presents it as verified.
      </p>

      <H2 id="calls">The calls</H2>
      <table className="table">
        <thead><tr><th>Who</th><th>Call</th><th>Says</th></tr></thead>
        <tbody>
          <tr><td>the controller</td><td className="mono small">counterfactualSetAgentWallet(standard, boundAddress, tokenId, wallet)</td><td>this profile's wallet is X</td></tr>
          <tr><td>the wallet</td><td className="mono small">setWalletUBID(standard, boundAddress, tokenId)</td><td>I work for this profile</td></tr>
          <tr><td>either</td><td className="mono small">counterfactualUnsetAgentWallet(...) / clearWalletUBID()</td><td>withdraw my half</td></tr>
        </tbody>
      </table>
      <p>
        When the controller and the wallet are the same address, one call does both halves:
      </p>
      <Code lang="solidity">{`counterfactualSetAgentWalletAndUBID(standard, boundAddress, tokenId)
// names msg.sender as the wallet and points msg.sender back - verified in one transaction`}</Code>
      <Note>
        The wallet's half is emit-only: the contract stores nothing. An indexer resolves an address by taking its
        latest <span className="mono">WalletUBIDSet</span> and checking the named profile points back. That is
        what the explorer's address lookup does.
      </Note>

      <H2 id="authority">What the wallet can and can't do</H2>
      <p>
        The operating wallet holds <b>no authority over the profile</b>. It cannot change the URI, the metadata,
        or the wallet link from the profile's side. It can only speak for itself: confirm or withdraw its half,
        and make attestations like any other address. Losing a hot wallet therefore costs an agent its link, not
        its identity - the controller names a new wallet and the new wallet confirms.
      </p>
    </>
  );
}

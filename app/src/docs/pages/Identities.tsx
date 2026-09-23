import { Code, H2, Note } from "../Docs";

export function Identities() {
  return (
    <>
      <h1 className="page-title">Identities and UBIDs</h1>
      <p className="page-sub">Every identity has one permanent name. It's a hash, and nobody issues it.</p>

      <H2 id="ubid">The Universal Binding Identifier</H2>
      <p>
        A UBID is <b>derived, not issued</b>. It is the hash of the controller's coordinates - which chain,
        which adapter, which standard, which address, which token id - so anyone can compute it offline for
        anything, before a single transaction is sent. A 10,000-token collection already has 10,000 UBIDs.
      </p>
      <Code lang="solidity">{`ubid = keccak256(abi.encode(
    interoperableAddress(chainId, adapter),  // ERC-7930: the adapter, on this chain
    uint8(standard),                         // the control rule - see Controllers and standards
    boundAddress,                            // the token contract, the contract, or the account
    tokenId                                  // 0 for account and contract standards
))`}</Code>
      <p>
        The live contract computes it with <span className="mono">hashBinding(standard, boundAddress, tokenId)</span>.
        Because the standard is in the preimage, the same token claimed under two standards is two identities.
        That is why the create flow shows the rule before anyone signs.
      </p>

      <H2 id="states">Untouched, claimed, registered</H2>
      <p>
        Reviews and attestations attach to a UBID whether or not anything has been registered under it. A
        counterfactual claim is a cheap transaction that does basic validation and emits an event - no storage,
        no external calls. A full registration mints an ERC-8004 agent. All three states share the same UBID.
      </p>
      <table className="table compare">
        <thead><tr><th /><th>Untouched</th><th>Claimed <span className="t3">(counterfactual)</span></th><th>Registered</th></tr></thead>
        <tbody>
          <tr><th scope="row">Costs</th><td>nothing</td><td>one cheap transaction</td><td>one transaction</td></tr>
          <tr><th scope="row">Has a UBID</th><td><b>yes</b> - derivable by anyone</td><td><b>yes</b> - the same one</td><td><b>yes</b> - the same one</td></tr>
          <tr><th scope="row">Can receive reviews</th><td><b>yes</b></td><td><b>yes</b></td><td><b>yes</b></td></tr>
          <tr><th scope="row">Can set its own URI and wallet</th><td>no</td><td>yes</td><td>yes</td></tr>
          <tr><th scope="row">Stored in</th><td>nowhere</td><td>the event log</td><td>the adapter's storage</td></tr>
          <tr><th scope="row">ERC-8004 agent</th><td>none</td><td>none</td><td>minted</td></tr>
        </tbody>
      </table>
      <div className="converge">
        <div className="converge-in"><span className="chip">Untouched</span><span className="chip">Claimed</span><span className="chip">Registered</span></div>
        <svg className="converge-join" viewBox="0 0 56 72" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M0 12 C 22 12, 20 36, 40 36" /><path d="M0 36 H 40" /><path d="M0 60 C 22 60, 20 36, 40 36" /><path d="M37 33l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="converge-out"><span className="converge-out-label">the same UBID throughout</span><span className="mono t2 converge-hash">0x989abafdb21e6029…9eb199fcb9</span></div>
      </div>

      <H2 id="record">What a record holds</H2>
      <ul className="claim-list">
        <li><b>Agent URI</b> - where the agent's card lives, an ERC-8004 registration file.</li>
        <li><b>Metadata</b> - key-value pairs, bytes-valued. <span className="mono">name</span> is what the explorer shows when it decodes as text.</li>
        <li><b>Operating wallet</b> - the address the agent signs from, once the wallet has confirmed it. See <a href="#/wallets">Operating wallets</a>.</li>
        <li><b>Reputation</b> - stars, ratings, reviews and transaction records from anyone. See <a href="#/reputation">Reputation</a>.</li>
      </ul>
      <Note>
        <b>Latest wins.</b> A counterfactual record is whatever the most recent events say. A new claim restates
        the whole record; a URI or metadata update changes one field. There is no delete - an empty value is
        how you clear a key.
      </Note>
    </>
  );
}

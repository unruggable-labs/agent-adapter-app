import { Code, H2, Note } from "../Docs";

export function Counterfactual() {
  return (
    <>
      <h1 className="page-title">Counterfactual registration</h1>
      <p className="page-sub">An identity that exists in the event log, keyed by its UBID, that can settle on-chain later - or never.</p>

      <H2 id="what">What it is</H2>
      <p>
        The counterfactual functions mirror the on-chain registration and setters but mint nothing and store
        nothing. Each one checks the caller's authority, computes the UBID, emits one event, and returns. The
        emitted events <b>are</b> the record; an indexer keys them by UBID and reconstructs the current identity
        from the latest ones.
      </p>
      <Code lang="solidity">{`counterfactualRegister(standard, boundAddress, tokenId, agentURI)      // the claim; restates the whole record
counterfactualSetAgentURI(standard, boundAddress, tokenId, newURI)
counterfactualSetMetadata(standard, boundAddress, tokenId, key, value)
counterfactualSetMetadataBatch(standard, boundAddress, tokenId, entries)
counterfactualSetAgentWallet(standard, boundAddress, tokenId, wallet)   // the profile's half of the wallet link
counterfactualUnsetAgentWallet(standard, boundAddress, tokenId)
counterfactualSetAgentWalletAndUBID(standard, boundAddress, tokenId)    // both halves, when caller is both`}</Code>

      <H2 id="why">Why</H2>
      <ul className="claim-list">
        <li><b>Cost.</b> The caller pays event-log gas for a claim and defers the mint until the identity needs registry state - if it ever does.</li>
        <li><b>Scale.</b> A collection can give every token an identity at mint for one event each.</li>
        <li><b>Continuity.</b> Reputation earned as a claim carries over to a full registration, because the UBID is the same.</li>
      </ul>

      <H2 id="verify">Self-verifying events</H2>
      <p>
        Every counterfactual event carries both the UBID and the coordinates it was derived from. An indexer
        recomputes the hash from the coordinates and drops any event whose topic doesn't match. The contract
        emits nothing that fails this, but an indexer that checks is an indexer that can't be fooled by a
        look-alike contract's logs.
      </p>

      <H2 id="indexing">Indexing rules</H2>
      <ul className="claim-list">
        <li>Apply events in <span className="mono">(blockNumber, logIndex)</span> order. State is a pure replay; a reorg means replay from scratch.</li>
        <li>Latest event per UBID wins. A new claim resets the URI and replaces the metadata map with exactly what it carries; field setters change one field.</li>
        <li>An ERC-8004 registration for the same coordinates derives the same UBID, so its history joins with no link assertion needed.</li>
        <li>Wallet designations and attestations resolve against the UBID, whether or not a claim has arrived yet.</li>
      </ul>
      <Note>
        Adapterscan's indexer is the reference implementation of these rules: <a href="https://github.com/unruggable-labs/agent-adapter-app/blob/main/indexer/SPEC.md" target="_blank" rel="noopener noreferrer">indexer/SPEC.md</a> documents the projection, and the trail every profile shows on its History tab is exactly the events it replayed.
      </Note>
    </>
  );
}

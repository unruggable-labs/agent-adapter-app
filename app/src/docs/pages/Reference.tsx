import { Code, H2, Note } from "../Docs";

export function Reference() {
  return (
    <>
      <h1 className="page-title">Contract reference</h1>
      <p className="page-sub">The entry points, grouped by what they do. The audited source is the source of truth; this page is the map.</p>
      <Note>
        Full signatures, natspec and errors: <a href="https://github.com/unruggable-labs/adapter" target="_blank" rel="noopener noreferrer">unruggable-labs/adapter</a>,
        <span className="mono"> src/AdapterImplementation.sol</span> and the interfaces under <span className="mono">src/interfaces/</span>. Use proxy addresses for integrations - see <a href="#/deployments">Deployments</a>.
      </Note>

      <H2 id="read">Read</H2>
      <Code lang="solidity">{`hashBinding(uint8 standard, address boundAddress, uint256 tokenId) view returns (bytes32 ubid)
bindingOf(uint256 agentId) view returns (Binding)            // the coordinates a registered agent is bound to
bindingHashOf(uint256 agentId) view returns (bytes32 ubid)   // its UBID; reverts UnknownAgent
isController(uint256 agentId, address account) view returns (bool)
identityRegistry() view returns (address)                    // an immutable; there is no setter`}</Code>

      <H2 id="claim">Counterfactual writes</H2>
      <p>Authority-checked, emit-only. See <a href="#/counterfactual">Counterfactual registration</a> for the list and the indexing rules.</p>

      <H2 id="register">Full registration and registry writes</H2>
      <Code lang="solidity">{`register(uint8 standard, address boundAddress, uint256 tokenId, string agentURI) returns (uint256 agentId)
register(..., MetadataEntry[] metadata) returns (uint256 agentId)
setAgentURI(uint256 agentId, string newURI)
setMetadata(uint256 agentId, string key, bytes value)
setMetadataBatch(uint256 agentId, MetadataEntry[] metadata)   // one MetadataSet event per entry
setAgentWallet(uint256 agentId, address newWallet, ...)         // forwarded to the registry; its wallet-proof rule applies
unsetAgentWallet(uint256 agentId)`}</Code>
      <p>
        The adapter registers the ERC-8004 agent itself and keeps custody of it, so the registry records the
        adapter as the owner. Control is decided by the binding, re-read on every write. The reserved metadata
        key <span className="mono">agent-binding</span> holds the adapter's address; a reader verifies a binding by
        following it to <span className="mono">bindingOf</span>.
      </p>

      <H2 id="wallet">Wallet designation</H2>
      <Code lang="solidity">{`setWalletUBID(uint8 standard, address boundAddress, uint256 tokenId) returns (bytes32)   // "I work for this identity"
clearWalletUBID()                                                                           // withdraw it`}</Code>
      <p>The caller is always the wallet itself. There is no acting-for path here: a wallet's half of the link has to come from that wallet.</p>

      <H2 id="attest">Attestations</H2>
      <Code lang="solidity">{`attest(uint8 attestationType, bytes32 ubid, bytes32 variant, bytes data)
confirmAdditionalAccount(bytes32 ubid)     // = attest(CONFIRM_ACCOUNT, ubid, 0, "")
revoke(bytes32 attestationId)`}</Code>

      <H2 id="events">Events an indexer subscribes to</H2>
      <Code lang="solidity">{`// full registration
AgentBound, AgentURISet, MetadataSet, AgentWalletSet, AgentWalletUnset
// counterfactual
CounterfactualAgentRegistered, CounterfactualAgentURISet, CounterfactualMetadataSet,
CounterfactualMetadataBatchSet, CounterfactualAgentWalletSet, CounterfactualAgentWalletUnset
// wallet designation
WalletUBIDSet, WalletUBIDCleared
// attestations
Attested, AttestationRevoked`}</Code>

      <H2 id="admin">Admin</H2>
      <p>
        <span className="mono">upgradeToAndCall</span>, owner-only (a Safe). There is no <span className="mono">setIdentityRegistry</span>:
        the registry is an immutable baked into the implementation. An upgrade could still ship an
        implementation with a different one; the code does not guard against that, so it is an operator
        rule. See <a href="#/trust">Trust and security</a>.
      </p>
    </>
  );
}

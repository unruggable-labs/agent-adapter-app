import { StandardBadge } from "../../components/ui";
import { Code, H2, Note } from "../Docs";

const ROWS: { name: string; controller: string; delegation: boolean; note: string }[] = [
  { name: "ERC721", controller: "whoever ownerOf(tokenId) returns", delegation: true, note: "The token is a sellable asset; the identity travels with it." },
  { name: "ERC1155", controller: "anyone with balanceOf(account, id) > 0", delegation: false, note: "Every holder is a controller. Mint exactly one of an id for single-holder control." },
  { name: "ERC6909", controller: "anyone with balanceOf(account, id) > 0", delegation: false, note: "Same rule as ERC1155." },
  { name: "ERC1155F", controller: "whoever ownerOf(tokenId) returns", delegation: true, note: "An ERC-1155 contract that also exposes ownerOf - a single-owner token on a balance standard." },
  { name: "ERC6909F", controller: "whoever ownerOf(tokenId) returns", delegation: true, note: "An ERC-6909 contract that also exposes ownerOf." },
  { name: "ACCOUNT", controller: "the address itself", delegation: true, note: "An EOA, a Safe, or any contract that can make the call as itself. Token id is always 0." },
  { name: "CONTRACT_OWNABLE", controller: "the contract's current owner()", delegation: true, note: "Follows ownership transfers. The contract itself gets no special access. Token id 0." },
  { name: "CONTRACT_ADMIN", controller: "holders of DEFAULT_ADMIN_ROLE", delegation: false, note: "For AccessControl contracts with no owner(). Token id 0." },
];

export function Standards() {
  return (
    <>
      <h1 className="page-title">Controllers and standards</h1>
      <p className="page-sub">The controller is the thing the identity is bound to. The standard is the rule for who controls that thing right now.</p>

      <H2 id="rules">The eight standards</H2>
      <p>
        The adapter re-reads the controller on every gated call, so control moves the moment the token does -
        no claim step, no stale owner. Numbering is part of the UBID and never changes.
      </p>
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Standard</th><th>Who controls the identity</th><th>delegate.xyz</th><th>Notes</th></tr></thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr key={r.name}>
                <td><span className="row" style={{ gap: 8 }}><span className="num t3">{i}</span><StandardBadge name={r.name} /></span></td>
                <td className="td-wrap">{r.controller}</td>
                <td>{r.delegation ? "yes" : "no"}</td>
                <td className="td-wrap t2">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="delegation">Authorising another wallet</H2>
      <p>
        For the standards marked yes, the controller can authorise another address to act for it on
        <a href="https://delegate.xyz" target="_blank" rel="noopener noreferrer"> delegate.xyz</a>, a public registry
        the adapter reads. A cold wallet or a multisig keeps the token or the contract; a hot wallet manages the
        identity. The rights key is <span className="mono">keccak256("adapter8004.manage")</span>, and unscoped
        delegations count too.
      </p>

      <H2 id="hybrids">A contract that speaks more than one standard</H2>
      <p>
        Because the standard is in the UBID, an ERC-1155 token can be claimed as ERC1155 (control by balance) or
        as ERC1155F (control by ownerOf) and get two different identities with two separate reputations. Nothing
        in the protocol names one canonical. The rule of thumb: pick the standard that describes how the token
        is actually held. One owner and an ownerOf - use the ownerOf rule. Many holders - use the balance rule.
      </p>
      <Note tone="warn">
        The explorer warns before a second identity is created under a different standard for the same
        coordinates, and shows the siblings on each profile. Continue only if you mean to have two.
      </Note>

      <H2 id="window">The collection's window</H2>
      <p>
        For the ownerOf standards, the token contract itself may act for a token while <span className="mono">ownerOf</span> reverts
        or returns zero - before the mint, and again after a burn. That is what lets a collection give every
        token an identity inside <span className="mono">mint()</span>:
      </p>
      <Code lang="solidity">{`function mint(address to, uint256 tokenId, string calldata agentURI) external {
    ADAPTER.counterfactualRegister(ERC721, address(this), tokenId, agentURI); // still ownerless here
    _safeMint(to, tokenId);                                                     // now the holder controls it
}`}</Code>
      <p>
        The same window reopens after a burn. A collection that burns and re-claims is allowed to, and the
        explorer discloses it: the profile's history shows a collection-authored claim after an owner existed.
      </p>
    </>
  );
}

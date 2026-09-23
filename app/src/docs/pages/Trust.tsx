import { H2 } from "../Docs";

export function Trust() {
  const qa: { q: string; a: React.ReactNode }[] = [
    {
      q: "Who controls the adapter, and what can they do?",
      a: <>The adapter is a UUPS-upgradeable proxy owned by a Safe. Its owner can upgrade the implementation. An upgrade is arbitrary code, so in principle it could rewrite bindings or bypass controller checks - that is true of every upgradeable contract and we'd rather say it than have you find out. What it cannot do any more is repoint the identity registry: that address is baked into the implementation and a later upgrade that differs is refused.</>,
    },
    {
      q: "What if the token contract lies?",
      a: <>The adapter is a trust-forwarder: whoever the bound contract says holds the token controls the identity. Bind to a contract that lies about <span className="mono">ownerOf</span> or <span className="mono">balanceOf</span> and control follows those lies. The explorer probes the bound contract's code and discloses what it finds - burnable, upgradeable, able to make arbitrary calls - rather than hiding the identity.</>,
    },
    {
      q: "Can a collection take an identity back from a holder?",
      a: <>Not while the holder holds it. The collection's window is open only while <span className="mono">ownerOf</span> reverts or returns zero - before a mint, after a burn. A collection that burns a token and re-claims is allowed to, and the profile's history shows a collection-authored claim after an owner existed. Disclosure, not suppression, is the policy throughout.</>,
    },
    {
      q: "Can someone impersonate an agent's wallet?",
      a: <>A wallet can claim to work for any agent, and an agent can name any wallet. Neither alone is shown as verified. Only when the profile names the wallet and the wallet points back does the explorer call the link verified. See <a href="#/wallets">Operating wallets</a>.</>,
    },
    {
      q: "Can reviews be deleted?",
      a: <>No. Every statement is an event. The attester can revoke their own statement, which is itself an event and stays in the history. Nobody else can - not the agent, not Adapterscan, not the adapter's owner.</>,
    },
    {
      q: "Can anyone rate anything?",
      a: <>Yes. Statements attach to a UBID, and a UBID can be computed for anything. The contract does not check that a target exists, because a counterfactual identity has no on-chain existence to check. Indexers keep statements about unclaimed targets and they acquire meaning if a claim arrives.</>,
    },
    {
      q: "Why bind through an adapter instead of registering on ERC-8004 directly?",
      a: <>ERC-8004 ties a record to a single ERC-721-style owner. If you want a token with many holders, an NFT in a collection you don't control, a contract, or an address to drive a record, you need something that owns the registry slot while forwarding control decisions. That is the adapter. It registers the ERC-8004 agent itself, keeps custody of it, and forwards writes on the controller's behalf.</>,
    },
    {
      q: "How is the contract tested?",
      a: <>The repository ships a Foundry suite covering the full surface: unit tests, adversarial tests against malicious token contracts, fuzz tests for the invariants, and a fork test that replays the Sepolia upgrade from a pinned block. Deployment records with verification are in <span className="mono">deployments/</span>.</>,
    },
  ];
  return (
    <>
      <h1 className="page-title">Trust and security</h1>
      <p className="page-sub">Straight answers to the questions people ask before they rely on this.</p>
      {qa.map(({ q, a }) => (
        <section key={q} style={{ marginTop: 22 }}>
          <H2 id={q.toLowerCase().replace(/[^a-z]+/g, "-")}>{q}</H2>
          <p style={{ margin: 0 }}>{a}</p>
        </section>
      ))}
    </>
  );
}

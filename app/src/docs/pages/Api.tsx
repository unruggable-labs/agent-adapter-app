import { Code, H2, Note } from "../Docs";

const BASE = "https://adapterscan.com/api";

export function Api() {
  return (
    <>
      <h1 className="page-title">Explorer API</h1>
      <p className="page-sub">Everything the explorer shows, as JSON. Ask who operates a wallet, look up an agent, or page through the registry. No key, no sign-in.</p>

      <H2 id="basics">The basics</H2>
      <ul>
        <li>Every call is a plain <span className="mono">GET</span> that answers JSON. CORS is open, so a web page can call it too.</li>
        <li>
          The base is <span className="mono">{BASE}</span>. It covers every mainnet (Robinhood Chain, Base and Ethereum), and each row says which chain
          it's on. Add <span className="mono">?chain=base</span> to any call to narrow it to one chain, or a comma-separated few.
        </li>
        <li>The testnet is separate: <span className="mono">https://testnet.adapterscan.com/api</span>, same calls, Sepolia only.</li>
        <li>Everything comes from what the indexer has already read. A call never waits on the chain.</li>
      </ul>

      <H2 id="wallet">Who operates this wallet?</H2>
      <p>The question most callers have. Give it the address an agent is talking to:</p>
      <Code lang="bash">{`curl "${BASE}/wallet/<address>"`}</Code>
      <Code lang="json">{`{
  "chain": "base",
  "verified": true,
  "self": null,
  "designation": { "account": "0x7099…79c8", "ubid": "0x5e63…c565", "setBy": "0x7099…79c8", "order": { … } },
  "identity": { "ubid": "0x5e63…c565", "boundAddress": "0xcf7e…0fc9", "tokenId": "7", "agentWallet": "0x7099…79c8", … },
  "chains": [ … ]
}`}</Code>
      <ul>
        <li><b>verified: true</b> means both sides agree: the wallet says it works for the profile, and the profile names the wallet back. Only then is the link real.</li>
        <li><b>verified: false</b> is one side's claim alone. Treat it as unconfirmed.</li>
        <li><b>self</b> is set when the address is itself the agent (an account-bound profile).</li>
        <li>The answer is <span className="mono">null</span> when nobody claims the address. An address can be claimed on more than one chain: <span className="mono">chains</span> has each answer, and the fields above are the first.</li>
        <li><b>identity</b> is the bare record. For its name, picture and reputation, ask <span className="mono">/identity/&lt;ubid&gt;</span>.</li>
      </ul>
      <p>
        For everything about an address - its own profile, what it operates, the profiles it holds the deed to, the statements it has
        made - use <span className="mono">/address/&lt;address&gt;</span>.
      </p>

      <H2 id="agents">Look up an agent</H2>
      <table className="table">
        <thead><tr><th>Call</th><th>Answers</th></tr></thead>
        <tbody>
          <tr><td className="mono small">/search?q=&lt;text&gt;</td><td>Profiles matching a name, a UBID, an address, a token or an ERC-8004 id. What the explorer's search box asks.</td></tr>
          <tr><td className="mono small">/identity/&lt;ubid&gt;</td><td>One profile: its name and card, what it's bound to and who holds that, its operating wallet, and its reputation (stars, ratings, reviews, transaction records). 404 if there's no such UBID.</td></tr>
          <tr><td className="mono small">/history/&lt;ubid&gt;</td><td>Every event behind a profile, in order, with what each one did. Events that failed their checks are there too, marked.</td></tr>
          <tr><td className="mono small">/attestations?ubid=&lt;ubid&gt;</td><td>The statements made about a profile, newest first.</td></tr>
          <tr><td className="mono small">/attestation/&lt;id&gt;</td><td>One statement, with the fields its id is hashed from, so you can check it yourself.</td></tr>
        </tbody>
      </table>
      <Code lang="bash">{`curl "${BASE}/search?q=normie"
curl "${BASE}/identity/0xfd7d1b959d39a1871fa1794a5aab9f224fa93e8954185803dfc5352b4be1e655"`}</Code>

      <H2 id="lists">Lists and paging</H2>
      <p>
        Lists answer a page, newest first: <span className="mono">{`{ items, total, offset, limit }`}</span>. 25 rows unless you ask
        for more with <span className="mono">limit</span> (up to 200). Walk through with <span className="mono">offset</span>.
      </p>
      <table className="table">
        <thead><tr><th>Call</th><th>Filters</th></tr></thead>
        <tbody>
          <tr><td className="mono small">/identities</td><td><span className="mono">q</span> (a name), <span className="mono">registration</span> (registered, counterfactual), <span className="mono">standard</span> (ERC721, ACCOUNT, …), <span className="mono">bound</span> (a contract), <span className="mono">tokenId</span></td></tr>
          <tr><td className="mono small">/attestations</td><td><span className="mono">type</span> (STAR, RATING, REVIEW, INTERACTION, CONFIRM_ACCOUNT), <span className="mono">standard</span>, <span className="mono">attester</span>, <span className="mono">ubid</span></td></tr>
          <tr><td className="mono small">/collections</td><td>The collections profiles are bound to, the most profiles first. <span className="mono">sort=newest</span>, <span className="mono">q</span> (a name or address)</td></tr>
          <tr><td className="mono small">/collection/&lt;contract&gt;</td><td>One collection on each chain it's on. Its profiles: <span className="mono">/identities?bound=&lt;contract&gt;</span></td></tr>
          <tr><td className="mono small">/overview</td><td>Totals, and each chain's figures and how its indexer is doing</td></tr>
        </tbody>
      </table>
      <Code lang="bash">{`# every on-chain agent in a collection, 100 at a time
curl "${BASE}/identities?bound=0x9eb6e2025b64f340691e424b7fe7022ffde12438&registration=registered&limit=100&offset=0"`}</Code>

      <H2 id="limits">Fair use</H2>
      <p>
        The API is free and open, with a limit per caller so one script can't slow it down for everyone. You get <b>300 requests a minute</b>,
        in bursts of up to 60. Social card images and CSV exports have their own, smaller allowance of 20 a minute.
      </p>
      <ul>
        <li>Every answer says where you stand: <span className="mono">RateLimit-Limit</span>, <span className="mono">RateLimit-Remaining</span> and <span className="mono">RateLimit-Reset</span> (seconds).</li>
        <li>Over the limit you get a <span className="mono">429</span> with <span className="mono">Retry-After</span> in seconds. Wait that long and carry on.</li>
        <li>Paging through the whole registry fits comfortably: at 200 rows a request, 25,000 profiles is 125 requests.</li>
      </ul>
      <Note>Building something that needs more? Get in touch rather than spreading requests across addresses.</Note>

      <H2 id="agents-read">For agents</H2>
      <p>
        <span className="mono">https://adapterscan.com/llms.txt</span> describes all of this in plain text, for an agent to read before it calls. The
        explorer's pages also answer a plain fetch with a short text summary of what's on them, and these docs are Markdown at the same path with{" "}
        <span className="mono">.md</span> on the end.
      </p>
    </>
  );
}

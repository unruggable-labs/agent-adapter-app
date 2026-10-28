import type { Address, Hex } from "viem";
import { esc } from "./meta.js";
import { addressView, attestationView, collectionView, findIdentity, listAttestations, listCollections, listIdentities, type ChainScope } from "./queries.js";
import { STANDARD_NAMES } from "./ubid.js";

/**
 * What a fetch with no JavaScript gets: a few lines of plain HTML in the page body, about what
 * the path is about, and /llms.txt, which points agents at the JSON API. The app replaces the body
 * when it boots; a browser never shows it, because design.css hides .plain-page (a <noscript>
 * shows it again). Everything here is indexed data, like every other answer (no chain reads).
 */

type Scope = ChainScope & { adapter: Address; chainId: bigint };

const DOCS = "https://docs.adapterscan.com";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const addr = (a: string) => link(`/address/${a}`, a);
const labelOf = (scope: Scope[], slug: string) => scope.find((c) => c.slug === slug)?.label ?? slug;
const page = (body: string) => `<main class="plain-page">${body}</main>`;
const json = (path: string) => `<p>As JSON: ${link(path, path)}</p>`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
/** "Robinhood Chain, Base and Ethereum". */
const chainList = (scope: Scope[]) => {
  const names = scope.map((c) => c.label);
  return esc(names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? ""));
};

/** The body for a path, or null where there is nothing to say beyond the tags. */
export function plainBody(scope: Scope[], pathname: string): string | null {
  let m: RegExpExecArray | null;
  if ((m = /^\/identity\/(0x[0-9a-fA-F]{64})$/.exec(pathname))) return identity(scope, m[1]);
  if ((m = /^\/address\/(0x[0-9a-fA-F]{40})$/.exec(pathname))) return address(scope, m[1]);
  if ((m = /^\/attestation\/(0x[0-9a-fA-F]{64})$/.exec(pathname))) return attestation(scope, m[1] as Hex);
  if ((m = /^\/collection\/([a-z0-9-]+)\/(0x[0-9a-fA-F]{40})$/.exec(pathname))) return collection(scope, m[1], m[2]);
  if (pathname === "/collections") return collectionList(scope);
  if (pathname === "/identities") return identities(scope);
  if (pathname === "/attestations") return attestations(scope);
  if (pathname === "/") return home(scope);
  return null;
}

function identity(scope: Scope[], ubid: string): string | null {
  const found = findIdentity(scope, ubid);
  if (!found) return null;
  const { c, id } = found;
  const v = c.views.view(id);
  const rep = v.reputation;
  const name = v.agentName ?? v.subjectLabel;
  const holder = v.currentControllerHolder;
  const rows: [string, string][] = [
    ["UBID", esc(id.ubid)],
    ["Chain", esc(c.label)],
    ["Bound to", `${esc(v.standardName)} ${addr(id.boundAddress)}${v.standardName === "ACCOUNT" ? "" : `, token ${esc(id.tokenId.toString())}`}`],
    ["Held by", v.flags.currentlyOwnerless ? "nobody right now" : holder ? addr(holder) : "not read yet"],
    ["Operating wallet", id.agentWallet ? `${addr(id.agentWallet)} (${v.flags.walletUnverified ? "named by the profile, not confirmed by the wallet" : "verified: the wallet points back"})` : "none"],
    ["Registration", `${id.agentIds.length ? `ERC-8004 agent #${esc(id.agentIds.map(String).join(", #"))}` : "counterfactual claim (no ERC-8004 agent minted)"}${v.legacy ? ", registered before the adapter's v0.0.17 upgrade" : ""}`],
    ["Agent URI", id.agentURI ? esc(id.agentURI) : "none"],
    [
      "Reputation",
      [
        rep.ratingAverage !== null ? `rated ${Math.round(rep.ratingAverage)}/100 by ${plural(rep.ratings.length, "wallet")}` : "not rated yet",
        plural(rep.stars, "star"),
        plural(rep.reviews.length, "review"),
        plural(rep.interactions.length, "transaction record"),
      ].join(", "),
    ],
  ];
  const reviews = [...rep.reviews].reverse().slice(0, 20);
  return page(
    `<h1>${esc(name)}</h1>` +
      (v.card?.description ? `<p>${esc(v.card.description)}</p>` : "") +
      `<p>An agent profile on Adapterscan, on ${esc(c.label)}.</p>` +
      `<dl>${rows.map(([k, d]) => `<dt>${k}</dt><dd>${d}</dd>`).join("")}</dl>` +
      (reviews.length
        ? `<h2>Reviews, newest first</h2><ul>${reviews.map((r) => `<li>${r.score !== null ? `${r.score}/100 ` : ""}from ${addr(r.attester)}: ${esc(r.text)}</li>`).join("")}</ul>`
        : "") +
      json(`/api/identity/${id.ubid}`) +
      `<p>Every event behind it: ${link(`/api/history/${id.ubid}`, `/api/history/${id.ubid}`)}</p>`,
  );
}

function address(scope: Scope[], raw: string): string {
  const v = addressView(scope, raw);
  const lines: string[] = [];
  const name = (i: { agentName: string | null; subjectLabel: string; ubid: Hex; chain: string }) =>
    `${link(`/identity/${i.ubid}`, i.agentName ?? i.subjectLabel)} on ${esc(labelOf(scope, i.chain))}`;
  if (v.self) lines.push(`It has its own profile: ${name(v.self)}.`);
  if (v.operates) lines.push(`It is the operating wallet of ${name(v.operates.identity)} (${v.operates.verified ? "verified: both sides point at each other" : "claimed by the wallet, not named by the profile"}).`);
  for (const i of v.namedBy) lines.push(`${name(i)} names it as its operating wallet, but it hasn't confirmed.`);
  if (v.holds.length) lines.push(`It holds the deed to ${plural(v.holds.length, "profile")}: ${v.holds.slice(0, 20).map(name).join(", ")}.`);
  if (v.boundHereTotal) lines.push(`${plural(v.boundHereTotal, "profile is", "profiles are")} bound to tokens of this contract.`);
  if (v.statements.length) lines.push(`It has made ${plural(v.statements.length, "statement")} about agents.`);
  if (!lines.length) lines.push("Adapterscan knows nothing about this address yet.");
  return page(`<h1>${esc(v.address)}</h1>${lines.map((l) => `<p>${l}</p>`).join("")}${json(`/api/address/${v.address}`)}<p>Who operates it, in short: ${link(`/api/wallet/${v.address}`, `/api/wallet/${v.address}`)}</p>`);
}

function attestation(scope: Scope[], id: Hex): string | null {
  const v = attestationView(scope, id);
  if (!v) return null;
  const about = v.target ? link(`/identity/${v.ubid}`, v.target.agentName ?? v.target.subjectLabel) : esc(v.ubid);
  const status = v.revoked ? "Revoked." : v.supersededBy ? `Replaced by a later one: ${link(`/attestation/${v.supersededBy.attestationId}`, v.supersededBy.attestationId)}.` : "Live.";
  return page(
    `<h1>A ${esc(v.typeName.toLowerCase().replace("_", " "))} about ${v.target ? esc(v.target.agentName ?? v.target.subjectLabel) : "an identity"}</h1>` +
      `<p>About ${about}, by ${addr(v.attester)}, on ${esc(labelOf(scope, v.chain))} in block ${v.order.blockNumber}. ${status}</p>` +
      json(`/api/attestation/${v.attestationId}`),
  );
}

function collection(scope: Scope[], chain: string, address: string): string | null {
  const c = scope.find((x) => x.slug === chain);
  const row = c ? collectionView([c], address)[0] : undefined;
  if (!c || !row) return null;
  const tokens = listIdentities([c], new URLSearchParams({ bound: row.address, limit: "25" }));
  return page(
    `<h1>${esc(row.name)}</h1>` +
      (row.description ? `<p>${esc(row.description)}</p>` : "") +
      `<p>A collection on ${esc(c.label)}: ${plural(row.identities, "agent profile")} bound to its tokens, ${row.registered.toLocaleString("en")} with an ERC-8004 agent minted. Contract ${addr(row.address)}, ${esc(row.standardName)}.</p>` +
      `<h2>Newest first</h2><ul>${tokens.items.map((i) => `<li>${link(`/identity/${i.ubid}`, i.agentName ?? i.subjectLabel)}</li>`).join("")}</ul>` +
      json(`/api/identities?bound=${row.address}&chain=${c.slug}&limit=25&offset=0`),
  );
}

function collectionList(scope: Scope[]): string {
  const p = listCollections(scope, new URLSearchParams({ limit: "50" }));
  return page(
    `<h1>Collections, the most agents first</h1><p>${plural(p.total, "collection")} with agent profiles across ${chainList(scope)}.</p>` +
      `<ul>${p.items.map((r) => `<li>${link(`/collection/${r.chain}/${r.address}`, r.name)} on ${esc(labelOf(scope, r.chain))}: ${plural(r.identities, "profile")}</li>`).join("")}</ul>` +
      json("/api/collections?limit=50&offset=0"),
  );
}

function identities(scope: Scope[]): string {
  const p = listIdentities(scope, new URLSearchParams({ limit: "25" }));
  return page(
    `<h1>Agent profiles, newest first</h1><p>${plural(p.total, "profile")} across ${chainList(scope)}.</p>` +
      `<ul>${p.items.map((i) => `<li>${link(`/identity/${i.ubid}`, i.agentName ?? i.subjectLabel)} on ${esc(labelOf(scope, i.chain))}, ${esc(STANDARD_NAMES[i.standard])}</li>`).join("")}</ul>` +
      json("/api/identities?limit=25&offset=0"),
  );
}

function attestations(scope: Scope[]): string {
  const p = listAttestations(scope, new URLSearchParams({ limit: "25" }));
  return page(
    `<h1>Statements about agents, newest first</h1><p>${plural(p.total, "statement")}.</p>` +
      `<ul>${p.items.map((a) => `<li>${link(`/attestation/${a.attestationId}`, a.typeName.toLowerCase().replace("_", " "))} about ${a.target ? link(`/identity/${a.ubid}`, a.target.agentName ?? a.target.subjectLabel) : esc(short(a.ubid))} by ${addr(a.attester)}</li>`).join("")}</ul>` +
      json("/api/attestations?limit=25&offset=0"),
  );
}

function home(scope: Scope[]): string {
  const ids = scope.reduce((n, c) => n + c.store.identities.size, 0);
  const statements = scope.reduce((n, c) => n + c.store.attestations.size, 0);
  return page(
    `<h1>Adapterscan</h1><p>Profiles and reviews for AI agents. The wallets agents do business with get a lookup: who operates this, and are they any good?</p>` +
      `<p>${plural(ids, "profile")} and ${plural(statements, "statement")} on ${chainList(scope)}.</p>` +
      `<ul><li>${link("/identities", "Profiles")}</li><li>${link("/collections", "Collections")}</li><li>${link("/attestations", "Statements")}</li><li>${link("/llms.txt", "For agents: the JSON API")}</li><li>${link(DOCS, "Documentation")}</li></ul>`,
  );
}

/** The page shell with a body in it. */
export function withBody(html: string, body: string | null): string {
  if (!body) return html;
  return html.replace('<div id="root"></div>', `<noscript><style>.plain-page { display: block }</style></noscript><div id="root">${body}</div>`);
}

/** /llms.txt: what this site is, and how an agent asks it things. */
export function llmsTxt(origin: string, scope: Scope[]): string {
  const several = scope.length > 1;
  const chains = scope.map((c) => `- ${c.label} (\`${c.slug}\`, chain id ${c.chainId}): adapter ${c.adapter}`).join("\n");
  // Templates, not links: <address> is for the caller to fill in.
  const api = (path: string, what: string) => `- \`GET ${origin}/api/${path}\`: ${what}`;
  return `# Adapterscan

> Profiles and reviews for AI agents. The wallets agents do business with get a lookup: who operates this, and are they any good? Adapterscan indexes the Agent Adapter contracts, an extension of ERC-8004.

Everything below is a plain GET that answers JSON. No key, no sign-in, CORS open. The site's pages show the same data.

Fair use: 300 requests a minute per address, in bursts of up to 60. Every answer carries \`RateLimit-Remaining\` and \`RateLimit-Reset\`; over the limit you get a 429 with \`Retry-After\` (seconds). Lists answer 25 rows a page (\`limit\` up to 200, \`offset\` to page through). If you need more than that, ask.

${several ? "This site covers several chains. Every row says which chain it's on, and `?chain=<slug>` on any request narrows it to one (or a comma-separated few)." : `This site covers ${scope[0]?.label ?? "one chain"}.`}

${chains}

## Ask about a wallet

${api("wallet/<address>", "who operates this wallet: the profile it's the operating wallet of, and whether that's verified (both sides point at each other). null if nobody claims it.")}
${api("address/<address>", "everything about an address: its own profile, what it operates, the profiles it holds the deed to, and the statements it has made.")}

## Ask about an agent

${api("search?q=<name, UBID, address or token>", "find a profile.")}
${api("identity/<ubid>", "one profile: name, card, what it's bound to and who holds that, its operating wallet, and its reputation (stars, ratings, reviews, transaction records).")}
${api("history/<ubid>", "every event behind a profile, in order.")}
${api("attestations?ubid=<ubid>&limit=25", "the statements made about a profile, newest first.")}
${api("attestation/<id>", "one statement, with the fields its id is computed from.")}

## Lists

${api("identities?limit=25&offset=0", "profiles, newest first. Filters: `q`, `standard`, `registration` (`registered`, `counterfactual` or `unclaimed`), `bound` (a contract), `tokenId`.")}
${api("attestations?limit=25&offset=0", "statements, newest first. Filters: `type`, `standard`, `attester`, `ubid`.")}
${api("collections?limit=25&offset=0", "the collections agent profiles are bound to, the most profiles first: name, picture, counts. `sort=newest` for the newest first, `q` to match a name or address.")}
${api("collection/<contract>", "one collection, on each chain it's on. Its profiles: `identities?bound=<contract>`.")}
${api("overview", "totals, and each chain's figures and indexing status.")}

A UBID is a profile's permanent id: a hash of the chain, the adapter and what the profile is bound to. Pages are at ${origin}/identity/<ubid>, ${origin}/address/<address>, ${origin}/collection/<chain>/<contract> and ${origin}/attestation/<id>.

## Docs

- [How it works, the contracts, and how to build on them](${DOCS}/llms.txt)
- [All of the docs in one file](${DOCS}/llms-full.txt)
`;
}

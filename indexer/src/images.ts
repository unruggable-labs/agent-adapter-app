import { withRpcPurpose } from "./rpc-budget.js";
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, type Address, type PublicClient } from "viem";
import { fetchContent, parseContentUri, proxyPath } from "./gateway.js";
import type { IdentityState } from "./projection.js";
import { Standard } from "./ubid.js";

/**
 * A picture for an identity. Most controllers are NFTs, and an NFT usually has one: its
 * metadata's `image`. Registered agents may also carry one in their agent card (the JSON at
 * `agentURI`). Token image first, agent card second, nothing otherwise.
 *
 * Resolution touches the chain (tokenURI/uri) and then the open web (the metadata JSON), so only
 * the view worker calls it, and what it finds is kept in the advisory store (advisories.ts). A
 * request reads the stored card. `cardKey` says what a card was resolved from, so an edited
 * agent URI shows as a stale card without a read.
 */

const FETCH_TIMEOUT_MS = 6_000;
const MAX_JSON_BYTES = 1_000_000;

/** What a metadata document says about the thing: the token's card, or failing that the agent's. */
export interface Card {
  image: string | null;
  name: string | null;
  description: string | null;
  /** Which document it came from. */
  source: "token" | "agent";
  /** The `name` in the agent's own registration file, which can differ from the token's: what the
   *  agent is called, where the token's name is what the NFT is called. */
  agentName?: string | null;
  /** A registration file could not be read; retry without discarding known agent details. */
  agentMetadataPending?: boolean;
}

const TOKEN_URI_ABI = [{ type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] }] as const;
const URI_ABI = [{ type: "function", name: "uri", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] }] as const;

/** What a card is resolved from. A record whose key changed (a new agent URI) has a stale card.
 *  The leading version is bumped when what a card holds changes, so every stored card is read again. */
export function cardKey(id: IdentityState): string {
  return `3:${id.boundAddress}:${id.tokenId}:${id.standard}:${id.agentURI ?? ""}:${id.agentIds.at(-1) ?? ""}`;
}

/** Read the card from the chain and the web, now. The view worker's call; never a request's.
 *  `registry` is the ERC-8004 registry the adapter mints on, for agents whose URI it never emitted. */
export interface CardSources {
  tokenUri?: string | null;
  agentUri?: string | null;
}
export async function resolveCard(client: PublicClient, id: IdentityState, registry: Address | null = null, priority = false): Promise<Card | null> {
  return (await resolveCardDetails(client, id, registry, priority)).card;
}

/**
 * Did the contract answer, with a revert or with nothing? That is an answer: no holder, no URI.
 * Anything else - a rate limit, a timeout, a 5xx, our own request budget saying no - is the RPC
 * failing to ask, and says nothing about the token.
 */
export function contractAnswered(e: unknown): boolean {
  return e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError) !== null;
}

/**
 * Successful URI lookups are persisted separately from the document. HTTP retries reuse them.
 * `complete` is false when the chain never answered the token URI lookup: the card is then no
 * reading at all, and the caller keeps what it had and tries again, instead of storing "no
 * picture" for a day because the RPC (or the request budget) was busy for a second.
 */
export async function resolveCardDetails(client: PublicClient, id: IdentityState, registry: Address | null = null, priority = false, cached?: CardSources): Promise<{ card: Card | null; sources: CardSources; complete: boolean }> {
  const tokenUri = cached && "tokenUri" in cached ? cached.tokenUri
    : await withRpcPurpose("token-uri", () => tokenMetadataUri(client, id)).catch((e) => (contractAnswered(e) ? null : undefined));
  const token = tokenUri ? await cardIn(tokenUri, "token", priority).catch(() => null) : null;
  const agentUri = id.agentURI !== null ? id.agentURI : cached && "agentUri" in cached ? cached.agentUri
    : !id.agentIds.length ? null : registry ? await withRpcPurpose("agent-uri", () => registryUri(client, id, registry)).catch(() => undefined) : undefined;
  const agent = agentUri ? await cardIn(agentUri, "agent", priority).catch(() => null) : null;
  const sources: CardSources = { ...(tokenUri !== undefined ? { tokenUri } : {}), ...(agentUri !== undefined ? { agentUri } : {}) };
  const pending = !!(id.agentURI || id.agentIds.length) && !agent;
  const complete = tokenUri !== undefined;
  if (!token && !agent && !pending) return { card: null, sources, complete };
  return { sources, complete, card: {
    image: token?.image ?? agent?.image ?? null,
    name: token?.name ?? agent?.name ?? null,
    description: token?.description ?? agent?.description ?? null,
    source: token ? "token" : "agent",
    agentName: agent?.name ?? null,
    ...(pending ? { agentMetadataPending: true } : {}),
  } };
}

/**
 * The agent's URI as the ERC-8004 registry has it. `register(..., agentURI)` hands the URI to the
 * registry, which says so in its own event; the adapter's AgentBound doesn't carry it, so a
 * minted agent's registration file is only on the registry until an AgentURISet. The newest
 * agent id is the one the binding points at now.
 */
async function registryUri(client: PublicClient, id: IdentityState, registry: Address | null): Promise<string | null> {
  const agentId = id.agentIds.at(-1);
  if (!registry || agentId === undefined) return null;
  const uri = (await client.readContract({ address: registry, abi: TOKEN_URI_ABI, functionName: "tokenURI", args: [agentId] })) as string;
  return uri || null;
}

/** Where a token's metadata lives, per standard. ERC-1155 URIs may carry a `{id}` slot that takes
 *  the id as 64 lowercase hex digits. ERC-6909's metadata extension mirrors ERC-721's tokenURI. */
async function tokenMetadataUri(client: PublicClient, id: IdentityState): Promise<string | null> {
  const address = id.boundAddress as Address;
  switch (id.standard) {
    case Standard.ERC721:
    case Standard.ERC6909:
    case Standard.ERC6909F:
      return (await client.readContract({ address, abi: TOKEN_URI_ABI, functionName: "tokenURI", args: [id.tokenId] })) as string;
    case Standard.ERC1155:
    case Standard.ERC1155F: {
      const raw = (await client.readContract({ address, abi: URI_ABI, functionName: "uri", args: [id.tokenId] })) as string;
      return raw.replace(/\{id\}/g, id.tokenId.toString(16).padStart(64, "0"));
    }
    default:
      return null;
  }
}

/** Fetch a metadata document and read its card: image as something a browser can load, name
 *  and description as plain text, cut to sane lengths. Null when it holds none of the three. */
async function cardIn(uri: string, source: Card["source"], priority: boolean): Promise<Card | null> {
  const json = await readJson(uri, priority);
  if (!json || typeof json !== "object") return null;
  const doc = json as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null);
  const candidate = [doc.image, doc.image_url, doc.imageUrl].find((v) => typeof v === "string" && v.length > 0) as string | undefined;
  const card: Card = {
    image: candidate ? toBrowserUrl(candidate) : null,
    name: str(doc.name, 80),
    description: str(doc.description, 600),
    source,
  };
  return card.image || card.name || card.description ? card : null;
}

export async function readJson(uri: string, priority = false): Promise<unknown> {
  const data = /^data:([^,]*),(.*)$/s.exec(uri);
  if (data) {
    const [, meta, payload] = data;
    const text = /;base64$/i.test(meta) ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
    return JSON.parse(text);
  }
  // Content-addressed documents come through the gateway module: its gateways, its cache.
  const content = parseContentUri(uri);
  if (content) {
    const got = await fetchContent(content.scheme, content.path, priority);
    if (!got || got.body.length > MAX_JSON_BYTES) return null;
    return JSON.parse(got.body.toString("utf8"));
  }
  const url = uri.trim();
  if (!/^https?:/.test(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_JSON_BYTES) return null;
  const text = await res.text();
  if (text.length > MAX_JSON_BYTES) return null;
  return JSON.parse(text);
}

/** What the browser loads: content-addressed images through our own /ipfs and /ar routes (see
 *  gateway.ts), http(s) and data: images as they are, anything else dropped. */
export function toBrowserUrl(uri: string): string | null {
  const proxied = proxyPath(uri);
  if (proxied) return proxied;
  const u = uri.trim();
  if (/^(https?:|data:image\/)/i.test(u)) return u;
  return null;
}

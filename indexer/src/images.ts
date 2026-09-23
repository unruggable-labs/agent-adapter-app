import type { Address, PublicClient } from "viem";
import type { IdentityState } from "./projection.js";
import { Standard } from "./ubid.js";

/**
 * A picture for an identity. Most controllers are NFTs, and an NFT usually has one: its
 * metadata's `image`. Registered agents may also carry one in their agent card (the JSON at
 * `agentURI`). Token image first, agent card second, nothing otherwise.
 *
 * Resolution touches the chain (tokenURI/uri) and then the open web (the metadata JSON), so it
 * is never awaited on the request path: `imageFor` answers from cache and starts a background
 * resolution on a miss. The next poll picks the answer up. Hits are kept for hours, misses are
 * retried after minutes, and the cache key includes the agent URI so an edited card re-resolves.
 */

const HIT_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_JSON_BYTES = 1_000_000;

/** What a metadata document says about the thing: the token's card, or failing that the agent's. */
export interface Card {
  image: string | null;
  name: string | null;
  description: string | null;
  /** Which document it came from. */
  source: "token" | "agent";
}

const cache = new Map<string, { value: Card | null; at: number }>();
const inFlight = new Set<string>();

const TOKEN_URI_ABI = [{ type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] }] as const;
const URI_ABI = [{ type: "function", name: "uri", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] }] as const;

export function imageFor(client: PublicClient, id: IdentityState): string | null {
  return cardFor(client, id)?.image ?? null;
}

export function cardFor(client: PublicClient, id: IdentityState): Card | null {
  const key = `${id.boundAddress}:${id.tokenId}:${id.standard}:${id.agentURI ?? ""}`;
  const hit = cache.get(key);
  const fresh = hit && Date.now() - hit.at < (hit.value ? HIT_TTL_MS : MISS_TTL_MS);
  if (fresh) return hit.value;
  if (!inFlight.has(key)) {
    inFlight.add(key);
    resolve(client, id)
      .catch(() => null)
      .then((value) => {
        cache.set(key, { value, at: Date.now() });
        inFlight.delete(key);
      });
  }
  return hit?.value ?? null;
}

async function resolve(client: PublicClient, id: IdentityState): Promise<Card | null> {
  const tokenUri = await tokenMetadataUri(client, id).catch(() => null);
  const token = tokenUri ? await cardIn(tokenUri, "token").catch(() => null) : null;
  const agent = id.agentURI ? await cardIn(id.agentURI, "agent").catch(() => null) : null;
  if (!token && !agent) return null;
  // The token's card leads; the agent card fills anything it left blank.
  return {
    image: token?.image ?? agent?.image ?? null,
    name: token?.name ?? agent?.name ?? null,
    description: token?.description ?? agent?.description ?? null,
    source: token ? "token" : "agent",
  };
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
async function cardIn(uri: string, source: Card["source"]): Promise<Card | null> {
  const json = await readJson(uri);
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

async function readJson(uri: string): Promise<unknown> {
  const data = /^data:([^,]*),(.*)$/s.exec(uri);
  if (data) {
    const [, meta, payload] = data;
    const text = /;base64$/i.test(meta) ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
    return JSON.parse(text);
  }
  const url = toBrowserUrl(uri);
  if (!url || !/^https?:/.test(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_JSON_BYTES) return null;
  const text = await res.text();
  if (text.length > MAX_JSON_BYTES) return null;
  return JSON.parse(text);
}

/** ipfs:// and ar:// through public gateways; http(s) and data: as they are; anything else dropped. */
function toBrowserUrl(uri: string): string | null {
  const u = uri.trim();
  if (/^ipfs:\/\//i.test(u)) return `https://ipfs.io/ipfs/${u.replace(/^ipfs:\/\/(ipfs\/)?/i, "")}`;
  if (/^ar:\/\//i.test(u)) return `https://arweave.net/${u.slice(5)}`;
  if (/^(https?:|data:image\/)/i.test(u)) return u;
  return null;
}

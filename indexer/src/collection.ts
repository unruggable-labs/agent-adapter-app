import type { Address, PublicClient } from "viem";
import { readJson, toBrowserUrl } from "./images.js";

/**
 * What a collection or contract says about itself: the `contractURI()` document (OpenSea's
 * convention, widely followed) with a name, a description, an image and a website. Read once
 * per address by the view worker, never on a request. Where a token has no image yet - an
 * identity claimed ahead of the mint, say - the collection's image stands in.
 */
export interface Collection {
  name: string | null;
  description: string | null;
  image: string | null;
  /** The project's website, http(s) only. */
  externalLink: string | null;
}

const HIT_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 30 * 60 * 1000;
const cache = new Map<Address, { value: Collection | null; at: number }>();

const CONTRACT_URI_ABI = [{ type: "function", name: "contractURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const;

export async function collectionFor(client: PublicClient, address: Address): Promise<Collection | null> {
  const key = address.toLowerCase() as Address;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? HIT_TTL_MS : MISS_TTL_MS)) return hit.value;
  let value: Collection | null = null;
  try {
    const uri = (await client.readContract({ address, abi: CONTRACT_URI_ABI, functionName: "contractURI" })) as string;
    value = parseCollection(await readJson(uri));
  } catch {
    value = null;
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

export function parseCollection(json: unknown): Collection | null {
  if (!json || typeof json !== "object") return null;
  const doc = json as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null);
  const image = str(doc.image ?? doc.image_url ?? doc.imageUrl, 2000);
  const link = str(doc.external_link ?? doc.external_url ?? doc.externalLink, 2000);
  const value: Collection = {
    name: str(doc.name, 80),
    description: str(doc.description, 600),
    image: image ? toBrowserUrl(image) : null,
    externalLink: link && /^https?:\/\//i.test(link) ? link : null,
  };
  return value.name || value.description || value.image || value.externalLink ? value : null;
}

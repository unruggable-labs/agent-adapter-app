import type { Address, PublicClient } from "viem";
import { readJson, toBrowserUrl } from "./images.js";

/**
 * What a collection or contract says about itself: the `contractURI()` document (OpenSea's
 * convention, widely followed) with a name, a description, an image and a website. Read once
 * by the view worker and kept in the advisory store, never on a request. Where a token has no image yet - an
 * identity claimed ahead of the mint, say - the collection's image stands in.
 */
export interface Collection {
  name: string | null;
  description: string | null;
  image: string | null;
  /** The project's website, http(s) only. */
  externalLink: string | null;
}

const CONTRACT_URI_ABI = [{ type: "function", name: "contractURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const;

export async function collectionFor(client: PublicClient, address: Address): Promise<Collection | null> {
  let value: Collection | null = null;
  try {
    const uri = (await client.readContract({ address, abi: CONTRACT_URI_ABI, functionName: "contractURI" })) as string;
    value = parseCollection(await readJson(uri));
  } catch {
    value = null;
  }
  return value;
}

export function parseCollection(json: unknown): Collection | null {
  if (!json || typeof json !== "object") return null;
  const doc = json as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null);
  // An inline data: image (an on-chain SVG) is the whole picture, so it can't be cut like a URL.
  const image = str(doc.image ?? doc.image_url ?? doc.imageUrl, 200_000);
  const link = str(doc.external_link ?? doc.external_url ?? doc.externalLink, 2000);
  const value: Collection = {
    name: str(doc.name, 80),
    description: str(doc.description, 600),
    image: image ? toBrowserUrl(image) : null,
    externalLink: link && /^https?:\/\//i.test(link) ? link : null,
  };
  return value.name || value.description || value.image || value.externalLink ? value : null;
}

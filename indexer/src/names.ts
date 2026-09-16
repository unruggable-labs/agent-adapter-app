import { type Address, type PublicClient } from "viem";
import type { IdentityState } from "./projection.js";
import { ACCOUNT_STANDARDS } from "./ubid.js";

/**
 * Human labels for identities. Hashes are the identity; names are how people find them.
 *  - subjectLabel: what the bound thing is called — collection `name()` + token id for token
 *    subjects, the contract's `name()` (or short address) for account subjects.
 *  - agentName: what the agent calls itself — the identity's own `name` metadata entry, when
 *    it decodes as printable UTF-8. Claims, not truth: it is caller-supplied like the rest.
 */

const nameCache = new Map<Address, string | null>();

async function contractName(client: PublicClient, address: Address): Promise<string | null> {
  const key = address.toLowerCase() as Address;
  if (nameCache.has(key)) return nameCache.get(key)!;
  let name: string | null = null;
  try {
    const raw = (await client.readContract({
      address,
      abi: [{ type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }],
      functionName: "name",
    })) as string;
    if (raw && raw.length <= 64) name = raw;
  } catch {
    name = null;
  }
  nameCache.set(key, name);
  return name;
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** NameWrapper-style token ids are 30+ digit namehashes — all digits, no information.
 *  Anything longer than 12 digits displays hash-style. */
function shortTokenId(tokenId: bigint): string {
  const s = tokenId.toString();
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function decodeUtf8Metadata(value: `0x${string}` | undefined): string | null {
  if (!value || value === "0x") return null;
  try {
    const bytes = value.slice(2).match(/.{2}/g)!.map((b) => parseInt(b, 16));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    const clean = text.trim();
    // printable, short, no control characters — otherwise it is data, not a name
    if (clean.length === 0 || clean.length > 48 || /[\x00-\x1f\x7f]/.test(clean)) return null;
    return clean;
  } catch {
    return null;
  }
}

export async function labelsFor(
  client: PublicClient,
  id: IdentityState,
): Promise<{ subjectLabel: string; agentName: string | null }> {
  const name = await contractName(client, id.boundAddress);
  const subjectLabel = ACCOUNT_STANDARDS.has(id.standard)
    ? (name ?? `Account ${short(id.boundAddress)}`)
    : `${name ?? short(id.boundAddress)} #${shortTokenId(id.tokenId)}`;
  return { subjectLabel, agentName: decodeUtf8Metadata(id.metadata.get("name")) };
}

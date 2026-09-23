import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { cardFor, imageFor } from "../src/images.js";
import type { IdentityState } from "../src/projection.js";
import { Standard } from "../src/ubid.js";

/** A client whose reads are scripted per function name; unknown reads revert. */
function client(reads: Record<string, (args: readonly unknown[]) => string>): PublicClient {
  return {
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      const fn = reads[functionName];
      if (!fn) throw new Error(`The contract function "${functionName}" reverted.`);
      return fn(args);
    },
  } as unknown as PublicClient;
}

let n = 0;
function identity(over: Partial<IdentityState>): IdentityState {
  return {
    ubid: `0x${(++n).toString(16).padStart(64, "0")}`,
    standard: Standard.ERC721,
    boundAddress: `0x${(n + 0x1000).toString(16).padStart(40, "0")}`,
    tokenId: 7n,
    agentURI: null,
    metadata: new Map(),
    ...over,
  } as IdentityState;
}

const json = (doc: unknown) => `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString("base64")}`;

/** imageFor answers from cache and resolves in the background; settle, then ask again. */
async function resolved(c: PublicClient, id: IdentityState) {
  expect(imageFor(c, id)).toBeNull();
  await new Promise((r) => setTimeout(r, 20));
  return imageFor(c, id);
}

describe("identity images", () => {
  it("takes an ERC-721 token's metadata image and routes ipfs through a gateway", async () => {
    const c = client({ tokenURI: () => json({ name: "Punk", image: "ipfs://bafyfoo/7.png" }) });
    expect(await resolved(c, identity({}))).toBe("https://ipfs.io/ipfs/bafyfoo/7.png");
  });

  it("fills the ERC-1155 {id} slot with the 64-hex token id", async () => {
    const c = client({ uri: () => 'data:application/json,{"image":"https://cdn.example/{id}.png"}' });
    const img = await resolved(c, identity({ standard: Standard.ERC1155, tokenId: 255n }));
    expect(img).toBe(`https://cdn.example/${"ff".padStart(64, "0")}.png`);
  });

  it("falls back to the agent card's image when the token has none", async () => {
    const c = client({ tokenURI: () => "" });
    const img = await resolved(c, identity({ agentURI: json({ name: "Agent", image: "https://agent.example/pic.png" }) }));
    expect(img).toBe("https://agent.example/pic.png");
  });

  it("is null when tokenURI reverts and there is no agent card", async () => {
    expect(await resolved(client({}), identity({}))).toBeNull();
  });

  it("never returns a scheme a browser can't load", async () => {
    const c = client({ tokenURI: () => json({ image: "ftp://nope/pic.png" }) });
    expect(await resolved(c, identity({}))).toBeNull();
  });

  it("does not look up token metadata for account standards", async () => {
    let reads = 0;
    const c = client({ tokenURI: () => (reads++, json({ image: "https://x/y.png" })) });
    expect(await resolved(c, identity({ standard: Standard.ACCOUNT }))).toBeNull();
    expect(reads).toBe(0);
  });

  it("keeps the token's name and description, and lets the agent card fill what the token left blank", async () => {
    const c = client({ tokenURI: () => json({ name: "Punk #7", image: "ipfs://bafy/7.png" }) });
    const id = identity({ agentURI: json({ name: "PunkBot", description: "Trades punks, politely." }) });
    expect(cardFor(c, id)).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(cardFor(c, id)).toEqual({
      image: "https://ipfs.io/ipfs/bafy/7.png",
      name: "Punk #7",
      description: "Trades punks, politely.",
      source: "token",
    });
  });
});

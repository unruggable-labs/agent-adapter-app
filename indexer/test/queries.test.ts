import { describe, expect, it } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { ProjectionStore, type LogEvent } from "../src/projection.js";
import { addressView, attestationView, listAttestations, listIdentities, search } from "../src/queries.js";
import { AttestationType, computeAttestationId, computeUbid, Standard } from "../src/ubid.js";
import { ViewCache } from "../src/views.js";

const CHAIN = 31337n;
const ADAPTER = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0" as Address;
const PUNKS = "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9" as Address;
const ALICE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const BOB = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address;
const UBID7 = computeUbid(CHAIN, ADAPTER, Standard.ERC721, PUNKS, 7n);
const UBID9 = computeUbid(CHAIN, ADAPTER, Standard.ERC721, PUNKS, 9n);
const UBID_BOB = computeUbid(CHAIN, ADAPTER, Standard.ACCOUNT, BOB, 0n);
const ZERO32 = `0x${"00".repeat(32)}` as Hex;

const ev = (block: number, eventName: string, args: Record<string, unknown>): LogEvent => ({ blockNumber: BigInt(block), logIndex: 0, eventName, args });
const registered = (block: number, ubid: Hex, standard: number, boundAddress: Address, tokenId: bigint, emitter: Address, metadata: { metadataKey: string; metadataValue: Hex }[] = []) =>
  ev(block, "CounterfactualAgentRegistered", { ubid, boundAddress, tokenId, standard, emitter, agentURI: null, metadata });
const starred = (block: number, attester: Address, ubid: Hex, data: Hex = "0x01") => {
  const attestationId = computeAttestationId(CHAIN, ADAPTER, attester, ubid, AttestationType.STAR, BigInt(block), ZERO32, data);
  return { ...ev(block, "Attested", { attester, attestationType: AttestationType.STAR, ubid, attestationId, variant: ZERO32, data }), transactionHash: `0x${block.toString(16).padStart(64, "0")}` as Hex, attestationId };
};

/** A chain that knows PunkBot holds #7 and the collection's name. */
function world() {
  const store = new ProjectionStore(CHAIN, ADAPTER);
  store.apply(registered(1, UBID7, Standard.ERC721, PUNKS, 7n, ALICE, [{ metadataKey: "name", metadataValue: ("0x" + Buffer.from("PunkBot").toString("hex")) as Hex }]));
  store.apply(registered(2, UBID_BOB, Standard.ACCOUNT, BOB, 0n, BOB));
  store.apply(registered(3, UBID9, Standard.ERC721, PUNKS, 9n, PUNKS));
  store.apply(starred(4, BOB, UBID7));
  const client = {
    readContract: async ({ address, functionName, args }: { address: Address; functionName: string; args?: unknown[] }) => {
      if (functionName === "ownerOf") return args?.[0] === 7n ? ALICE : "0x0000000000000000000000000000000000000000";
      if (functionName === "name") return address === PUNKS ? "DemoPunks" : null; // only the collection has a name
      throw new Error(`unexpected ${functionName}`);
    },
    getCode: async () => "0x",
    getStorageAt: async () => undefined,
  } as unknown as PublicClient;
  const views = new ViewCache(store, client);
  return { store, views };
}
const params = (o: Record<string, string>) => new URLSearchParams(o);

describe("queries", () => {
  it("pages identities newest first, with filters", async () => {
    const { store, views } = world();
    const all = listIdentities(store, views, params({ limit: "10" }));
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.ubid)).toEqual([UBID9, UBID_BOB, UBID7]);
    const second = listIdentities(store, views, params({ limit: "1", offset: "1" }));
    expect(second.items.map((i) => i.ubid)).toEqual([UBID_BOB]);
    expect(listIdentities(store, views, params({ standard: "ACCOUNT" })).items.map((i) => i.ubid)).toEqual([UBID_BOB]);
    expect(listIdentities(store, views, params({ bound: PUNKS, tokenId: "7" })).items.map((i) => i.ubid)).toEqual([UBID7]);
    expect(listIdentities(store, views, params({ q: "punkbot" })).items.map((i) => i.ubid)).toEqual([UBID7]);
    await views.refresh(store.identities.get(UBID9)!);
    expect(listIdentities(store, views, params({ q: "demopunks" })).total).toBe(1); // only #9 has its name read so far
  });

  it("search: addresses lead, then identities with why they matched", async () => {
    const { store, views } = world();
    for (const id of store.identities.values()) await views.refresh(id);
    const byName = search(store, views, "punk");
    expect(byName.map((h) => (h.kind === "identity" ? h.identity.ubid : h.address)).sort()).toEqual([UBID7, UBID9].sort()); // "PunkBot" and "DemoPunks #9"
    const bob = search(store, views, BOB);
    expect(bob[0]).toEqual({ kind: "address", address: BOB });
    expect(bob[1]).toMatchObject({ kind: "identity", note: "this address is the agent", tone: "ok" });
    const alice = search(store, views, ALICE.slice(0, 10));
    expect(alice[0]).toEqual({ kind: "address", address: ALICE }); // a known holder
    expect(alice[1]).toMatchObject({ kind: "identity", note: "holds the token" });
    expect(search(store, views, UBID7.slice(0, 12))[0]).toMatchObject({ kind: "identity", note: "UBID" });
    expect(search(store, views, "")).toEqual([]);
  });

  it("an address: what it is, holds, and has said", async () => {
    const { store, views } = world();
    for (const id of store.identities.values()) await views.refresh(id);
    const bob = addressView(store, views, BOB.toUpperCase().replace("0X", "0x"));
    expect(bob.self?.ubid).toBe(UBID_BOB);
    expect(bob.operates).toBeNull();
    expect(bob.statements).toHaveLength(1);
    expect(bob.statements[0].target?.ubid).toBe(UBID7);
    expect(bob.statements[0].typeName).toBe("STAR");
    const alice = addressView(store, views, ALICE);
    expect(alice.self).toBeNull();
    expect(alice.holds.map((i) => i.ubid)).toEqual([UBID7]);
    const punks = addressView(store, views, PUNKS);
    expect(punks.boundHereTotal).toBe(2);
  });

  it("pages statements with their targets and filters", () => {
    const { store, views } = world();
    const page = listAttestations(store, views, params({ limit: "5" }));
    expect(page.total).toBe(1);
    expect(page.items[0].target?.ubid).toBe(UBID7);
    expect(listAttestations(store, views, params({ type: "RATING" })).total).toBe(0);
    expect(listAttestations(store, views, params({ standard: "ERC721" })).total).toBe(1);
    expect(listAttestations(store, views, params({ attester: ALICE })).total).toBe(0);
  });

  it("one statement in full: its target, its transaction, what replaced or revoked it, and its preimage", () => {
    const { store, views } = world();
    const first = [...store.attestations.keys()][0];
    const v = attestationView(store, views, first)!;
    expect(v.target?.ubid).toBe(UBID7);
    expect(v.typeName).toBe("STAR");
    expect(v.revoked).toBe(false);
    expect(v.supersededBy).toBeNull();
    expect(v.transactionHash).toBe(`0x${(4).toString(16).padStart(64, "0")}`);
    expect(v.preimage).toMatchObject({ chainId: CHAIN, adapter: ADAPTER, attester: BOB, ubid: UBID7, attestationType: AttestationType.STAR, blockNumber: 4n, variant: ZERO32, data: "0x01" });
    expect(attestationView(store, views, `0x${"ab".repeat(32)}` as Hex)).toBeNull();

    // Bob stars again later (value 0): the first star is replaced, not revoked
    const second = starred(5, BOB, UBID7, "0x00");
    store.apply(second);
    expect(attestationView(store, views, first)!.supersededBy).toEqual({ attestationId: second.attestationId, order: { blockNumber: 5n, logIndex: 0 } });
    expect(attestationView(store, views, second.attestationId)!.supersededBy).toBeNull();

    // then revokes the second: revoked wins over replaced, and the revocation is on the record
    store.apply({ ...ev(6, "AttestationRevoked", { attestationId: second.attestationId, revoker: BOB }), transactionHash: `0x${"06".repeat(32)}` as Hex });
    const revoked = attestationView(store, views, second.attestationId)!;
    expect(revoked.revoked).toBe(true);
    expect(revoked.revocation).toEqual({ revoker: BOB, order: { blockNumber: 6n, logIndex: 0 }, transactionHash: `0x${"06".repeat(32)}` });
    expect(revoked.supersededBy).toBeNull();
    // with the second gone, the first stands again
    expect(attestationView(store, views, first)!.supersededBy).toBeNull();
  });
});

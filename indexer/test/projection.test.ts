import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { ProjectionStore, type LogEvent } from "../src/projection.js";
import { AttestationType, computeAttestationId, computeUbid, Standard } from "../src/ubid.js";

const CHAIN = 31337n;
const ADAPTER = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0" as Address;
const PUNKS = "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9" as Address;
const ALICE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const BOB = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address;

const UBID7 = computeUbid(CHAIN, ADAPTER, Standard.ERC721, PUNKS, 7n);

let seq = 0;
function ev(eventName: string, args: Record<string, unknown>, block = ++seq): LogEvent {
  return { blockNumber: BigInt(block), logIndex: 0, eventName, args };
}

function cf(eventName: string, emitter: Address, extra: Record<string, unknown> = {}, block?: number): LogEvent {
  return ev(
    eventName,
    { ubid: UBID7, boundAddress: PUNKS, tokenId: 7n, standard: Standard.ERC721, emitter, ...extra },
    block,
  );
}

function attested(
  attester: Address,
  type: AttestationType,
  data: Hex,
  block: number,
  ubid: Hex = UBID7,
  variant: Hex = `0x${"00".repeat(32)}`,
): LogEvent {
  const attestationId = computeAttestationId(CHAIN, ADAPTER, attester, ubid, type, BigInt(block), variant, data);
  return ev("Attested", { attester, attestationType: type, ubid, attestationId, variant, data }, block);
}

function freshStore() {
  seq += 1000; // keep order strictly increasing across helper calls in one test
  return new ProjectionStore(CHAIN, ADAPTER);
}

describe("counterfactual fold", () => {
  it("drops events whose UBID does not match their coordinates (I-1)", () => {
    const store = freshStore();
    store.apply(
      ev("CounterfactualAgentRegistered", {
        ubid: computeUbid(CHAIN, ADAPTER, Standard.ERC721, PUNKS, 8n), // wrong hash for tokenId 7
        boundAddress: PUNKS,
        tokenId: 7n,
        standard: Standard.ERC721,
        emitter: ALICE,
        agentURI: "ipfs://x",
        metadata: [],
      }),
    );
    expect(store.dropped).toHaveLength(1);
    expect(store.identities.size).toBe(0);
  });

  it("registration is a full re-statement: metadata map is replaced (R-1)", () => {
    const store = freshStore();
    store.apply(cf("CounterfactualAgentRegistered", ALICE, { agentURI: "a", metadata: [{ metadataKey: "k1", metadataValue: "0x01" }] }));
    store.apply(cf("CounterfactualMetadataSet", ALICE, { metadataKey: "k2", metadataValue: "0x02" }));
    store.apply(cf("CounterfactualAgentRegistered", ALICE, { agentURI: "b", metadata: [{ metadataKey: "k3", metadataValue: "0x03" }] }));
    const id = store.identities.get(UBID7)!;
    expect(id.agentURI).toBe("b");
    expect([...id.metadata.keys()]).toEqual(["k3"]);
  });

  it("field events before any registration are retained with claimed=false (R-4)", () => {
    const store = freshStore();
    store.apply(cf("CounterfactualAgentURISet", ALICE, { newURI: "ipfs://early" }));
    const id = store.identities.get(UBID7)!;
    expect(id.claimed).toBe(false);
    expect(id.agentURI).toBe("ipfs://early");
  });

  it("wallet unset is field-level (R-2)", () => {
    const store = freshStore();
    store.apply(cf("CounterfactualAgentRegistered", ALICE, { agentURI: "a", metadata: [] }));
    store.apply(cf("CounterfactualAgentWalletSet", ALICE, { newWallet: ALICE }));
    store.apply(cf("CounterfactualAgentWalletUnset", ALICE));
    const id = store.identities.get(UBID7)!;
    expect(id.agentWallet).toBeNull();
    expect(id.claimed).toBe(true);
    expect(id.agentURI).toBe("a");
  });

  it("flags collection-authored events after an owner has spoken (R-5)", () => {
    const store = freshStore();
    store.apply(cf("CounterfactualAgentRegistered", PUNKS, { agentURI: "premint", metadata: [] })); // window
    store.apply(cf("CounterfactualAgentRegistered", ALICE, { agentURI: "owner", metadata: [] }));
    expect(store.identities.get(UBID7)!.collectionAuthoredAfterOwner).toBe(false);
    store.apply(cf("CounterfactualAgentRegistered", PUNKS, { agentURI: "hijack", metadata: [] })); // post-burn
    const id = store.identities.get(UBID7)!;
    expect(id.collectionAuthoredAfterOwner).toBe(true);
    expect(id.lastEventCollectionAuthored).toBe(true);
    expect(id.agentURI).toBe("hijack"); // latest-wins stays normative — flag, not suppression
  });

  it("rejects out-of-order application (O-1)", () => {
    const store = freshStore();
    store.apply(cf("CounterfactualAgentRegistered", ALICE, { agentURI: "a", metadata: [] }, seq + 10));
    expect(() => store.apply(cf("CounterfactualAgentURISet", ALICE, { newURI: "b" }, 1))).toThrow(/out of order/);
  });
});

describe("registration join", () => {
  it("AgentBound with the same coordinates joins the counterfactual identity by UBID", () => {
    const store = freshStore();
    store.apply(cf("CounterfactualAgentRegistered", ALICE, { agentURI: "a", metadata: [] }));
    store.apply(ev("AgentBound", { agentId: 0n, standard: Standard.ERC721, boundAddress: PUNKS, tokenId: 7n, registeredBy: ALICE }));
    const id = store.identities.get(UBID7)!;
    expect(id.agentIds).toEqual([0n]); // agent id 0 is a real id, never null
    expect(store.agents.get(0n)!.ubid).toBe(UBID7);
  });
});

describe("wallet UBID", () => {
  it("verifies only under mutual pointing", () => {
    const store = freshStore();
    store.apply(ev("WalletUBIDSet", { account: ALICE, ubid: UBID7, boundAddress: PUNKS, tokenId: 7n, standard: Standard.ERC721, setBy: ALICE }));
    expect(store.resolveWallet(ALICE)!.verified).toBe(false); // identity does not point back yet
    store.apply(cf("CounterfactualAgentWalletSet", ALICE, { newWallet: ALICE }));
    expect(store.resolveWallet(ALICE)!.verified).toBe(true);
    store.apply(ev("WalletUBIDCleared", { account: ALICE, clearedBy: ALICE }));
    expect(store.resolveWallet(ALICE)).toBeNull();
  });
});

describe("attestations (spec §5)", () => {
  it("revocation by a non-attester is inert (rule 4)", () => {
    const store = freshStore();
    const a = attested(BOB, AttestationType.STAR, "0x01", ++seq);
    store.apply(a);
    store.apply(ev("AttestationRevoked", { attestationId: a.args.attestationId, revoker: ALICE }));
    expect(store.reputation(UBID7).stars).toBe(1);
    expect(store.inertRevocations).toHaveLength(1);
    store.apply(ev("AttestationRevoked", { attestationId: a.args.attestationId, revoker: BOB }));
    expect(store.reputation(UBID7).stars).toBe(0);
  });

  it("revoking the latest rating resurrects the older one (rule 5)", () => {
    const store = freshStore();
    store.apply(attested(BOB, AttestationType.RATING, "0x32", ++seq)); // 50
    const eighty = attested(BOB, AttestationType.RATING, "0x50", ++seq); // 80
    store.apply(eighty);
    expect(store.reputation(UBID7).ratingAverage).toBe(80);
    store.apply(ev("AttestationRevoked", { attestationId: eighty.args.attestationId, revoker: BOB }));
    expect(store.reputation(UBID7).ratingAverage).toBe(50);
  });

  it("re-attestation of a revoked id reactivates it (rule 3)", () => {
    const store = freshStore();
    // attest, revoke, and re-attest all in one block: identical content in one block is the
    // same id, so the third log reactivates the second's revocation in log order
    const block = ++seq;
    const star = attested(BOB, AttestationType.STAR, "0x01", block);
    store.apply(star);
    store.apply({
      blockNumber: BigInt(block),
      logIndex: 1,
      eventName: "AttestationRevoked",
      args: { attestationId: star.args.attestationId, revoker: BOB },
    });
    store.apply({ ...star, logIndex: 5 });
    expect(store.reputation(UBID7).stars).toBe(1);
  });

  it("drops Attested events whose id does not match their fields (I-1)", () => {
    const store = freshStore();
    const bad = attested(BOB, AttestationType.STAR, "0x01", ++seq);
    (bad.args as Record<string, unknown>).data = "0x00"; // tamper: id no longer matches
    store.apply(bad);
    expect(store.dropped).toHaveLength(1);
    expect(store.attestations.size).toBe(0);
  });

  it("invalid payloads are excluded at read time, not errors", () => {
    const store = freshStore();
    store.apply(attested(BOB, AttestationType.RATING, "0xff", ++seq)); // 255 > 100: invalid
    store.apply(attested(ALICE, AttestationType.STAR, "0x0101", ++seq)); // two bytes: invalid
    const rep = store.reputation(UBID7);
    expect(rep.ratingAverage).toBeNull();
    expect(rep.stars).toBe(0);
    expect(store.attestations.size).toBe(2); // recorded either way — invalidity is a read-time rule
  });

  it("attestations to an unclaimed UBID are retained and resolve later", () => {
    const store = freshStore();
    store.apply(attested(BOB, AttestationType.STAR, "0x01", ++seq));
    expect(store.identities.has(UBID7)).toBe(false);
    expect(store.reputation(UBID7).stars).toBe(1); // meaning precedes the claim
    store.apply(cf("CounterfactualAgentRegistered", ALICE, { agentURI: "late", metadata: [] }));
    expect(store.identities.get(UBID7)!.claimed).toBe(true);
  });
});

describe("audit trail", () => {
  it("records every event that touched an identity, including the ones that did not count", () => {
    const store = new ProjectionStore(CHAIN, ADAPTER);
    const cf = (eventName: string, block: number, extra: Record<string, unknown>, emitter = ALICE) =>
      ({ blockNumber: BigInt(block), logIndex: 0, eventName, transactionHash: `0x${block.toString(16).padStart(64, "0")}` as `0x${string}`, args: { standard: Standard.ERC721, boundAddress: PUNKS, tokenId: 7n, ubid: UBID7, emitter, ...extra } }) as const;
    store.apply(cf("CounterfactualAgentRegistered", 1, { agentURI: "ipfs://a", metadata: [] }));
    store.apply(cf("CounterfactualAgentURISet", 2, { newURI: "ipfs://b" }));
    // a forged claim: the UBID topic does not match the coordinates
    store.apply({ ...cf("CounterfactualAgentURISet", 3, { newURI: "ipfs://evil" }), args: { ...cf("CounterfactualAgentURISet", 3, { newURI: "ipfs://evil" }).args, tokenId: 8n } });
    const trail = store.history.get(UBID7)!;
    expect(trail.map((h) => [h.eventName, h.outcome])).toEqual([
      ["CounterfactualAgentRegistered", "applied"],
      ["CounterfactualAgentURISet", "applied"],
      ["CounterfactualAgentURISet", "dropped"],
    ]);
    expect(trail[0].effect).toMatch(/^Claimed by the holder/);
    expect(trail[1].effect).toContain("ipfs://b");
    expect(trail[0].transactionHash).toBe(`0x${"1".padStart(64, "0")}`);
    expect(trail.every((h) => h.actor === ALICE)).toBe(true);
    expect(store.identities.get(UBID7)!.agentURI).toBe("ipfs://b");
  });
});

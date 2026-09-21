import type { Address, Hex } from "viem";
import {
  ACCOUNT_STANDARDS,
  AttestationType,
  computeAttestationId,
  computeUbid,
  Standard,
} from "./ubid.js";

/** One decoded, ordered log. `logIndex` is block-scoped so (blockNumber, logIndex) totally orders. */
export interface LogEvent {
  blockNumber: bigint;
  logIndex: number;
  eventName: string;
  args: Record<string, unknown>;
}

export type EmitterClass = "collection" | "owner-or-delegate" | "self" | "external";

export interface OrderKey {
  blockNumber: bigint;
  logIndex: number;
}

export interface IdentityState {
  ubid: Hex;
  standard: Standard;
  boundAddress: Address;
  tokenId: bigint;
  /** true once any CounterfactualAgentRegistered has been applied. */
  claimed: boolean;
  agentURI: string | null;
  metadata: Map<string, Hex>;
  agentWallet: Address | null;
  lastEvent: (OrderKey & { emitter: Address; eventName: string }) | null;
  /** Order position of the first event whose emitter != boundAddress (token standards only). */
  firstOwnerAuthored: OrderKey | null;
  /** Trust flag: a collection-authored event was applied after an owner-authored one existed. */
  collectionAuthoredAfterOwner: boolean;
  /** Whether the most recent applied event was collection-authored (emitter == boundAddress). */
  lastEventCollectionAuthored: boolean;
  /** ERC-8004 agent ids whose stored binding derives this same UBID (the registration join). */
  agentIds: bigint[];
}

export interface AgentState {
  agentId: bigint;
  standard: Standard;
  boundAddress: Address;
  tokenId: bigint;
  ubid: Hex;
  registeredBy: Address;
  metadata: Map<string, Hex>;
  agentURI: string | null;
  agentWallet: Address | null;
}

export interface WalletDesignation {
  account: Address;
  ubid: Hex;
  setBy: Address;
  order: OrderKey;
}

export interface AttestationRecord {
  attestationId: Hex;
  attester: Address;
  attestationType: AttestationType;
  ubid: Hex;
  variant: Hex;
  data: Hex;
  order: OrderKey;
  revoked: boolean;
}

export interface DroppedEvent {
  eventName: string;
  order: OrderKey;
  reason: string;
}

function later(a: OrderKey, b: OrderKey): boolean {
  return a.blockNumber > b.blockNumber || (a.blockNumber === b.blockNumber && a.logIndex > b.logIndex);
}

/**
 * The event-sourced database. Feed it decoded logs in (blockNumber, logIndex) order via apply();
 * read the projected state through the query methods. Reorg handling is replay: throw the store
 * away and re-apply the canonical log.
 */
export class ProjectionStore {
  readonly chainId: bigint;
  readonly adapter: Address;

  identities = new Map<Hex, IdentityState>();
  agents = new Map<bigint, AgentState>();
  /** Latest wallet-UBID designation per account (null after a clear). */
  walletUbid = new Map<Address, WalletDesignation | null>();
  attestations = new Map<Hex, AttestationRecord>();
  /** Revocations that matched no statement or the wrong revoker: recorded, inert (spec §5 rules 3-4). */
  inertRevocations: { attestationId: Hex; revoker: Address; order: OrderKey }[] = [];
  dropped: DroppedEvent[] = [];

  private lastApplied: OrderKey | null = null;

  constructor(chainId: bigint, adapter: Address) {
    this.chainId = chainId;
    this.adapter = adapter.toLowerCase() as Address;
  }

  apply(ev: LogEvent): void {
    const order = { blockNumber: ev.blockNumber, logIndex: ev.logIndex };
    if (this.lastApplied && !later(order, this.lastApplied)) {
      throw new Error(
        `events applied out of order: ${order.blockNumber}:${order.logIndex} after ` +
          `${this.lastApplied.blockNumber}:${this.lastApplied.logIndex}`,
      );
    }
    this.lastApplied = order;

    switch (ev.eventName) {
      case "CounterfactualAgentRegistered":
      case "CounterfactualAgentURISet":
      case "CounterfactualMetadataSet":
      case "CounterfactualMetadataBatchSet":
      case "CounterfactualAgentWalletSet":
      case "CounterfactualAgentWalletUnset":
        this.applyCounterfactual(ev, order);
        break;
      case "AgentBound":
        this.applyAgentBound(ev, order);
        break;
      case "AgentURISet":
        this.withAgent(ev, (a) => (a.agentURI = ev.args.newURI as string));
        break;
      case "MetadataSet":
        this.withAgent(ev, (a) => a.metadata.set(ev.args.metadataKey as string, ev.args.metadataValue as Hex));
        break;
      case "AgentWalletSet":
        this.withAgent(ev, (a) => (a.agentWallet = (ev.args.newWallet as string).toLowerCase() as Address));
        break;
      case "AgentWalletUnset":
        this.withAgent(ev, (a) => (a.agentWallet = null));
        break;
      case "WalletUBIDSet":
        this.applyWalletUbidSet(ev, order);
        break;
      case "WalletUBIDCleared":
        this.walletUbid.set((ev.args.account as string).toLowerCase() as Address, null);
        break;
      case "Attested":
        this.applyAttested(ev, order);
        break;
      case "AttestationRevoked":
        this.applyRevoked(ev, order);
        break;
      default:
        break; // Upgraded, Initialized, OwnershipTransferred — not part of any projection
    }
  }

  // ---------------------------------------------------------------- counterfactual fold

  private identityFor(standard: Standard, boundAddress: Address, tokenId: bigint): IdentityState {
    const ubid = computeUbid(this.chainId, this.adapter, standard, boundAddress, tokenId);
    let id = this.identities.get(ubid);
    if (!id) {
      id = {
        ubid,
        standard,
        boundAddress,
        tokenId,
        claimed: false,
        agentURI: null,
        metadata: new Map(),
        agentWallet: null,
        lastEvent: null,
        firstOwnerAuthored: null,
        collectionAuthoredAfterOwner: false,
        lastEventCollectionAuthored: false,
        agentIds: [],
      };
      this.identities.set(ubid, id);
    }
    return id;
  }

  private applyCounterfactual(ev: LogEvent, order: OrderKey): void {
    const standard = Number(ev.args.standard) as Standard;
    const boundAddress = (ev.args.boundAddress as string).toLowerCase() as Address;
    const tokenId = BigInt(ev.args.tokenId as bigint);
    const claimedUbid = (ev.args.ubid as string).toLowerCase() as Hex;
    const emitter = (ev.args.emitter as string).toLowerCase() as Address;

    // Every counterfactual event is self-verifying: recompute the UBID from the event's own
    // coordinate fields and drop the event if it does not match its hash topic.
    const derived = computeUbid(this.chainId, this.adapter, standard, boundAddress, tokenId);
    if (derived.toLowerCase() !== claimedUbid) {
      this.dropped.push({ eventName: ev.eventName, order, reason: "ubid does not match coordinates" });
      return;
    }

    const id = this.identityFor(standard, boundAddress, tokenId);

    // Emitter-class bookkeeping (token standards only): collection-authored means the token
    // contract emitted for its own token. Used for trust flags, never for suppression —
    // v0.0.17's normative rule is plain latest-wins per UBID.
    const isTokenStandard = !ACCOUNT_STANDARDS.has(standard);
    const collectionAuthored = isTokenStandard && emitter === boundAddress;
    if (isTokenStandard && !collectionAuthored && id.firstOwnerAuthored === null) {
      id.firstOwnerAuthored = order;
    }
    if (collectionAuthored && id.firstOwnerAuthored !== null) {
      id.collectionAuthoredAfterOwner = true;
    }
    id.lastEventCollectionAuthored = collectionAuthored;
    id.lastEvent = { ...order, emitter, eventName: ev.eventName };

    switch (ev.eventName) {
      case "CounterfactualAgentRegistered": {
        // A registration is a full re-statement: it resets URI and replaces the metadata map
        // with exactly the entries it carries.
        id.claimed = true;
        id.agentURI = ev.args.agentURI as string;
        id.metadata = new Map();
        for (const entry of ev.args.metadata as { metadataKey: string; metadataValue: Hex }[]) {
          id.metadata.set(entry.metadataKey, entry.metadataValue);
        }
        break;
      }
      case "CounterfactualAgentURISet":
        id.agentURI = ev.args.newURI as string;
        break;
      case "CounterfactualMetadataSet":
        id.metadata.set(ev.args.metadataKey as string, ev.args.metadataValue as Hex);
        break;
      case "CounterfactualMetadataBatchSet":
        for (const entry of ev.args.metadata as { metadataKey: string; metadataValue: Hex }[]) {
          id.metadata.set(entry.metadataKey, entry.metadataValue);
        }
        break;
      case "CounterfactualAgentWalletSet":
        id.agentWallet = (ev.args.newWallet as string).toLowerCase() as Address;
        break;
      case "CounterfactualAgentWalletUnset":
        id.agentWallet = null; // field-level: the rest of the claim stands
        break;
    }
  }

  // ---------------------------------------------------------------- registration join

  private applyAgentBound(ev: LogEvent, _order: OrderKey): void {
    const agentId = BigInt(ev.args.agentId as bigint);
    const standard = Number(ev.args.standard) as Standard;
    const boundAddress = (ev.args.boundAddress as string).toLowerCase() as Address;
    const tokenId = BigInt(ev.args.tokenId as bigint);
    const ubid = computeUbid(this.chainId, this.adapter, standard, boundAddress, tokenId);

    this.agents.set(agentId, {
      agentId,
      standard,
      boundAddress,
      tokenId,
      ubid,
      registeredBy: (ev.args.registeredBy as string).toLowerCase() as Address,
      metadata: new Map(),
      agentURI: null,
      agentWallet: null,
    });

    // The join is by construction: the stored binding derives the same UBID as the
    // counterfactual claims for these coordinates. No link assertion exists or is needed.
    const id = this.identityFor(standard, boundAddress, tokenId);
    if (!id.agentIds.includes(agentId)) id.agentIds.push(agentId);
  }

  private withAgent(ev: LogEvent, fn: (a: AgentState) => void): void {
    const agent = this.agents.get(BigInt(ev.args.agentId as bigint));
    if (agent) fn(agent);
  }

  // ---------------------------------------------------------------- wallet UBID

  private applyWalletUbidSet(ev: LogEvent, order: OrderKey): void {
    const account = (ev.args.account as string).toLowerCase() as Address;
    const standard = Number(ev.args.standard) as Standard;
    const boundAddress = (ev.args.boundAddress as string).toLowerCase() as Address;
    const tokenId = BigInt(ev.args.tokenId as bigint);
    const claimedUbid = (ev.args.ubid as string).toLowerCase() as Hex;

    const derived = computeUbid(this.chainId, this.adapter, standard, boundAddress, tokenId);
    if (derived.toLowerCase() !== claimedUbid) {
      this.dropped.push({ eventName: ev.eventName, order, reason: "ubid does not match coordinates" });
      return;
    }
    this.walletUbid.set(account, {
      account,
      ubid: claimedUbid,
      setBy: (ev.args.setBy as string).toLowerCase() as Address,
      order,
    });
  }

  // ---------------------------------------------------------------- attestations (spec §5)

  private applyAttested(ev: LogEvent, order: OrderKey): void {
    const attester = (ev.args.attester as string).toLowerCase() as Address;
    const attestationType = Number(ev.args.attestationType) as AttestationType;
    const ubid = (ev.args.ubid as string).toLowerCase() as Hex;
    const attestationId = (ev.args.attestationId as string).toLowerCase() as Hex;
    const variant = (ev.args.variant as string).toLowerCase() as Hex;
    const data = ((ev.args.data as string) ?? "0x").toLowerCase() as Hex;

    const derived = computeAttestationId(
      this.chainId,
      this.adapter,
      attester,
      ubid,
      attestationType,
      order.blockNumber,
      variant,
      data,
    );
    if (derived.toLowerCase() !== attestationId) {
      this.dropped.push({ eventName: ev.eventName, order, reason: "attestationId does not match fields" });
      return;
    }

    const existing = this.attestations.get(attestationId);
    if (existing) {
      // Rule 1 (collapse): byte-identical content is one statement. Rule 3: re-emitting a
      // revoked id in log order reactivates it.
      existing.revoked = false;
      existing.order = order;
      return;
    }
    this.attestations.set(attestationId, {
      attestationId,
      attester,
      attestationType,
      ubid,
      variant,
      data,
      order,
      revoked: false,
    });
  }

  private applyRevoked(ev: LogEvent, order: OrderKey): void {
    const attestationId = (ev.args.attestationId as string).toLowerCase() as Hex;
    const revoker = (ev.args.revoker as string).toLowerCase() as Address;
    const statement = this.attestations.get(attestationId);
    // Rule 4: a revocation changes state only when its caller is the statement's attester.
    // Everything else — unknown id, zero id, wrong revoker — is recorded, inert history.
    if (statement && statement.attester === revoker) {
      statement.revoked = true;
    } else {
      this.inertRevocations.push({ attestationId, revoker, order });
    }
  }

  // ---------------------------------------------------------------- read-side projections

  /** State-class projection: latest live statement per (attester, ubid, type). Spec §6. */
  liveStateValue(ubid: Hex, attester: Address, type: AttestationType): AttestationRecord | null {
    let best: AttestationRecord | null = null;
    for (const a of this.attestations.values()) {
      if (a.revoked || a.ubid !== ubid || a.attester !== attester || a.attestationType !== type) continue;
      if (!best || later(a.order, best.order)) best = a;
    }
    return best;
  }

  private attestersOf(ubid: Hex, type: AttestationType): Set<Address> {
    const out = new Set<Address>();
    for (const a of this.attestations.values()) {
      if (a.ubid === ubid && a.attestationType === type) out.add(a.attester);
    }
    return out;
  }

  /** Payload validity is a read-time rule (§3): malformed payloads are invalid, not reverted. */
  static payloadByte(data: Hex): number | null {
    if (data.length !== 4) return null; // exactly one byte: 0x + 2 chars
    return parseInt(data.slice(2), 16);
  }

  reputation(ubid: Hex) {
    // STAR aggregates by counting attesters whose live value is 1. The attesters are returned
    // alongside the count, because the count alone cannot answer "have I starred this?" - which
    // a toggle in a UI has to know.
    const starredBy: Address[] = [];
    for (const attester of this.attestersOf(ubid, AttestationType.STAR)) {
      const live = this.liveStateValue(ubid, attester, AttestationType.STAR);
      if (live && ProjectionStore.payloadByte(live.data) === 1) starredBy.push(attester);
    }
    const stars = starredBy.length;
    // RATING aggregates by averaging each attester's live value; 0-100, invalid at read otherwise.
    const ratings: { attester: Address; value: number }[] = [];
    for (const attester of this.attestersOf(ubid, AttestationType.RATING)) {
      const live = this.liveStateValue(ubid, attester, AttestationType.RATING);
      if (!live) continue;
      const value = ProjectionStore.payloadByte(live.data);
      if (value !== null && value <= 100) ratings.push({ attester, value });
    }
    const ratingAverage = ratings.length
      ? ratings.reduce((sum, r) => sum + r.value, 0) / ratings.length
      : null;

    // Stream classes accumulate all live statements, each individually valid or not at read.
    const reviews = [...this.attestations.values()]
      .filter((a) => !a.revoked && a.ubid === ubid && a.attestationType === AttestationType.REVIEW && a.data !== "0x")
      .map((a) => ({ attester: a.attester, text: hexToUtf8(a.data), order: a.order, attestationId: a.attestationId }));

    const interactions = [...this.attestations.values()]
      .filter((a) => !a.revoked && a.ubid === ubid && a.attestationType === AttestationType.INTERACTION)
      .map((a) => decodeInteraction(a))
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // CONFIRM_ACCOUNT counts only while the identity's current forward `account` metadata
    // names the attester — the live, indexer-mediated mutual check.
    const identity = this.identities.get(ubid);
    const confirmedAccounts: { attester: Address; verified: boolean }[] = [];
    for (const attester of this.attestersOf(ubid, AttestationType.CONFIRM_ACCOUNT)) {
      const live = this.liveStateValue(ubid, attester, AttestationType.CONFIRM_ACCOUNT);
      if (!live) continue;
      confirmedAccounts.push({ attester, verified: identityNamesAccount(identity, attester) });
    }

    return { stars, starredBy, ratingAverage, ratings, reviews, interactions, confirmedAccounts };
  }

  /**
   * Wallet reverse-resolution: "who operates this address?"
   *
   * Two ways an address resolves, and they are not the same relationship:
   *
   *  - `self`: the address IS an agent. An ACCOUNT record's controller is the address itself, and its
   *    UBID is derivable from the address alone - no designation is needed or possible, so this
   *    needs no mutual-pointing check. Nothing can fake it: only the address can bind it.
   *  - `designation`: the address is the OPERATING WALLET of an agent controlled elsewhere (a token, a
   *    contract). That is a claim by the wallet, so it carries the mutual-pointing check.
   *
   * Both can hold at once. Returning null means neither does.
   */
  resolveWallet(account: Address) {
    const addr = account.toLowerCase() as Address;

    const selfUbid = computeUbid(this.chainId, this.adapter, Standard.ACCOUNT, addr, 0n)
      .toLowerCase() as Hex;
    const self = this.identities.get(selfUbid) ?? null;

    const designation = this.walletUbid.get(addr) ?? null;
    const identity = designation ? this.identities.get(designation.ubid) ?? null : null;

    if (!self && !designation) return null;
    return {
      self,
      designation,
      identity,
      verified: identity !== null && designation !== null && identity.agentWallet === designation.account,
    };
  }
}

function hexToUtf8(data: Hex): string {
  const bytes = data.slice(2).match(/.{2}/g) ?? [];
  return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
}

function decodeInteraction(a: AttestationRecord) {
  const raw = a.data.slice(2);
  if (raw.length < 66) return null; // ≥ 33 bytes: score(1) + reference(32)
  const score = parseInt(raw.slice(0, 2), 16);
  if (score > 100) return null;
  return {
    attester: a.attester,
    attestationId: a.attestationId,
    score,
    reference: ("0x" + raw.slice(2, 66)) as Hex,
    text: hexToUtf8(("0x" + raw.slice(66)) as Hex),
    order: a.order,
  };
}

function identityNamesAccount(identity: IdentityState | null | undefined, account: Address): boolean {
  if (!identity) return false;
  const needle = account.slice(2).toLowerCase();
  for (const [key, value] of identity.metadata) {
    if (key === "account" || key.startsWith("account[")) {
      if (value.toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

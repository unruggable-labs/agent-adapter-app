import type { Address, Hex } from "viem";

export interface Overview {
  adapter: Address;
  chainId: string;
  identities: number;
  agents: number;
  attestations: number;
  dropped: number;
  inertRevocations: number;
}

export interface TrustBase {
  isEoa: boolean;
  delegated7702: boolean;
  canBurn: boolean;
  arbitraryCallSurface: boolean;
  upgradeable: boolean;
  verdict: "ruggable" | "unstable" | "burnable" | "solid" | "eoa";
}

export interface Reputation {
  stars: number;
  /** Attesters whose live star value is 1 - lets a viewer see whether they are one of them.
   *  Optional: an indexer that predates this field simply omits it. */
  starredBy?: Address[];
  ratingAverage: number | null;
  ratings: { attester: Address; value: number }[];
  /** `reference` is the statement's variant slot - the transaction it is about, or zero. Optional:
   *  an indexer that predates this field simply omits it. */
  reviews: { attester: Address; text: string; attestationId: Hex; order: Order; reference?: Hex }[];
  interactions: { attester: Address; attestationId: Hex; score: number; reference: Hex; text: string; order: Order }[];
  confirmedAccounts: { attester: Address; verified: boolean }[];
}

export interface Order {
  blockNumber: string;
  logIndex: number;
}

export interface Identity {
  ubid: Hex;
  standard: number;
  standardName: string;
  /** What the bound thing is called: "DemoPunks #7", or the contract/account name. */
  subjectLabel: string;
  /** The agent's self-declared name from its `name` metadata entry, when printable. */
  agentName: string | null;
  /** The bound contract's name(), when it implements the ERC-721 metadata extension. */
  contractName: string | null;
  /** A picture: the token's metadata image, else the agent card's. Resolved in the background,
   *  so it can arrive a poll after the identity does. Optional for older indexers. */
  image?: string | null;
  boundAddress: Address;
  tokenId: string;
  /** Who holds the controller right now, where control is a single nameable address. null means the
   *  standard has no single holder (balance standards, CONTRACT_ADMIN) or the read failed -
   *  never "nobody controls it". Delegates also pass control without appearing here. */
  currentControllerHolder: Address | null;
  claimed: boolean;
  agentURI: string | null;
  metadata: Record<string, Hex>;
  agentWallet: Address | null;
  lastEvent: (Order & { emitter: Address; eventName: string }) | null;
  /** The first event that created the identity. Optional for indexers that predate it. */
  created?: Order;
  collectionAuthoredAfterOwner: boolean;
  lastEventCollectionAuthored: boolean;
  agentIds: string[];
  reputation: Reputation;
  trustBase: TrustBase | null;
  flags: {
    currentlyOwnerless: boolean | null;
    collectionAuthoredAfterOwner: boolean;
    lastEventCollectionAuthored: boolean;
    walletUnverified: boolean;
  };
}

/** One line of an identity's audit trail. `outcome` says whether the event counted: `dropped`
 *  failed its own consistency check, `inert` is a revocation by someone other than the attester. */
export interface HistoryEntry {
  order: Order;
  transactionHash: Hex | null;
  eventName: string;
  actor: Address | null;
  effect: string;
  outcome: "applied" | "dropped" | "inert";
}

export interface AttestationRow {
  attestationId: Hex;
  attester: Address;
  attestationType: number;
  typeName: string;
  ubid: Hex;
  variant: Hex;
  data: Hex;
  order: Order;
  revoked: boolean;
  resolved: boolean;
}

import { NETWORK } from "./chain";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(NETWORK.apiBase + path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const api = {
  overview: () => get<Overview>("/overview"),
  identities: () => get<Identity[]>("/identities"),
  identity: (ubid: string) => get<Identity>(`/identity/${ubid}`),
  history: (ubid: string) => get<HistoryEntry[]>(`/history/${ubid}`),
  attestations: () => get<AttestationRow[]>("/attestations"),
  /** `self` = the address IS an agent (an ACCOUNT record whose controller is the address; its UBID is
   *  derivable from the address, so it needs no designation). `designation` = the address is some
   *  agent's operating wallet, a claim that carries the mutual-pointing check. Both can hold. */
  wallet: (address: string) =>
    get<{
      self: { ubid: Hex } | null;
      designation: { ubid: Hex } | null;
      verified: boolean;
    } | null>(`/wallet/${address}`),
  trustbase: (address: string) => get<TrustBase>(`/trustbase/${address}`),
};

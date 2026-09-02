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
  ratingAverage: number | null;
  ratings: { attester: Address; value: number }[];
  reviews: { attester: Address; text: string; attestationId: Hex; order: Order }[];
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
  boundAddress: Address;
  tokenId: string;
  claimed: boolean;
  agentURI: string | null;
  metadata: Record<string, Hex>;
  agentWallet: Address | null;
  lastEvent: (Order & { emitter: Address; eventName: string }) | null;
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const api = {
  overview: () => get<Overview>("/api/overview"),
  identities: () => get<Identity[]>("/api/identities"),
  identity: (ubid: string) => get<Identity>(`/api/identity/${ubid}`),
  attestations: () => get<AttestationRow[]>("/api/attestations"),
  wallet: (address: string) =>
    get<{ designation: { ubid: Hex }; verified: boolean } | null>(`/api/wallet/${address}`),
  trustbase: (address: string) => get<TrustBase>(`/api/trustbase/${address}`),
};

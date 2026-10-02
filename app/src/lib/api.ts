import type { Address, Hex } from "viem";

export interface Overview {
  adapter: Address;
  chainId: string;
  identities: number;
  agents: number;
  /** Distinct collections and contracts identities are bound to. Older indexers omit it. */
  projects?: number;
  /** Identities with an ERC-8004 agent minted. Older indexers omit it. */
  registered?: number;
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
  /** Reviews: the text carried by an attester's live rating (score present), or a legacy REVIEW
   *  statement (score null). `reference` is the statement's variant slot - the transaction it
   *  is about, or zero. Older indexers omit the newer fields. */
  reviews: { attester: Address; text: string; score?: number | null; source?: "rating" | "review"; attestationId: Hex; order: Order; reference?: Hex }[];
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
  /** The token's metadata card (name, description, image), or the agent card's where the token
   *  has none. Resolved in the background like the image. */
  card?: { image: string | null; name: string | null; description: string | null; source: "token" | "agent" } | null;
  /** What the bound collection or contract says about itself (its contractURI): name, description,
   *  image, website. Read in the background like the card. Older indexers omit it. */
  collection?: { name: string | null; description: string | null; image: string | null; externalLink: string | null } | null;
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
  /** The identity the statement is about, when the registry knows it. Present on paged rows. */
  target?: Identity | null;
}

/** One page of a list. */
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type SearchHit =
  | { kind: "address"; address: Address }
  | { kind: "identity"; identity: Identity; note?: string; tone?: string };

/** Everything the registry knows about one address. */
export interface AddressView {
  address: Address;
  /** The address is itself an agent: its ACCOUNT identity. */
  self: Identity | null;
  /** The agent this address is the operating wallet of, and whether both sides agree. */
  operates: { identity: Identity; verified: boolean } | null;
  /** Agents that name this address as their wallet without the wallet pointing back. */
  namedBy: Identity[];
  holds: Identity[];
  /** How many identities are bound to this address (a collection's tokens, say). Page them with
   *  identities({ bound }). */
  boundHereTotal: number;
  statements: AttestationRow[];
}

export interface IdentitiesQuery {
  limit?: number;
  offset?: number;
  standard?: string[];
  bound?: string;
  tokenId?: string;
  q?: string;
}

export interface AttestationsQuery {
  limit?: number;
  offset?: number;
  type?: string[];
  standard?: string[];
  attester?: string;
  ubid?: string;
}

import { NETWORK } from "./chain";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(NETWORK.apiBase + path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** Thrown for a 404, so a page can tell "not found" from "not reachable". */
export class NotFound extends Error {}

async function getOrNotFound<T>(path: string): Promise<T> {
  const res = await fetch(NETWORK.apiBase + path);
  if (res.status === 404) throw new NotFound(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** Query parameters, with arrays comma-joined and empties left out. Always at least one, so the
 *  server answers with a page rather than the whole list. */
function qs(params: object): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as [string, string | number | string[] | undefined][]) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  if (!p.has("limit")) p.set("limit", "25");
  return `?${p.toString()}`;
}

export const api = {
  overview: () => get<Overview>("/overview"),
  /** A page of identities, newest first. */
  identities: (query: IdentitiesQuery = {}) => get<Page<Identity>>(`/identities${qs(query)}`),
  identity: (ubid: string) => getOrNotFound<Identity>(`/identity/${ubid}`),
  history: (ubid: string) => get<HistoryEntry[]>(`/history/${ubid}`),
  /** A page of statements, newest first, each with the identity it is about. */
  attestations: (query: AttestationsQuery = {}) => get<Page<AttestationRow>>(`/attestations${qs(query)}`),
  search: (q: string) => get<{ hits: SearchHit[] }>(`/search?q=${encodeURIComponent(q)}`),
  address: (address: string) => get<AddressView>(`/address/${address}`),
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

import type { Address, Hex } from "viem";

/** One chain's figures and how its indexer is doing. */
export interface ChainOverview {
  chain: string;
  label: string;
  chainId: string;
  adapter: Address;
  /** Where the adapter went to v0.0.17, when the indexed history starts before it (Ethereum, Base). */
  upgradeBlock?: string | null;
  identities: number;
  agents: number;
  projects: number;
  registered: number;
  attestations: number;
  /** syncing: the first sync hasn't finished. live: polling. stalled: no good poll for a while. */
  state: "syncing" | "live" | "stalled";
  syncedTo: string | null;
  head: string | null;
}

export interface Overview {
  /** The adapter and chain, where the site is one chain; null on the hub, where each chain has its own. */
  adapter: Address | null;
  chainId: string | null;
  /** Each chain the indexer follows. Older indexers omit it. */
  chains?: ChainOverview[];
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
  /** The chain the record is on: robinhood, base, mainnet, sepolia, local. */
  chain: string;
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
  /** Registered by the adapter before its v0.0.17 upgrade. That version emitted no UBID; this one is
   *  derived from the binding, as every UBID is. Older indexers omit it. */
  legacy?: boolean;
  flags: {
    currentlyOwnerless: boolean | null;
    collectionAuthoredAfterOwner: boolean;
    lastEventCollectionAuthored: boolean;
    walletUnverified: boolean;
  };
}

/** The adapter a chain's records are scoped to, from the overview: what writes are sent to. */
export function adapterOf(overview: Overview | null, chain: string): Address | null {
  const c = overview?.chains?.find((x) => x.chain === chain);
  if (c) return c.adapter;
  return overview?.chains ? null : (overview?.adapter ?? null);
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
  /** Emitted by the adapter before its v0.0.17 upgrade. */
  legacy?: true;
}

export interface AttestationRow {
  attestationId: Hex;
  /** The chain the statement is on. */
  chain: string;
  attester: Address;
  attestationType: number;
  typeName: string;
  ubid: Hex;
  variant: Hex;
  data: Hex;
  order: Order;
  revoked: boolean;
  resolved: boolean;
  /** The transaction that made it. Older indexers omit it. */
  transactionHash?: Hex | null;
  /** The block number in the id's preimage (the contract's block.number). Older indexers omit it. */
  contractBlockNumber?: string;
  /** The revocation that took it down, while it is down. */
  revocation?: { revoker: Address; order: Order; transactionHash: Hex | null } | null;
  /** The identity the statement is about, when the registry knows it. Present on paged rows. */
  target?: Identity | null;
}

/** One statement in full - see /api/attestation/:id. */
export interface AttestationView extends AttestationRow {
  target: Identity | null;
  /** For star, rating and account confirmation, the later statement by the same attester that stands instead of this one. */
  supersededBy: { attestationId: Hex; order: Order } | null;
  /** What the id is keccak'd from. */
  preimage: { chainId: string; adapter: Address; attester: Address; ubid: Hex; attestationType: number; blockNumber: string; variant: Hex; data: Hex };
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
  /** The chains the address appears on, and what it is on each. Older indexers omit them. */
  chains?: string[];
  byChain?: { chain: string; self: Identity | null; operates: { identity: Identity; verified: boolean } | null }[];
}

/** A token contract identities are bound to, on one chain - see /api/collections. */
export interface CollectionRow {
  chain: string;
  address: Address;
  /** What it calls itself: its contractURI name, else name(), else the short address. */
  name: string;
  description: string | null;
  /** Its own picture, else its newest token's. */
  image: string | null;
  externalLink: string | null;
  standardName: string;
  identities: number;
  registered: number;
  /** Up to four of its newest tokens' pictures. */
  previews: string[];
  latest: Order;
}

export interface CollectionsQuery {
  chain?: string[];
  limit?: number;
  offset?: number;
  q?: string;
  sort?: "newest";
}

export interface IdentitiesQuery {
  /** Only these chains (slugs). */
  chain?: string[];
  limit?: number;
  offset?: number;
  standard?: string[];
  bound?: string;
  tokenId?: string;
  q?: string;
}

export interface AttestationsQuery {
  chain?: string[];
  limit?: number;
  offset?: number;
  type?: string[];
  standard?: string[];
  attester?: string;
  ubid?: string;
}

import { API_BASE } from "./chain";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** Thrown for a 404, so a page can tell "not found" from "not reachable". */
export class NotFound extends Error {}

async function getOrNotFound<T>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path);
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

// ---- stats (see indexer/src/stats.ts)
export type StatsBucket = "day" | "week" | "month";
export type StatsMetric = "identities" | "registrations" | "claims" | "attestations" | "revocations" | "attesters" | "wallets" | "active";
export interface StatsFigure {
  value: number;
  prior: number;
}
export interface StatsOverview {
  from: number;
  to: number;
  figures: Record<StatsMetric | "projects", StatsFigure>;
  totals: { identities: number; registered: number; projects: number; attestations: number; events: number; firstEvent: number | null; lastEvent: number | null; blocksWithoutTimestamp: number };
}
export interface StatsPoint {
  t: string;
  v: number;
}
export interface StatsSeries {
  metric: StatsMetric;
  bucket: StatsBucket;
  from: number;
  to: number;
  series: { key: string; points: StatsPoint[] }[];
}
export interface ProjectRow {
  address: Address;
  name: string | null;
  image: string | null;
  website: string | null;
  standards: string[];
  identities: number;
  registered: number;
  attestations: number;
  attesters: number;
  ratingAverage: number | null;
  ratings: number;
  stars: number;
  firstSeen: number | null;
  lastEvent: number | null;
  trustVerdict: string | null;
}
export interface ProjectsQuery {
  from: number;
  to: number;
  standard?: string[];
  registration?: "registered" | "counterfactual";
  active?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

/** The stats endpoints of one chain, by its API base and - where that API serves several chains,
 *  as the hub does - the chain's name, since the page asks several chains. */
export function statsApi(source: { base: string; chain: string | null }) {
  const getAt = async <T,>(path: string): Promise<T> => {
    const res = await fetch(source.base + path + (source.chain ? `&chain=${encodeURIComponent(source.chain)}` : ""));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };
  return {
    overview: (w: { from: number; to: number }) => getAt<StatsOverview>(`/stats/overview${qs({ from: w.from, to: w.to })}`),
    series: (metric: StatsMetric, bucket: StatsBucket, w: { from: number; to: number }, by?: { type?: boolean; projects?: string[] }) =>
      getAt<StatsSeries>(`/stats/series${qs({ metric, bucket, from: w.from, to: w.to, by: by?.type ? "type" : undefined, project: by?.projects })}`),
    projects: (q: ProjectsQuery) =>
      getAt<Page<ProjectRow>>(`/stats/projects${qs({ from: q.from, to: q.to, standard: q.standard, registration: q.registration, active: q.active ? 1 : undefined, q: q.q, limit: q.limit ?? 500, offset: q.offset })}`),
  };
}

export const api = {
  overview: () => get<Overview>("/overview"),
  /** A page of identities, newest first. */
  identities: (query: IdentitiesQuery = {}) => get<Page<Identity>>(`/identities${qs(query)}`),
  identity: (ubid: string) => getOrNotFound<Identity>(`/identity/${ubid}`),
  /** A page of collections, the most identities first. */
  collections: (query: CollectionsQuery = {}) => get<Page<CollectionRow>>(`/collections${qs(query)}`),
  /** One contract as a collection on one chain; NotFound when nothing is bound to its tokens there. */
  collection: (address: string, chain: string) =>
    getOrNotFound<{ collections: CollectionRow[] }>(`/collection/${address}?chain=${encodeURIComponent(chain)}`).then((r) => {
      if (!r.collections[0]) throw new NotFound(address);
      return r.collections[0];
    }),
  history: (ubid: string) => get<HistoryEntry[]>(`/history/${ubid}`),
  /** A page of statements, newest first, each with the identity it is about. */
  attestations: (query: AttestationsQuery = {}) => get<Page<AttestationRow>>(`/attestations${qs(query)}`),
  attestation: (id: string) => getOrNotFound<AttestationView>(`/attestation/${id}`),
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
  /** Whether a cited transaction exists on this chain, as the indexer found it; null until it has checked. */
  txref: (hash: string) => get<{ hash: Hex; status: "found" | "missing" | null }>(`/txref/${hash}`),
};

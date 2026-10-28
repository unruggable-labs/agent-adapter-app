import type { Address, Hex } from "viem";
import type { AttestationRecord, IdentityState, OrderKey, ProjectionStore } from "./projection.js";
import { ACCOUNT_STANDARDS, ATTESTATION_TYPE_NAMES, AttestationType, Standard, STANDARD_NAMES } from "./ubid.js";
import type { IdentityView, ViewCache } from "./views.js";

/**
 * The read side as questions, not dumps: a page of identities, the hits for a search box, what
 * one address is and has done, a page of statements. The app asks these instead of downloading
 * the registry and filtering it itself.
 *
 * They are asked of a list of chains - one for a chain's own site, several for the multichain
 * explorer - and every row says which chain it is on. A UBID or an attestation id is unique
 * across chains (both are hashed over the adapter's ERC-7930 address, chain id included), so a
 * lookup by id needs no chain; an address isn't, so an address's answer gathers every chain.
 * Lists are newest first: within a chain by block and log index, as always; across chains by
 * block time, since block numbers on two chains don't compare.
 *
 * They run over the stores and view caches in memory, and they are careful about what that
 * costs: an identity's full view folds its reputation out of every attestation, so a page builds
 * views only for the rows it returns and searches on the cheap summary (labels, holder, card).
 */

/** One chain, as the queries see it. A ChainRuntime is one. */
export interface ChainScope {
  slug: string;
  label: string;
  store: ProjectionStore;
  views: ViewCache;
  /** When the block an order key points into was made, unix seconds, or null if unknown. */
  timeOf(order: OrderKey): number | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type ChainIdentityView = IdentityView & { chain: string };

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

function paging(p: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(p.get("limit") ?? "", 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number.parseInt(p.get("offset") ?? "", 10) || 0);
  return { limit, offset };
}

function newestFirst(a: OrderKey, b: OrderKey): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
  return b.logIndex - a.logIndex;
}

/**
 * Several chains' rows as one list, newest first. Each chain's rows are sorted exactly by block
 * and log index; the chains are then interleaved by block time. A row whose block time isn't
 * known yet takes the time of the newer row before it, so a chain's own order is never broken.
 */
function interleave<T>(chains: ChainScope[], rowsOf: (c: ChainScope) => T[], orderOf: (t: T) => OrderKey): { c: ChainScope; row: T }[] {
  const keyed: { c: ChainScope; row: T; t: number }[] = [];
  for (const c of chains) {
    const rows = rowsOf(c).sort((a, b) => newestFirst(orderOf(a), orderOf(b)));
    let t = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      t = Math.min(t, c.timeOf(orderOf(row)) ?? t);
      keyed.push({ c, row, t });
    }
  }
  // Stable: rows of one chain keep their order, and equal times keep the chains' order.
  return chains.length > 1 ? keyed.sort((a, b) => b.t - a.t) : keyed;
}

const names = (p: URLSearchParams, key: string): Set<string> | null => {
  const v = p.get(key);
  return v ? new Set(v.split(",").map((s) => s.trim()).filter(Boolean)) : null;
};

/** The full view, saying which chain it is on. */
export function viewOf(c: ChainScope, id: IdentityState): ChainIdentityView {
  return { ...c.views.view(id), chain: c.slug };
}

/** Does the identity's text - what people call it - contain the query? */
function matchesText(views: ViewCache, id: IdentityState, q: string): boolean {
  const s = views.summary(id);
  return [s.agentName, s.contractName, s.subjectLabel, s.card?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/** Does a hex query prefix one of the identity's addresses or its UBID? */
function matchesHex(views: ViewCache, id: IdentityState, q: string): boolean {
  return id.ubid.startsWith(q) || id.boundAddress.startsWith(q) || !!id.agentWallet?.startsWith(q) || !!views.holder(id)?.startsWith(q);
}

const isHex = (q: string) => /^0x[0-9a-f]{1,64}$/.test(q);
const isAddress = (q: string) => /^0x[0-9a-f]{40}$/.test(q);

/** The chain whose store has this identity, if any. */
export function findIdentity<C extends ChainScope>(chains: C[], ubid: string): { c: C; id: IdentityState } | null {
  const key = ubid.toLowerCase() as Hex;
  for (const c of chains) {
    const id = c.store.identities.get(key);
    if (id) return { c, id };
  }
  return null;
}

/** How an identity exists: an ERC-8004 agent minted, a counterfactual claim, or neither yet. */
export type Registration = "registered" | "counterfactual" | "unclaimed";
export const registrationOf = (i: IdentityState): Registration => (i.agentIds.length > 0 ? "registered" : i.claimed ? "counterfactual" : "unclaimed");

/** A page of identities, newest first. Filters: standard (names, comma-separated), registration
 *  (registered, counterfactual, unclaimed, comma-separated), bound, tokenId, q. */
export function listIdentities(chains: ChainScope[], p: URLSearchParams): Page<ChainIdentityView> {
  const { limit, offset } = paging(p);
  const standards = names(p, "standard");
  const registrations = names(p, "registration");
  const bound = p.get("bound")?.toLowerCase();
  const tokenId = p.get("tokenId");
  const t = tokenId && /^\d+$/.test(tokenId) ? BigInt(tokenId) : null;
  const q = p.get("q")?.trim().toLowerCase();
  const rows = interleave(
    chains,
    (c) => {
      let ids = [...c.store.identities.values()];
      if (standards) ids = ids.filter((i) => standards.has(STANDARD_NAMES[i.standard]));
      if (registrations) ids = ids.filter((i) => registrations.has(registrationOf(i)));
      if (bound) ids = ids.filter((i) => i.boundAddress === bound);
      if (t !== null) ids = ids.filter((i) => i.tokenId === t);
      if (q) ids = ids.filter((i) => (isHex(q) ? matchesHex(c.views, i, q) : matchesText(c.views, i, q)));
      return ids;
    },
    (i) => i.created,
  );
  return { items: rows.slice(offset, offset + limit).map(({ c, row }) => viewOf(c, row)), total: rows.length, offset, limit };
}

export type SearchHit =
  | { kind: "address"; address: Address }
  | { kind: "identity"; identity: ChainIdentityView; note?: string; tone?: string };

const MAX_HITS = 8;

/**
 * The header search box: who is this? A full address leads with its own page; a hex prefix leads
 * with the pages of known addresses that start with it; then identities by UBID, bound address,
 * operating wallet, holder, ERC-8004 id, or name, on every chain. The note says why a hit matched
 * when the name alone wouldn't.
 */
export function search(chains: ChainScope[], raw: string): SearchHit[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const addresses: SearchHit[] = [];
  const knownAddresses = new Set<string>();
  const addAddress = (a: string) => {
    if (knownAddresses.has(a)) return;
    knownAddresses.add(a);
    addresses.push({ kind: "address", address: a as Address });
  };
  const hits: SearchHit[] = [];
  const hex = isHex(q);
  if (isAddress(q)) addAddress(q);

  for (const c of chains) {
    const views = c.views;
    const seen = new Set<Hex>();
    const add = (id: IdentityState, note?: string, tone?: string) => {
      if (seen.has(id.ubid) || hits.length >= MAX_HITS) return;
      seen.add(id.ubid);
      const hit: SearchHit = { kind: "identity", identity: viewOf(c, id) };
      if (note) hit.note = note;
      if (tone) hit.tone = tone;
      hits.push(hit);
    };
    const ids = [...c.store.identities.values()];

    if (isAddress(q)) {
      // The reverse index, with the mutual-pointing verdict - not anything the wallet says about itself.
      const w = c.store.resolveWallet(q as Address);
      if (w?.self) add(w.self, "this address is the agent", "ok");
      else if (w?.identity) add(w.identity, w.verified ? "operating wallet, verified both ways" : "claims to operate this, not verified", w.verified ? "ok" : "warn");
    } else if (hex && q.length >= 4) {
      const known = new Set<string>();
      for (const id of ids) for (const a of [id.boundAddress, views.holder(id), id.agentWallet]) if (a && a.startsWith(q)) known.add(a);
      for (const a of [...known].slice(0, 3)) if (knownAddresses.size < 3) addAddress(a);
    }

    const agentId = /^#?\d+$/.test(q) ? q.replace("#", "") : null;
    for (const id of ids) {
      if (hex && id.ubid.startsWith(q)) add(id, "UBID");
      else if (hex && id.boundAddress.startsWith(q)) add(id, id.standard === Standard.ACCOUNT ? "this address is the agent" : "bound to this contract");
      else if (hex && id.agentWallet?.startsWith(q)) add(id, "operating wallet");
      else if (hex && views.holder(id)?.startsWith(q)) add(id, id.standard <= 4 ? "holds the token" : "controls it");
      else if (agentId) {
        const match = id.agentIds.find((a) => a.toString().startsWith(agentId));
        if (match !== undefined) add(id, `ERC-8004 #${match}`);
      }
    }
    if (!hex) for (const id of ids) if (matchesText(views, id, q)) add(id);
  }
  return [...addresses, ...hits];
}

/** One statement as the API shows it: the record, its type's name, its chain, and the identity it is about when known. */
export function attestationRow(c: ChainScope, a: AttestationRecord) {
  const target = c.store.identities.get(a.ubid);
  return { ...a, chain: c.slug, typeName: ATTESTATION_TYPE_NAMES[a.attestationType], resolved: !!target, target: target ? viewOf(c, target) : null };
}

/** The statement classes where one live statement per attester stands and the latest wins (spec §6).
 *  A statement of these kinds that is not the latest is replaced, not wrong. */
const STATE_CLASSES = new Set([AttestationType.STAR, AttestationType.RATING, AttestationType.CONFIRM_ACCOUNT]);

/**
 * One statement in full: the row, the identity it is about, the later statement by the same
 * attester that replaced it if one did, and the fields its id was recomputed from when it was
 * indexed - the whole case for believing it. Null when the id is unknown on every chain (never
 * indexed, or dropped because its id did not match its fields).
 */
export function attestationView(chains: ChainScope[], id: Hex) {
  const key = id.toLowerCase() as Hex;
  const c = chains.find((x) => x.store.attestations.has(key));
  if (!c) return null;
  const store = c.store;
  const a = store.attestations.get(key)!;
  const live = STATE_CLASSES.has(a.attestationType) ? store.liveStateValue(a.ubid, a.attester, a.attestationType) : null;
  const supersededBy = live && live.attestationId !== a.attestationId && !a.revoked ? { attestationId: live.attestationId, order: live.order } : null;
  return {
    ...attestationRow(c, a),
    supersededBy,
    preimage: {
      chainId: store.chainId,
      adapter: store.adapter,
      attester: a.attester,
      ubid: a.ubid,
      attestationType: a.attestationType,
      blockNumber: a.contractBlockNumber,
      variant: a.variant,
      data: a.data,
    },
  };
}

/** A page of statements, newest first. Filters: type (names), standard (of the identity; hides unresolved), attester, ubid. */
export function listAttestations(chains: ChainScope[], p: URLSearchParams) {
  const { limit, offset } = paging(p);
  const types = names(p, "type");
  const standards = names(p, "standard");
  const attester = p.get("attester")?.toLowerCase();
  const ubid = p.get("ubid")?.toLowerCase();
  const rows = interleave(
    chains,
    (c) => {
      let rows = [...c.store.attestations.values()];
      if (types) rows = rows.filter((a) => types.has(ATTESTATION_TYPE_NAMES[a.attestationType]));
      if (standards)
        rows = rows.filter((a) => {
          const id = c.store.identities.get(a.ubid);
          return !!id && standards.has(STANDARD_NAMES[id.standard]);
        });
      if (attester) rows = rows.filter((a) => a.attester === attester);
      if (ubid) rows = rows.filter((a) => a.ubid === ubid);
      return rows;
    },
    (a) => a.order,
  );
  return { items: rows.slice(offset, offset + limit).map(({ c, row }) => attestationRow(c, row)), total: rows.length, offset, limit };
}

/**
 * Everything the registry knows about one address, on every chain: whether it is an agent, which
 * agent it operates and whether that link is verified both ways, what it holds or controls, how
 * many identities are bound to it (paged separately via listIdentities with `bound`, since a
 * collection can bind thousands), and every statement it has made. `chains` lists the chains it
 * appears on; `self` and `operates` are the first chain's that has one, and `byChain` has each.
 */
export function addressView(chains: ChainScope[], raw: string) {
  const a = raw.toLowerCase() as Address;
  const byChain = chains.map((c) => {
    const ids = [...c.store.identities.values()];
    const w = c.store.resolveWallet(a);
    const operatesId = w?.identity ?? null;
    return {
      chain: c.slug,
      self: w?.self ? viewOf(c, w.self) : null,
      operates: operatesId ? { identity: viewOf(c, operatesId), verified: w!.verified } : null,
      namedBy: ids.filter((i) => i.agentWallet === a && i.ubid !== operatesId?.ubid).map((i) => viewOf(c, i)),
      holds: ids.filter((i) => c.views.holder(i) === a && i.boundAddress !== a).map((i) => viewOf(c, i)),
      boundHereTotal: ids.filter((i) => i.boundAddress === a && i.standard !== Standard.ACCOUNT).length,
    };
  });
  const statements = interleave(chains, (c) => [...c.store.attestations.values()].filter((s) => s.attester === a), (s) => s.order);
  const present = new Set(statements.map((s) => s.c.slug));
  for (const b of byChain) if (b.self || b.operates || b.namedBy.length || b.holds.length || b.boundHereTotal) present.add(b.chain);
  return {
    address: a,
    chains: chains.map((c) => c.slug).filter((s) => present.has(s)),
    self: byChain.find((b) => b.self)?.self ?? null,
    operates: byChain.find((b) => b.operates)?.operates ?? null,
    namedBy: byChain.flatMap((b) => b.namedBy),
    holds: byChain.flatMap((b) => b.holds),
    boundHereTotal: byChain.reduce((n, b) => n + b.boundHereTotal, 0),
    statements: statements.map(({ c, row }) => attestationRow(c, row)),
    byChain: byChain.filter((b) => present.has(b.chain)).map(({ chain, self, operates }) => ({ chain, self, operates })),
  };
}

/**
 * A collection: a token contract identities are bound to, on one chain. Its name and picture are
 * what the contract says about itself (contractURI, else name()), with its newest tokens'
 * pictures for a preview. Account-style bindings (an address, a contract's owner or admins) are
 * not collections: they are one identity each, and their address page says what they are.
 */
export interface CollectionRow {
  chain: string;
  address: Address;
  name: string;
  description: string | null;
  image: string | null;
  externalLink: string | null;
  /** The standard most of its identities are bound under. */
  standardName: string;
  identities: number;
  /** Identities with an ERC-8004 agent minted. */
  registered: number;
  /** Up to four of its newest tokens' pictures. */
  previews: string[];
  /** Its newest identity. */
  latest: OrderKey;
}

const PREVIEWS = 4;

/** Every collection on these chains, unsorted. One pass over the identities: cheap reads only (summary). */
function collections(chains: ChainScope[]): { c: ChainScope; row: CollectionRow }[] {
  const out: { c: ChainScope; row: CollectionRow }[] = [];
  for (const c of chains) {
    const groups = new Map<Address, IdentityState[]>();
    for (const id of c.store.identities.values()) {
      if (ACCOUNT_STANDARDS.has(id.standard)) continue;
      const g = groups.get(id.boundAddress);
      if (g) g.push(id);
      else groups.set(id.boundAddress, [id]);
    }
    for (const [address, ids] of groups) out.push({ c, row: collectionRow(c, address, ids) });
  }
  return out;
}

function collectionRow(c: ChainScope, address: Address, ids: IdentityState[]): CollectionRow {
  const facts = c.views.advisories.contract(address);
  const newest = [...ids].sort((a, b) => newestFirst(a.created, b.created));
  const previews: string[] = [];
  for (const id of newest) {
    const image = c.views.summary(id).card?.image;
    if (image && !previews.includes(image)) previews.push(image);
    if (previews.length === PREVIEWS) break;
  }
  const byStandard = new Map<number, number>();
  for (const id of ids) byStandard.set(id.standard, (byStandard.get(id.standard) ?? 0) + 1);
  const standard = [...byStandard].sort((a, b) => b[1] - a[1])[0][0];
  return {
    chain: c.slug,
    address,
    name: facts?.collection?.name ?? facts?.name ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
    description: facts?.collection?.description ?? null,
    image: facts?.collection?.image ?? previews[0] ?? null,
    externalLink: facts?.collection?.externalLink ?? null,
    standardName: STANDARD_NAMES[standard],
    identities: ids.length,
    registered: ids.filter((i) => i.agentIds.length > 0).length,
    previews,
    latest: newest[0].created,
  };
}

/**
 * A page of collections, the biggest first (most identities; a tie goes to the one with the
 * newer identity). `sort=newest` puts the one with the newest identity first. `q` matches the
 * name or the address.
 */
export function listCollections(chains: ChainScope[], p: URLSearchParams): Page<CollectionRow> {
  const { limit, offset } = paging(p);
  const q = p.get("q")?.trim().toLowerCase();
  let rows = collections(chains);
  if (q) rows = rows.filter(({ row }) => row.address.startsWith(q) || row.name.toLowerCase().includes(q));
  const time = ({ c, row }: { c: ChainScope; row: CollectionRow }) => c.timeOf(row.latest) ?? 0;
  const newer = (a: (typeof rows)[number], b: (typeof rows)[number]) => time(b) - time(a) || newestFirst(a.row.latest, b.row.latest);
  rows.sort(p.get("sort") === "newest" ? newer : (a, b) => b.row.identities - a.row.identities || newer(a, b));
  return { items: rows.slice(offset, offset + limit).map(({ row }) => row), total: rows.length, offset, limit };
}

/** One contract as a collection, on each chain it is one on. Empty when it is nowhere. */
export function collectionView(chains: ChainScope[], raw: string): CollectionRow[] {
  const address = raw.toLowerCase() as Address;
  return chains.flatMap((c) => {
    const ids = [...c.store.identities.values()].filter((i) => i.boundAddress === address && !ACCOUNT_STANDARDS.has(i.standard));
    return ids.length ? [collectionRow(c, address, ids)] : [];
  });
}

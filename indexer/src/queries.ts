import type { Address, Hex } from "viem";
import type { AttestationRecord, IdentityState, OrderKey, ProjectionStore } from "./projection.js";
import { ATTESTATION_TYPE_NAMES, AttestationType, Standard, STANDARD_NAMES } from "./ubid.js";
import type { IdentityView, ViewCache } from "./views.js";

/**
 * The read side as questions, not dumps: a page of identities, the hits for a search box, what
 * one address is and has done, a page of statements. The app asks these instead of downloading
 * the registry and filtering it itself.
 *
 * Today they run over the store and the view cache in memory, and they are careful about what
 * that costs: an identity's full view folds its reputation out of every attestation, so a page
 * builds views only for the rows it returns and searches on the cheap summary (labels, holder,
 * card). When the views move into SQLite these functions are the seam - same questions, same
 * answers, a different engine underneath.
 */

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

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

const names = (p: URLSearchParams, key: string): Set<string> | null => {
  const v = p.get(key);
  return v ? new Set(v.split(",").map((s) => s.trim()).filter(Boolean)) : null;
};

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

/** A page of identities, newest first. Filters: standard (names, comma-separated), bound, tokenId, q. */
export function listIdentities(store: ProjectionStore, views: ViewCache, p: URLSearchParams): Page<IdentityView> {
  const { limit, offset } = paging(p);
  let ids = [...store.identities.values()];
  const standards = names(p, "standard");
  if (standards) ids = ids.filter((i) => standards.has(STANDARD_NAMES[i.standard]));
  const bound = p.get("bound")?.toLowerCase();
  if (bound) ids = ids.filter((i) => i.boundAddress === bound);
  const tokenId = p.get("tokenId");
  if (tokenId && /^\d+$/.test(tokenId)) {
    const t = BigInt(tokenId);
    ids = ids.filter((i) => i.tokenId === t);
  }
  const q = p.get("q")?.trim().toLowerCase();
  if (q) ids = ids.filter((i) => (isHex(q) ? matchesHex(views, i, q) : matchesText(views, i, q)));
  ids.sort((a, b) => newestFirst(a.created, b.created));
  return { items: ids.slice(offset, offset + limit).map((i) => views.viewWanted(i)), total: ids.length, offset, limit };
}

export type SearchHit =
  | { kind: "address"; address: Address }
  | { kind: "identity"; identity: IdentityView; note?: string; tone?: string };

const MAX_HITS = 8;

/**
 * The header search box: who is this? A full address leads with its own page; a hex prefix leads
 * with the pages of known addresses that start with it; then identities by UBID, bound address,
 * operating wallet, holder, ERC-8004 id, or name. The note says why a hit matched when the name
 * alone wouldn't.
 */
export function search(store: ProjectionStore, views: ViewCache, raw: string): SearchHit[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const out: SearchHit[] = [];
  const seen = new Set<Hex>();
  const add = (id: IdentityState, note?: string, tone?: string) => {
    if (seen.has(id.ubid) || seen.size >= MAX_HITS) return;
    seen.add(id.ubid);
    const hit: SearchHit = { kind: "identity", identity: views.viewWanted(id) };
    if (note) hit.note = note;
    if (tone) hit.tone = tone;
    out.push(hit);
  };
  const hex = isHex(q);
  const ids = [...store.identities.values()];

  if (isAddress(q)) {
    out.push({ kind: "address", address: q as Address });
    // The reverse index, with the mutual-pointing verdict - not anything the wallet says about itself.
    const w = store.resolveWallet(q as Address);
    if (w?.self) add(w.self, "this address is the agent", "ok");
    else if (w?.identity) add(w.identity, w.verified ? "operating wallet, verified both ways" : "claims to operate this, not verified", w.verified ? "ok" : "warn");
  } else if (hex && q.length >= 4) {
    const known = new Set<string>();
    for (const id of ids) for (const a of [id.boundAddress, views.holder(id), id.agentWallet]) if (a && a.startsWith(q)) known.add(a);
    for (const a of [...known].slice(0, 3)) out.push({ kind: "address", address: a as Address });
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
  return out;
}

/** One statement as the API shows it: the record, its type's name, and the identity it is about when known. */
export function attestationRow(store: ProjectionStore, views: ViewCache, a: AttestationRecord) {
  const target = store.identities.get(a.ubid);
  return { ...a, typeName: ATTESTATION_TYPE_NAMES[a.attestationType], resolved: !!target, target: target ? views.viewWanted(target) : null };
}

/** The statement classes where one live statement per attester stands and the latest wins (spec §6).
 *  A statement of these kinds that is not the latest is replaced, not wrong. */
const STATE_CLASSES = new Set([AttestationType.STAR, AttestationType.RATING, AttestationType.CONFIRM_ACCOUNT]);

/**
 * One statement in full: the row, the identity it is about, the later statement by the same
 * attester that replaced it if one did, and the fields its id was recomputed from when it was
 * indexed - the whole case for believing it. Null when the id is unknown (never indexed, or
 * dropped because its id did not match its fields).
 */
export function attestationView(store: ProjectionStore, views: ViewCache, id: Hex) {
  const a = store.attestations.get(id.toLowerCase() as Hex);
  if (!a) return null;
  const live = STATE_CLASSES.has(a.attestationType) ? store.liveStateValue(a.ubid, a.attester, a.attestationType) : null;
  const supersededBy = live && live.attestationId !== a.attestationId && !a.revoked ? { attestationId: live.attestationId, order: live.order } : null;
  return {
    ...attestationRow(store, views, a),
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
export function listAttestations(store: ProjectionStore, views: ViewCache, p: URLSearchParams) {
  const { limit, offset } = paging(p);
  let rows = [...store.attestations.values()];
  const types = names(p, "type");
  if (types) rows = rows.filter((a) => types.has(ATTESTATION_TYPE_NAMES[a.attestationType]));
  const standards = names(p, "standard");
  if (standards)
    rows = rows.filter((a) => {
      const id = store.identities.get(a.ubid);
      return !!id && standards.has(STANDARD_NAMES[id.standard]);
    });
  const attester = p.get("attester")?.toLowerCase();
  if (attester) rows = rows.filter((a) => a.attester === attester);
  const ubid = p.get("ubid")?.toLowerCase();
  if (ubid) rows = rows.filter((a) => a.ubid === ubid);
  rows.sort((a, b) => newestFirst(a.order, b.order));
  return { items: rows.slice(offset, offset + limit).map((a) => attestationRow(store, views, a)), total: rows.length, offset, limit };
}

/**
 * Everything the registry knows about one address: whether it is an agent, which agent it
 * operates and whether that link is verified both ways, what it holds or controls, how many
 * identities are bound to it (paged separately via listIdentities with `bound`, since a collection
 * can bind thousands), and every statement it has made.
 */
export function addressView(store: ProjectionStore, views: ViewCache, raw: string) {
  const a = raw.toLowerCase() as Address;
  const ids = [...store.identities.values()];
  const w = store.resolveWallet(a);
  const operatesId = w?.identity ?? null;
  const boundHereTotal = ids.filter((i) => i.boundAddress === a && i.standard !== Standard.ACCOUNT).length;
  const statements = [...store.attestations.values()].filter((s) => s.attester === a).sort((x, y) => newestFirst(x.order, y.order));
  return {
    address: a,
    self: w?.self ? views.viewWanted(w.self) : null,
    operates: operatesId ? { identity: views.viewWanted(operatesId), verified: w!.verified } : null,
    namedBy: ids.filter((i) => i.agentWallet === a && i.ubid !== operatesId?.ubid).map((i) => views.viewWanted(i)),
    holds: ids.filter((i) => views.holder(i) === a && i.boundAddress !== a).map((i) => views.viewWanted(i)),
    boundHereTotal,
    statements: statements.map((s) => attestationRow(store, views, s)),
  };
}

import type { Address, Hex, PublicClient } from "viem";
import { ProjectionStore } from "./projection.js";
import { addressView, listAttestations, listIdentities, search } from "./queries.js";
import { probeTrustBase } from "./trustbase.js";
import { ATTESTATION_TYPE_NAMES } from "./ubid.js";
import type { ViewCache } from "./views.js";

/** The API core, host-agnostic. Identity views come from the ViewCache, so no request reads the
 *  chain per identity - see views.ts. Subpaths are relative, with their query string:
 *    overview · identities[?limit&offset&standard&bound&tokenId&q] · identity/<ubid> · history/<ubid>
 *    search?q= · address/<addr> · wallet/<addr> · trustbase/<addr> · attestations[?limit&offset&type&standard&attester&ubid]
 *  `identities` and `attestations` with no query string return the whole list, as they always
 *  did; with any parameter they return a page: { items, total, offset, limit }. See queries.ts. */

export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v,
  );
}

export interface ApiResponse {
  status: number;
  body: string; // JSON
}

export async function handleApi(
  store: ProjectionStore,
  client: PublicClient,
  adapter: Address,
  subpath: string,
  views: ViewCache,
): Promise<ApiResponse> {
  const [path, query = ""] = subpath.split("?");
  const params = new URLSearchParams(query);
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  const [head, arg] = parts;

  if (head === "overview") {
    return {
      status: 200,
      body: toJson({
        adapter,
        chainId: store.chainId.toString(),
        identities: store.identities.size,
        agents: store.agents.size,
        /** Distinct collections and contracts identities are bound to - one collection with a hundred agents counts once. */
        projects: new Set([...store.identities.values()].map((i) => i.boundAddress)).size,
        /** Identities with an ERC-8004 agent minted; the rest are counterfactual claims. */
        registered: [...store.identities.values()].filter((i) => i.agentIds.length > 0).length,
        attestations: store.attestations.size,
        dropped: store.dropped.length,
        inertRevocations: store.inertRevocations.length,
      }),
    };
  }
  if (head === "identities") {
    return { status: 200, body: toJson(params.size > 0 ? listIdentities(store, views, params) : views.views()) };
  }
  if (head === "search") {
    return { status: 200, body: toJson({ hits: search(store, views, params.get("q") ?? "") }) };
  }
  if (head === "address" && arg) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(arg)) return { status: 400, body: toJson({ error: "not an address", address: arg }) };
    return { status: 200, body: toJson(addressView(store, views, arg)) };
  }
  if (head === "identity" && arg) {
    const id = store.identities.get(arg.toLowerCase() as Hex);
    if (!id) return { status: 404, body: toJson({ error: "unknown identity", ubid: arg }) };
    views.want(id.ubid); // someone is looking: its chain facts move up the worker's queue
    return { status: 200, body: toJson(views.view(id)) };
  }
  if (head === "history" && arg) {
    // The audit trail: every event that touched this identity, in log order, dropped and
    // inert ones included. Empty for a UBID nothing has touched.
    return { status: 200, body: toJson(store.history.get(arg.toLowerCase() as `0x${string}`) ?? []) };
  }
  if (head === "wallet" && arg) {
    return { status: 200, body: toJson(store.resolveWallet(arg.toLowerCase() as Address)) };
  }
  if (head === "trustbase" && arg) {
    return { status: 200, body: toJson(await probeTrustBase(client, arg as Address)) };
  }
  if (head === "attestations") {
    if (params.size > 0) return { status: 200, body: toJson(listAttestations(store, views, params)) };
    return {
      status: 200,
      body: toJson(
        [...store.attestations.values()].map((a) => ({
          ...a,
          typeName: ATTESTATION_TYPE_NAMES[a.attestationType],
          resolved: store.identities.has(a.ubid),
        })),
      ),
    };
  }
  return { status: 404, body: toJson({ error: "not found" }) };
}

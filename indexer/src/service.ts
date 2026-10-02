import type { Address, Hex, PublicClient } from "viem";
import { ProjectionStore } from "./projection.js";
import { probeTrustBase } from "./trustbase.js";
import { ATTESTATION_TYPE_NAMES } from "./ubid.js";
import type { ViewCache } from "./views.js";

/** The API core, host-agnostic. Identity views come from the ViewCache, so no request reads the
 *  chain per identity - see views.ts. Subpaths are relative — "overview", "identities", "identity/<ubid>", "history/<ubid>",
 *  "wallet/<addr>", "trustbase/<addr>", "attestations". */

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
  const parts = subpath.replace(/^\/+|\/+$/g, "").split("/");
  const [head, arg] = parts;

  if (head === "overview") {
    return {
      status: 200,
      body: toJson({
        adapter,
        chainId: store.chainId.toString(),
        identities: store.identities.size,
        agents: store.agents.size,
        attestations: store.attestations.size,
        dropped: store.dropped.length,
        inertRevocations: store.inertRevocations.length,
      }),
    };
  }
  if (head === "identities") {
    return { status: 200, body: toJson(views.views()) };
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

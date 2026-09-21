import type { Address, PublicClient } from "viem";
import { labelsFor } from "./names.js";
import { ProjectionStore, type IdentityState } from "./projection.js";
import { probeTrustBase } from "./trustbase.js";
import { ATTESTATION_TYPE_NAMES, SINGLE_OWNER_TOKEN_STANDARDS, Standard, STANDARD_NAMES } from "./ubid.js";

/** The API core, host-agnostic: the Node server and the serverless function both delegate here.
 *  Subpaths are relative — "overview", "identities", "identity/<ubid>", "wallet/<addr>",
 *  "trustbase/<addr>", "attestations". */

export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v,
  );
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function identityView(store: ProjectionStore, client: PublicClient, id: IdentityState) {
  // Read-time advisory: who currently holds the controller, and is the bound token ownerless?
  //
  // `currentControllerHolder` is the address that passes _hasBindingControl today. It is only
  // resolvable where control is a single address: the single-owner token standards, ACCOUNT
  // (the address itself), and CONTRACT_OWNABLE (owner()). The balance standards (ERC1155,
  // ERC6909) and CONTRACT_ADMIN have no single holder to name, and delegate.xyz delegates also
  // pass control without appearing here - so null means "not expressible", never "nobody".
  let currentlyOwnerless: boolean | null = null;
  let currentControllerHolder: Address | null = null;

  if (SINGLE_OWNER_TOKEN_STANDARDS.has(id.standard)) {
    try {
      const owner = (await client.readContract({
        address: id.boundAddress,
        abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] }],
        functionName: "ownerOf",
        args: [id.tokenId],
      })) as Address;
      currentlyOwnerless = owner === ZERO_ADDRESS;
      if (!currentlyOwnerless) currentControllerHolder = owner.toLowerCase() as Address;
    } catch {
      currentlyOwnerless = true;
    }
  } else if (id.standard === Standard.ACCOUNT) {
    currentControllerHolder = id.boundAddress;
  } else if (id.standard === Standard.CONTRACT_OWNABLE) {
    // No extra call for the standards above - this one is the only added read.
    currentControllerHolder = await client
      .readContract({
        address: id.boundAddress,
        abi: [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
        functionName: "owner",
      })
      .then((o) => ((o as Address) === ZERO_ADDRESS ? null : ((o as Address).toLowerCase() as Address)))
      .catch(() => null);
  }
  const reputation = store.reputation(id.ubid);
  const trustBase = await probeTrustBase(client, id.boundAddress).catch(() => null);
  const labels = await labelsFor(client, id).catch(() => ({ subjectLabel: id.boundAddress as string, agentName: null, contractName: null }));
  return {
    ...id,
    ...labels,
    standardName: STANDARD_NAMES[id.standard],
    currentControllerHolder,
    reputation,
    trustBase,
    flags: {
      currentlyOwnerless,
      collectionAuthoredAfterOwner: id.collectionAuthoredAfterOwner,
      lastEventCollectionAuthored: id.lastEventCollectionAuthored,
      walletUnverified:
        id.agentWallet !== null && store.resolveWallet(id.agentWallet)?.designation?.ubid !== id.ubid,
    },
  };
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
    const list = [];
    for (const id of store.identities.values()) list.push(await identityView(store, client, id));
    return { status: 200, body: toJson(list) };
  }
  if (head === "identity" && arg) {
    const id = store.identities.get(arg.toLowerCase() as `0x${string}`);
    if (!id) return { status: 404, body: toJson({ error: "unknown identity", ubid: arg }) };
    return { status: 200, body: toJson(await identityView(store, client, id)) };
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

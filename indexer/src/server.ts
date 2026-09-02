import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, PublicClient } from "viem";
import type { Ingester } from "./ingest.js";
import { ProjectionStore, type IdentityState } from "./projection.js";
import { probeTrustBase } from "./trustbase.js";
import { ATTESTATION_TYPE_NAMES, SINGLE_OWNER_TOKEN_STANDARDS, STANDARD_NAMES } from "./ubid.js";

const uiPath = join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "index.html");

function json(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v));
}

async function identityView(store: ProjectionStore, client: PublicClient, id: IdentityState) {
  // Read-time advisory: is the bound token currently ownerless (reverting/zero ownerOf)?
  let currentlyOwnerless: boolean | null = null;
  if (SINGLE_OWNER_TOKEN_STANDARDS.has(id.standard)) {
    try {
      const owner = (await client.readContract({
        address: id.boundAddress,
        abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] }],
        functionName: "ownerOf",
        args: [id.tokenId],
      })) as Address;
      currentlyOwnerless = owner === "0x0000000000000000000000000000000000000000";
    } catch {
      currentlyOwnerless = true;
    }
  }
  const reputation = store.reputation(id.ubid);
  const trustBase = await probeTrustBase(client, id.boundAddress).catch(() => null);
  return {
    ...id,
    standardName: STANDARD_NAMES[id.standard],
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

export function startServer(
  store: ProjectionStore,
  client: PublicClient,
  adapter: Address,
  port: number,
  ingester?: Ingester,
) {
  if (ingester) setInterval(() => ingester.sync().catch(() => {}), 2000);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (body: string, type = "application/json") => {
      res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
      res.end(body);
    };
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return send(readFileSync(uiPath, "utf8"), "text/html");
      }
      if (url.pathname === "/api/overview") {
        return send(
          json({
            adapter,
            chainId: store.chainId.toString(),
            identities: store.identities.size,
            agents: store.agents.size,
            attestations: store.attestations.size,
            dropped: store.dropped.length,
            inertRevocations: store.inertRevocations.length,
          }),
        );
      }
      if (url.pathname === "/api/identities") {
        const list = [];
        for (const id of store.identities.values()) list.push(await identityView(store, client, id));
        return send(json(list));
      }
      if (url.pathname.startsWith("/api/identity/")) {
        const ubid = url.pathname.split("/").pop()!.toLowerCase() as `0x${string}`;
        const id = store.identities.get(ubid);
        if (!id) {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(json({ error: "unknown identity", ubid }));
        }
        return send(json(await identityView(store, client, id)));
      }
      if (url.pathname.startsWith("/api/wallet/")) {
        const account = url.pathname.split("/").pop()!.toLowerCase() as Address;
        return send(json(store.resolveWallet(account)));
      }
      if (url.pathname === "/api/attestations") {
        return send(
          json(
            [...store.attestations.values()].map((a) => ({
              ...a,
              typeName: ATTESTATION_TYPE_NAMES[a.attestationType],
              resolved: store.identities.has(a.ubid),
            })),
          ),
        );
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(json({ error: "not found" }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(json({ error: String(err) }));
    }
  });
  server.listen(port);
  return server;
}

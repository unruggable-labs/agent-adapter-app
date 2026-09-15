import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, PublicClient } from "viem";
import type { Ingester } from "./ingest.js";
import type { ProjectionStore } from "./projection.js";
import { handleApi } from "./service.js";

const uiPath = join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "index.html");

export function startServer(
  store: ProjectionStore,
  client: PublicClient,
  adapter: Address,
  port: number,
  ingester?: Ingester,
  pollMs = 2000,
) {
  if (ingester) setInterval(() => ingester.sync().catch(() => {}), pollMs);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(readFileSync(uiPath, "utf8"));
      }
      if (url.pathname.startsWith("/api/")) {
        const { status, body } = await handleApi(store, client, adapter, url.pathname.slice("/api/".length));
        res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
        return res.end(body);
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  server.listen(port);
  return server;
}

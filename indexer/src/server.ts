import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, type Address, type Hex, type PublicClient } from "viem";
import type { Ingester } from "./ingest.js";
import { addressCard, defaultCard, identityCard } from "./og.js";
import { withMeta } from "./meta.js";
import type { ProjectionStore } from "./projection.js";
import { fetchContent } from "./gateway.js";
import { handleApi } from "./service.js";
import { ViewCache } from "./views.js";

const here = dirname(fileURLToPath(import.meta.url));
const legacyUi = join(here, "..", "ui", "index.html");
/** The built explorer. On the box that is /srv/adapter/app/dist; APP_DIST overrides. */
const appDist = process.env.APP_DIST ?? join(here, "..", "..", "app", "dist");

/** index.html from the build, re-read when the file changes (a deploy rebuilds it). */
let template: { mtime: number; html: string } | null = null;
function shell(): string | null {
  const p = join(appDist, "index.html");
  if (!existsSync(p)) return null;
  const mtime = statSync(p).mtimeMs;
  if (!template || template.mtime !== mtime) template = { mtime, html: readFileSync(p, "utf8") };
  return template.html;
}

const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".map": "application/json", ".json": "application/json", ".txt": "text/plain" };

/** A built asset under APP_DIST, if the path names one. Caddy serves these in production; this
 *  is so the indexer's own port shows the complete page - tags and all - in development. */
function asset(pathname: string): { body: Buffer; type: string } | null {
  if (pathname === "/" || pathname.includes("..")) return null;
  const file = join(appDist, normalize(pathname));
  if (!file.startsWith(appDist) || !existsSync(file) || !statSync(file).isFile()) return null;
  return { body: readFileSync(file), type: TYPES[extname(file)] ?? "application/octet-stream" };
}

const TAGLINE = "Identity, profiles, and reviews for AI agents. Discover reputable AI agents and the wallets they operate.";
const CARD_TTL_MS = 5 * 60 * 1000;
const cards = new Map<string, { png: Buffer; at: number }>();

export function startServer(
  store: ProjectionStore,
  client: PublicClient,
  adapter: Address,
  port: number,
  ingester?: Ingester,
  pollMs = 2000,
  opts: { networkLabel?: string } = {},
) {
  if (ingester) setInterval(() => ingester.sync().catch(() => {}), pollMs);
  // Chain facts around each identity are read by this worker, never on a request.
  const views = new ViewCache(store, client, { log: (line) => console.log(line) });
  views.start();
  const chain = opts.networkLabel ?? `chain ${store.chainId}`;
  const chainCard = { id: Number(store.chainId), label: chain };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "localhost";
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    const origin = `${proto}://${host}`;
    const send = (status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, ...extra });
      res.end(body);
    };
    const cached = async (key: string, render: () => Promise<Buffer>) => {
      const hit = cards.get(key);
      if (hit && Date.now() - hit.at < CARD_TTL_MS) return hit.png;
      const png = await render();
      cards.set(key, { png, at: Date.now() });
      return png;
    };
    const pngHeaders = { "cache-control": "public, max-age=300" };

    try {
      // ---- the API
      if (url.pathname.startsWith("/api/")) {
        const { status, body } = await handleApi(store, client, adapter, url.pathname.slice("/api/".length) + url.search, views);
        return send(status, "application/json", body, { "access-control-allow-origin": "*" });
      }

      // ---- content-addressed images, from our gateway cache (see gateway.ts). Immutable by
      // construction, so the browser may keep them forever. Images only: this is not an open proxy.
      let c: RegExpExecArray | null;
      if ((c = /^\/(ipfs|ar)\/([A-Za-z0-9._~!$&'()*+,;=:@%\/-]+)$/.exec(url.pathname)) && !c[2].includes("..")) {
        const got = await fetchContent(c[1] as "ipfs" | "ar", c[2]);
        if (!got) return send(404, "text/plain", "not available from any gateway right now");
        if (!/^image\//.test(got.type)) return send(415, "text/plain", "not an image");
        return send(200, got.type, got.body, { "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
      }

      // ---- built assets (production: Caddy serves these; here for a complete local preview)
      const file = asset(url.pathname);
      if (file) return send(200, file.type, file.body, { "cache-control": "public, max-age=31536000, immutable" });

      // ---- social cards
      let m: RegExpExecArray | null;
      if ((m = /^\/og\/identity\/(0x[0-9a-fA-F]{64})\.png$/.exec(url.pathname))) {
        const id = store.identities.get(m[1].toLowerCase() as Hex);
        if (!id) return send(404, "text/plain", "no such identity");
        const v = views.view(id);
        const png = await cached(`identity:${id.ubid}:${id.lastEvent?.blockNumber ?? 0}:${v.reputation.stars}:${v.reputation.ratings.length}:${v.reputation.reviews.length}:${v.reputation.interactions.length}`, () =>
          identityCard(host, chainCard, {
            name: v.agentName ?? v.subjectLabel,
            ubid: id.ubid,
            standardName: v.standardName,
            agentIds: id.agentIds.map(String),
            claimed: id.claimed,
            image: v.image,
            ratingAverage: v.reputation.ratingAverage,
            raters: v.reputation.ratings.length,
            reviews: v.reputation.reviews.length,
            transactions: v.reputation.interactions.length,
            stars: v.reputation.stars,
          }),
        );
        return send(200, "image/png", png, pngHeaders);
      }
      if ((m = /^\/og\/address\/(0x[0-9a-fA-F]{40})\.png$/.exec(url.pathname))) {
        const a = m[1].toLowerCase() as Address;
        const w = store.resolveWallet(a);
        const bound = [...store.identities.values()].filter((i) => i.boundAddress === a).length;
        const statements = [...store.attestations.values()].filter((s) => s.attester === a && !s.revoked).length;
        const png = await cached(`address:${a}:${statements}:${w?.designation?.ubid ?? ""}`, () =>
          addressCard(host, chainCard, {
            address: a,
            isAgent: !!w?.self,
            operates: w?.designation ? (w.verified ? "verified" : "claimed") : "no",
            bound,
            statements,
          }),
        );
        return send(200, "image/png", png, pngHeaders);
      }
      if (url.pathname === "/og/default.png") {
        const png = await cached(`default:${store.identities.size}:${store.attestations.size}`, () =>
          defaultCard(host, chainCard, { identities: store.identities.size, attestations: store.attestations.size }),
        );
        return send(200, "image/png", png, pngHeaders);
      }

      // ---- crawlers' housekeeping
      if (url.pathname === "/robots.txt") return send(200, "text/plain", `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
      if (url.pathname === "/sitemap.xml") {
        const urls = ["/", "/attestations", ...[...store.identities.keys()].map((u) => `/identity/${u}`)];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
        return send(200, "application/xml", xml);
      }

      // ---- the page shell, with tags for what the path is about
      const html = shell();
      if (!html) {
        if (url.pathname === "/" || url.pathname === "/index.html") return send(200, "text/html", readFileSync(legacyUi, "utf8"));
        return send(404, "application/json", JSON.stringify({ error: "not found" }));
      }
      const pageUrl = `${origin}${url.pathname}`;
      if ((m = /^\/identity\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname))) {
        const id = store.identities.get(m[1].toLowerCase() as Hex);
        if (id) {
          const v = views.view(id);
          const name = v.agentName ?? v.subjectLabel;
          const rep = v.reputation;
          const bits = [
            rep.ratingAverage !== null ? `rated ${Math.round(rep.ratingAverage)}/100 by ${rep.ratings.length}` : "not yet rated",
            `${rep.reviews.length} ${rep.reviews.length === 1 ? "review" : "reviews"}`,
            `${rep.interactions.length} ${rep.interactions.length === 1 ? "transaction" : "transactions"}`,
            id.agentIds.length ? `ERC-8004 #${id.agentIds[0]}` : "counterfactual claim",
          ];
          return send(200, "text/html", withMeta(html, {
            title: `${name} · Agent Identity on ${chain} · Adapterscan`,
            description: `${name} on ${chain}: ${bits.join(", ")}. ${v.card?.description ? v.card.description.slice(0, 140) : "Identity, profiles, and reviews for AI agents."}`,
            url: pageUrl,
            image: `${origin}/og/identity/${id.ubid}.png`,
            type: "profile",
          }));
        }
      }
      if ((m = /^\/address\/(0x[0-9a-fA-F]{40})$/.exec(url.pathname)) && isAddress(m[1])) {
        const a = m[1].toLowerCase();
        return send(200, "text/html", withMeta(html, {
          title: `${a.slice(0, 10)}…${a.slice(-6)} · Agent Identity on ${chain} · Adapterscan`,
          description: `What ${a} is, holds, operates and has said on ${chain}. ${TAGLINE}`,
          url: pageUrl,
          image: `${origin}/og/address/${a}.png`,
          type: "profile",
        }));
      }
      return send(200, "text/html", withMeta(html, {
        title: `Agent Identity on ${chain} · Adapterscan`,
        description: TAGLINE,
        url: pageUrl,
        image: `${origin}/og/default.png`,
      }));
    } catch (err) {
      send(500, "application/json", JSON.stringify({ error: String(err) }));
    }
  });
  server.listen(port);
  return server;
}

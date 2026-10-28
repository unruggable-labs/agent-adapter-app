import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, type Address, type Hex } from "viem";
import { addressCard, defaultCard, identityCard, statsCard } from "./og.js";
import { withMeta } from "./meta.js";
import { llmsTxt, plainBody, withBody } from "./plain.js";
import { fetchContent } from "./gateway.js";
import { readPicture } from "./pictures.js";
import { attestationView, collectionView, findIdentity, listCollections } from "./queries.js";
import type { ChainRuntime } from "./runtime.js";
import { overview as statsOverview, series as statsSeries } from "./stats.js";
import { handleApi } from "./service.js";

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

/** The live public sites, for the stats card, which adds every chain up the way the page does: a
 *  chain this server runs from its own log, the others from their public APIs. The same list the
 *  app keeps in chain.ts; a new chain goes in both. */
const PUBLIC_SITES = [
  { slug: "robinhood", chain: { id: 4663, label: "Robinhood Chain" }, host: "robinhood.adapterscan.com", testnet: false },
  { slug: "base", chain: { id: 8453, label: "Base" }, host: "base.adapterscan.com", testnet: false },
  { slug: "mainnet", chain: { id: 1, label: "Ethereum" }, host: "adapterscan.com", testnet: false },
  { slug: "sepolia", chain: { id: 11155111, label: "Sepolia" }, host: "testnet.adapterscan.com", testnet: true },
];

/**
 * Serve a list of running chains (runtime.ts) on one port: the API, the social cards, the page
 * shell with its tags, the crawlers' files. One chain is a chain's own site; several are the
 * multichain explorer. A request for a chain's own hostname (robinhood.adapterscan.com) sees only
 * that chain, so the old per-chain sites keep working from the same process.
 */
export function startServer(chains: ChainRuntime[], port: number) {
  for (const c of chains) c.start();
  /** The chains a request sees: its host's chain if the host is one's own site, else all of them. */
  const scopeFor = (host: string) => {
    const own = chains.filter((c) => c.host && c.host === host.split(":")[0]);
    return own.length ? own : chains;
  };
  const cardOf = (c: ChainRuntime) => ({ id: Number(c.chainId), label: c.label });

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
    const scope = scopeFor(host);
    // "on Base" where the page is about one chain; nothing where it spans several.
    const onScope = scope.length === 1 ? ` on ${scope[0].label}` : "";

    try {
      // ---- the API
      if (url.pathname.startsWith("/api/")) {
        const { status, body, type } = await handleApi(scope, url.pathname.slice("/api/".length) + url.search);
        return send(status, type ?? "application/json", body, { "access-control-allow-origin": "*" });
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

      // ---- our copies of the pictures (pictures.ts). Saved by the worker; a request only reads the disk.
      if ((c = /^\/pic\/([0-9a-f]{40})\.webp$/.exec(url.pathname))) {
        const pic = await readPicture(c[1]);
        if (!pic) return send(404, "text/plain", "no copy of this picture yet");
        // A web picture is saved again after a day, so a day is as long as a browser may keep it.
        return send(200, "image/webp", pic, { "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" });
      }

      // ---- built assets (production: Caddy serves these; here for a complete local preview)
      const file = asset(url.pathname);
      if (file) return send(200, file.type, file.body, { "cache-control": "public, max-age=31536000, immutable" });

      // ---- social cards
      let m: RegExpExecArray | null;
      if ((m = /^\/og\/identity\/(0x[0-9a-fA-F]{64})\.png$/.exec(url.pathname))) {
        const found = findIdentity(scope, m[1]);
        if (!found) return send(404, "text/plain", "no such identity");
        const { c, id } = found;
        const v = c.views.view(id);
        const png = await cached(`identity:${id.ubid}:${id.lastEvent?.blockNumber ?? 0}:${v.reputation.stars}:${v.reputation.ratings.length}:${v.reputation.reviews.length}:${v.reputation.interactions.length}`, () =>
          identityCard(host, cardOf(c), {
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
        // Every chain the address is on: its first answer for what it is, the counts added up.
        const per = scope.map((c) => ({
          c,
          w: c.store.resolveWallet(a),
          bound: [...c.store.identities.values()].filter((i) => i.boundAddress === a).length,
          statements: [...c.store.attestations.values()].filter((s) => s.attester === a && !s.revoked).length,
        }));
        const present = per.filter((p) => p.w || p.bound || p.statements);
        const w = present.find((p) => p.w?.self || p.w?.designation)?.w ?? null;
        const bound = per.reduce((n, p) => n + p.bound, 0);
        const statements = per.reduce((n, p) => n + p.statements, 0);
        const pills = (present.length ? present : per).map((p) => cardOf(p.c));
        const png = await cached(`address:${scope.map((c) => c.slug).join(",")}:${a}:${statements}:${w?.designation?.ubid ?? ""}`, () =>
          addressCard(host, pills.length === 1 ? pills[0] : pills, {
            address: a,
            isAgent: !!w?.self,
            operates: w?.designation ? (w.verified ? "verified" : "claimed") : "no",
            bound,
            statements,
          }),
        );
        return send(200, "image/png", png, pngHeaders);
      }
      if (url.pathname === "/og/stats.png") {
        // The last 90 days, by week. On the stats host every selected chain is added up: this
        // chain from its own log, the others from their public APIs. Elsewhere, this chain alone.
        const now = Math.floor(Date.now() / 1000 / 3600) * 3600;
        const window = { from: now - 90 * 86400, to: now };
        // The stats host, or a server running several chains, adds up every mainnet (or ?chains=);
        // a chain's own site shows that chain.
        const across = host.startsWith("stats.") || scope.length > 1;
        const pick = url.searchParams.get("chains")?.split(",");
        const local = (id: number) => scope.find((c) => Number(c.chainId) === id && c.log);
        const wanted = across ? PUBLIC_SITES.filter((s) => (pick ? pick.includes(s.slug) : !s.testnet)) : PUBLIC_SITES.filter((s) => local(s.chain.id));
        const sites = wanted.length ? wanted : PUBLIC_SITES.filter((s) => local(s.chain.id));
        const key = `stats:${sites.map((s) => s.slug).join(",")}:${now}`;
        const png = await cached(key, async () => {
          const parts = await Promise.all(
            sites.map(async (s) => {
              const c = local(s.chain.id);
              if (c?.log) {
                const o = statsOverview(c.log.connection, c.store, window);
                const w = statsSeries(c.log.connection, "identities", "week", window).series[0].points;
                return { identities: o.figures.identities.value, projects: o.figures.projects.value, attestations: o.figures.attestations.value, weekly: w };
              }
              try {
                const q = `from=${window.from}&to=${window.to}`;
                const [o, w] = await Promise.all([
                  fetch(`https://${s.host}/api/stats/overview?${q}`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json()),
                  fetch(`https://${s.host}/api/stats/series?metric=identities&bucket=week&${q}`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json()),
                ]);
                return { identities: o.figures.identities.value as number, projects: o.figures.projects.value as number, attestations: o.figures.attestations.value as number, weekly: w.series[0].points as { t: string; v: number }[] };
              } catch {
                return null;
              }
            }),
          );
          const got = parts.filter((p): p is NonNullable<typeof p> => p !== null);
          const byWeek = new Map<string, number>();
          for (const p of got) for (const pt of p.weekly) byWeek.set(pt.t, (byWeek.get(pt.t) ?? 0) + pt.v);
          const chainsShown = sites.filter((_, i) => parts[i] !== null).map((s) => s.chain);
          return statsCard(host, chainsShown.length ? chainsShown : scope.map(cardOf), {
            identities: got.reduce((a, p) => a + p.identities, 0),
            projects: got.reduce((a, p) => a + p.projects, 0),
            attestations: got.reduce((a, p) => a + p.attestations, 0),
            weekly: [...byWeek].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => ({ t, v })),
            windowLabel: `Last 90 days${chainsShown.length > 1 ? ` across ${chainsShown.length} chains` : chainsShown.length === 1 ? ` on ${chainsShown[0].label}` : ""}`,
          });
        });
        return send(200, "image/png", png, pngHeaders);
      }
      if (url.pathname === "/og/default.png") {
        const identities = scope.reduce((n, c) => n + c.store.identities.size, 0);
        const attestations = scope.reduce((n, c) => n + c.store.attestations.size, 0);
        const png = await cached(`default:${scope.map((c) => c.slug).join(",")}:${identities}:${attestations}`, () =>
          defaultCard(host, scope.length === 1 ? cardOf(scope[0]) : scope.map(cardOf), { identities, attestations }),
        );
        return send(200, "image/png", png, pngHeaders);
      }

      // ---- crawlers' housekeeping
      if (url.pathname === "/llms.txt") return send(200, "text/plain; charset=utf-8", llmsTxt(origin, scope));
      if (url.pathname === "/robots.txt") return send(200, "text/plain", `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
      if (url.pathname === "/sitemap.xml") {
        const urls = [
          "/",
          "/attestations",
          "/collections",
          ...listCollections(scope, new URLSearchParams({ limit: "200" })).items.map((r) => `/collection/${r.chain}/${r.address}`),
          ...scope.flatMap((c) => [...c.store.identities.keys()].map((u) => `/identity/${u}`)),
        ];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
        return send(200, "application/xml", xml);
      }

      // ---- the page shell, with tags for what the path is about
      const built = shell();
      if (!built) {
        if (url.pathname === "/" || url.pathname === "/index.html") return send(200, "text/html", readFileSync(legacyUi, "utf8"));
        return send(404, "application/json", JSON.stringify({ error: "not found" }));
      }
      // A few lines about what the path is about, for a fetch that runs no JavaScript (plain.ts).
      const html = withBody(built, plainBody(scope, url.pathname));
      const pageUrl = `${origin}${url.pathname}`;
      if ((m = /^\/identity\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname))) {
        const found = findIdentity(scope, m[1]);
        if (found) {
          const { id } = found;
          const chain = found.c.label;
          const v = found.c.views.view(id);
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
      if (url.pathname === "/stats" || host.startsWith("stats.")) {
        const onStatsHost = host.startsWith("stats.");
        const where = onStatsHost ? "" : onScope;
        const chainsParam = onStatsHost && url.searchParams.get("chains") ? `?chains=${encodeURIComponent(url.searchParams.get("chains")!)}` : "";
        return send(200, "text/html", withMeta(html, {
          title: `Adapter usage${where} · Adapterscan`,
          description: `How used the adapter is${where}: identities created, ERC-8004 registrations, counterfactual claims, attestations and attesters over time, and the projects behind them.`,
          url: pageUrl,
          image: `${origin}/og/stats.png${chainsParam}`,
        }));
      }
      if ((m = /^\/attestation\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname))) {
        const v = attestationView(scope, m[1].toLowerCase() as Hex);
        if (v) {
          const chain = scope.find((c) => c.slug === v.chain)!.label;
          const about = v.target ? (v.target.agentName ?? v.target.subjectLabel) : `${v.ubid.slice(0, 10)}…`;
          const kind = v.typeName.toLowerCase().replace("_", " ");
          return send(200, "text/html", withMeta(html, {
            title: `A ${kind} about ${about} · Agent Identity on ${chain} · Adapterscan`,
            description: `${v.revoked ? "Revoked" : "Live"} ${kind} about ${about} on ${chain}, by ${v.attester.slice(0, 10)}…, block ${v.order.blockNumber}. The statement, who made it, and how its id verifies.`,
            url: pageUrl,
            image: v.target ? `${origin}/og/identity/${v.ubid}.png` : `${origin}/og/default.png`,
            type: "website",
          }));
        }
      }
      if ((m = /^\/collection\/([a-z0-9-]+)\/(0x[0-9a-fA-F]{40})$/.exec(url.pathname))) {
        const c = scope.find((x) => x.slug === m![1]);
        const row = c ? collectionView([c], m[2])[0] : undefined;
        if (c && row) {
          return send(200, "text/html", withMeta(html, {
            title: `${row.name} · Collection on ${c.label} · Adapterscan`,
            description: `${row.name} on ${c.label}: ${row.identities.toLocaleString("en")} agent ${row.identities === 1 ? "profile" : "profiles"} bound to its tokens. ${row.description ? row.description.slice(0, 140) : TAGLINE}`,
            url: pageUrl,
            image: `${origin}/og/default.png`,
          }));
        }
      }
      if (url.pathname === "/collections") {
        return send(200, "text/html", withMeta(html, {
          title: `Collections${onScope} · Adapterscan`,
          description: `The collections agent profiles are bound to${onScope}, the most agents first. ${TAGLINE}`,
          url: pageUrl,
          image: `${origin}/og/default.png`,
        }));
      }
      if ((m = /^\/address\/(0x[0-9a-fA-F]{40})$/.exec(url.pathname)) && isAddress(m[1])) {
        const a = m[1].toLowerCase();
        return send(200, "text/html", withMeta(html, {
          title: `${a.slice(0, 10)}…${a.slice(-6)} · Agent Identity${onScope} · Adapterscan`,
          description: `What ${a} is, holds, operates and has said${onScope}. ${TAGLINE}`,
          url: pageUrl,
          image: `${origin}/og/address/${a}.png`,
          type: "profile",
        }));
      }
      return send(200, "text/html", withMeta(html, {
        title: `Agent Identity${onScope} · Adapterscan`,
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

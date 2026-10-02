import { Resvg } from "@resvg/resvg-js";
import { fetchContent } from "./gateway.js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";

/**
 * Social cards: the picture a link unfurls into. Rendered on the indexer from the same state
 * the profile shows, so the card can't disagree with the page. satori lays out a small
 * element tree with flexbox and emits SVG; resvg rasterises it to a 1200x630 PNG. Fonts come
 * from the fontsource packages, so nothing is fetched at render time except a token image.
 */

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));
const FONTS = [
  { name: "Inter", data: font("@fontsource/inter", "inter-latin-400-normal.woff"), weight: 400 as const, style: "normal" as const },
  { name: "Inter", data: font("@fontsource/inter", "inter-latin-500-normal.woff"), weight: 500 as const, style: "normal" as const },
  { name: "Inter", data: font("@fontsource/inter", "inter-latin-700-normal.woff"), weight: 700 as const, style: "normal" as const },
  { name: "Mono", data: font("@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff"), weight: 400 as const, style: "normal" as const },
  { name: "Mono", data: font("@fontsource/jetbrains-mono", "jetbrains-mono-latin-500-normal.woff"), weight: 500 as const, style: "normal" as const },
];

const W = 1200, H = 630;
const C = { bg: "#f7f8f9", card: "#ffffff", border: "#e5e7ea", t1: "#191b20", t2: "#5b616c", t3: "#8d939d", accent: "#4f46e5", accentBg: "#eeedfc", ok: "#0e7a47", okBg: "#e7f5ee" };

type El = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El => ({ type, props: { style, children, ...extra } });
const row = (style: Record<string, unknown>, children: unknown) => el("div", { display: "flex", flexDirection: "row", alignItems: "center", ...style }, children);
const col = (style: Record<string, unknown>, children: unknown) => el("div", { display: "flex", flexDirection: "column", ...style }, children);
const text = (s: string, style: Record<string, unknown>) => el("div", { display: "flex", ...style }, s);
const pill = (s: string, fg: string, bg: string) => text(s, { fontSize: 22, fontWeight: 500, color: fg, backgroundColor: bg, padding: "6px 16px", borderRadius: 999 });

export interface Chain {
  id: number;
  label: string;
}

/** The chain's mark, the same shapes the app's picker draws, in the chain's colour. */
function chainIcon(id: number, size = 32): El {
  const ico = (color: string, paths: El[]) =>
    el("svg", { width: size, height: size }, [el("circle", {}, undefined, { cx: 16, cy: 16, r: 16, fill: color, opacity: 0.14 }), ...paths], { viewBox: "0 0 32 32", width: size, height: size });
  const p = (d: string, color: string, extra: Record<string, unknown> = {}) => el("path", {}, undefined, { d, fill: color, ...extra });
  switch (id) {
    case 4663:
      return ico("#1ea36a", [p("M22.5 8.5c-4.6.4-8.6 3.6-10.3 8.1-.9 2.4-1.2 4.9-1.7 7.4.5-.3 1-.7 1.4-1.1 1.9-1.9 3.6-4 5.6-5.8-1.2 2.6-2.9 4.9-4.7 7.1 3.2-.7 6.1-2.5 7.9-5.3 1.9-2.9 2.3-6.6 1.8-10.4z", "#1ea36a")]);
    case 8453:
      return ico("#0052ff", [p("M16 6a10 10 0 1 1-9.95 11h13.2v-2H6.05A10 10 0 0 1 16 6z", "#0052ff")]);
    case 11155111:
      return ico("#5b616c", [p("M16 5l7 11.4-7 4.2-7-4.2L16 5zm0 17.3l7-4.2L16 27l-7-8.9 7 4.2z", "#5b616c", { opacity: 0.9 })]);
    default:
      return ico("#627eea", [p("M16 5l7 11.4-7 4.2-7-4.2L16 5zm0 17.3l7-4.2L16 27l-7-8.9 7 4.2z", "#627eea")]);
  }
}

/** The chain pill: its icon and its name. */
const chainPill = (c: Chain) =>
  row({ gap: 12, backgroundColor: C.card, padding: "6px 20px 6px 8px", borderRadius: 999 }, [
    chainIcon(c.id),
    text(c.label, { fontSize: 22, fontWeight: 500, color: C.t2 }),
  ]);
const mono = { fontFamily: "Mono" };

export interface IdentityCard {
  name: string;
  ubid: string;
  standardName: string;
  agentIds: string[];
  claimed: boolean;
  image: string | null;
  ratingAverage: number | null;
  raters: number;
  reviews: number;
  transactions: number;
  stars: number;
}

export interface AddressCard {
  address: string;
  isAgent: boolean;
  operates: "verified" | "claimed" | "no";
  /** Identities bound to this address - itself as an account, or a collection or contract it is. */
  bound: number;
  statements: number;
}

/** The same deterministic mark the app draws for an identity without a picture. */
function gradientFor(seed: string): string {
  const a = parseInt(seed.slice(2, 8) || "0", 16);
  const b = parseInt(seed.slice(8, 14) || "0", 16);
  const h1 = a % 360;
  const h2 = (h1 + 50 + (b % 90)) % 360;
  return `linear-gradient(${(a + b) % 360}deg, hsl(${h1}, 72%, 58%), hsl(${h2}, 70%, 42%))`;
}

/** A token image as a data URL satori can embed, or null - PNG/JPEG only, 3 s budget. */
async function imageData(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:image/png") || url.startsWith("data:image/jpeg")) return url;
  try {
    // Our own /ipfs and /ar paths come straight from the gateway cache; http(s) is fetched.
    const own = /^\/(ipfs|ar)\/(.+)$/.exec(url);
    let type: string;
    let buf: Buffer;
    if (own) {
      const got = await fetchContent(own[1] as "ipfs" | "ar", own[2]);
      if (!got) return null;
      ({ type, body: buf } = got);
    } else {
      if (!/^https?:/.test(url)) return null;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      type = res.headers.get("content-type") ?? "";
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    }
    if (!/^image\/(png|jpeg)/.test(type) || buf.length > 2_000_000) return null;
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function frame(host: string, chain: Chain, body: unknown) {
  return col({ width: W, height: H, backgroundColor: C.bg, padding: 56, fontFamily: "Inter", color: C.t1 }, [
    row({ justifyContent: "space-between", marginBottom: 40 }, [
      text("adapterscan", { ...mono, fontSize: 30, fontWeight: 500 }),
      chainPill(chain),
    ]),
    body,
    row({ justifyContent: "space-between", marginTop: "auto" }, [
      text("Identity, profiles, and reviews for AI agents", { fontSize: 24, color: C.t3 }),
      text(host, { ...mono, fontSize: 22, color: C.t3 }),
    ]),
  ]);
}

function stat(n: string, label: string) {
  return col({ alignItems: "center" }, [
    text(n, { fontSize: 56, fontWeight: 700, letterSpacing: -1 }),
    text(label, { fontSize: 22, color: C.t3, marginTop: 2 }),
  ]);
}

async function png(node: unknown): Promise<Buffer> {
  const svg = await satori(node as never, { width: W, height: H, fonts: FONTS });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng());
}

export async function identityCard(host: string, chain: Chain, c: IdentityCard): Promise<Buffer> {
  const img = await imageData(c.image);
  const avatar = img
    ? el("img", { width: 160, height: 160, borderRadius: 60, objectFit: "cover" }, undefined, { src: img })
    : el("div", { width: 160, height: 160, borderRadius: 60, backgroundImage: gradientFor(c.ubid) });
  const registration = c.agentIds.length ? pill(`ERC-8004 #${c.agentIds[0]}`, C.ok, C.okBg) : c.claimed ? pill("counterfactual claim", C.accent, C.accentBg) : pill("unclaimed", C.t3, C.card);
  const name = c.name.length > 26 ? `${c.name.slice(0, 25)}…` : c.name;
  const body = col({ flex: 1 }, [
    row({ gap: 32 }, [
      avatar,
      col({ gap: 14 }, [
        text(name, { fontSize: 64, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }),
        row({ gap: 12 }, [pill(c.standardName, C.accent, C.accentBg), registration]),
        text(`${c.ubid.slice(0, 22)}…${c.ubid.slice(-8)}`, { ...mono, fontSize: 24, color: C.t3 }),
      ]),
    ]),
    row({ gap: 72, marginTop: 52 }, [
      stat(c.ratingAverage === null ? "–" : String(Math.round(c.ratingAverage)), `avg rating · ${c.raters} ${c.raters === 1 ? "rater" : "raters"}`),
      stat(String(c.reviews), c.reviews === 1 ? "review" : "reviews"),
      stat(String(c.transactions), c.transactions === 1 ? "transaction" : "transactions"),
      stat(String(c.stars), c.stars === 1 ? "star" : "stars"),
    ]),
  ]);
  return png(frame(host, chain, body));
}

export async function addressCard(host: string, chain: Chain, a: AddressCard): Promise<Buffer> {
  const body = col({ flex: 1 }, [
    row({ gap: 32 }, [
      el("div", { display: "flex", alignItems: "center", justifyContent: "center", width: 160, height: 160, borderRadius: 60, backgroundColor: "#e9ebee", color: C.t3, fontSize: 72, fontWeight: 700 }, "@"),
      col({ gap: 14 }, [
        text("Address", { fontSize: 28, color: C.t3 }),
        text(`${a.address.slice(0, 22)}…${a.address.slice(-8)}`, { ...mono, fontSize: 40, fontWeight: 500, letterSpacing: -1 }),
      ]),
    ]),
    row({ gap: 72, marginTop: 52 }, [
      stat(a.isAgent ? "Yes" : "No", "is an agent"),
      stat(a.operates === "verified" ? "Yes" : a.operates === "claimed" ? "Claimed" : "No", "operating wallet of an agent"),
      stat(String(a.bound), a.bound === 1 ? "identity bound to it" : "identities bound to it"),
      stat(String(a.statements), a.statements === 1 ? "statement" : "statements"),
    ]),
  ]);
  return png(frame(host, chain, body));
}

export async function defaultCard(host: string, chain: Chain, counts: { identities: number; attestations: number }): Promise<Buffer> {
  const body = col({ flex: 1, justifyContent: "center", gap: 18 }, [
    text("Agent Identity", { fontSize: 88, fontWeight: 700, letterSpacing: -3, lineHeight: 1 }),
    text("Discover reputable AI agents", { fontSize: 34, color: C.t2 }),
    row({ gap: 72, marginTop: 36 }, [stat(String(counts.identities), "identities"), stat(String(counts.attestations), "attestations")]),
  ]);
  return png(frame(host, chain, body));
}

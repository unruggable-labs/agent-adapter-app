import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

/**
 * Content-addressed fetches - ipfs:// and ar:// - through public gateways, cached on disk.
 *
 * Public gateways rate-limit by IP and go away without notice (ipfs.io answered 429 to the box
 * and a laptop alike), and an app that hands browsers a gateway URL puts every picture at their
 * mercy. So the indexer fetches content itself, trying gateways in turn and resting one that
 * answers 429 or 5xx, keeps what it gets on disk under its content address (which never
 * changes, so the cache never goes stale), and serves it at /ipfs/<path> and /ar/<path>. The
 * browser only ever talks to us. The same path feeds the metadata reads in images.ts and
 * collection.ts.
 */

export type Scheme = "ipfs" | "ar";

export interface Content {
  body: Buffer;
  type: string;
}

const GATEWAYS: Record<Scheme, string[]> = {
  ipfs: [
    "https://ipfs.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://w3s.link/ipfs/",
    "https://gateway.pinata.cloud/ipfs/",
    "https://4everland.io/ipfs/",
    "https://ipfs.filebase.io/ipfs/",
  ],
  ar: ["https://arweave.net/", "https://ar-io.net/"],
};

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 10_000_000;
/** A gateway that rate-limits or errors rests this long before it is tried again. */
const COOLDOWN_MS = 5 * 60_000;
/** A path no gateway could serve is not asked again for this long. */
const MISS_TTL_MS = 10 * 60_000;
/** Upstream fetches in flight at once, across every caller - a page of 25 avatars must not become 25 parallel gateway hits. */
const MAX_CONCURRENT = 6;
/** Cached files untouched for longer than this are swept on boot. */
const SWEEP_AFTER_MS = 60 * 24 * 60 * 60_000;

let cacheDir: string | null = null;
let fetchImpl: typeof fetch = (...args) => fetch(...args);
const cooldown = new Map<string, number>();
const misses = new Map<string, number>();
const inflight = new Map<string, Promise<Content | null>>();

/** Where fetched content is kept. Without this the cache is memory-only (the demo, the tests). */
export function configureGatewayCache(dir: string): void {
  mkdirSync(dir, { recursive: true });
  cacheDir = dir;
  sweep(dir);
}

/** Tests swap the network out. */
export function setGatewayFetch(f: typeof fetch): void {
  fetchImpl = f;
}
export function resetGatewayState(): void {
  cacheDir = null;
  cooldown.clear();
  misses.clear();
  inflight.clear();
}

/** ipfs://cid/path, ipfs://ipfs/cid/path, https://<gateway>/ipfs/cid/path, https://<cid>.ipfs.<gateway>/path, ar://id. */
export function parseContentUri(uri: string): { scheme: Scheme; path: string } | null {
  const u = uri.trim();
  let m: RegExpExecArray | null;
  if ((m = /^ipfs:\/\/(?:ipfs\/)?(.+)$/i.exec(u))) return clean("ipfs", m[1]);
  if ((m = /^ar:\/\/(.+)$/i.exec(u))) return clean("ar", m[1]);
  if ((m = /^https?:\/\/[^/]+\/ipfs\/(.+)$/i.exec(u))) return clean("ipfs", m[1]);
  if ((m = /^https?:\/\/([a-z0-9]{46,})\.ipfs\.[^/]+(?:\/(.*))?$/i.exec(u))) return clean("ipfs", m[2] ? `${m[1]}/${m[2]}` : m[1]);
  return null;
}

function clean(scheme: Scheme, path: string): { scheme: Scheme; path: string } | null {
  const p = path.replace(/^\/+/, "").split("?")[0].split("#")[0];
  if (!p || p.includes("..") || !/^[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+$/.test(p)) return null;
  return { scheme, path: p };
}

/** The same-origin path the browser loads it from, or null when the URI is not content-addressed. */
export function proxyPath(uri: string): string | null {
  const c = parseContentUri(uri);
  return c ? `/${c.scheme}/${c.path}` : null;
}

export async function fetchContent(scheme: Scheme, path: string): Promise<Content | null> {
  const key = `${scheme}/${path}`;
  const cached = await readCache(key);
  if (cached) return cached;
  const missedAt = misses.get(key);
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;
  const running = inflight.get(key);
  if (running) return running;
  const task = withSlot(() => fetchFromGateways(scheme, path))
    .then(async (got) => {
      if (got) await writeCache(key, got);
      else {
        if (misses.size > 10_000) misses.clear();
        misses.set(key, Date.now());
      }
      return got;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

async function fetchFromGateways(scheme: Scheme, path: string): Promise<Content | null> {
  const now = Date.now();
  for (const base of GATEWAYS[scheme]) {
    if ((cooldown.get(base) ?? 0) > now) continue;
    try {
      const res = await fetchImpl(base + path, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
      if (res.status === 429 || res.status >= 500) {
        cooldown.set(base, Date.now() + COOLDOWN_MS);
        continue;
      }
      if (!res.ok) continue; // a 404 here may be a 200 elsewhere - content propagates unevenly
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > MAX_BYTES) return null;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_BYTES) return null;
      const type = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
      return { body, type };
    } catch {
      cooldown.set(base, Date.now() + COOLDOWN_MS / 5); // a timeout rests it briefly
    }
  }
  return null;
}

// ---- a small concurrency gate
let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// ---- the disk cache: <sha256(key)> holds the bytes, <sha256(key)>.json the type
function fileFor(key: string): string {
  return join(cacheDir!, createHash("sha256").update(key).digest("hex"));
}

async function readCache(key: string): Promise<Content | null> {
  if (!cacheDir) return null;
  const file = fileFor(key);
  try {
    const [body, meta] = await Promise.all([readFile(file), readFile(`${file}.json`, "utf8")]);
    return { body, type: (JSON.parse(meta) as { type: string }).type };
  } catch {
    return null;
  }
}

async function writeCache(key: string, content: Content): Promise<void> {
  if (!cacheDir) return;
  const file = fileFor(key);
  try {
    await writeFile(`${file}.tmp`, content.body);
    await rename(`${file}.tmp`, file);
    await writeFile(`${file}.json`, JSON.stringify({ key, type: content.type, at: Date.now() }));
  } catch {
    // a full disk is not a reason to fail the request
  }
}

function sweep(dir: string): void {
  const cutoff = Date.now() - SWEEP_AFTER_MS;
  try {
    for (const name of readdirSync(dir)) {
      const f = join(dir, name);
      if (existsSync(f) && statSync(f).mtimeMs < cutoff) unlinkSync(f);
    }
  } catch {
    // best effort
  }
}

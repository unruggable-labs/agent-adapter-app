import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { fetchContent } from "./gateway.js";

/**
 * Our own copy of every picture the site shows: a token's, an agent card's, a collection's. The
 * view worker saves one when it reads a card or a collection - never a page view - so a gateway's
 * rate limit lands on the worker, which tries again later, and a project whose server goes away
 * keeps the last picture we had. Each copy is a small WebP (fits 512 px), which is what tiles and
 * lists need: a 768 KB PNG becomes tens of KB. Tiny pixel art is scaled up with hard edges rather
 * than left for the browser to blur.
 *
 * A copy lives at `<dir>/<key>.webp`, the key a hash of the picture's address, and is served at
 * `/pic/<key>.webp`. The API hands out that path once the copy exists, and the picture's own
 * address until then. Content-addressed pictures (ipfs, ar) never change, so they are saved once;
 * a web address is saved again after a day, and a failed refresh keeps the copy we have.
 * Inline `data:` pictures are already in the record and are left alone.
 */

const SIZE = 512;
/** Below this, a raster is pixel art or a placeholder: scaled up with nearest-neighbour. */
const SMALL = 128;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 25_000_000;
const REFRESH_MS = 24 * 60 * 60_000;
/** Pictures fetched at once. Gentle: the gateways and the projects' servers are shared. */
const CONCURRENCY = 3;
/** A picture that failed is tried again after this, not on every batch. */
const RETRY_MS = 30 * 60_000;

let dir: string | null = null;
/** The keys saved on disk. Read once at boot; a page asks only this, never the disk or the network. */
const saved = new Set<string>();
const queue: string[] = [];
const queued = new Set<string>();
const failedAt = new Map<string, number>();
let running = 0;
let fetchImpl: typeof fetch = (...a) => fetch(...a);

export function configurePictures(at: string): void {
  dir = at;
  mkdirSync(at, { recursive: true });
  saved.clear();
  for (const name of readdirSync(at)) if (name.endsWith(".webp")) saved.add(name.slice(0, -5));
}

/** Tests swap the network out. */
export function setPictureFetch(f: typeof fetch): void {
  fetchImpl = f;
}

export function pictureKey(src: string): string {
  return createHash("sha256").update(src).digest("hex").slice(0, 40);
}

const contentAddressed = (src: string) => /^\/(ipfs|ar)\//.test(src);

/** What the browser should load for a picture: our copy once there is one, else the picture itself. */
export function shownPicture(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  const key = pictureKey(src);
  return saved.has(key) ? `/pic/${key}.webp` : src;
}

/** Our copy, for the /pic route and the social cards. Null when there is none. */
export async function readPicture(key: string): Promise<Buffer | null> {
  if (!dir || !/^[0-9a-f]{40}$/.test(key) || !saved.has(key)) return null;
  return readFile(join(dir, `${key}.webp`)).catch(() => null);
}

/** Save a copy of these pictures in the background, where one is missing or due. Returns at once. */
export function warmPictures(srcs: Iterable<string | null | undefined>): void {
  if (!dir) return;
  const now = Date.now();
  for (const src of srcs) {
    if (!src || src.startsWith("data:") || queued.has(src)) continue;
    if ((failedAt.get(src) ?? 0) + RETRY_MS > now) continue;
    // Content-addressed and saved: nothing can change. A web picture is checked for its age when its turn comes.
    if (contentAddressed(src) && saved.has(pictureKey(src))) continue;
    queued.add(src);
    queue.push(src);
  }
  pump();
}

/** How many pictures are waiting - for logs and tests. */
export function picturesWaiting(): number {
  return queue.length + running;
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const src = queue.shift()!;
    running++;
    savePicture(src)
      .catch(() => false)
      .then((ok) => {
        if (!ok) failedAt.set(src, Date.now());
        else failedAt.delete(src);
      })
      .finally(() => {
        running--;
        queued.delete(src);
        pump();
      });
  }
}

/** Fetch, shrink and keep one picture. True when we have a copy afterwards (new, refreshed or kept fresh). */
export async function savePicture(src: string): Promise<boolean> {
  if (!dir) return false;
  const key = pictureKey(src);
  const file = join(dir, `${key}.webp`);
  if (saved.has(key)) {
    if (contentAddressed(src)) return true;
    const age = Date.now() - (await stat(file).then((s) => s.mtimeMs).catch(() => 0));
    if (age < REFRESH_MS) return true;
  }
  const original = await fetchOriginal(src);
  if (!original) return saved.has(key); // a failed refresh keeps what we had
  const small = await shrink(original).catch(() => null);
  if (!small) return saved.has(key);
  await writeFile(`${file}.tmp`, small);
  await rename(`${file}.tmp`, file);
  saved.add(key);
  return true;
}

async function fetchOriginal(src: string): Promise<Buffer | null> {
  const own = /^\/(ipfs|ar)\/(.+)$/.exec(src);
  if (own) return (await fetchContent(own[1] as "ipfs" | "ar", own[2]))?.body ?? null;
  if (!/^https?:\/\//.test(src)) return null;
  try {
    const res = await fetchImpl(src, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow", headers: { accept: "image/*" } });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const body = Buffer.from(await res.arrayBuffer());
    return body.length > MAX_BYTES ? null : body;
  } catch {
    return null;
  }
}

/** The small copy: fits SIZE, animation kept, pixel art scaled up with hard edges. Throws on what isn't a picture. */
export async function shrink(input: Buffer): Promise<Buffer> {
  const opts = { animated: true, limitInputPixels: 100_000_000 } as const;
  const meta = await sharp(input, opts).metadata();
  const w = meta.width ?? 0;
  const h = meta.pageHeight ?? meta.height ?? 0;
  if (!w || !h) throw new Error("not a picture");
  if (meta.format === "svg") {
    // A vector is drawn at the size it's needed, not at its nominal size and then stretched.
    const density = Math.min(2400, Math.max(1, (72 * SIZE) / Math.max(w, h)));
    return sharp(input, { ...opts, density }).resize(SIZE, SIZE, { fit: "inside" }).webp({ quality: 82 }).toBuffer();
  }
  const small = Math.max(w, h) < SMALL;
  return sharp(input, opts)
    .resize(SIZE, SIZE, { fit: "inside", withoutEnlargement: !small, kernel: small ? "nearest" : "lanczos3" })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();
}

/** Tests: start empty. */
export function resetPictures(): void {
  dir = null;
  saved.clear();
  queue.length = 0;
  queued.clear();
  failedAt.clear();
}

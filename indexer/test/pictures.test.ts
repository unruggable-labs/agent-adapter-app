import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { configurePictures, pictureKey, picturesWaiting, readPicture, resetPictures, savePicture, setPictureFetch, shownPicture, shrink, warmPictures } from "../src/pictures.js";

const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 90 } } }).png().toBuffer();
const reply = (body: Buffer | null, status = 200) => new Response(body ? new Uint8Array(body) : null, { status, headers: { "content-type": "image/png" } });

describe("our copies of pictures", () => {
  let dir: string;
  let asked: string[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pics-"));
    configurePictures(dir);
    asked = [];
  });
  afterEach(() => {
    resetPictures();
    rmSync(dir, { recursive: true, force: true });
  });

  it("shrinks a big picture to fit 512 px, as WebP", async () => {
    const out = await sharp(await shrink(await solid(2000, 1000))).metadata();
    expect([out.format, out.width, out.height]).toEqual(["webp", 512, 256]);
  });

  it("scales tiny pixel art up with hard edges, and draws a vector at the size it's needed", async () => {
    expect((await sharp(await shrink(await solid(24, 24))).metadata()).width).toBe(512);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="#e3e5e4"/></svg>');
    expect((await sharp(await shrink(svg)).metadata()).width).toBe(512);
  });

  it("hands out the picture's own address until there's a copy, then ours", async () => {
    const src = "https://cdn.example/7.png";
    const png = await solid(800, 800);
    setPictureFetch(async (input) => (asked.push(String(input)), reply(png)));
    expect(shownPicture(src)).toBe(src);
    expect(await savePicture(src)).toBe(true);
    expect(shownPicture(src)).toBe(`/pic/${pictureKey(src)}.webp`);
    expect((await sharp((await readPicture(pictureKey(src)))!).metadata()).format).toBe("webp");
    // Inline pictures are already in the record.
    expect(shownPicture("data:image/svg+xml;base64,AAAA")).toBe("data:image/svg+xml;base64,AAAA");
    // A restart finds the copies on disk.
    configurePictures(dir);
    expect(shownPicture(src)).toBe(`/pic/${pictureKey(src)}.webp`);
  });

  it("refreshes a web picture after a day, and keeps the copy when the source has gone", async () => {
    const src = "https://gone.example/1.png";
    let up = true;
    setPictureFetch(async (input) => (asked.push(String(input)), up ? reply(await solid(300, 300)) : reply(null, 402)));
    expect(await savePicture(src)).toBe(true);
    expect(await savePicture(src)).toBe(true); // fresh: not asked again
    expect(asked).toHaveLength(1);
    const old = (Date.now() - 2 * 24 * 60 * 60_000) / 1000;
    utimesSync(join(dir, `${pictureKey(src)}.webp`), old, old);
    up = false;
    expect(await savePicture(src)).toBe(true); // asked, failed, kept
    expect(asked).toHaveLength(2);
    expect(shownPicture(src)).toBe(`/pic/${pictureKey(src)}.webp`);
  });

  it("saves in the background, once per picture, and nothing that isn't a picture", async () => {
    setPictureFetch(async (input) => {
      asked.push(String(input));
      return String(input).includes("text") ? new Response("hello", { headers: { "content-type": "text/plain" } }) : reply(await solid(100, 100));
    });
    warmPictures(["https://a.example/1.png", "https://a.example/1.png", "https://a.example/text", null, "data:image/png;base64,AA"]);
    while (picturesWaiting() > 0) await new Promise((r) => setTimeout(r, 5));
    expect(asked.sort()).toEqual(["https://a.example/1.png", "https://a.example/text"]);
    expect(shownPicture("https://a.example/1.png")).toMatch(/^\/pic\//);
    expect(shownPicture("https://a.example/text")).toBe("https://a.example/text");
  });
});

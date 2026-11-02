import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { imageData, previewVersion } from "../src/og.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>';

describe("preview invalidation", () => {
  it("includes on-chain bigint values and metadata maps", () => {
    expect(previewVersion({ block: 1n, metadata: new Map([["name", "before"]]) }))
      .not.toBe(previewVersion({ block: 1n, metadata: new Map([["name", "after"]]) }));
  });
  it("changes with any record field or decoded avatar content", () => {
    const record = { name: "Normie", ratingAverage: 50, agentIds: ["32417"], holder: "alice", image: "/pic/same.webp" };
    const original = previewVersion("adapterscan.com", record, "first image bytes");
    expect(previewVersion("adapterscan.com", { ...record }, "first image bytes")).toBe(original);
    for (const change of [
      { name: "Updated" }, { ratingAverage: 75 }, { agentIds: ["32418"] },
      { holder: "bob" }, { image: "data:image/svg+xml,new" },
    ]) expect(previewVersion("adapterscan.com", { ...record, ...change }, "first image bytes")).not.toBe(original);
    expect(previewVersion("adapterscan.com", record, "updated image bytes")).not.toBe(original);
    expect(previewVersion("other.example", record, "first image bytes")).not.toBe(original);
  });
});

describe("social preview images", () => {
  it.each(["png", "jpeg", "webp", "gif", "avif", "tiff"] as const)("normalizes %s data URLs to PNG", async (format) => {
    const input = await sharp(Buffer.from(svg)).toFormat(format).toBuffer();
    const result = await imageData(`data:image/${format};base64,${input.toString("base64")}`);
    expect(result).toMatch(/^data:image\/png;base64,/);
    const metadata = await sharp(Buffer.from(result!.split(",")[1], "base64")).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBeLessThanOrEqual(320);
  });

  it.each([
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    `data:image/svg+xml,${encodeURIComponent(svg)}`,
  ])("supports inline SVG avatars", async (url) => {
    expect(await imageData(url)).toMatch(/^data:image\/png;base64,/);
  });

  it("decodes remote image bytes even with a generic content type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(svg, { headers: { "content-type": "application/octet-stream" } })));
    try {
      expect(await imageData("https://example.com/avatar")).toMatch(/^data:image\/png;base64,/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back for missing or invalid images", async () => {
    expect(await imageData(null)).toBeNull();
    expect(await imageData("data:image/png;base64,bm90IGFuIGltYWdl")).toBeNull();
    expect(await imageData("data:text/html,hello")).toBeNull();
  });
});

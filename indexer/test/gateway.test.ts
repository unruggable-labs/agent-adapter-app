import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureGatewayCache, fetchContent, parseContentUri, proxyPath, resetGatewayState, setGatewayFetch } from "../src/gateway.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const reply = (status: number, body: Buffer = Buffer.alloc(0), type = "image/png") =>
  new Response(status === 204 ? null : new Uint8Array(body), { status, headers: { "content-type": type } });

describe("content gateway", () => {
  let dir: string;
  let calls: string[];
  beforeEach(() => {
    resetGatewayState();
    dir = mkdtempSync(join(tmpdir(), "gw-"));
    configureGatewayCache(dir);
    calls = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads every spelling of a content address, and nothing else", () => {
    expect(parseContentUri("ipfs://bafyfoo/7.png")).toEqual({ scheme: "ipfs", path: "bafyfoo/7.png" });
    expect(parseContentUri("ipfs://ipfs/bafyfoo")).toEqual({ scheme: "ipfs", path: "bafyfoo" });
    expect(parseContentUri("https://ipfs.io/ipfs/bafyfoo/a.png?x=1")).toEqual({ scheme: "ipfs", path: "bafyfoo/a.png" });
    expect(parseContentUri("https://bafybeievztwgzp6zi3hbdkm4yql5ufxrkj6adxyr3ssk6em4437qzpfghe.ipfs.dweb.link/img.png")).toEqual({ scheme: "ipfs", path: "bafybeievztwgzp6zi3hbdkm4yql5ufxrkj6adxyr3ssk6em4437qzpfghe/img.png" });
    expect(parseContentUri("ar://abc_DEF-123")).toEqual({ scheme: "ar", path: "abc_DEF-123" });
    expect(parseContentUri("ipfs://bafy/../etc")).toBeNull();
    expect(parseContentUri("https://cdn.example/x.png")).toBeNull();
    expect(proxyPath("ipfs://bafyfoo/7.png")).toBe("/ipfs/bafyfoo/7.png");
    expect(proxyPath("https://cdn.example/x.png")).toBeNull();
  });

  it("moves on from a gateway that rate-limits, rests it, and caches what it got on disk", async () => {
    setGatewayFetch(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://ipfs.io/")) return reply(429, Buffer.from("slow down"), "text/plain");
      return reply(200, png);
    });
    const first = await fetchContent("ipfs", "bafyone/a.png");
    expect(first).toEqual({ body: png, type: "image/png" });
    expect(calls).toEqual(["https://ipfs.io/ipfs/bafyone/a.png", "https://dweb.link/ipfs/bafyone/a.png"]);

    // the same address again: from disk, no network
    calls.length = 0;
    expect(await fetchContent("ipfs", "bafyone/a.png")).toEqual(first);
    expect(calls).toEqual([]);

    // a different address: the rate-limited gateway is resting, so the next one is asked first
    await fetchContent("ipfs", "bafytwo/b.png");
    expect(calls).toEqual(["https://dweb.link/ipfs/bafytwo/b.png"]);
  });

  it("gives up when no gateway has it, and does not ask again for a while", async () => {
    setGatewayFetch(async (input) => {
      calls.push(String(input));
      return reply(404, Buffer.from("nope"), "text/plain");
    });
    expect(await fetchContent("ipfs", "bafymissing")).toBeNull();
    const asked = calls.length;
    expect(asked).toBeGreaterThan(1); // every gateway was tried
    expect(await fetchContent("ipfs", "bafymissing")).toBeNull();
    expect(calls.length).toBe(asked); // remembered as a miss
  });

  it("dedupes concurrent requests for one address", async () => {
    setGatewayFetch(async (input) => {
      calls.push(String(input));
      await new Promise((r) => setTimeout(r, 10));
      return reply(200, png);
    });
    const [a, b, c] = await Promise.all([fetchContent("ar", "txid"), fetchContent("ar", "txid"), fetchContent("ar", "txid")]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(calls).toEqual(["https://arweave.net/txid"]);
  });
});

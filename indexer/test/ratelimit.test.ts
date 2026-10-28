import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { limitClassOf, limitHeaders, RateLimiter, RULES } from "../src/ratelimit.js";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe("fair-use limit", () => {
  it("lets a burst through, then says when to come back, then refills", () => {
    let t = 0;
    const rl = new RateLimiter(null, () => t);
    for (let i = 0; i < RULES.api.burst; i++) expect(rl.check("1.2.3.4", "api").ok).toBe(true);
    const over = rl.check("1.2.3.4", "api");
    expect(over).toMatchObject({ ok: false, limit: 300 });
    expect(limitHeaders(over)["retry-after"]).toBe("1");
    // Another caller has an allowance of its own.
    expect(rl.check("5.6.7.8", "api").ok).toBe(true);
    // 300 a minute is one every 200 ms.
    t += 200;
    expect(rl.check("1.2.3.4", "api").ok).toBe(true);
    expect(rl.check("1.2.3.4", "api").ok).toBe(false);
  });

  it("knows the caller by the address Caddy put last, and exempts the box and our key", () => {
    const rl = new RateLimiter("sekret");
    expect(rl.callerOf(req({ "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(rl.callerOf(req({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" }))).toBe("9.9.9.9");
    expect(rl.callerOf(req({}))).toBeNull(); // not through Caddy: the box itself
    expect(rl.callerOf(req({ "x-forwarded-for": "9.9.9.9", "x-adapterscan-key": "sekret" }))).toBeNull();
    expect(rl.callerOf(req({ "x-forwarded-for": "9.9.9.9", "x-adapterscan-key": "guess" }))).toBe("9.9.9.9");
    expect(new RateLimiter(null).callerOf(req({ "x-forwarded-for": "9.9.9.9", "x-adapterscan-key": "" }))).toBe("9.9.9.9");
    expect(rl.check(null, "heavy")).toEqual({ ok: true, exempt: true });
  });

  it("draws the expensive answers and the pictures from allowances of their own", () => {
    expect(limitClassOf("/api/identities", "?limit=25")).toBe("api");
    expect(limitClassOf("/api/stats/projects", "?format=csv")).toBe("heavy");
    expect(limitClassOf("/og/identity/0xabc.png", "")).toBe("heavy");
    expect(limitClassOf("/pic/abc.webp", "")).toBe("pictures");
    expect(limitClassOf("/ipfs/bafy/1.png", "")).toBe("pictures");
    expect(limitClassOf("/identity/0xabc", "")).toBeNull();
    expect(limitClassOf("/assets/main.js", "")).toBeNull();
  });
});

import type { IncomingMessage } from "node:http";

/**
 * The public API's fair-use limit: an allowance per caller that refills steadily and absorbs a
 * burst. Our own app is a caller like any other - it runs in each visitor's browser, from their
 * address - so the limit is set well above what a person browsing makes (a page polls every 12 s,
 * a few requests each time). What it stops is a script asking as fast as it can.
 *
 * The caller is the address Caddy saw. Caddy has no trusted proxies configured, so it replaces any
 * X-Forwarded-For a client sends with the client's own address: the last entry can't be forged. A
 * request without one didn't come through Caddy - it came from the box itself - and isn't limited,
 * and neither is one carrying ADAPTER_API_KEY (our own tools, set in /etc/adapter.env, never in the app).
 *
 * The expensive answers (social cards rendered on demand, the CSV export) have a smaller allowance
 * of their own; pictures have a larger one, since a page of tiles is dozens of them at once.
 */

export type LimitClass = "api" | "heavy" | "pictures";

interface Rule {
  /** Requests a minute, refilled continuously. */
  perMinute: number;
  /** How many can go at once from a full allowance. */
  burst: number;
}

export const RULES: Record<LimitClass, Rule> = {
  api: { perMinute: 300, burst: 60 },
  heavy: { perMinute: 20, burst: 10 },
  pictures: { perMinute: 1200, burst: 300 },
};

interface Bucket {
  tokens: number;
  at: number;
}

export type Verdict =
  | { ok: true; exempt: true }
  | { ok: true; exempt: false; limit: number; remaining: number; resetSeconds: number }
  | { ok: false; limit: number; retryAfterSeconds: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(
    private readonly key: string | null = process.env.ADAPTER_API_KEY || null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Who is asking: the address Caddy saw, or null for the box itself and our own key. */
  callerOf(req: IncomingMessage): string | null {
    if (this.key && req.headers["x-adapterscan-key"] === this.key) return null;
    const forwarded = req.headers["x-forwarded-for"];
    const chain = (Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? "")).split(",").map((s) => s.trim()).filter(Boolean);
    return chain.length ? chain[chain.length - 1] : null;
  }

  check(caller: string | null, cls: LimitClass): Verdict {
    if (caller === null) return { ok: true, exempt: true };
    const rule = RULES[cls];
    const t = this.now();
    this.sweep(t);
    const id = `${cls}:${caller}`;
    const perMs = rule.perMinute / 60_000;
    const b = this.buckets.get(id) ?? { tokens: rule.burst, at: t };
    b.tokens = Math.min(rule.burst, b.tokens + (t - b.at) * perMs);
    b.at = t;
    this.buckets.set(id, b);
    if (b.tokens < 1) return { ok: false, limit: rule.perMinute, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000)) };
    b.tokens -= 1;
    return { ok: true, exempt: false, limit: rule.perMinute, remaining: Math.floor(b.tokens), resetSeconds: Math.ceil((rule.burst - b.tokens) / perMs / 1000) };
  }

  /** Allowances that have filled back up are forgotten, so the map holds only recent callers. */
  private sweep(t: number) {
    if (t - this.lastSweep < 60_000) return;
    this.lastSweep = t;
    for (const [id, b] of this.buckets) {
      const rule = RULES[id.slice(0, id.indexOf(":")) as LimitClass];
      if (b.tokens + (t - b.at) * (rule.perMinute / 60_000) >= rule.burst) this.buckets.delete(id);
    }
  }
}

/** Which allowance a path draws on, or null for what isn't limited (pages, built files). */
export function limitClassOf(pathname: string, search: string): LimitClass | null {
  if (pathname.startsWith("/og/")) return "heavy";
  if (/^\/(pic|ipfs|ar)\//.test(pathname)) return "pictures";
  if (pathname.startsWith("/api/")) return /(^|[?&])format=csv(&|$)/.test(search.slice(1)) ? "heavy" : "api";
  return null;
}

/** The headers a response carries: what the allowance is and what's left (draft-ietf-httpapi-ratelimit-headers). */
export function limitHeaders(v: Verdict): Record<string, string> {
  if (v.ok && v.exempt) return {};
  if (!v.ok) return { "retry-after": String(v.retryAfterSeconds), "ratelimit-limit": String(v.limit), "ratelimit-remaining": "0", "ratelimit-reset": String(v.retryAfterSeconds) };
  return { "ratelimit-limit": String(v.limit), "ratelimit-remaining": String(v.remaining), "ratelimit-reset": String(v.resetSeconds) };
}

import { describe, expect, it } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { EventLog, type StoredEvent } from "../src/eventlog.js";
import { ProjectionStore } from "../src/projection.js";
import { fill, overview, projects, projectsCsv, series, windowFrom } from "../src/stats.js";
import { AttestationType, computeAttestationId, computeUbid, Standard } from "../src/ubid.js";
import { ViewCache } from "../src/views.js";

const CHAIN = 31337n;
const ADAPTER = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0" as Address;
const PUNKS = "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9" as Address;
const OTHER = "0x1111111111111111111111111111111111111111" as Address;
const ALICE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const BOB = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address;
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const DAY = 86400;
const T0 = Date.UTC(2026, 8, 1) / 1000; // 2026-09-01, a Tuesday
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

/** A log and a store fed the same events: identities on a few days, one statement, one revocation. */
function world() {
  const log = new EventLog(":memory:", { chainId: CHAIN, adapter: ADAPTER, fromBlock: 1n });
  const store = new ProjectionStore(CHAIN, ADAPTER);
  const events: StoredEvent[] = [];
  let block = 0;
  const push = (day: number, eventName: string, args: Record<string, unknown>) => {
    block++;
    events.push({ blockNumber: BigInt(block), logIndex: 0, blockHash: h(block), blockTimestamp: T0 + day * DAY + 3600, eventName, args });
  };
  const claim = (day: number, bound: Address, tokenId: bigint, emitter: Address) =>
    push(day, "CounterfactualAgentRegistered", { ubid: computeUbid(CHAIN, ADAPTER, Standard.ERC721, bound, tokenId), boundAddress: bound, tokenId, standard: Standard.ERC721, emitter, agentURI: null, metadata: [] });
  claim(0, PUNKS, 1n, ALICE);
  claim(0, PUNKS, 2n, ALICE);
  claim(1, PUNKS, 3n, PUNKS);
  claim(3, OTHER, 1n, BOB);
  push(3, "AgentBound", { agentId: 7n, standard: Standard.ERC721, boundAddress: OTHER, tokenId: 1n, registeredBy: BOB });
  const u1 = computeUbid(CHAIN, ADAPTER, Standard.ERC721, PUNKS, 1n);
  const starBlock = block + 1;
  const starId = computeAttestationId(CHAIN, ADAPTER, BOB, u1, AttestationType.STAR, BigInt(starBlock), ZERO32, "0x01");
  push(4, "Attested", { attester: BOB, attestationType: AttestationType.STAR, ubid: u1, attestationId: starId, variant: ZERO32, data: "0x01" });
  const rateBlock = block + 1;
  const rateId = computeAttestationId(CHAIN, ADAPTER, ALICE, u1, AttestationType.RATING, BigInt(rateBlock), ZERO32, "0x50");
  push(4, "Attested", { attester: ALICE, attestationType: AttestationType.RATING, ubid: u1, attestationId: rateId, variant: ZERO32, data: "0x50" });
  push(8, "AttestationRevoked", { attestationId: starId, revoker: BOB });
  log.append(events, { number: BigInt(block), hash: h(block), timestamp: T0 + 8 * DAY + 3600 }); // the checkpoint is the last event's block
  for (const ev of events) store.apply(ev);
  const client = { readContract: async () => { throw new Error("no chain"); }, getCode: async () => "0x", getStorageAt: async () => undefined } as unknown as PublicClient;
  return { log, store, views: new ViewCache(store, client) };
}
const win = (fromDay: number, toDay: number) => ({ from: T0 + fromDay * DAY, to: T0 + toDay * DAY });

describe("stats", () => {
  it("counts identities per day, zero-filled, with claims and registrations apart", () => {
    const { log } = world();
    const s = series(log.connection, "identities", "day", win(0, 5));
    expect(s.series[0].points).toEqual([
      { t: "2026-09-01", v: 2 }, { t: "2026-09-02", v: 1 }, { t: "2026-09-03", v: 0 }, { t: "2026-09-04", v: 1 }, { t: "2026-09-05", v: 0 },
    ]);
    expect(series(log.connection, "registrations", "day", win(0, 5)).series[0].points.map((p) => p.v)).toEqual([0, 0, 0, 1, 0]);
    expect(series(log.connection, "claims", "day", win(0, 5)).series[0].points.map((p) => p.v)).toEqual([2, 1, 0, 1, 0]);
  });

  it("buckets by week and month, weeks starting Monday", () => {
    const { log } = world();
    const weeks = series(log.connection, "identities", "week", win(0, 14));
    expect(weeks.series[0].points.map((p) => [p.t, p.v])).toEqual([["2026-08-31", 4], ["2026-09-07", 0], ["2026-09-14", 0]]);
    const months = series(log.connection, "attestations", "month", win(0, 40));
    expect(months.series[0].points.map((p) => [p.t, p.v])).toEqual([["2026-09-01", 2], ["2026-10-01", 0]]);
  });

  it("splits attestations by type and identities by project", () => {
    const { log } = world();
    const byType = series(log.connection, "attestations", "day", win(4, 5), { type: true });
    expect(byType.series.map((s) => [s.key, s.points[0].v])).toEqual([["total", 2], ["STAR", 1], ["RATING", 1]]);
    const byProject = series(log.connection, "identities", "day", win(0, 4), { projects: [PUNKS, OTHER] });
    expect(byProject.series.map((s) => [s.key, s.points.map((p) => p.v)])).toEqual([
      ["total", [2, 1, 0, 1]], [PUNKS, [2, 1, 0, 0]], [OTHER, [0, 0, 0, 1]],
    ]);
    const statementsByProject = series(log.connection, "attestations", "day", win(4, 5), { projects: [PUNKS] });
    expect(statementsByProject.series[1]).toEqual({ key: PUNKS, points: [{ t: "2026-09-05", v: 2 }] });
  });

  it("the overview: this window, the one before, and the totals", () => {
    const { log, store } = world();
    const o = overview(log.connection, store, win(3, 6));
    expect(o.figures.identities).toEqual({ value: 1, prior: 3 });
    expect(o.figures.registrations).toEqual({ value: 1, prior: 0 });
    expect(o.figures.attestations).toEqual({ value: 2, prior: 0 });
    expect(o.figures.attesters).toEqual({ value: 2, prior: 0 });
    expect(o.figures.projects).toEqual({ value: 1, prior: 1 }); // OTHER is new in the window; PUNKS was new before it
    expect(o.totals).toMatchObject({ identities: 4, registered: 1, projects: 2, attestations: 2, events: 8, blocksWithoutTimestamp: 0 });
  });

  it("the projects table: counts from the log, reputation from the store, filters, sort, csv", () => {
    const { log, store, views } = world();
    const all = projects(log.connection, store, views, { window: win(0, 10), limit: 10, offset: 0 });
    expect(all.total).toBe(2);
    const punks = all.items.find((r) => r.address === PUNKS)!;
    expect(punks).toMatchObject({ identities: 3, registered: 0, attestations: 2, attesters: 2, ratings: 1, ratingAverage: 80, stars: 0, standards: ["ERC721"] }); // the star was revoked
    expect(punks.firstSeen).toBe(T0 + 3600);
    expect(punks.lastEvent).toBe(T0 + 8 * DAY + 3600); // the revocation touched it last
    const other = all.items.find((r) => r.address === OTHER)!;
    expect(other).toMatchObject({ identities: 1, registered: 1, attestations: 0 });
    expect(projects(log.connection, store, views, { window: win(0, 10), registration: "registered", limit: 10, offset: 0 }).items.map((r) => r.address)).toEqual([OTHER]);
    expect(projects(log.connection, store, views, { window: win(5, 10), active: true, limit: 10, offset: 0 }).items.map((r) => r.address)).toEqual([PUNKS]);
    expect(projects(log.connection, store, views, { window: win(0, 10), sort: "identities", dir: "desc", limit: 1, offset: 0 }).items[0].address).toBe(PUNKS);
    const csv = projectsCsv(all.items);
    expect(csv.split("\n")[0]).toBe("address,name,standards,identities,registered,attestations,attesters,ratingAverage,ratings,stars,firstSeen,lastEvent,trustVerdict,website");
    expect(csv).toContain(`${PUNKS},,ERC721,3,0,2,2,80,1,0,`);
  });

  it("fills buckets and parses windows", () => {
    expect(fill([], "day", win(0, 3)).map((p) => p.t)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(windowFrom(new URLSearchParams(""), 1000 * DAY)).toEqual({ from: 970 * DAY, to: 1000 * DAY });
    expect(windowFrom(new URLSearchParams("from=10&to=20"))).toEqual({ from: 10, to: 20 });
  });
});

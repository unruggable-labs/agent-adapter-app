import type { Address, Hex, PublicClient } from "viem";
import { cardFor, cardIfCached } from "./images.js";
import { contractName, labelsFrom } from "./names.js";
import type { IdentityState, ProjectionStore } from "./projection.js";
import { probeTrustBase, type TrustBase } from "./trustbase.js";
import { SINGLE_OWNER_TOKEN_STANDARDS, Standard, STANDARD_NAMES } from "./ubid.js";

/**
 * Identity views, served from memory.
 *
 * A view has two halves. The first is what the adapter's own events say - the record, its
 * reputation, its wallet link. The store holds it and it costs nothing to read. The second is
 * what the chain says around the record and never emits through the adapter: who holds the
 * controlling token right now, the collection's name, the trust-base reading of the bound
 * contract. Those are RPC reads, and a request must never wait on them - at a thousand
 * identities, a list request that read the chain per row took minutes.
 *
 * So the second half is an advisory, read by the worker here on its own budget and merged into
 * the view at request time. A view with no advisory yet reports those facts as unknown (null),
 * the shape the API already used when a probe failed. The worker reads new identities first,
 * then any a request asked about, then the stalest, at a bounded rate. The work is set by the
 * size of the registry, never by what the controlling contracts do - it follows nothing.
 */

export interface Advisory {
  currentControllerHolder: Address | null;
  currentlyOwnerless: boolean | null;
  trustBase: TrustBase | null;
  contractName: string | null;
  /** When the chain was read. */
  at: number;
}

export interface ViewWorkerOptions {
  /** Advisories in flight at once. */
  concurrency: number;
  /** Pause after each advisory, so the worker shares the RPC with the ingester. */
  gapMs: number;
  /** An advisory older than this is re-read when nothing newer is waiting. */
  staleMs: number;
  /** An advisory a request asked about is re-read if older than this. */
  wantedStaleMs: number;
  tickMs: number;
  log: (line: string) => void;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ViewCache {
  private advisories = new Map<Hex, Advisory>();
  private wanted = new Set<Hex>();
  private inflight = new Set<Hex>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstPassDone = false;
  private readonly startedAt = Date.now();
  readonly opts: ViewWorkerOptions;

  constructor(
    private readonly store: ProjectionStore,
    private readonly client: PublicClient,
    opts: Partial<ViewWorkerOptions> = {},
  ) {
    this.opts = { concurrency: 3, gapMs: 100, staleMs: 10 * 60_000, wantedStaleMs: 30_000, tickMs: 1000, log: () => {}, ...opts };
  }

  /** Start the worker. The tick only matters when the queue has drained: a finished read pumps the next. */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.pump(), this.opts.tickMs);
    this.timer.unref?.();
    this.pump();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A request asked about this identity: re-read its advisory ahead of the round robin. */
  want(ubid: Hex) {
    this.wanted.add(ubid);
  }

  /** The view, now, from memory. Never reads the chain. */
  view(id: IdentityState) {
    const a = this.advisories.get(id.ubid);
    const card = cardIfCached(id);
    return {
      ...id,
      ...labelsFrom(a?.contractName ?? null, id),
      image: card?.image ?? null,
      card,
      standardName: STANDARD_NAMES[id.standard],
      // ACCOUNT needs no chain read: the address is its own holder.
      currentControllerHolder: a?.currentControllerHolder ?? (id.standard === Standard.ACCOUNT ? id.boundAddress : null),
      reputation: this.store.reputation(id.ubid),
      trustBase: a?.trustBase ?? null,
      flags: {
        currentlyOwnerless: a?.currentlyOwnerless ?? null,
        collectionAuthoredAfterOwner: id.collectionAuthoredAfterOwner,
        lastEventCollectionAuthored: id.lastEventCollectionAuthored,
        walletUnverified:
          id.agentWallet !== null && this.store.resolveWallet(id.agentWallet)?.designation?.ubid !== id.ubid,
      },
      /** When the chain facts above were read; null until the worker reaches this identity. */
      advisoryAt: a?.at ?? null,
    };
  }

  views() {
    return [...this.store.identities.values()].map((id) => this.view(id));
  }

  /** How many identities have an advisory - for logs and tests. */
  get read(): number {
    return this.advisories.size;
  }

  /** Read the chain for one identity now. The worker's unit of work; also for callers that must not wait on the worker. */
  async refresh(id: IdentityState): Promise<Advisory> {
    // The card (token metadata, agent card) resolves in the images module's own background
    // fetch with its own TTLs; the worker is where that fetch is started, not a request.
    cardFor(this.client, id);
    let currentlyOwnerless: boolean | null = null;
    let currentControllerHolder: Address | null = null;
    // `currentControllerHolder` is the address that passes the adapter's control check today. It
    // is only expressible where control is a single address: the single-owner token standards,
    // ACCOUNT, and CONTRACT_OWNABLE. Balance standards and CONTRACT_ADMIN have no one holder, and
    // delegate.xyz delegates pass without appearing here - so null is "not expressible", never
    // "nobody".
    if (SINGLE_OWNER_TOKEN_STANDARDS.has(id.standard)) {
      try {
        const owner = (await this.client.readContract({
          address: id.boundAddress,
          abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] }],
          functionName: "ownerOf",
          args: [id.tokenId],
        })) as Address;
        currentlyOwnerless = owner === ZERO_ADDRESS;
        if (!currentlyOwnerless) currentControllerHolder = owner.toLowerCase() as Address;
      } catch {
        currentlyOwnerless = true;
      }
    } else if (id.standard === Standard.ACCOUNT) {
      currentControllerHolder = id.boundAddress;
    } else if (id.standard === Standard.CONTRACT_OWNABLE) {
      currentControllerHolder = await this.client
        .readContract({
          address: id.boundAddress,
          abi: [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
          functionName: "owner",
        })
        .then((o) => ((o as Address) === ZERO_ADDRESS ? null : ((o as Address).toLowerCase() as Address)))
        .catch(() => null);
    }
    const [trustBase, name] = await Promise.all([
      probeTrustBase(this.client, id.boundAddress).catch(() => null),
      contractName(this.client, id.boundAddress),
    ]);
    const advisory: Advisory = { currentControllerHolder, currentlyOwnerless, trustBase, contractName: name, at: Date.now() };
    this.advisories.set(id.ubid, advisory);
    return advisory;
  }

  /** The next identity worth a read, or nothing: asked-for first, then never-read in registry order, then the stalest. */
  private next(): IdentityState | undefined {
    const now = Date.now();
    for (const ubid of this.wanted) {
      this.wanted.delete(ubid);
      const id = this.store.identities.get(ubid);
      if (!id || this.inflight.has(ubid)) continue;
      const a = this.advisories.get(ubid);
      if (!a || now - a.at > this.opts.wantedStaleMs) return id;
    }
    let oldest: IdentityState | undefined;
    let oldestAt = Infinity;
    for (const id of this.store.identities.values()) {
      if (this.inflight.has(id.ubid)) continue;
      const a = this.advisories.get(id.ubid);
      if (!a) return id;
      if (a.at < oldestAt) {
        oldestAt = a.at;
        oldest = id;
      }
    }
    return oldest && now - oldestAt > this.opts.staleMs ? oldest : undefined;
  }

  private pump() {
    while (this.inflight.size < this.opts.concurrency) {
      const id = this.next();
      if (!id) {
        if (!this.firstPassDone && this.inflight.size === 0 && this.advisories.size >= this.store.identities.size && this.store.identities.size > 0) {
          this.firstPassDone = true;
          this.opts.log(`Advisories: ${this.advisories.size} identities read in ${((Date.now() - this.startedAt) / 1000).toFixed(1)}s`);
        }
        break;
      }
      this.inflight.add(id.ubid);
      this.refresh(id)
        .catch(() => {})
        .then(() => sleep(this.opts.gapMs))
        .finally(() => {
          this.inflight.delete(id.ubid);
          this.pump();
        });
    }
  }
}

export type IdentityView = ReturnType<ViewCache["view"]>;

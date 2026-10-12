import type { Address, Hex, PublicClient } from "viem";
import { collectionFor, type Collection } from "./collection.js";
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
 * the shape the API already used when a probe failed. The worker reads what a request asked
 * about first, then unread identities newest first (the first page of the explorer is the
 * newest), then the stalest, at a bounded rate. The work is set by the
 * size of the registry, never by what the controlling contracts do - it follows nothing.
 *
 * The worker reads in batches. The holder reads - one `ownerOf` per identity, the bulk of the
 * work - go through the chain's Multicall3 when it has one, so a batch of a hundred identities
 * is one RPC call, not a hundred. The per-contract facts (trust base, name, collection document)
 * are cached by address, so a batch bound to the same collection reads them once. The dedicated
 * RPCs are metered: a background re-read of the whole registry every ten minutes was most of
 * the bill, so the background cadence is hours, while an identity someone is looking at is
 * still re-read within `wantedStaleMs`.
 */

export interface Advisory {
  currentControllerHolder: Address | null;
  currentlyOwnerless: boolean | null;
  trustBase: TrustBase | null;
  contractName: string | null;
  /** The bound contract's contractURI document, when it has one. */
  collection: Collection | null;
  /** When the chain was read. */
  at: number;
}

export interface ViewWorkerOptions {
  /** Batches in flight at once. */
  concurrency: number;
  /** Identities per batch: one Multicall3 call for the holders. */
  batch: number;
  /** Pause after each batch, so the worker shares the RPC with the ingester. */
  gapMs: number;
  /** An advisory older than this is re-read when nothing newer is waiting. */
  staleMs: number;
  /** An advisory a request asked about is re-read if older than this. */
  wantedStaleMs: number;
  tickMs: number;
  log: (line: string) => void;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const OWNER_OF_ABI = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const OWNER_ABI = [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
type ContractCall = { address: Address; abi: typeof OWNER_OF_ABI | typeof OWNER_ABI; functionName: "ownerOf" | "owner"; args?: readonly [bigint] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ViewCache {
  private advisories = new Map<Hex, Advisory>();
  private wanted = new Set<Hex>();
  /** The registry newest first, rebuilt when it grows - the order unread identities are taken in. */
  private newest: IdentityState[] = [];
  private inflight = new Set<Hex>();
  private inflightBatches = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstPassDone = false;
  private readonly startedAt = Date.now();
  readonly opts: ViewWorkerOptions;

  constructor(
    private readonly store: ProjectionStore,
    private readonly client: PublicClient,
    opts: Partial<ViewWorkerOptions> = {},
  ) {
    this.opts = { concurrency: 2, batch: 100, gapMs: 250, staleMs: 6 * 60 * 60_000, wantedStaleMs: 30_000, tickMs: 1000, log: () => {}, ...opts };
    this.multicall = Boolean(client.chain?.contracts?.multicall3?.address);
  }

  /** Whether holder reads go through Multicall3. Off where the chain has none, or once it failed. */
  private multicall: boolean;

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

  /** The view for something a request is returning: it is on someone's screen, so it goes to the front. */
  viewWanted(id: IdentityState) {
    this.wanted.add(id.ubid);
    return this.view(id);
  }

  /** Who holds the controller right now, as far as the worker has read. ACCOUNT needs no read: the address is its own holder. */
  holder(id: IdentityState): Address | null {
    return this.advisories.get(id.ubid)?.currentControllerHolder ?? (id.standard === Standard.ACCOUNT ? id.boundAddress : null);
  }

  /** What the worker has read about this identity's chain facts, or null before it gets there. */
  advisoryOf(ubid: Hex): Advisory | null {
    return this.advisories.get(ubid) ?? null;
  }

  /** The cheap part of a view - labels, holder, card - for listing and searching without folding the reputation. */
  summary(id: IdentityState) {
    const a = this.advisories.get(id.ubid);
    return { ...labelsFrom(a?.contractName ?? null, id), holder: this.holder(id), card: cardIfCached(id) };
  }

  /** The view, now, from memory. Never reads the chain. */
  view(id: IdentityState) {
    const a = this.advisories.get(id.ubid);
    const card = cardIfCached(id);
    return {
      ...id,
      ...labelsFrom(a?.contractName ?? null, id),
      // The token's own picture; the collection's where the token has none (yet).
      image: card?.image ?? a?.collection?.image ?? null,
      card,
      collection: a?.collection ?? null,
      standardName: STANDARD_NAMES[id.standard],
      currentControllerHolder: this.holder(id),
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

  /** Read the chain for one identity now, for callers that must not wait on the worker. */
  async refresh(id: IdentityState): Promise<Advisory> {
    await this.refreshMany([id]);
    return this.advisories.get(id.ubid)!;
  }

  /** Read the chain for a batch of identities. The worker's unit of work. */
  async refreshMany(ids: IdentityState[]): Promise<void> {
    // The card (token metadata, agent card) resolves in the images module's own background
    // fetch with its own TTLs; the worker is where that fetch is started, not a request.
    for (const id of ids) cardFor(this.client, id);
    const holders = await this.holders(ids);
    // The per-contract facts, once per address in the batch. Each is cached by address, but a
    // batch bound to one collection must not race a hundred probes past an empty cache.
    const byAddress = new Map<Address, Promise<Pick<Advisory, "trustBase" | "contractName" | "collection">>>();
    for (const id of ids) {
      if (byAddress.has(id.boundAddress)) continue;
      byAddress.set(
        id.boundAddress,
        Promise.all([
          probeTrustBase(this.client, id.boundAddress).catch(() => null),
          contractName(this.client, id.boundAddress),
          collectionFor(this.client, id.boundAddress).catch(() => null),
        ]).then(([trustBase, contractName, collection]) => ({ trustBase, contractName, collection })),
      );
    }
    for (const id of ids) {
      const contract = await byAddress.get(id.boundAddress)!;
      const h = holders.get(id.ubid) ?? { currentControllerHolder: null, currentlyOwnerless: null };
      this.advisories.set(id.ubid, { ...h, ...contract, at: Date.now() });
    }
  }

  /**
   * Who controls each identity right now. `currentControllerHolder` is the address that passes
   * the adapter's control check today. It is only expressible where control is a single
   * address: the single-owner token standards, ACCOUNT, and CONTRACT_OWNABLE. Balance standards
   * and CONTRACT_ADMIN have no one holder, and delegate.xyz delegates pass without appearing
   * here - so null is "not expressible", never "nobody".
   */
  private async holders(ids: IdentityState[]): Promise<Map<Hex, Pick<Advisory, "currentControllerHolder" | "currentlyOwnerless">>> {
    const out = new Map<Hex, Pick<Advisory, "currentControllerHolder" | "currentlyOwnerless">>();
    const calls: { id: IdentityState; contract: ContractCall; token: boolean }[] = [];
    for (const id of ids) {
      if (SINGLE_OWNER_TOKEN_STANDARDS.has(id.standard)) {
        calls.push({ id, token: true, contract: { address: id.boundAddress, abi: OWNER_OF_ABI, functionName: "ownerOf", args: [id.tokenId] } });
      } else if (id.standard === Standard.ACCOUNT) {
        out.set(id.ubid, { currentControllerHolder: id.boundAddress, currentlyOwnerless: null });
      } else if (id.standard === Standard.CONTRACT_OWNABLE) {
        calls.push({ id, token: false, contract: { address: id.boundAddress, abi: OWNER_ABI, functionName: "owner" } });
      } else {
        out.set(id.ubid, { currentControllerHolder: null, currentlyOwnerless: null });
      }
    }
    const results = await this.readMany(calls.map((c) => c.contract));
    calls.forEach(({ id, token }, i) => {
      const owner = results[i];
      const holder = owner && owner !== ZERO_ADDRESS ? (owner.toLowerCase() as Address) : null;
      // A token whose ownerOf reverts or answers zero has no one holding it: burned or never minted.
      out.set(id.ubid, { currentControllerHolder: holder, currentlyOwnerless: token ? holder === null : null });
    });
    return out;
  }

  /** The calls' address results, null where one failed: one Multicall3 call where the chain has it, else one call each. */
  private async readMany(contracts: ContractCall[]): Promise<(Address | null)[]> {
    if (contracts.length === 0) return [];
    if (this.multicall) {
      try {
        const results = await this.client.multicall({ contracts, allowFailure: true, batchSize: 0 });
        return results.map((r) => (r.status === "success" ? (r.result as Address) : null));
      } catch (e) {
        // Not deployed after all, or the RPC refuses it: fall back for good rather than retry it every batch.
        this.multicall = false;
        this.opts.log(`Multicall3 failed, reading one call at a time: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
    }
    return Promise.all(contracts.map((c) => this.client.readContract(c).then((r) => r as Address).catch(() => null)));
  }

  /** The next batch worth a read, possibly empty: asked-for first, then never-read newest first, then the stalest. */
  private nextBatch(): IdentityState[] {
    const now = Date.now();
    if (this.newest.length !== this.store.identities.size) this.newest = [...this.store.identities.values()].reverse();
    const out: IdentityState[] = [];
    const taken = new Set<Hex>();
    const take = (id: IdentityState) => {
      out.push(id);
      taken.add(id.ubid);
      return out.length >= this.opts.batch;
    };
    for (const ubid of this.wanted) {
      const id = this.store.identities.get(ubid);
      if (!id) {
        this.wanted.delete(ubid);
        continue;
      }
      if (this.inflight.has(ubid)) continue; // keep the interest; the read in flight may be older than the ask
      this.wanted.delete(ubid);
      const a = this.advisories.get(ubid);
      if ((!a || now - a.at > this.opts.wantedStaleMs) && take(id)) return out;
    }
    const stale: { id: IdentityState; at: number }[] = [];
    for (const id of this.newest) {
      if (this.inflight.has(id.ubid) || taken.has(id.ubid)) continue;
      const a = this.advisories.get(id.ubid);
      if (!a) {
        if (take(id)) return out;
      } else if (now - a.at > this.opts.staleMs) stale.push({ id, at: a.at });
    }
    stale.sort((x, y) => x.at - y.at);
    for (const { id } of stale) if (take(id)) break;
    return out;
  }

  private pump() {
    while (this.inflightBatches < this.opts.concurrency) {
      const ids = this.nextBatch();
      if (ids.length === 0) {
        if (!this.firstPassDone && this.inflightBatches === 0 && this.advisories.size >= this.store.identities.size && this.store.identities.size > 0) {
          this.firstPassDone = true;
          this.opts.log(`Advisories: ${this.advisories.size} identities read in ${((Date.now() - this.startedAt) / 1000).toFixed(1)}s`);
        }
        break;
      }
      this.inflightBatches++;
      for (const id of ids) this.inflight.add(id.ubid);
      this.refreshMany(ids)
        .catch(() => {})
        .then(() => sleep(this.opts.gapMs))
        .finally(() => {
          for (const id of ids) this.inflight.delete(id.ubid);
          this.inflightBatches--;
          this.pump();
        });
    }
  }
}

export type IdentityView = ReturnType<ViewCache["view"]>;

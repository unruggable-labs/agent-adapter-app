import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, type Address, type Hex, type PublicClient } from "viem";
import { AdvisoryStore, type CardFact, type ContractFacts, type HolderFact, type TxRefFact } from "./advisories.js";
import { collectionFor, type Collection } from "./collection.js";
import { cardKey, resolveCard, type Card } from "./images.js";
import { contractName, labelsFrom } from "./names.js";
import type { IdentityState, ProjectionStore } from "./projection.js";
import { probeTrustBase, type TrustBase } from "./trustbase.js";
import { SINGLE_OWNER_TOKEN_STANDARDS, Standard, STANDARD_NAMES } from "./ubid.js";
import type { Dirty } from "./watch.js";

/**
 * Identity views, served from what has been indexed.
 *
 * A view has two halves. The first is what the adapter's own events say - the record, its
 * reputation, its wallet link. The store holds it and it costs nothing to read. The second is
 * what the chain says around the record and never emits through the adapter: who holds the
 * controlling token right now, the collection's name, the trust-base reading of the bound
 * contract, the token's card. Those are RPC reads, and no request and no page view makes one.
 *
 * So the second half is an advisory, read by the worker here and kept in the advisory store
 * (advisories.ts, the network's SQLite file), which a request reads. A view with no advisory yet
 * reports those facts as unknown (null). The worker reads, in order: records the collection
 * watcher (watch.ts) says changed - a transfer, an upgrade, a metadata update; records never read,
 * newest first (the explorer's first page is the newest); then the stalest, once a day, as the
 * backstop for contracts that change without an event. What it reads is set by the size of the
 * registry and by what the bound contracts emit, never by who is looking.
 *
 * The worker reads in batches. The holder reads - one `ownerOf` per identity, the bulk of the
 * work - go through the chain's Multicall3 when it has one, so a batch of a hundred identities
 * is one RPC call, not a hundred. The per-contract facts (trust base, name, collection document)
 * are kept per address, so a batch bound to the same collection reads them once, and only when
 * they are missing, marked or a day old. A card is read when it is missing, marked, a day old,
 * or its record's agent URI changed.
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
  /** Anything older than this is read again when nothing marked or unread is waiting: the backstop. */
  staleMs: number;
  /** A card or collection document that wasn't there is looked for again after this. */
  missStaleMs: number;
  /** Referenced transactions checked per tick. */
  txRefBatch: number;
  /** After the RPC fails a read (rate limit, timeout), wait this long before trying that record again. */
  retryMs: number;
  tickMs: number;
  log: (line: string) => void;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO32 = `0x${"00".repeat(32)}`;
const OWNER_OF_ABI = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const OWNER_ABI = [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
type ContractCall = { address: Address; abi: typeof OWNER_OF_ABI | typeof OWNER_ABI; functionName: "ownerOf" | "owner"; args?: readonly [bigint] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** One-call-each reads in flight at once, where there is no Multicall3: a metered RPC counts requests per second. */
const FALLBACK_CONCURRENCY = 5;

/**
 * Did the contract answer, with a revert or with nothing? That is an answer: no holder. Anything
 * else - a rate limit, a timeout, a 5xx - is the RPC failing to ask, and says nothing about the token.
 */
function contractAnswered(e: unknown): boolean {
  return e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError) !== null;
}
const firstLine = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

export class ViewCache {
  readonly advisories: AdvisoryStore;
  /** What the collection watcher marked and the worker hasn't read yet. */
  private dirty: Dirty = { holders: new Set(), cards: new Set(), contracts: new Set() };
  /** The registry newest first, rebuilt when it grows - the order unread identities are taken in. */
  private newest: IdentityState[] = [];
  private inflight = new Set<Hex>();
  private inflightBatches = 0;
  private checkingRefs = false;
  /** Records whose last read the RPC failed, and when to try again. Not stored: a restart tries at once. */
  private retryAt = new Map<Hex, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstPassDone = false;
  private readonly startedAt = Date.now();
  readonly opts: ViewWorkerOptions;

  constructor(
    private readonly store: ProjectionStore,
    private readonly client: PublicClient,
    opts: Partial<ViewWorkerOptions> = {},
    advisories?: AdvisoryStore,
  ) {
    this.opts = { concurrency: 2, batch: 100, gapMs: 250, staleMs: 24 * 60 * 60_000, missStaleMs: 6 * 60 * 60_000, txRefBatch: 20, retryMs: 2 * 60_000, tickMs: 1000, log: () => {}, ...opts };
    this.advisories = advisories ?? new AdvisoryStore();
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

  /** The collection watcher saw these change: read them ahead of everything else. */
  mark(d: Dirty) {
    for (const u of d.holders) this.dirty.holders.add(u);
    for (const u of d.cards) this.dirty.cards.add(u);
    for (const a of d.contracts) this.dirty.contracts.add(a);
    if (this.timer) this.pump();
  }

  /** Who holds the controller right now, as far as the worker has read. ACCOUNT needs no read: the address is its own holder. */
  holder(id: IdentityState): Address | null {
    return this.advisories.holder(id.ubid)?.holder ?? (id.standard === Standard.ACCOUNT ? id.boundAddress : null);
  }

  /** What the worker has read about this identity's chain facts, or null before it gets there. */
  advisoryOf(ubid: Hex): Advisory | null {
    const id = this.store.identities.get(ubid);
    const h = this.advisories.holder(ubid);
    const c = id ? this.advisories.contract(id.boundAddress) : null;
    if (!h && !c) return null;
    return {
      currentControllerHolder: h?.holder ?? null,
      currentlyOwnerless: h?.ownerless ?? null,
      trustBase: c?.trustBase ?? null,
      contractName: c?.name ?? null,
      collection: c?.collection ?? null,
      at: Math.min(h?.at ?? Infinity, c?.at ?? Infinity),
    };
  }

  /** The stored card for a record, stale or not. */
  private cardOf(id: IdentityState): Card | null {
    return this.advisories.card(id.ubid)?.card ?? null;
  }

  /** Whether a referenced transaction was found on this chain: null until the worker has checked. */
  txRef(hash: Hex): "found" | "missing" | null {
    const r = this.advisories.txRef(hash);
    return r ? (r.found ? "found" : "missing") : null;
  }

  /** The cheap part of a view - labels, holder, card - for listing and searching without folding the reputation. */
  summary(id: IdentityState) {
    const c = this.advisories.contract(id.boundAddress);
    return { ...labelsFrom(c?.name ?? null, id), holder: this.holder(id), card: this.cardOf(id) };
  }

  /** The view, now, from what is stored. Never reads the chain. */
  view(id: IdentityState) {
    const h = this.advisories.holder(id.ubid);
    const c = this.advisories.contract(id.boundAddress);
    const card = this.cardOf(id);
    return {
      ...id,
      ...labelsFrom(c?.name ?? null, id),
      // The token's own picture; the collection's where the token has none (yet).
      image: card?.image ?? c?.collection?.image ?? null,
      card,
      collection: c?.collection ?? null,
      standardName: STANDARD_NAMES[id.standard],
      currentControllerHolder: this.holder(id),
      reputation: this.store.reputation(id.ubid),
      trustBase: c?.trustBase ?? null,
      flags: {
        currentlyOwnerless: h?.ownerless ?? null,
        collectionAuthoredAfterOwner: id.collectionAuthoredAfterOwner,
        lastEventCollectionAuthored: id.lastEventCollectionAuthored,
        walletUnverified:
          id.agentWallet !== null && this.store.resolveWallet(id.agentWallet)?.designation?.ubid !== id.ubid,
      },
      /** When the holder was read; null until the worker reaches this identity. */
      advisoryAt: h?.at ?? null,
      /** Registered by the adapter's implementation before v0.0.17, which emitted no UBID: this one
       *  is derived from the binding, as every UBID is (ProjectionStore.upgradeBlock). */
      legacy: this.store.isLegacy(id.created),
    };
  }

  views() {
    return [...this.store.identities.values()].map((id) => this.view(id));
  }

  /** How many identities have a holder reading - for logs and tests. */
  get read(): number {
    return this.advisories.holderCount;
  }

  /** Read the chain for one identity now, everything about it, for callers that must not wait on the worker. */
  async refresh(id: IdentityState): Promise<Advisory> {
    await this.refreshMany([id], true);
    return this.advisoryOf(id.ubid)!;
  }

  /**
   * Read the chain for a batch of identities: the worker's unit of work. The holders always (one
   * Multicall3 call); the contract facts and cards only where missing, marked or stale - or all of
   * it with `everything`.
   */
  async refreshMany(ids: IdentityState[], everything = false): Promise<void> {
    const now = Date.now();
    const holders = await this.holders(ids);

    const contracts = new Map<Address, ContractFacts>();
    for (const address of new Set(ids.map((i) => i.boundAddress))) {
      if (!everything && !this.contractDue(address, now)) continue;
      const [trustBase, name, collection] = await Promise.all([
        probeTrustBase(this.client, address).catch(() => null),
        contractName(this.client, address),
        collectionFor(this.client, address).catch(() => null),
      ]);
      contracts.set(address, { trustBase, name, collection, at: Date.now() });
    }

    const cards = new Map<Hex, CardFact>();
    await Promise.all(
      ids
        .filter((id) => everything || this.cardDue(id, now))
        .map(async (id) => cards.set(id.ubid, { key: cardKey(id), card: await resolveCard(this.client, id), at: Date.now() })),
    );

    this.advisories.write({ holders, contracts, cards });
    for (const id of ids) {
      // A holder the RPC failed to read keeps its mark and its old reading, and is tried again later.
      if (holders.has(id.ubid)) {
        this.dirty.holders.delete(id.ubid);
        this.retryAt.delete(id.ubid);
      } else this.retryAt.set(id.ubid, now + this.opts.retryMs);
      if (cards.has(id.ubid)) this.dirty.cards.delete(id.ubid);
    }
    for (const a of contracts.keys()) this.dirty.contracts.delete(a);
  }

  private contractDue(address: Address, now: number): boolean {
    const c = this.advisories.contract(address);
    if (!c || this.dirty.contracts.has(address)) return true;
    // Every contract has a trust-base reading, an EOA included, so none means the RPC failed the probe.
    if (c.trustBase === null) return now - c.at > this.opts.retryMs;
    const missing = c.name === null && c.collection === null;
    return now - c.at > (missing ? this.opts.missStaleMs : this.opts.staleMs);
  }

  private cardDue(id: IdentityState, now: number): boolean {
    const c = this.advisories.card(id.ubid);
    if (!c || c.key !== cardKey(id) || this.dirty.cards.has(id.ubid)) return true;
    return now - c.at > (c.card ? this.opts.staleMs : this.opts.missStaleMs);
  }

  /**
   * Who controls each identity right now. `holder` is the address that passes the adapter's
   * control check today. It is only expressible where control is a single address: the
   * single-owner token standards, ACCOUNT, and CONTRACT_OWNABLE. Balance standards and
   * CONTRACT_ADMIN have no one holder, and delegate.xyz delegates pass without appearing here -
   * so null is "not expressible", never "nobody".
   */
  private async holders(ids: IdentityState[]): Promise<Map<Hex, HolderFact>> {
    const out = new Map<Hex, HolderFact>();
    const at = Date.now();
    const calls: { id: IdentityState; contract: ContractCall; token: boolean }[] = [];
    for (const id of ids) {
      if (SINGLE_OWNER_TOKEN_STANDARDS.has(id.standard)) {
        calls.push({ id, token: true, contract: { address: id.boundAddress, abi: OWNER_OF_ABI, functionName: "ownerOf", args: [id.tokenId] } });
      } else if (id.standard === Standard.ACCOUNT) {
        out.set(id.ubid, { holder: id.boundAddress, ownerless: null, at });
      } else if (id.standard === Standard.CONTRACT_OWNABLE) {
        calls.push({ id, token: false, contract: { address: id.boundAddress, abi: OWNER_ABI, functionName: "owner" } });
      } else {
        out.set(id.ubid, { holder: null, ownerless: null, at });
      }
    }
    const results = await this.readMany(calls.map((c) => c.contract));
    let unread = 0;
    calls.forEach(({ id, token }, i) => {
      const owner = results[i];
      if (owner === undefined) {
        unread++; // the RPC didn't answer: no reading, rather than a wrong one
        return;
      }
      const holder = owner && owner !== ZERO_ADDRESS ? (owner.toLowerCase() as Address) : null;
      // A token whose ownerOf reverts or answers zero has no one holding it: burned or never minted.
      out.set(id.ubid, { holder, ownerless: token ? holder === null : null, at });
    });
    if (unread > 0) this.opts.log(`Holders: the RPC failed ${unread} of ${calls.length} reads; trying them again in ${Math.round(this.opts.retryMs / 1000)}s`);
    return out;
  }

  /**
   * The calls' address results: null where the contract answered with a revert (no holder),
   * undefined where the RPC failed to ask. One Multicall3 call where the chain has it, else a few
   * calls at a time. Multicall3 is given up only when the contract itself fails - a rate-limited
   * batch is retried later as a batch, not turned into a hundred single calls.
   */
  private async readMany(contracts: ContractCall[]): Promise<(Address | null | undefined)[]> {
    if (contracts.length === 0) return [];
    if (this.multicall) {
      try {
        const results = await this.client.multicall({ contracts, allowFailure: true, batchSize: 0 });
        // Inside a batch that ran, a failed call is the contract answering - a revert - never the RPC.
        return results.map((r) => (r.status === "success" ? (r.result as Address) : null));
      } catch (e) {
        if (!contractAnswered(e)) {
          this.opts.log(`Multicall3 batch failed (RPC), trying again later: ${firstLine(e)}`);
          return contracts.map(() => undefined);
        }
        // Not deployed after all: fall back for good rather than retry it every batch.
        this.multicall = false;
        this.opts.log(`Multicall3 is not usable here, reading a few calls at a time: ${firstLine(e)}`);
      }
    }
    const out: (Address | null | undefined)[] = [];
    for (let i = 0; i < contracts.length; i += FALLBACK_CONCURRENCY) {
      const part = await Promise.all(
        contracts.slice(i, i + FALLBACK_CONCURRENCY).map((c) =>
          this.client.readContract(c).then((r) => r as Address, (e) => (contractAnswered(e) ? null : undefined)),
        ),
      );
      out.push(...part);
    }
    return out;
  }

  /** The next batch worth a read, possibly empty: marked first, then never-read newest first, then the stale. */
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
    const marked = (id: IdentityState) => this.dirty.holders.has(id.ubid) || this.dirty.cards.has(id.ubid) || this.dirty.contracts.has(id.boundAddress);
    for (const ubid of [...this.dirty.holders, ...this.dirty.cards]) {
      const id = this.store.identities.get(ubid);
      if (!id) {
        this.dirty.holders.delete(ubid);
        this.dirty.cards.delete(ubid);
        continue;
      }
      if (this.inflight.has(ubid) || taken.has(ubid) || this.backingOff(ubid, now)) continue;
      if (take(id)) return out;
    }
    const stale: { id: IdentityState; at: number }[] = [];
    for (const id of this.newest) {
      if (this.inflight.has(id.ubid) || taken.has(id.ubid) || this.backingOff(id.ubid, now)) continue;
      const h = this.advisories.holder(id.ubid);
      if (!h || marked(id) || this.cardDue(id, now) || (this.contractDue(id.boundAddress, now) && !this.inflightAddress(id.boundAddress))) {
        if (take(id)) return out;
      } else if (now - h.at > this.opts.staleMs) stale.push({ id, at: h.at });
    }
    stale.sort((x, y) => x.at - y.at);
    for (const { id } of stale) if (take(id)) break;
    return out;
  }

  private backingOff(ubid: Hex, now: number): boolean {
    return (this.retryAt.get(ubid) ?? 0) > now;
  }

  /** A batch in flight is already reading this address's contract facts. */
  private inflightAddress(address: Address): boolean {
    for (const u of this.inflight) if (this.store.identities.get(u)?.boundAddress === address) return true;
    return false;
  }

  /** Referenced transactions the worker hasn't checked: a found one stays found; a missing one is asked again after a day. */
  private dueRefs(now: number): Hex[] {
    const out: Hex[] = [];
    for (const a of this.store.attestations.values()) {
      for (const hash of referencesIn(a.attestationType, a.variant, a.data)) {
        const r: TxRefFact | null = this.advisories.txRef(hash);
        if (!r || (!r.found && now - r.at > this.opts.staleMs)) out.push(hash);
        if (out.length >= this.opts.txRefBatch) return out;
      }
    }
    return out;
  }

  private checkRefs() {
    if (this.checkingRefs) return;
    const due = this.dueRefs(Date.now());
    if (due.length === 0) return;
    this.checkingRefs = true;
    Promise.all(
      [...new Set(due)].map(async (hash) => {
        const found = await this.client.getTransaction({ hash }).then(() => true).catch(() => false);
        return [hash, { found, at: Date.now() }] as const;
      }),
    )
      .then((rows) => this.advisories.write({ txRefs: new Map(rows) }))
      .catch(() => {})
      .finally(() => {
        this.checkingRefs = false;
      });
  }

  private pump() {
    while (this.inflightBatches < this.opts.concurrency) {
      const ids = this.nextBatch();
      if (ids.length === 0) {
        if (!this.firstPassDone && this.inflightBatches === 0 && this.read >= this.store.identities.size && this.store.identities.size > 0) {
          this.firstPassDone = true;
          this.opts.log(`Advisories: ${this.read} identities read in ${((Date.now() - this.startedAt) / 1000).toFixed(1)}s`);
        }
        // Nothing else waiting: the references, a few at a time.
        if (this.inflightBatches === 0) this.checkRefs();
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

/**
 * The transaction hashes a statement cites: a rating's or review's variant slot, an interaction's
 * reference bytes. Zero is "no reference".
 */
export function referencesIn(attestationType: number, variant: Hex, data: Hex): Hex[] {
  // RATING (3) and REVIEW (4) cite through the variant. INTERACTION (5) carries it after the
  // score byte, and falls back to the variant when its payload is too short - as the app reads it.
  let ref: string | null = null;
  if (attestationType === 3 || attestationType === 4) ref = variant;
  else if (attestationType === 5) ref = data.length >= 68 ? "0x" + data.slice(4, 68) : variant;
  return ref && ref.toLowerCase() !== ZERO32 ? [ref.toLowerCase() as Hex] : [];
}

export type IdentityView = ReturnType<ViewCache["view"]>;

import type { Address, Hex, PublicClient } from "viem";
import type { AdvisoryStore } from "./advisories.js";
import type { ProjectionStore } from "./projection.js";
import { Standard } from "./ubid.js";

/**
 * Follows the contracts records are bound to, so a page never has to ask the chain who holds
 * the deed today.
 *
 * The adapter doesn't see a token change hands - that happens in the collection's own
 * contract. So the watcher asks for the events that mean a fact around a record changed: a
 * transfer (the holder), an ownership transfer (a CONTRACT_OWNABLE holder), an upgrade (the
 * trust base), a metadata update (the card), a contractURI update (the collection document).
 * It doesn't read the new value out of the event; it marks the record for the view worker to
 * re-read, which keeps the per-standard quirks (batches, the single-owner F variants) in one
 * place and reads the state as it is now.
 *
 * Only contracts with a record bound to them are followed - never collections in general - and
 * only on a slow cadence: a sale can show up minutes late, a new review shouldn't. One
 * eth_getLogs takes a list of addresses, so a scan is one call per `chunk` contracts per
 * `maxRange` blocks, however many records they carry. Past `maxAddresses` the contracts with
 * the fewest records drop off the list and rely on the worker's slow sweep instead, so a chain
 * where binding gets popular can't run up the RPC bill.
 */

export interface Dirty {
  /** Records whose holder should be read again. */
  holders: Set<Hex>;
  /** Records whose card should be fetched again. */
  cards: Set<Hex>;
  /** Contracts whose facts (trust base, name, collection document) should be read again. */
  contracts: Set<Address>;
}

export interface WatchOptions {
  /** Addresses per eth_getLogs. Robinhood's public RPC takes 1,000 and refuses 5,000. */
  chunk: number;
  /** Blocks per eth_getLogs, as the ingester's backfill. */
  maxRange: bigint;
  /** The most contracts followed on one chain. */
  maxAddresses: number;
  /** Holder reads per worker batch, for pricing a re-read of everything against a scan. */
  batch: number;
  log: (line: string) => void;
}

const topic = (signature: string, hash: Hex) => ({ signature, hash });
/** topic0 of each event that changes a fact around a record. Hashes are keccak256 of the signature. */
const EVENTS = {
  // ERC-721 Transfer has three indexed fields; ERC-20's (same topic0) has two and is skipped.
  transfer: topic("Transfer(address,address,uint256)", "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"),
  transfer6909: topic("Transfer(address,address,address,uint256,uint256)", "0x1b3d7edb2e9c0b0e7c525b20aaaef0f5940d2ed71663c7d39266ecafac728859"),
  transferSingle: topic("TransferSingle(address,address,address,uint256,uint256)", "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62"),
  transferBatch: topic("TransferBatch(address,address,address,uint256[],uint256[])", "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb"),
  ownershipTransferred: topic("OwnershipTransferred(address,address)", "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0"),
  upgraded: topic("Upgraded(address)", "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b"),
  beaconUpgraded: topic("BeaconUpgraded(address)", "0x1cf3b03a6cf19fa2baba4df148e9dcabedea7f8a5c07840e207e5c089be95d3e"),
  metadataUpdate: topic("MetadataUpdate(uint256)", "0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7"),
  batchMetadataUpdate: topic("BatchMetadataUpdate(uint256,uint256)", "0x6bd5c950a8d8df17f772f5af37cb3655737899cbf903264b9795592da439661c"),
  uri: topic("URI(string,uint256)", "0x6bb7ff708619ba0610cba295a58592e0451dee2622938c8755667688daf3529b"),
  contractUriUpdated: topic("ContractURIUpdated()", "0xa5d4097edda6d87cb9329af83fb3712ef77eeb13738ffe43cc35a4ce305ad962"),
};
export const WATCHED_TOPICS: Hex[] = Object.values(EVENTS).map((e) => e.hash);

interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
}

const word = (data: Hex, i: number) => BigInt("0x" + (data.slice(2 + i * 64, 2 + (i + 1) * 64) || "0"));

export class CollectionWatcher {
  readonly opts: WatchOptions;
  /** address → tokenId → the records bound to that token. Rebuilt when the registry grows. */
  private index = new Map<Address, Map<bigint, Hex[]>>();
  private indexedSize = -1;
  private list: Address[] = [];
  private capped = false;

  constructor(
    private readonly store: ProjectionStore,
    private readonly client: PublicClient,
    private readonly advisories: AdvisoryStore,
    opts: Partial<WatchOptions> = {},
  ) {
    this.opts = { chunk: 500, maxRange: 10_000n, maxAddresses: 5_000, batch: 100, log: () => {}, ...opts };
  }

  /** The contracts followed: every bound address but plain accounts, most records first, up to the cap. */
  watched(): Address[] {
    this.reindex();
    return this.list;
  }

  private reindex() {
    if (this.indexedSize === this.store.identities.size) return;
    this.indexedSize = this.store.identities.size;
    const index = new Map<Address, Map<bigint, Hex[]>>();
    for (const id of this.store.identities.values()) {
      if (id.standard === Standard.ACCOUNT) continue; // an account has no token to move
      let tokens = index.get(id.boundAddress);
      if (!tokens) index.set(id.boundAddress, (tokens = new Map()));
      tokens.set(id.tokenId, [...(tokens.get(id.tokenId) ?? []), id.ubid]);
    }
    const count = (a: Address) => [...index.get(a)!.values()].reduce((n, u) => n + u.length, 0);
    const ranked = [...index.keys()].sort((a, b) => count(b) - count(a) || (a < b ? -1 : 1));
    const list = ranked.slice(0, this.opts.maxAddresses);
    if (ranked.length > list.length && !this.capped) {
      this.opts.log(`Watch: ${ranked.length} bound contracts, following the ${list.length} with the most records; the rest rely on the daily re-read`);
    }
    this.capped = ranked.length > list.length;
    this.index = new Map(list.map((a) => [a, index.get(a)!]));
    this.list = list;
  }

  /**
   * Scan everything after the last scan up to `to` - the block the ingester has synced, so the
   * watcher never runs ahead of the records it maps events onto. The first scan only records
   * where it starts: the worker's first read of each record is the starting state.
   */
  async scan(to: bigint): Promise<Dirty> {
    const dirty: Dirty = { holders: new Set(), cards: new Set(), contracts: new Set() };
    const from = this.advisories.watchedTo === null ? null : this.advisories.watchedTo + 1n;
    if (from === null) {
      this.advisories.write({ watchedTo: to });
      return dirty;
    }
    if (to < from) return dirty;
    const addresses = this.watched();
    if (addresses.length === 0) {
      this.advisories.write({ watchedTo: to });
      return dirty;
    }

    // After a long stop the gap can cost more calls than reading every holder again. Then do that.
    const chunks = Math.ceil(addresses.length / this.opts.chunk);
    const ranges = Number((to - from) / this.opts.maxRange) + 1;
    const records = [...this.index.values()].reduce((n, t) => n + [...t.values()].reduce((m, u) => m + u.length, 0), 0);
    if (chunks * ranges > Math.ceil(records / this.opts.batch) + addresses.length) {
      this.opts.log(`Watch: ${to - from + 1n} blocks behind; re-reading the ${records} records instead of scanning`);
      for (const [address, tokens] of this.index) {
        dirty.contracts.add(address);
        for (const ubids of tokens.values()) for (const u of ubids) dirty.holders.add(u);
      }
      this.advisories.write({ watchedTo: to });
      return dirty;
    }

    for (let start = from; start <= to; start += this.opts.maxRange) {
      const end = start + this.opts.maxRange - 1n > to ? to : start + this.opts.maxRange - 1n;
      for (let i = 0; i < addresses.length; i += this.opts.chunk) {
        const logs = (await this.client.request({
          method: "eth_getLogs",
          params: [{ address: addresses.slice(i, i + this.opts.chunk), fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: [WATCHED_TOPICS] }],
        } as never)) as RawLog[];
        for (const log of logs) this.mark(log, dirty);
      }
      // Each range is kept as it completes, so a failed scan resumes where it stopped.
      this.advisories.write({ watchedTo: end });
    }
    return dirty;
  }

  /** What one log means for the records bound to its contract. */
  private mark(log: RawLog, dirty: Dirty) {
    const address = log.address.toLowerCase() as Address;
    const tokens = this.index.get(address);
    if (!tokens) return;
    const t0 = log.topics[0];
    const token = (id: bigint, into: Set<Hex>) => tokens.get(id)?.forEach((u) => into.add(u));
    const all = (into: Set<Hex>) => tokens.forEach((ubids) => ubids.forEach((u) => into.add(u)));
    try {
      switch (t0) {
        case EVENTS.transfer.hash:
          if (log.topics.length === 4) token(BigInt(log.topics[3]), dirty.holders);
          break;
        case EVENTS.transfer6909.hash:
          if (log.topics.length === 4) token(BigInt(log.topics[3]), dirty.holders);
          break;
        case EVENTS.transferSingle.hash:
          token(word(log.data, 0), dirty.holders);
          break;
        case EVENTS.transferBatch.hash: {
          // (uint256[] ids, uint256[] values): the ids array's offset, then its length, then the ids.
          const at = Number(word(log.data, 0)) / 32;
          const n = Number(word(log.data, at));
          for (let k = 0; k < n && k < 10_000; k++) token(word(log.data, at + 1 + k), dirty.holders);
          break;
        }
        case EVENTS.ownershipTransferred.hash:
          all(dirty.holders);
          break;
        case EVENTS.upgraded.hash:
        case EVENTS.beaconUpgraded.hash:
          dirty.contracts.add(address);
          break;
        case EVENTS.metadataUpdate.hash:
          token(word(log.data, 0), dirty.cards);
          break;
        case EVENTS.batchMetadataUpdate.hash: {
          const lo = word(log.data, 0);
          const hi = word(log.data, 1);
          for (const [id, ubids] of tokens) if (id >= lo && id <= hi) ubids.forEach((u) => dirty.cards.add(u));
          break;
        }
        case EVENTS.uri.hash:
          if (log.topics.length === 2) token(BigInt(log.topics[1]), dirty.cards);
          break;
        case EVENTS.contractUriUpdated.hash:
          dirty.contracts.add(address);
          break;
      }
    } catch {
      // A malformed log from a contract we don't control: nothing to mark.
    }
  }
}

# Adapter8004 v0.0.17 — Indexer Projection Rules

**Status:** working draft, written alongside the reference indexer in this package. The contract
prescribes only what its interface comments state; everything else here is this indexer's projection
policy, recorded so a second implementation can conform. Rules marked **(contract)** restate the
adapter's own documentation; rules marked **(policy)** are choices this indexer makes and surfaces —
they never suppress data.

The adapter is emit-only for everything except `Binding` storage, so **the indexer is the database,
not a cache**: two conforming indexers fed the same logs must agree on every projected state.

## 1. Identity model

- **(contract)** The identity of a claim is its UBID:
  `keccak256(abi.encode(adapterInteroperableAddress, standard, boundAddress, tokenId))`, with
  `standard` as the `IERC8217.Standard` uint8 and the adapter bytes as the ERC-7930 v1
  Interoperable Address. Consumers key on the UBID, never on `(boundAddress, tokenId)`.
- **(contract)** The UBID is chain- and adapter-scoped by the ERC-7930 bytes. Never merge identities
  across chains or adapter deployments.
- **(contract)** A registered agent's `bindingHashOf(agentId)` derives the same UBID, so an
  `AgentBound` whose stored binding shares the coordinates **joins** the counterfactual history —
  one identity row, both statuses. No link assertion exists; the join is by construction.
- **(contract)** `Standard` and `AttestationType` numbering is identity-critical and append-only.

## 2. Ordering and integrity

- **O-1 (contract).** Total order by `(blockNumber, logIndex)`. Nothing else — not tx position,
  not timestamps.
- **O-2 (policy).** Reorg handling is replay: discard the store and re-apply the canonical log.
  Equivalent-to-fresh-replay is the conformance requirement.
- **I-1 (contract).** Every counterfactual event and `WalletUBIDSet` carries its full coordinates,
  so a single log line is self-verifying. Recompute the UBID from the event's own
  `(standard, boundAddress, tokenId)` fields; **drop** (and count) any event whose recomputation
  does not match its hash topic. Same for `Attested`: recompute the `attestationId` from the event
  fields plus its block number and drop mismatches.

## 3. Counterfactual fold (per UBID, in O-1 order)

- **R-1 (contract).** `CounterfactualAgentRegistered` is a full re-statement: sets `claimed`,
  replaces `agentURI`, and **replaces** the metadata map with exactly the carried entries.
- **R-2 (contract).** `URISet` replaces the URI; `MetadataSet` and each batch entry upsert one
  key; `WalletSet`/`WalletUnset` act on the wallet field alone (field-level — there is no
  whole-claim tombstone).
- **R-3 (contract).** Latest event wins, per UBID, per field. There is **no authority
  subordination** in v0.0.17: collection-authored and owner-authored events rank equally.
- **R-4 (policy).** Field events that precede any registration are retained and surfaced with
  `claimed: false`, never hidden. Hiding data the chain contains is how two indexers diverge.
- **R-5 (policy — trust flags, token standards only).** An event is *collection-authored* iff
  `emitter == boundAddress`. The indexer tracks, per identity:
  - `collectionAuthoredAfterOwner` — a collection-authored event was applied after an
    owner-authored event existed. This is the burn-reopen signature: the pre-mint window is the
    only legitimate collection-authority period, so collection speech after an owner has spoken
    is either post-burn or spoofing. Flagged, not suppressed (R-3 is normative).
  - `lastEventCollectionAuthored` — whether the current claim is the collection's.
  - At read time, whether the bound token is *currently* ownerless (`ownerOf` reverting or zero).
  Consumers decide what the flags mean; this indexer's UI treats
  `collectionAuthoredAfterOwner` as "reputation may describe a previous claimant's agent."

## 4. Wallet UBID (reverse resolution)

- **(contract)** Latest `WalletUBIDSet` per account wins; `WalletUBIDCleared` unsets. Since the
  audit round, both are strictly `msg.sender`-only (the acting-for surface was removed), so the
  event's account and actor fields always match; smart-wallet authorization is the wallet's own
  concern. Event ABIs and topics are unchanged, so the projection is unaffected.
- **(contract)** A designation is a self-assertion. It is **verified** only under mutual
  pointing: the designated identity's current `agentWallet` names the account back. The indexer
  exposes both directions and never presents a one-directional claim as verified.

## 5. Attestations (restating `docs/specs/attestation-type-registry-v1.md` §5–§7)

- Collapse: byte-identical content (same attester, ubid, type, variant, data, block) is one
  statement with one id. Re-emitting a revoked id reactivates it in log order.
- `AttestationRevoked` changes state only when `revoker == attester` of the named statement;
  everything else — unknown id, zero id, wrong revoker — is recorded inert history.
- State classes (`CONFIRM_ACCOUNT`, `STAR`, `RATING`): latest live statement per
  `(attester, ubid, type)`; revocation can resurrect an older live statement.
- Stream classes (`REVIEW`, `INTERACTION`): all live statements accumulate.
- Payload validity is read-time: `STAR` ∈ {0,1} (1 byte), `RATING` ∈ [0,100] (1 byte), `REVIEW`
  non-empty UTF-8, `INTERACTION` ≥ 33 bytes (`uint8 score ≤ 100 || bytes32 reference || text`).
  Invalid payloads are excluded from aggregation, never errors.
- Aggregation: `STAR` counts attesters whose live value is 1; `RATING` averages per-attester
  live values.
- `CONFIRM_ACCOUNT` counts only while the identity's **current** forward `account[...]` metadata
  names the attester (live, indexer-mediated check).
- A target UBID matching no identity is **unresolved**, retained, and acquires meaning if a claim
  arrives later. Attest-before-claim is a supported flow, not an anomaly.

## 6. Trust-base disclosure (policy)

Why the burn-reopen pattern is a **flag plus a static probe**, not a demotion rule:

Binding an agent to a token adopts the collection's rules as part of the identity's security
model. The adapter already accepts this shape elsewhere and refuses to second-guess it — an
`ACCOUNT` address can install a 7702 delegation and permanently widen its authority; a
`CONTRACT_OWNABLE` contract can renounce ownership and freeze its identity. A post-burn
collection re-claim is the same shape: an action outside the adapter, taken under rules that
were readable before anyone bound. Demoting collection-authored events after first owner speech
(the earlier D3 design) would also break legitimate burn-and-reissue flows — collections whose
stated rule is that identity follows the reissued token. So latest-wins stays normative and the
indexer's job is **disclosure**, in two tenses:

- **After the fact** — the event-derived flags of §3 R-5 (`collectionAuthoredAfterOwner`,
  `lastEventCollectionAuthored`, read-time ownerless probe).
- **Before the fact** — a static probe of the bound contract (`src/trustbase.ts`). A re-claim
  needs two capabilities at once: (a) tokens can become ownerless (burn), and (b) the contract
  can be made to call the adapter (an outbound-call surface). Both are properties of the code.
  Upgradeability voids any static reading and is its own signal. The rollup verdicts:

  | Verdict | Meaning |
  |---|---|
  | `ruggable` | burnable AND (call surface OR upgradeable) — re-claim possible by code |
  | `unstable` | upgradeable — can acquire both capabilities after identities are bound |
  | `burnable` | tokens can die; no visible way for the collection to speak |
  | `solid` | none detected |
  | `eoa` | no code; for `ACCOUNT` subjects, a 7702 delegation is reported separately |

  Selector presence is a labeled heuristic (false negatives on non-standard dispatch, rare
  false positives on data bytes); the EIP-1967 proxy-slot checks are exact. Third parties who
  rely on an identity's reputation see the same badges, which is what makes assumption-of-risk
  fair: reliance is always "this identity, given its trust base."

## 7. Remaining question for the contract author

`emitter` is the last non-indexed field on counterfactual events. If any consumer ever needs a
filtered backfill by author class (e.g. auditing collection-authored claims at scale), indexing
it would avoid decoding every event body. Cheap now, a topic0 cutover later.

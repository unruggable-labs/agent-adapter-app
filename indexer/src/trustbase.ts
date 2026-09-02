import { toFunctionSelector, type Address, type Hex, type PublicClient } from "viem";

/**
 * Static trust-base probe: what can this identity's bound contract do to the identity later?
 *
 * Rationale (SPEC.md §7): binding an agent to a token adopts the collection's rules as part of
 * the identity's security model. A post-burn re-claim needs TWO capabilities at once — (a) the
 * token can become ownerless, and (b) the contract can be made to call the adapter. Both are
 * properties of the collection's code, so they are disclosable at claim time, not only
 * detectable after the fact. Upgradeability voids any static reading, so it is its own signal.
 *
 * Selector presence is a HEURISTIC: it scans deployed bytecode for the 4-byte selectors below,
 * which yields false negatives on non-standard dispatch and rare false positives on data bytes.
 * The proxy-slot checks are exact. Every consumer-facing surface labels the heuristics as such.
 */

const BURN_SELECTORS = [
  "function burn(uint256)",
  "function burn(address,uint256)",
  "function burn(address,uint256,uint256)", // ERC-1155
  "function burnFrom(address,uint256)",
  "function burnBatch(address,uint256[],uint256[])",
].map(toFunctionSelector);

const ARBITRARY_CALL_SELECTORS = [
  "function execute(address,uint256,bytes)",
  "function executeCall(address,uint256,bytes)",
  "function call(address,uint256,bytes)",
  "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)", // Safe
  "function multicall(bytes[])",
  "function functionCall(address,bytes)",
].map(toFunctionSelector);

const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const EIP1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as Hex;
const ZERO_WORD = `0x${"00".repeat(32)}`;

export interface TrustBase {
  /** No code at the address: a plain EOA subject (meaningful for ACCOUNT bindings). */
  isEoa: boolean;
  /** EIP-7702 delegation designator (0xef0100 || address): the EOA's authority is widened. */
  delegated7702: boolean;
  /** Heuristic: a burn-family selector appears in the deployed bytecode. */
  canBurn: boolean;
  /** Heuristic: a generic outbound-call selector appears in the deployed bytecode. */
  arbitraryCallSurface: boolean;
  /** Exact: an EIP-1967 implementation or beacon slot is set — today's code proves nothing. */
  upgradeable: boolean;
  /**
   * The rollup verdict for token subjects:
   *  - "ruggable": burnable AND a way to make the contract speak (call surface or upgradeable)
   *  - "unstable": upgradeable — it can acquire both capabilities after you bind
   *  - "burnable": tokens can die, but the collection has no visible way to re-claim
   *  - "solid": none of the above detected
   */
  verdict: "ruggable" | "unstable" | "burnable" | "solid" | "eoa";
}

export function analyzeBytecode(code: Hex): Pick<TrustBase, "isEoa" | "delegated7702" | "canBurn" | "arbitraryCallSurface"> {
  const hex = code.toLowerCase();
  if (hex === "0x" || hex.length <= 2) {
    return { isEoa: true, delegated7702: false, canBurn: false, arbitraryCallSurface: false };
  }
  if (hex.startsWith("0xef0100")) {
    return { isEoa: true, delegated7702: true, canBurn: false, arbitraryCallSurface: false };
  }
  const has = (selectors: Hex[]) => selectors.some((s) => hex.includes(s.slice(2).toLowerCase()));
  return {
    isEoa: false,
    delegated7702: false,
    canBurn: has(BURN_SELECTORS),
    arbitraryCallSurface: has(ARBITRARY_CALL_SELECTORS),
  };
}

export function verdictOf(t: Omit<TrustBase, "verdict">): TrustBase["verdict"] {
  if (t.isEoa) return "eoa";
  if (t.canBurn && (t.arbitraryCallSurface || t.upgradeable)) return "ruggable";
  if (t.upgradeable) return "unstable";
  if (t.canBurn) return "burnable";
  return "solid";
}

const cache = new Map<Address, TrustBase>();

export async function probeTrustBase(client: PublicClient, address: Address): Promise<TrustBase> {
  const key = address.toLowerCase() as Address;
  const cached = cache.get(key);
  if (cached) return cached;

  const code = ((await client.getCode({ address })) ?? "0x") as Hex;
  const fromCode = analyzeBytecode(code);
  let upgradeable = false;
  if (!fromCode.isEoa) {
    const [impl, beacon] = await Promise.all([
      client.getStorageAt({ address, slot: EIP1967_IMPLEMENTATION_SLOT }),
      client.getStorageAt({ address, slot: EIP1967_BEACON_SLOT }),
    ]);
    upgradeable = (impl ?? ZERO_WORD) !== ZERO_WORD || (beacon ?? ZERO_WORD) !== ZERO_WORD;
  }
  const partial = { ...fromCode, upgradeable };
  const result: TrustBase = { ...partial, verdict: verdictOf(partial) };
  cache.set(key, result);
  return result;
}

/** For tests and long-running servers: upgradeable targets can change; callers may clear. */
export function clearTrustBaseCache() {
  cache.clear();
}

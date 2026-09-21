import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";

/** The backends the app can face. Each network pairs an indexer API with the RPC the wizard's
 *  probes and the write paths use. On the local devnet, demo personas sign with anvil
 *  keys; on public networks the user's connected wallet signs. API bases come from build-time env so a deployed
 *  build points at hosted indexers; the local devnet exists only in dev builds, because nobody
 *  else has our anvil. Toggle persists and reloads. */
interface NetworkConfig {
  label: string;
  apiBase: string;
  rpcUrl: string;
  chain: typeof foundry | typeof sepolia;
  /** true = demo personas sign with anvil keys (local devnet). false = a real connected wallet signs. */
  personaWrites: boolean;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  ...(import.meta.env.DEV
    ? {
        local: {
          label: "Local devnet",
          apiBase: "http://127.0.0.1:8787/api",
          rpcUrl: "http://127.0.0.1:8547",
          chain: foundry,
          personaWrites: true,
        },
      }
    : {}),
  sepolia: {
    label: "Sepolia",
    // dev: the standalone Node indexer; deployed: the same-origin serverless function
    apiBase: import.meta.env.VITE_SEPOLIA_API ?? (import.meta.env.DEV ? "http://127.0.0.1:8788/api" : "/api/sepolia"),
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC ?? "https://gateway.tenderly.co/public/sepolia",
    chain: sepolia,
    personaWrites: false,
  },
};

export type NetworkId = string;
const stored = localStorage.getItem("aa-network");
export const networkId: NetworkId = stored && NETWORKS[stored] ? stored : Object.keys(NETWORKS)[0];
export const NETWORK = NETWORKS[networkId];

export function switchNetwork(id: NetworkId) {
  localStorage.setItem("aa-network", id);
  location.reload(); // clients are module-level; a reload rebuilds everything consistently
}

export const RPC_URL = NETWORK.rpcUrl;

/** Anvil's funded demo accounts — the app's persona switcher. A real deployment swaps this
 *  for an injected-wallet connector; every write path goes through the same `actor` object. */
export const ACTORS = [
  { name: "Alice", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
  { name: "Bob", key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
  { name: "Carol", key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
  { name: "Dave", key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" },
  { name: "Eve", key: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" },
  { name: "PunkBot server", key: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" },
].map((a) => {
  const account = privateKeyToAccount(a.key as Hex);
  return { name: a.name, address: account.address.toLowerCase() as Address, account };
});

export const publicClient = createPublicClient({ chain: NETWORK.chain, transport: http(RPC_URL) });

export function walletFor(actorIndex: number) {
  return createWalletClient({ account: ACTORS[actorIndex].account, chain: NETWORK.chain, transport: http(RPC_URL) });
}

export const adapterAbi = parseAbi([
  "function hashBinding(uint8 standard, address boundAddress, uint256 tokenId) view returns (bytes32)",
  "function register(uint8 standard, address boundAddress, uint256 tokenId, string agentURI) returns (uint256)",
  "function counterfactualRegister(uint8 standard, address boundAddress, uint256 tokenId, string agentURI) returns (bytes32)",
  "function counterfactualSetAgentURI(uint8 standard, address boundAddress, uint256 tokenId, string newURI) returns (bytes32)",
  "function counterfactualSetMetadata(uint8 standard, address boundAddress, uint256 tokenId, string metadataKey, bytes metadataValue) returns (bytes32)",
  "function counterfactualSetAgentWalletAndUBID(uint8 standard, address boundAddress, uint256 tokenId) returns (bytes32)",
  "function counterfactualUnsetAgentWallet(uint8 standard, address boundAddress, uint256 tokenId) returns (bytes32)",
  "function setWalletUBID(uint8 standard, address boundAddress, uint256 tokenId) returns (bytes32)",
  "function clearWalletUBID()",
  "function attest(uint8 attestationType, bytes32 ubid, bytes32 variant, bytes data)",
  "function confirmAdditionalAccount(bytes32 ubid)",
  "function revoke(bytes32 attestationId)",
]);

export const erc721Abi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function name() view returns (string)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function mint(address to, uint256 tokenId)",
]);

export const STANDARD_NAMES = ["ERC721", "ERC1155", "ERC6909", "ERC1155F", "ERC6909F", "ACCOUNT", "CONTRACT_OWNABLE", "CONTRACT_ADMIN"];
export const ATTESTATION_TYPES = { CONFIRM_ACCOUNT: 1, STAR: 2, RATING: 3, REVIEW: 4, INTERACTION: 5 } as const;

export const ZERO32 = ("0x" + "00".repeat(32)) as Hex;

/** Persona name for a known demo address — how the local demo stands in for ENS/profiles. */
export function personaName(address: string): string | null {
  return ACTORS.find((a) => a.address === address.toLowerCase())?.name ?? null;
}

/** The one rule for naming an identity anywhere in the app: agent's own name, else what
 *  the bound subject is called. Hashes are for verification surfaces, not for recognition. */
export function displayName(id: { agentName: string | null; subjectLabel: string; standard: number; boundAddress: string }): string {
  if (id.agentName) return id.agentName;
  if (id.standard === 5) {
    const persona = personaName(id.boundAddress);
    if (persona) return `${persona}'s wallet`;
  }
  return id.subjectLabel;
}

/** The control relationship in words: the token/contract is the ownership handle for the
 *  identity, not the agent itself. */
export function controlLine(id: { standard: number; subjectLabel: string }): string {
  if (id.standard <= 4) return `controlled by whoever owns ${id.subjectLabel}`;
  if (id.standard === 5) return `controlled by the address itself`;
  if (id.standard === 6) return `controlled by the contract's owner()`;
  return `controlled by the contract's admins`;
}

/** Huge token ids (30+ digit namehash-style) display hash-style. */
export function shortTokenId(tokenId: string): string {
  return tokenId.length > 12 ? `${tokenId.slice(0, 6)}…${tokenId.slice(-4)}` : tokenId;
}

export function shortHex(h: string | null | undefined, n = 10): string {
  if (!h) return "—";
  return h.length <= n + 2 ? h : `${h.slice(0, n)}…${h.slice(-4)}`;
}

export function toByteHex(n: number): Hex {
  return `0x${n.toString(16).padStart(2, "0")}` as Hex;
}

export function utf8ToHex(s: string): Hex {
  return ("0x" +
    Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/** "1 star", "2 stars". Regular plurals only - the app has no irregular count nouns. */
export function plural(n: number, word: string): string {
  return `${n} ${pluralise(n, word)}`;
}

/** Just the noun, for places that render the number separately (stat tiles). */
export function pluralise(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/** Metadata values are arbitrary bytes. Most are UTF-8 text, so show that when the bytes decode
 *  cleanly and hold no control characters; otherwise the caller falls back to raw hex. */
export function hexToUtf8(h: string): string | null {
  const body = h.startsWith("0x") ? h.slice(2) : h;
  if (body.length === 0 || body.length % 2 !== 0) return null;
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  if (bytes.some((b) => Number.isNaN(b))) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return [...text].some((c) => c.codePointAt(0)! < 0x20) ? null : text;
  } catch {
    return null;
  }
}

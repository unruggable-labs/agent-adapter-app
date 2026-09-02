import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const RPC_URL = "http://127.0.0.1:8547";

/** Anvil's funded demo accounts — the app's persona switcher. A real deployment swaps this
 *  for an injected-wallet connector; every write path goes through the same `actor` object. */
export const ACTORS = [
  { name: "Alice", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
  { name: "Bob", key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
  { name: "Carol", key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
  { name: "Dave", key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" },
  { name: "Eve", key: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" },
].map((a) => {
  const account = privateKeyToAccount(a.key as Hex);
  return { name: a.name, address: account.address.toLowerCase() as Address, account };
});

export const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) });

export function walletFor(actorIndex: number) {
  return createWalletClient({ account: ACTORS[actorIndex].account, chain: foundry, transport: http(RPC_URL) });
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

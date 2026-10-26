import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, foundry, mainnet, robinhood, sepolia } from "viem/chains";

/** The chains the app knows. Each pairs an indexer API (for a chain's own site) with the RPC the
 *  wizard's probes and the write paths use. On the local devnet, demo personas sign with anvil
 *  keys; on public networks the user's connected wallet signs. API bases come from build-time env
 *  so a deployed build points at hosted indexers; the local devnet exists only in dev builds,
 *  because nobody else has our anvil. */
interface NetworkConfig {
  label: string;
  apiBase: string;
  rpcUrl: string;
  chain: typeof foundry | typeof sepolia | typeof mainnet | typeof base | typeof robinhood;
  /** true = demo personas sign with anvil keys (local devnet). false = a real connected wallet signs. */
  personaWrites: boolean;
  /** The public hostname this network is served on. */
  host: string;
  /** live = an indexer follows it. pending = the adapter on this chain is not on v0.0.17 yet. */
  status: "live" | "pending";
  /** One line for the chain picker. */
  blurb: string;
  /** A testnet is its own site; the mainnets are one explorer at adapterscan.com. */
  testnet?: boolean;
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
          host: "localhost",
          status: "live",
          blurb: "The anvil devnet with seeded personas. Dev builds only.",
        },
      }
    : {}),
  sepolia: {
    label: "Sepolia",
    // dev: the standalone Node indexer; deployed: same-origin, Caddy routes by hostname
    apiBase: import.meta.env.VITE_SEPOLIA_API ?? (import.meta.env.DEV ? "http://127.0.0.1:8788/api" : "/api"),
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC ?? "https://gateway.tenderly.co/public/sepolia",
    chain: sepolia,
    personaWrites: false,
    host: "testnet.adapterscan.com",
    status: "live",
    testnet: true,
    blurb: "The testnet. Free to try; nothing here is worth anything.",
  },
  robinhood: {
    label: "Robinhood Chain",
    apiBase: import.meta.env.VITE_ROBINHOOD_API ?? (import.meta.env.DEV ? "http://127.0.0.1:8791/api" : "/api"),
    rpcUrl: import.meta.env.VITE_ROBINHOOD_RPC ?? "https://rpc.mainnet.chain.robinhood.com",
    chain: robinhood,
    personaWrites: false,
    host: "robinhood.adapterscan.com",
    status: "live",
    blurb: "Mainnet. The adapter's first production chain on v0.0.17.",
  },
  base: {
    label: "Base",
    apiBase: import.meta.env.VITE_BASE_API ?? (import.meta.env.DEV ? "http://127.0.0.1:8790/api" : "/api"),
    rpcUrl: import.meta.env.VITE_BASE_RPC ?? "https://base-rpc.publicnode.com",
    chain: base,
    personaWrites: false,
    host: "base.adapterscan.com",
    status: "live",
    blurb: "Mainnet. On v0.0.17 since block 52991843.",
  },
  mainnet: {
    label: "Ethereum",
    apiBase: import.meta.env.VITE_MAINNET_API ?? (import.meta.env.DEV ? "http://127.0.0.1:8789/api" : "/api"),
    rpcUrl: import.meta.env.VITE_MAINNET_RPC ?? "https://ethereum-rpc.publicnode.com",
    chain: mainnet,
    personaWrites: false,
    host: "adapterscan.com",
    status: "pending",
    blurb: "Deployed, but the adapter on Ethereum is not on v0.0.17 yet. Opens once it is upgraded.",
  },
};

export type NetworkId = string;

/**
 * What a hostname is. adapterscan.com is the explorer for every mainnet, served by the hub
 * indexer, which says in its overview which chains it has. testnet.adapterscan.com is Sepolia on
 * its own. stats.adapterscan.com is the usage page. robinhood. and base. were each chain's own
 * site before the hub, and are served as such until their hostnames redirect to the apex. In dev
 * there is no hostname to go by, so VITE_NETWORK picks (hub | local | sepolia | robinhood | base |
 * mainnet | stats), Sepolia by default.
 */
type Site = "hub" | "stats" | NetworkId;
const HOST_SITE: Record<string, Site> = {
  "adapterscan.com": "hub",
  "www.adapterscan.com": "hub",
  "stats.adapterscan.com": "stats",
  "testnet.adapterscan.com": "sepolia",
  "robinhood.adapterscan.com": "robinhood",
  "base.adapterscan.com": "base",
};
const devChoice = import.meta.env.VITE_NETWORK as string | undefined;
const site: Site = import.meta.env.DEV
  ? devChoice === "hub" || devChoice === "stats" ? devChoice : devChoice && NETWORKS[devChoice] ? devChoice : "sepolia"
  : (HOST_SITE[location.hostname] ?? "sepolia");

/** True on adapterscan.com: every mainnet in one explorer. Rows say which chain they're on. */
export const IS_HUB = site === "hub";
/** True on stats.adapterscan.com: the usage page across every chain, no explorer around it. */
export const IS_STATS_HOST = site === "stats";
/** The one chain a chain's own site shows (testnet.adapterscan.com: Sepolia). Null on the hub and the stats host. */
export const HOME: NetworkConfig | null = site === "hub" || site === "stats" ? null : NETWORKS[site];
export const HOME_ID: NetworkId | null = HOME ? site : null;
/** On the local devnet demo personas sign; everywhere else a connected wallet does. */
export const PERSONA_WRITES = HOME?.personaWrites ?? false;

/** The mainnets: what the hub indexes, in the order the app lists them. */
export const MAINNETS: NetworkId[] = ["robinhood", "base", "mainnet"];
/** The hub's API: same-origin in production (Caddy sends the apex's /api to it), its port in dev. */
const HUB_API = import.meta.env.VITE_HUB_API ?? (import.meta.env.DEV ? "http://127.0.0.1:8792/api" : "/api");
/** The API this site's pages ask. */
export const API_BASE: string = HOME ? HOME.apiBase : HUB_API;

/** A chain's config by its slug, as the API names it (robinhood, base, mainnet, sepolia, local). */
export function chainConfig(id: NetworkId): NetworkConfig {
  const n = NETWORKS[id];
  if (!n) throw new Error(`unknown chain ${id}`);
  return n;
}
/** The name people read, for a chain the API names; the slug itself for one this build doesn't know. */
export function chainLabel(id: NetworkId): string {
  return NETWORKS[id]?.label ?? id;
}

/** The networks the picker offers: Robinhood first, then the rest live-before-pending, in declaration order. */
const PICKER_ORDER = ["robinhood", "sepolia", "base", "mainnet"];
export const PUBLIC_NETWORKS = Object.entries(NETWORKS)
  .filter(([, n]) => !n.personaWrites)
  .sort(([a], [b]) => PICKER_ORDER.indexOf(a) - PICKER_ORDER.indexOf(b));

/** Where to ask for one chain's stats from this site: the hub's own API, naming the chain, for
 *  the mainnets; a chain's own API for its own site and for the testnet. The stats page asks each
 *  chain this way and merges the answers. */
export function statsSourceFor(id: NetworkId): { base: string; chain: NetworkId | null } {
  const n = chainConfig(id);
  if (HOME_ID === id || n.personaWrites) return { base: n.apiBase, chain: null };
  if (MAINNETS.includes(id)) return { base: HUB_API, chain: id };
  return { base: import.meta.env.DEV ? n.apiBase : `https://${n.host}/api`, chain: null };
}
/** The explorer a chain's pages live on, for links out of the cross-chain stats page: this one
 *  for the mainnets (and in dev), the testnet's own host for Sepolia. */
export function explorerOriginFor(id: NetworkId): string {
  const n = chainConfig(id);
  if (import.meta.env.DEV || HOME_ID === id || (!HOME && MAINNETS.includes(id))) return "";
  return MAINNETS.includes(id) ? "https://adapterscan.com" : `https://${n.host}`;
}
/** The chains the stats page can show: every live public network. */
export const STATS_NETWORKS: NetworkId[] = PUBLIC_NETWORKS.filter(([, n]) => n.status === "live").map(([id]) => id);

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

const clients = new Map<NetworkId, ReturnType<typeof makeClient>>();
const makeClient = (n: NetworkConfig) => createPublicClient({ chain: n.chain, transport: http(n.rpcUrl) });
/** An RPC client for a chain: only the write paths and the Create wizard's probes use one. Pages read the indexer. */
export function clientFor(id: NetworkId) {
  let c = clients.get(id);
  if (!c) clients.set(id, (c = makeClient(chainConfig(id))));
  return c;
}

/** The anvil key of a demo persona, signing on the local devnet. */
export function walletFor(actorIndex: number) {
  const n = chainConfig("local");
  return createWalletClient({ account: ACTORS[actorIndex].account, chain: n.chain, transport: http(n.rpcUrl) });
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

/** 8004Scan's chain slugs. A chain it doesn't index (the local devnet) gets no link. */
const SCAN_SLUGS: Record<number, string> = { 1: "ethereum", 11155111: "sepolia", 8453: "base", 4663: "robinhood-chain" };

/** The explorer and the docs are one build on two hostnames; each links to the other. In dev both
 *  are served by Vite: the docs at /docs.html. */
const IS_DOCS_HOST = location.hostname.startsWith("docs.");
export const DOCS_URL: string = import.meta.env.DEV ? "/docs.html" : IS_DOCS_HOST ? "/" : `https://docs.${location.hostname.replace(/^(testnet|www|base|robinhood|stats)\./, "")}`;
/** The usage page across every chain. In dev, this chain's own /stats stands in. */
export const STATS_URL: string = import.meta.env.DEV ? "/stats" : `https://stats.${location.hostname.replace(/^(testnet|www|base|robinhood|docs|stats)\./, "")}`;

/** Etherscan's chain hosts. The local devnet has no explorer, so its transactions get no link. */
const EXPLORER: Record<number, string> = { 1: "https://etherscan.io", 11155111: "https://sepolia.etherscan.io", 8453: "https://basescan.org", 4663: "https://robinhoodchain.blockscout.com" };
const EXPLORER_NAME: Record<number, string> = { 1: "Etherscan", 11155111: "Sepolia Etherscan", 8453: "Basescan", 4663: "Blockscout" };

const idOf = (chain: NetworkId) => NETWORKS[chain]?.chain.id ?? 0;

/** What a chain's block explorer is called, for link labels. */
export function explorerName(chain: NetworkId): string {
  return EXPLORER_NAME[idOf(chain)] ?? "block explorer";
}

export function explorerTxUrl(chain: NetworkId, hash: string): string | null {
  const base = EXPLORER[idOf(chain)];
  return base ? `${base}/tx/${hash}` : null;
}

export function explorerBlockUrl(chain: NetworkId, block: string | number | bigint): string | null {
  const base = EXPLORER[idOf(chain)];
  return base ? `${base}/block/${block}` : null;
}

export function explorerAddressUrl(chain: NetworkId, address: string): string | null {
  const base = EXPLORER[idOf(chain)];
  return base ? `${base}/address/${address}` : null;
}

/** The 8004Scan page for an ERC-8004 agent id on a chain, or null where 8004Scan doesn't index it. */
export function scanAgentUrl(chain: NetworkId, agentId: string): string | null {
  const slug = SCAN_SLUGS[idOf(chain)];
  return slug ? `https://8004scan.io/agents/${slug}/${agentId}` : null;
}

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

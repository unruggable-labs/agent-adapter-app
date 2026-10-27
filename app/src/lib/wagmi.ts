import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base, foundry, mainnet, robinhood, sepolia, type AppKitNetwork } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit/react";
import { getBalance } from "@wagmi/core";
import { formatUnits, type Address } from "viem";
import { createConfig, http, type Config } from "wagmi";
import { injected } from "wagmi/connectors";
import { HOME, MAINNETS, NETWORKS } from "./chain";

/**
 * Wallet plumbing is wagmi's wheel: EIP-6963 discovery of injected wallets, account and chain
 * state, switching. The connect UI is Reown AppKit (WalletConnect's modal - the one people
 * already know from other dapps), which needs a project id from cloud.reown.com; set it as
 * VITE_WC_PROJECT_ID at build time. Without one the app still works with injected wallets
 * through its own plain buttons, so a fresh checkout runs before anyone has registered a project.
 */
const projectId = import.meta.env.VITE_WC_PROJECT_ID as string | undefined;
export const appKitEnabled = Boolean(projectId);

// The chains this site shows: a chain's own site offers that one, the multichain explorer every
// mainnet - a write switches the wallet to the chain of the record it is about (tx.ts).
// Offering others would let someone switch to a chain the site can't read.
const APPKIT_NETWORK: Record<number, AppKitNetwork> = { [mainnet.id]: mainnet, [sepolia.id]: sepolia, [base.id]: base, [robinhood.id]: robinhood, [foundry.id]: foundry };
const shown = HOME ? [HOME] : MAINNETS.map((id) => NETWORKS[id]);
const networks = shown.map((n) => APPKIT_NETWORK[n.chain.id]).filter(Boolean) as [AppKitNetwork, ...AppKitNetwork[]];
const transports = {
  [mainnet.id]: http(NETWORKS.mainnet?.rpcUrl),
  [sepolia.id]: http(NETWORKS.sepolia?.rpcUrl),
  [base.id]: http(NETWORKS.base?.rpcUrl),
  [robinhood.id]: http(NETWORKS.robinhood?.rpcUrl),
  [foundry.id]: http(NETWORKS.local?.rpcUrl ?? "http://127.0.0.1:8547"),
};

/**
 * AppKit's adapter reads `balance.formatted` from wagmi's getBalance, a field wagmi 3 no longer
 * returns, so the account modal shows 0.000 ETH for everyone. Same read, formatted here, until
 * the adapter catches up with wagmi 3.
 */
class Adapter extends WagmiAdapter {
  override async getBalance(params: Parameters<WagmiAdapter["getBalance"]>[0]): ReturnType<WagmiAdapter["getBalance"]> {
    const address = params.address as Address | undefined;
    if (!address || !this.wagmiConfig) return { balance: "0.00", symbol: "ETH" };
    try {
      const chainId = Number(params.chainId) as (typeof networks)[number]["id"] & number;
      const b = await getBalance(this.wagmiConfig, { address, chainId });
      return { balance: formatUnits(b.value, b.decimals), symbol: b.symbol };
    } catch {
      return { balance: "0.00", symbol: "ETH" };
    }
  }
}

const adapter = projectId ? new Adapter({ networks, projectId, transports }) : null;

export const wagmiConfig: Config =
  adapter?.wagmiConfig ?? createConfig({ chains: [mainnet, sepolia, base, robinhood, foundry], connectors: [injected()], transports });

if (adapter && projectId) {
  createAppKit({
    adapters: [adapter],
    networks,
    defaultNetwork: networks[0],
    // A wallet on any chain is fine until it signs something: a write switches it then (tx.ts).
    // Without this AppKit asks for a switch the moment a wallet on another chain reconnects.
    allowUnsupportedChain: true,
    projectId,
    metadata: {
      name: "Adapterscan",
      description: "Identity, profiles, and reviews for AI agents",
      url: location.origin,
      icons: [],
    },
    // Wallet connection only: account, network, disconnect. None of the wallet-as-a-service
    // extras (funding, sending, swaps, activity) belong in a registry UI.
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, receive: false, send: false, history: false, pay: false },
    themeMode: localStorage.getItem("aa-theme") === "dark" ? "dark" : "light",
    themeVariables: {
      "--w3m-accent": "#4f46e5",
      "--w3m-font-family": "-apple-system, BlinkMacSystemFont, Inter, 'Segoe UI', sans-serif",
      "--w3m-border-radius-master": "2px",
    },
  });
}

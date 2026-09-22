import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { foundry, sepolia, type AppKitNetwork } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit/react";
import { createConfig, http, type Config } from "wagmi";
import { injected } from "wagmi/connectors";
import { NETWORK, NETWORKS } from "./chain";

/**
 * Wallet plumbing is wagmi's wheel: EIP-6963 discovery of injected wallets, account and chain
 * state, switching. The connect UI is Reown AppKit (WalletConnect's modal - the one people
 * already know from other dapps), which needs a project id from cloud.reown.com; set it as
 * VITE_WC_PROJECT_ID at build time. Without one the app still works with injected wallets
 * through its own plain buttons, so a fresh checkout runs before anyone has registered a project.
 */
const projectId = import.meta.env.VITE_WC_PROJECT_ID as string | undefined;
export const appKitEnabled = Boolean(projectId);

// Only the chain this build's indexer follows. Offering the other in the wallet menu would let
// someone switch to a chain the app can't read, and the sidebar's network switch (dev only) is
// what actually changes which backend the app talks to.
const networks: [AppKitNetwork, ...AppKitNetwork[]] = [NETWORK.chain.id === foundry.id ? foundry : sepolia];
const transports = {
  [sepolia.id]: http(NETWORKS.sepolia?.rpcUrl),
  [foundry.id]: http(NETWORKS.local?.rpcUrl ?? "http://127.0.0.1:8547"),
};

const adapter = projectId ? new WagmiAdapter({ networks, projectId, transports }) : null;

export const wagmiConfig: Config =
  adapter?.wagmiConfig ?? createConfig({ chains: [sepolia, foundry], connectors: [injected()], transports });

if (adapter && projectId) {
  createAppKit({
    adapters: [adapter],
    networks,
    defaultNetwork: networks[0],
    projectId,
    metadata: {
      name: "Agent Adapter",
      description: "Profiles and reviews for AI agents",
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

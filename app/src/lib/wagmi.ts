import { http, createConfig } from "wagmi";
import { foundry, sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { NETWORKS } from "./chain";

/**
 * Wallet plumbing is wagmi's wheel: EIP-6963 discovery of injected wallets, account and
 * chain state, switching. The connect UI stays ours (see the sidebar). WalletConnect (mobile
 * wallets) turns on by setting VITE_WC_PROJECT_ID; until then injected wallets only.
 */
const wcProjectId = import.meta.env.VITE_WC_PROJECT_ID as string | undefined;

export const wagmiConfig = createConfig({
  chains: [sepolia, foundry],
  connectors: [injected(), ...(wcProjectId ? [walletConnect({ projectId: wcProjectId })] : [])],
  transports: {
    [sepolia.id]: http(NETWORKS.sepolia?.rpcUrl),
    [foundry.id]: http(NETWORKS.local?.rpcUrl ?? "http://127.0.0.1:8547"),
  },
});

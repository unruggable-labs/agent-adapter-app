import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import App from "./App";
import { ChainSelect, PendingChain } from "./components/chains";
import "./design.css";
import { IS_CHAIN_SELECT, NETWORK } from "./lib/chain";
import { wagmiConfig } from "./lib/wagmi";

const queryClient = new QueryClient();

// The apex is the chain picker and a not-yet-indexed chain's host is a notice: neither needs
// wallet plumbing or the indexer poll, so they render without the providers.
const root = IS_CHAIN_SELECT ? <ChainSelect /> : NETWORK.status === "pending" ? <PendingChain /> : (
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);

createRoot(document.getElementById("root")!).render(<StrictMode>{root}</StrictMode>);

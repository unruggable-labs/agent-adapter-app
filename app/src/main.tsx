import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import App from "./App";
import { ChainSelect, PendingChain } from "./components/chains";
import { StatsSite } from "./pages/StatsSite";
import "./design.css";
import { IS_CHAIN_SELECT, IS_STATS_HOST, NETWORK } from "./lib/chain";
import { wagmiConfig } from "./lib/wagmi";

const queryClient = new QueryClient();

// The same page serves every hostname; say which chain this one is in the tab.
if (IS_STATS_HOST) document.title = "Adapter usage · Adapterscan";
else if (!IS_CHAIN_SELECT) document.title = `${NETWORK.label} · Agent Identity · Adapterscan`;

// The apex is the chain picker and a not-yet-indexed chain's host is a notice: neither needs
// wallet plumbing or the indexer poll, so they render without the providers.
const root = IS_STATS_HOST ? <StatsSite /> : IS_CHAIN_SELECT ? <ChainSelect /> : NETWORK.status === "pending" ? <PendingChain /> : (
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);

createRoot(document.getElementById("root")!).render(<StrictMode>{root}</StrictMode>);

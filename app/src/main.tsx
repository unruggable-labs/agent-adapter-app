import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import App from "./App";
import { StatsSite } from "./pages/StatsSite";
import "./design.css";
import { HOME, IS_STATS_HOST } from "./lib/chain";
import { wagmiConfig } from "./lib/wagmi";

const queryClient = new QueryClient();

// The same page serves every hostname; say in the tab which chain a chain's own site is.
if (IS_STATS_HOST) document.title = "Adapter usage · Adapterscan";
else document.title = HOME ? `${HOME.label} · Agent Identity · Adapterscan` : "Agent Identity · Adapterscan";

// The stats host needs no wallet plumbing or indexer poll, so it renders without the providers.
const root = IS_STATS_HOST ? <StatsSite /> : (
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);

createRoot(document.getElementById("root")!).render(<StrictMode>{root}</StrictMode>);

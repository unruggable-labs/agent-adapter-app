import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two entries, one build: index.html is the explorer, docs.html the documentation site. Caddy
// serves the same dist to both hostnames and picks the entry by host.
/** Each network's local indexer port, as serve.ts assigns them. */
const DEV_PORT: Record<string, number> = { local: 8787, sepolia: 8788, mainnet: 8789, base: 8790, robinhood: 8791 };

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, "index.html"), docs: resolve(__dirname, "docs.html") },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      // Content-addressed images are served by the indexer the app is reading (see indexer/src/gateway.ts).
      "/ipfs": `http://127.0.0.1:${DEV_PORT[process.env.VITE_NETWORK ?? "local"] ?? 8787}`,
      "/ar": `http://127.0.0.1:${DEV_PORT[process.env.VITE_NETWORK ?? "local"] ?? 8787}`,
    },
  },
});

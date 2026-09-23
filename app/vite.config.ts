import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two entries, one build: index.html is the explorer, docs.html the documentation site. Caddy
// serves the same dist to both hostnames and picks the entry by host.
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
    },
  },
});

import { useEffect, useState } from "react";

/**
 * The docs' routes are paths - docs.adapterscan.com/<page>[/<part>] - so each page can be a real
 * file: the build writes every page as plain HTML and Markdown (scripts/prerender-docs.ts), and a
 * fetch with no JavaScript gets the words. In dev Vite serves the docs under /docs/ (vite.config.ts),
 * beside the explorer's own paths.
 */
export const DOCS_BASE = import.meta.env.DEV ? "/docs/" : "/";

/** A docs page's href: doc("wallets"), doc("model/wallet"). */
export const doc = (path: string) => DOCS_BASE + path;

const listeners = new Set<() => void>();

/** Go to a docs path without a page load. */
export function go(href: string) {
  history.pushState(null, "", href);
  listeners.forEach((l) => l());
}

function read(): string[] {
  return location.pathname.slice(DOCS_BASE.length - 1).replace(/^\/+|\/+$/g, "").split("/");
}

/** [page, part] from the path. `at` is the path to render when there is no location (the prerender). */
export function useDocsRoute(at?: string): [string, string | undefined] {
  const [parts, setParts] = useState<string[]>(() => (at !== undefined ? at.split("/") : read()));
  useEffect(() => {
    const on = () => {
      setParts(read());
      if (!location.hash) window.scrollTo({ top: 0 });
    };
    listeners.add(on);
    window.addEventListener("popstate", on);
    return () => {
      listeners.delete(on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return [parts[0] || "model", parts[1]];
}

/** Links shared before the docs had paths (#/wallets, #/model/wallet) land on the same page. */
export function upgradeHashRoute() {
  if (location.hash.startsWith("#/")) history.replaceState(null, "", doc(location.hash.slice(2)));
}

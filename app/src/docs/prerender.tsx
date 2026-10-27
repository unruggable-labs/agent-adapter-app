import { renderToStaticMarkup } from "react-dom/server";
import { ALL, Docs, GROUPS } from "./Docs";

/**
 * The docs rendered on the build machine, for scripts/prerender-docs.mjs: the whole page for the
 * HTML a fetch gets before any JavaScript runs, and the content alone - every part of an
 * interactive page at once - for the Markdown copy. Built with `vite build --ssr`.
 */
export { ALL, GROUPS };

/** The model page's parts, each its own path (/model/wallet). */
export const MODEL_PARTS = ["agent", "profile", "controller", "wallet"];

export const renderPage = (at: string) => renderToStaticMarkup(<Docs at={at} />);

export function renderContent(slug: string): string {
  const page = ALL.find((p) => p.slug === slug);
  if (!page) throw new Error(`no docs page "${slug}"`);
  return renderToStaticMarkup(<>{page.render(undefined, true)}</>);
}

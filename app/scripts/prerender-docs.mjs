// The docs as files, after `vite build`: every page as plain HTML (the same markup the app
// renders, so a fetch with no JavaScript gets the words) and as Markdown, with an llms.txt
// index and llms-full.txt (every page in one file). All of it goes to dist/docs/, which Caddy
// serves at docs.adapterscan.com (deploy/Caddyfile.adapter): /wallets is docs/wallets.html,
// /wallets.md is docs/wallets.md. The pages are rendered from the same components the docs site
// runs (src/docs/prerender.tsx), so the copies can't drift from it.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { build } from "vite";

const ORIGIN = "https://docs.adapterscan.com";
const EXPLORER = "https://adapterscan.com";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(app, "dist");
const out = join(dist, "docs");
const ssrDir = join(app, "node_modules", ".prerender-docs");

await build({ root: app, logLevel: "warn", build: { ssr: "src/docs/prerender.tsx", outDir: ssrDir, emptyOutDir: true } });

// The app's modules read the hostname when they load; the build has none, so it is the docs'.
globalThis.location = new URL(`${ORIGIN}/`);
const { ALL, GROUPS, MODEL_PARTS, renderPage, renderContent } = await import(pathToFileURL(join(ssrDir, "prerender.js")).href);

const template = readFileSync(join(dist, "docs.html"), "utf8");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** A page's one-line summary: its subtitle, or the first paragraph where it has none. */
const summaryOf = (html) => text((/<p class="page-sub">([\s\S]*?)<\/p>/.exec(html) ?? /<p>([\s\S]*?)<\/p>/.exec(html) ?? ["", ""])[1]);

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "_" });
td.use(gfm);
// The interactive bits: the model diagram's buttons, copy buttons, the pager.
td.remove((n) => n.nodeName === "BUTTON" || n.nodeName === "svg" || n.nodeName === "NAV" || /(^|\s)(model|codeblock-bar)(\s|$)/.test(n.getAttribute?.("class") ?? ""));
td.addRule("code", {
  filter: (n) => n.nodeName === "PRE",
  replacement: (_c, n) => `\n\n\`\`\`${n.parentNode?.getAttribute?.("data-lang") ?? ""}\n${n.textContent.replace(/\n$/, "")}\n\`\`\`\n\n`,
});
td.addRule("note", {
  filter: (n) => /\bcallout\b/.test(n.getAttribute?.("class") ?? ""),
  replacement: (c) => `\n\n${c.trim().split("\n").map((l) => `> ${l}`.trimEnd()).join("\n")}\n\n`,
});
// The model page's parts: name and what it is, as a heading and a line.
td.addRule("part", {
  filter: (n) => /(^|\s)model-detail-(name|what)(\s|$)/.test(n.getAttribute?.("class") ?? ""),
  replacement: (c, n) => (/model-detail-name/.test(n.getAttribute("class")) ? `\n\n### ${c}\n\n` : `_${c}_\n\n`),
});
td.addRule("links", {
  filter: "a",
  replacement: (c, n) => {
    const href = n.getAttribute("href") ?? "";
    // A section anchor means nothing outside the page; another docs page is its Markdown copy.
    if (!href || href.startsWith("#")) return c;
    const to = href.startsWith("/") ? `${ORIGIN}${href.replace(/\/$/, "")}.md` : href;
    return `[${c}](${to})`;
  },
});
const markdown = (html) => td.turndown(html).replace(/\n{3,}/g, "\n\n").trim() + "\n";

/** docs.html with this page in it and its own tags. */
function htmlPage(path, page, body, summary) {
  const title = `${page.title} · Adapterscan Docs`;
  const url = `${ORIGIN}/${path}`;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(summary)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<link rel="alternate" type="text/markdown" href="${ORIGIN}/${page.slug}.md" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(summary)}" />`,
    `<meta property="og:url" content="${url}" />`,
  ].join("\n    ");
  return template
    .replace(/<title>[^<]*<\/title>\s*/i, "")
    .replace(/<meta (?:name="description"|property="og:(?:title|description|url)")[^>]*>\s*/gi, "")
    .replace(/<\/head>/i, `  ${tags}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "model"), { recursive: true });
const write = (file, body) => writeFileSync(join(out, file), body);

const pages = ALL.map((page) => {
  const content = renderContent(page.slug);
  return { page, summary: summaryOf(content), md: markdown(content) };
});
for (const { page, summary, md } of pages) {
  write(`${page.slug}.html`, htmlPage(page.slug, page, renderPage(page.slug), summary));
  write(`${page.slug}.md`, md);
}
const model = pages.find((p) => p.page.slug === "model");
write("index.html", htmlPage("", model.page, renderPage("model"), model.summary));
for (const part of MODEL_PARTS) write(`model/${part}.html`, htmlPage(`model/${part}`, model.page, renderPage(`model/${part}`), model.summary));

const summaryFor = (slug) => pages.find((p) => p.page.slug === slug).summary;
write(
  "llms.txt",
  [
    "# Adapterscan docs",
    "",
    "> Profiles and reviews for AI agents. The wallets agents do business with get a lookup: who operates this, and are they any good? These docs cover how it works, the contracts, and how to build on them.",
    "",
    "Every page is also plain Markdown at the same path with .md on the end. All of them in one file: " + `${ORIGIN}/llms-full.txt`,
    "",
    `To look up an agent or a wallet, the explorer has a JSON API, described in ${EXPLORER}/llms.txt`,
    "",
    ...GROUPS.flatMap((g) => [`## ${g.label}`, "", ...g.pages.map((p) => `- [${p.title}](${ORIGIN}/${p.slug}.md): ${summaryFor(p.slug)}`), ""]),
  ].join("\n"),
);
write("llms-full.txt", pages.map(({ page, md }) => `<!-- ${ORIGIN}/${page.slug} -->\n\n${md}`).join("\n---\n\n"));
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["", ...ALL.map((p) => p.slug)].map((s) => `  <url><loc>${ORIGIN}/${s}</loc></url>`).join("\n")}\n</urlset>\n`,
);
rmSync(ssrDir, { recursive: true, force: true });
console.log(`docs: ${pages.length} pages as HTML and Markdown, llms.txt, llms-full.txt -> dist/docs/`);

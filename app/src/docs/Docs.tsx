import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Brand } from "../components/brand";
import { CodeBlock } from "../components/code";
import { ChainGrid } from "../components/chains";
import { MenuButton, NavBackdrop, NavClose, useNavDrawer } from "../components/shell";
import { Modal } from "../components/ui";
import { Api } from "./pages/Api";
import { Counterfactual } from "./pages/Counterfactual";
import { Deployments } from "./pages/Deployments";
import { Identities } from "./pages/Identities";
import { License } from "./pages/License";
import { Model } from "./pages/Model";
import { Quickstart } from "./pages/Quickstart";
import { Reference } from "./pages/Reference";
import { Reputation } from "./pages/Reputation";
import { Standards } from "./pages/Standards";
import { Trust } from "./pages/Trust";
import { Wallets } from "./pages/Wallets";
import { doc, DOCS_BASE, go, useDocsRoute } from "./route";

/**
 * The documentation site: the same design system as the explorer, in a reading register. One
 * static build serves both; this is the docs entry. Pages are paths (route.ts), and the model page
 * keeps its selected part in the path too (/model/wallet). The build also writes each page as
 * plain HTML and Markdown from these same components, with an llms.txt (scripts/prerender-docs.ts).
 */

export interface Page {
  slug: string;
  title: string;
  /** `all`: every part of an interactive page at once - what the Markdown copy shows. */
  render: (sub?: string, all?: boolean) => ReactNode;
}

export const GROUPS: { label: string; pages: Page[] }[] = [
  {
    label: "Understand",
    pages: [
      { slug: "model", title: "Agent identity", render: (sub, all) => <Model part={sub} all={all} /> },
      { slug: "identities", title: "Identities and UBIDs", render: () => <Identities /> },
      { slug: "standards", title: "Controllers and standards", render: () => <Standards /> },
      { slug: "wallets", title: "Operating wallets", render: () => <Wallets /> },
      { slug: "reputation", title: "Reputation", render: () => <Reputation /> },
      { slug: "trust", title: "Trust and security", render: () => <Trust /> },
    ],
  },
  {
    label: "Build",
    pages: [
      { slug: "quickstart", title: "Quickstart", render: () => <Quickstart /> },
      { slug: "api", title: "Explorer API", render: () => <Api /> },
      { slug: "counterfactual", title: "Counterfactual registration", render: () => <Counterfactual /> },
      { slug: "reference", title: "Contract reference", render: () => <Reference /> },
      { slug: "deployments", title: "Deployments", render: () => <Deployments /> },
    ],
  },
  { label: "Project", pages: [{ slug: "license", title: "License", render: () => <License /> }] },
];
export const ALL = GROUPS.flatMap((g) => g.pages);

/** A click on a link to another docs page changes the route in place; anything else is a normal link. */
function followInPlace(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  const href = a.getAttribute("href") ?? "";
  if (!href.startsWith(DOCS_BASE) || href.startsWith("//")) return;
  e.preventDefault();
  go(href);
}

/** `at`: the path to render, for the prerender, which has no location. */
export function Docs({ at }: { at?: string } = {}) {
  const [slug, sub] = useDocsRoute(at);
  const page = ALL.find((p) => p.slug === slug) ?? ALL[0];
  const [theme, setTheme] = useState(() => (typeof localStorage === "undefined" ? "light" : localStorage.getItem("aa-theme") ?? "light"));
  const [pickChain, setPickChain] = useState(false);
  const [navOpen, setNavOpen] = useNavDrawer(slug);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aa-theme", theme);
  }, [theme]);
  const i = ALL.indexOf(page);
  const prev = ALL[i - 1];
  const next = ALL[i + 1];

  return (
    <div className={`shell${navOpen ? " nav-open" : ""}`} onClick={followInPlace}>
      <NavBackdrop onClick={() => setNavOpen(false)} />
      <aside className="sidebar">
        <div className="sidebar-top">
          <a className="brand" href={doc("model")} style={{ textDecoration: "none", color: "inherit" }}>
            <Brand suffix="Docs" />
          </a>
          <NavClose onClick={() => setNavOpen(false)} />
        </div>
        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="nav-label">{g.label}</div>
            {g.pages.map((p) => (
              <a key={p.slug} className={`nav-item${p.slug === page.slug ? " active" : ""}`} href={doc(p.slug)} style={{ textDecoration: "none" }}>
                {p.title}
              </a>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <button className="btn btn-primary" style={{ width: "100%", marginBottom: 8 }} onClick={() => setPickChain(true)}>Open the explorer</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "◐ Dark mode" : "◑ Light mode"}
          </button>
        </div>
      </aside>
      {pickChain && (
        <Modal title="Which chain?" width={600} onClose={() => setPickChain(false)}>
          <ChainGrid />
        </Modal>
      )}
      <main className="main">
        <header className="mobile-bar">
          <MenuButton onClick={() => setNavOpen(true)} />
          <a className="brand" href={doc("model")} style={{ textDecoration: "none", color: "inherit" }}><Brand suffix="Docs" /></a>
        </header>
        <div className="main-scroll">
          <div className="page docs-page fade-in" key={page.slug}>
            {page.render(sub)}
            <nav className="docs-pager">
              {prev ? <a href={doc(prev.slug)}>← {prev.title}</a> : <span />}
              {next ? <a href={doc(next.slug)}>{next.title} →</a> : <span />}
            </nav>
          </div>
        </div>
      </main>
    </div>
  );
}

/** A section heading with an anchor, for the longer pages. */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 className="h-section docs-h2" id={id}><a href={`#${id}`} style={{ color: "inherit", textDecoration: "none" }}>{children}</a></h2>;
}

export function Code({ children, lang }: { children: string; lang?: string }) {
  return <CodeBlock code={children} lang={lang} />;
}

export function Note({ children, tone = "" }: { children: ReactNode; tone?: string }) {
  return <div className={`callout ${tone ? `callout-${tone}` : ""}`} style={{ margin: "14px 0" }}>{children}</div>;
}

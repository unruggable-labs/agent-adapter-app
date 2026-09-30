import { useEffect, useState, type ReactNode } from "react";
import { CodeBlock } from "../components/code";
import { EXPLORER_URL } from "../lib/chain";
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

/**
 * The documentation site: the same design system as the explorer, in a reading register. One
 * static build serves both; this is the docs entry. Pages are hash routes so a link can point at
 * one, and the model page keeps its selected part in the hash too (#/model/wallet).
 */

interface Page {
  slug: string;
  title: string;
  render: (sub?: string) => ReactNode;
}

const GROUPS: { label: string; pages: Page[] }[] = [
  {
    label: "Understand",
    pages: [
      { slug: "model", title: "Agent identity", render: (sub) => <Model part={sub} /> },
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
      { slug: "counterfactual", title: "Counterfactual registration", render: () => <Counterfactual /> },
      { slug: "reference", title: "Contract reference", render: () => <Reference /> },
      { slug: "deployments", title: "Deployments", render: () => <Deployments /> },
    ],
  },
  { label: "Project", pages: [{ slug: "license", title: "License", render: () => <License /> }] },
];
const ALL = GROUPS.flatMap((g) => g.pages);

function useHashRoute(): [string, string | undefined] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/");
  const [parts, setParts] = useState<string[]>(read);
  useEffect(() => {
    const on = () => {
      setParts(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [parts[0] || "model", parts[1]];
}

export function Docs() {
  const [slug, sub] = useHashRoute();
  const page = ALL.find((p) => p.slug === slug) ?? ALL[0];
  const [theme, setTheme] = useState(localStorage.getItem("aa-theme") ?? "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aa-theme", theme);
  }, [theme]);
  const i = ALL.indexOf(page);
  const prev = ALL[i - 1];
  const next = ALL[i + 1];

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/model" style={{ textDecoration: "none", color: "inherit" }}>
          Adapterscan <span className="t3" style={{ fontWeight: 500 }}>Docs</span>
        </a>
        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="nav-label">{g.label}</div>
            {g.pages.map((p) => (
              <a key={p.slug} className={`nav-item${p.slug === page.slug ? " active" : ""}`} href={`#/${p.slug}`} style={{ textDecoration: "none" }}>
                {p.title}
              </a>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <a className="btn btn-sm" href={EXPLORER_URL} style={{ marginBottom: 8, textDecoration: "none" }}>Open the explorer</a>
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "◐ Dark mode" : "◑ Light mode"}
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="main-scroll">
          <div className="page docs-page fade-in" key={page.slug}>
            {page.render(sub)}
            <nav className="docs-pager">
              {prev ? <a href={`#/${prev.slug}`}>← {prev.title}</a> : <span />}
              {next ? <a href={`#/${next.slug}`}>{next.title} →</a> : <span />}
            </nav>
          </div>
        </div>
      </main>
    </div>
  );
}

/** A section heading with an anchor, for the longer pages. */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 className="h-section docs-h2" id={id}><a href={`#${location.hash.slice(1).split("#")[0]}`} style={{ color: "inherit", textDecoration: "none" }}>{children}</a></h2>;
}

export function Code({ children }: { children: string; lang?: string }) {
  return <CodeBlock code={children} />;
}

export function Note({ children, tone = "" }: { children: ReactNode; tone?: string }) {
  return <div className={`callout ${tone ? `callout-${tone}` : ""}`} style={{ margin: "14px 0" }}>{children}</div>;
}

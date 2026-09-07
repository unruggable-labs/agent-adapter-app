import { useEffect, useState } from "react";
import { AppProvider, useApp } from "./lib/app-state";
import { ACTORS, shortHex } from "./lib/chain";
import { AttestationsPage } from "./pages/Attestations";
import { CreatePage } from "./pages/Create";
import { HowPage } from "./pages/How";
import { IdentitiesPage } from "./pages/Identities";
import { IdentityPage } from "./pages/Identity";
import { LandingPage } from "./pages/Landing";
import { WalletPage } from "./pages/Wallet";

function NavItem({ to, label, count }: { to: string; label: string; count?: number }) {
  const { route, navigate } = useApp();
  const active =
    route === to ||
    (to === "/identities" && route.startsWith("/identity")) ||
    (to !== "/" && to !== "/identities" && route.startsWith(to));
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={() => navigate(to)}>
      {label}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}

function Shell() {
  const { route, overview, actorIndex, setActorIndex, actor } = useApp();
  const [theme, setTheme] = useState(localStorage.getItem("aa-theme") ?? "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aa-theme", theme);
  }, [theme]);

  let page = <LandingPage />;
  if (route.startsWith("/identity/")) page = <IdentityPage ubid={route.split("/")[2]} />;
  else if (route.startsWith("/identities")) page = <IdentitiesPage />;
  else if (route.startsWith("/attestations")) page = <AttestationsPage />;
  else if (route.startsWith("/create")) page = <CreatePage />;
  else if (route.startsWith("/wallet")) page = <WalletPage />;
  else if (route.startsWith("/how")) page = <HowPage />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A8</span> Agent Adapter
        </div>

        <button className="btn btn-primary" style={{ margin: "2px 8px 6px" }} onClick={() => (location.hash = "/create")}>
          + Create identity
        </button>

        <div className="nav-label">Registry</div>
        <NavItem to="/" label="Start here" />
        <NavItem to="/identities" label="Identities" count={overview?.identities} />
        <NavItem to="/attestations" label="Attestations" count={overview?.attestations} />

        <div className="nav-label">You</div>
        <NavItem to="/wallet" label="My wallet" />

        <div className="nav-label">Learn</div>
        <NavItem to="/how" label="How identity works" />

        <div className="sidebar-foot">
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "◐ Dark mode" : "◑ Light mode"}
          </button>
          <div className="nav-label" style={{ padding: "0 0 4px" }}>Acting as</div>
          <select className="select" value={actorIndex} onChange={(e) => setActorIndex(Number(e.target.value))}>
            {ACTORS.map((a, i) => (
              <option key={a.name} value={i}>{a.name}</option>
            ))}
          </select>
          <div className="sidebar-meta" style={{ marginTop: 8 }}>
            <div className="mono t3">{shortHex(actor.address, 12)}</div>
            <div style={{ marginTop: 4 }}>chain {overview?.chainId ?? "…"} · <span className="mono">{shortHex(overview?.adapter ?? "", 6)}</span></div>
            <div className="t3">local demo · anvil personas</div>
          </div>
        </div>
      </aside>
      <main className="main">{page}</main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

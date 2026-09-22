import { AppKitButton, useAppKitTheme } from "@reown/appkit/react";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { SearchBar } from "./components/search";
import { AppProvider, useApp } from "./lib/app-state";
import { ACTORS, NETWORK, NETWORKS, networkId, shortHex, switchNetwork, type NetworkId } from "./lib/chain";
import { appKitEnabled } from "./lib/wagmi";
import { AttestationsPage } from "./pages/Attestations";
import { CreatePage } from "./pages/Create";
import { HowPage } from "./pages/How";
import { IdentitiesPage } from "./pages/Identities";
import { IdentityPage } from "./pages/Identity";

function NavItem({ to, label, count }: { to: string; label: string; count?: number }) {
  const { route, navigate } = useApp();
  // Identities is home: "/" and every profile page light it up.
  const active =
    route === to ||
    (to === "/identities" && (route === "/" || route.startsWith("/identity"))) ||
    (to !== "/identities" && route.startsWith(to));
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={() => navigate(to)}>
      {label}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}

/** The account, in the header: who is connected, whether they are on the right chain, and the
 *  way in or out. On the devnet the "account" is a persona picked from a list instead. */
function WalletControl() {
  const { signer, actorIndex, setActorIndex } = useApp();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const wrongChain = signer !== null && chain?.id !== NETWORK.chain.id;

  // nudge the wallet onto this network's chain as soon as it connects
  useEffect(() => {
    if (wrongChain) switchChain({ chainId: NETWORK.chain.id });
  }, [signer?.address]);

  if (NETWORK.personaWrites)
    return (
      <label className="row" style={{ gap: 8 }}>
        <span className="hint">Acting as</span>
        <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={actorIndex} onChange={(e) => setActorIndex(Number(e.target.value))}>
          {ACTORS.map((a, i) => (
            <option key={a.name} value={i}>{a.name}</option>
          ))}
        </select>
      </label>
    );

  // The standard modal: wallet list, QR for mobile, account and network pills once connected.
  if (appKitEnabled) return <AppKitButton balance="hide" size="sm" />;

  // No project id configured: plain injected-wallet buttons, so a checkout still works.
  if (signer)
    return (
      <div className="row" style={{ gap: 8 }}>
        {wrongChain ? (
          <button className="btn btn-sm" style={{ color: "var(--warn)" }} onClick={() => switchChain({ chainId: NETWORK.chain.id })}>
            Switch to {NETWORK.chain.name}
          </button>
        ) : (
          <span className="account-dot" title={`on ${chain?.name}`} />
        )}
        <span className="mono t2 small">{signer.label}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  return (
    <div className="row" style={{ gap: 6 }}>
      {connectors.map((c) => (
        <button key={c.uid} className="btn btn-sm" disabled={isPending} onClick={() => connect({ connector: c })}>
          Connect {c.name}
        </button>
      ))}
      {connectors.length === 0 && <span className="hint">No wallet extension found</span>}
    </div>
  );
}

/** Keeps AppKit's modal in the app's theme. Its hook needs AppKit created, so this only
 *  mounts when it is. */
function AppKitTheme({ theme }: { theme: string }) {
  const { setThemeMode } = useAppKitTheme();
  useEffect(() => setThemeMode(theme === "dark" ? "dark" : "light"), [theme]);
  return null;
}

function Shell() {
  const { route, overview, signer } = useApp();
  const [theme, setTheme] = useState(localStorage.getItem("aa-theme") ?? "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aa-theme", theme);
  }, [theme]);

  let page = <IdentitiesPage />;
  if (route.startsWith("/identity/")) page = <IdentityPage ubid={route.split("/")[2]} />;
  else if (route.startsWith("/attestations")) page = <AttestationsPage />;
  else if (route.startsWith("/create")) page = <CreatePage />;
  // /how/<part> keeps the selected component in the URL, so a reload or a shared link lands
  // on the same explanation.
  else if (route.startsWith("/how")) page = <HowPage part={route.split("/")[2]} />;

  return (
    <div className="shell">
      {appKitEnabled && <AppKitTheme theme={theme} />}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span> Adapterscan
        </div>

        <button className="btn btn-primary" style={{ margin: "2px 8px 6px" }} onClick={() => (location.hash = "/create")}>
          + Create identity
        </button>

        <div className="nav-label">Registry</div>
        <NavItem to="/identities" label="Identities" count={overview?.identities} />
        <NavItem to="/attestations" label="Attestations" count={overview?.attestations} />

        <div className="nav-label">Learn</div>
        <NavItem to="/how" label="Agent identity" />

        <div className="sidebar-foot">
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "◐ Dark mode" : "◑ Light mode"}
          </button>
          {/* Which backend the app reads - the local devnet or Sepolia. A dev-build choice: the
              production build knows one network, and the wallet's own network menu is a
              different thing (it moves the wallet, not the indexer). */}
          {Object.keys(NETWORKS).length > 1 && (
            <>
              <div className="nav-label" style={{ padding: "0 0 4px" }}>Network</div>
              <select className="select" value={networkId} onChange={(e) => switchNetwork(e.target.value as NetworkId)}>
                {Object.entries(NETWORKS).map(([id, n]) => (
                  <option key={id} value={id}>{n.label}</option>
                ))}
              </select>
            </>
          )}
          <div className="sidebar-meta" style={{ marginTop: 8 }}>
            {NETWORK.personaWrites && <div className="mono t3">{shortHex(signer?.address ?? "", 12)}</div>}
            <div style={{ marginTop: 4 }}>chain {overview?.chainId ?? "…"} · <span className="mono">{shortHex(overview?.adapter ?? "", 6)}</span></div>
            {NETWORK.personaWrites && <div className="t3">local demo · anvil personas</div>}
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span />
          <SearchBar />
          <div className="topbar-right">
            <WalletControl />
          </div>
        </header>
        <div className="main-scroll">{page}</div>
      </main>
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

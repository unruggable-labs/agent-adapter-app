import { useAppKit, useAppKitAccount, useAppKitTheme } from "@reown/appkit/react";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Brand } from "./components/brand";
import { ChainGrid, ChainIcon } from "./components/chains";
import { SearchBar } from "./components/search";
import { MenuButton, NavBackdrop, NavClose, useNavDrawer } from "./components/shell";
import { Modal } from "./components/ui";
import { AppProvider, useApp } from "./lib/app-state";
import { ACTORS, DOCS_URL, HOME, HOME_ID, MAINNETS, NETWORKS, PERSONA_WRITES, shortHex, STATS_URL } from "./lib/chain";
import { appKitEnabled } from "./lib/wagmi";
import { AddressPage } from "./pages/Address";
import { AttestationPage } from "./pages/Attestation";
import { AttestationsPage } from "./pages/Attestations";
import { CreatePage } from "./pages/Create";
import { IdentitiesPage } from "./pages/Identities";
import { IdentityPage } from "./pages/Identity";
import { StatsPage } from "./pages/Stats";

function NavItem({ to, label, count }: { to: string; label: string; count?: number }) {
  const { route, navigate } = useApp();
  // Identities is home: "/" and every profile page light it up. A statement's page lights up
  // Attestations, the list it was opened from.
  const active =
    route === to ||
    (to === "/identities" && (route === "/" || route.startsWith("/identity"))) ||
    (to === "/attestations" && route.startsWith("/attestation")) ||
    (to !== "/identities" && route.startsWith(to));
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={() => navigate(to)}>
      {label}
      {count !== undefined && <span className="count">{count.toLocaleString()}</span>}
    </button>
  );
}

/** The account, in the header: who is connected, whether they are on the right chain, and the
 *  way in or out. On the devnet the "account" is a persona picked from a list instead. On the
 *  multichain explorer there is no one right chain: a write switches the wallet to the chain of
 *  the record it is about (lib/tx.ts), so the header only says which chain the wallet is on. */
function WalletControl() {
  const { signer, actorIndex, setActorIndex } = useApp();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const wrongChain = signer !== null && HOME !== null && chain?.id !== HOME.chain.id;

  // a chain's own site: nudge the wallet onto its chain as soon as it connects
  useEffect(() => {
    if (wrongChain && HOME) switchChain({ chainId: HOME.chain.id });
  }, [signer?.address]);

  if (PERSONA_WRITES)
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

  // The standard modal, behind our own button so the header stays in one register.
  if (appKitEnabled) return <AppKitControl wrongChain={wrongChain} chainName={chain?.name} />;

  // No project id configured: plain injected-wallet buttons, so a checkout still works.
  if (signer)
    return (
      <div className="row" style={{ gap: 8 }}>
        {wrongChain ? (
          <button className="btn btn-sm" style={{ color: "var(--warn)" }} onClick={() => HOME && switchChain({ chainId: HOME.chain.id })}>
            Switch to {HOME?.label}
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

/** The account pill for AppKit: our button, their modal. Connected shows the address with the
 *  chain state; clicking opens the account view. Off-chain opens straight to the network list. */
function AppKitControl({ wrongChain, chainName }: { wrongChain: boolean; chainName?: string }) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  if (!isConnected || !address)
    return <button className="btn btn-sm" onClick={() => open({ view: "Connect" })}>Connect wallet</button>;
  return (
    <span className="row" style={{ gap: 8 }}>
      {wrongChain && (
        <button className="btn btn-sm" style={{ color: "var(--warn)" }} onClick={() => open({ view: "Networks" })}>
          Switch to {HOME?.label}
        </button>
      )}
      <button className="btn btn-sm btn-account" title={`${address}${chainName ? ` · on ${chainName}` : ""}`} onClick={() => open({ view: "Account" })}>
        <span className={`account-dot${wrongChain ? " is-off" : ""}`} />
        <span className="mono">{shortHex(address, 8)}</span>
      </button>
    </span>
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
  const { route, overview, navigate } = useApp();
  const [theme, setTheme] = useState(localStorage.getItem("aa-theme") ?? "light");
  const [pickChain, setPickChain] = useState(false);
  const [navOpen, setNavOpen] = useNavDrawer(route);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aa-theme", theme);
  }, [theme]);

  let page = <IdentitiesPage />;
  if (route.startsWith("/identity/")) page = <IdentityPage ubid={route.split("/")[2]} />;
  else if (route.startsWith("/address/")) page = <AddressPage address={route.split("/")[2]} />;
  else if (route.startsWith("/attestations")) page = <AttestationsPage />;
  else if (route.startsWith("/attestation/")) page = <AttestationPage id={route.split("/")[2]} />;
  else if (route.startsWith("/create")) page = <CreatePage />;
  else if (route.startsWith("/stats")) page = HOME_ID ? <StatsPage chains={[HOME_ID]} /> : <StatsPage chains={liveMainnets(overview)} allChains />;

  return (
    <div className={`shell${navOpen ? " nav-open" : ""}`}>
      {appKitEnabled && <AppKitTheme theme={theme} />}
      {pickChain && (
        <Modal title="Which chain?" width={600} onClose={() => setPickChain(false)}>
          <ChainGrid />
        </Modal>
      )}
      <NavBackdrop onClick={() => setNavOpen(false)} />
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="brand" onClick={() => navigate("/")} title="Home"><Brand /></button>
          <NavClose onClick={() => setNavOpen(false)} />
        </div>

        <button className="btn btn-primary" style={{ margin: "2px 8px 6px" }} onClick={() => navigate("/create")}>
          + Create identity
        </button>

        <div className="nav-label">Registry</div>
        <NavItem to="/identities" label="Identities" count={overview?.identities} />
        <NavItem to="/attestations" label="Attestations" count={overview?.attestations} />

        <div className="sidebar-foot">
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "◐ Dark mode" : "◑ Light mode"}
          </button>
          <a className="sidebar-link" href={DOCS_URL}>Documentation ↗</a>
          <a className="sidebar-link" href={STATS_URL}>Stats ↗</a>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <MenuButton onClick={() => setNavOpen(true)} />
          <button className="brand topbar-brand" onClick={() => navigate("/")} title="Home"><Brand /></button>
          <span className="topbar-spacer" />
          <SearchBar />
          <div className="topbar-right">
            {HOME_ID ? (
              <button className="chain-btn" title={`${HOME!.label} - switch chain`} aria-label="Switch chain" onClick={() => setPickChain(true)}>
                <ChainIcon id={HOME_ID} size={22} />
              </button>
            ) : (
              <button className="chain-btn chain-btn-wide" title="Every mainnet - the testnet is a separate site" aria-label="Chains" onClick={() => setPickChain(true)}>
                <span className="chain-stack">{liveMainnets(overview).map((id) => <ChainIcon key={id} id={id} size={20} />)}</span>
              </button>
            )}
            <WalletControl />
          </div>
        </header>
        <div className="main-scroll">{page}</div>
      </main>
    </div>
  );
}

/** The mainnets the hub has records for: its overview says which it follows; before that loads, the ones marked live. */
function liveMainnets(overview: ReturnType<typeof useApp>["overview"]): string[] {
  const indexed = overview?.chains?.map((c) => c.chain);
  return indexed?.length ? indexed : MAINNETS.filter((id) => NETWORKS[id]?.status === "live");
}

/**
 * The hub's chains in the sidebar: each with its count, opening the identities on it alone. A
 * chain still catching up, or one whose indexer has stopped hearing from its RPC, says so - its
 * records are still shown, as of the last block it read.
 */
export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

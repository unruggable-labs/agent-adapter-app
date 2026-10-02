import { useEffect, useState } from "react";
import { Brand } from "../components/brand";
import { ChainGrid } from "../components/chains";
import { Modal } from "../components/ui";
import { DOCS_URL, STATS_NETWORKS } from "../lib/chain";
import { StatsPage } from "./Stats";

/** stats.adapterscan.com: the usage page across every chain, with a thin bar instead of the explorer's shell. */
export function StatsSite() {
  const [theme, setTheme] = useState(localStorage.getItem("aa-theme") ?? "light");
  const [pickChain, setPickChain] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aa-theme", theme);
  }, [theme]);
  return (
    <div className="main" style={{ height: "100%" }}>
      <header className="topbar stats-bar">
        <span className="brand" style={{ padding: 0 }}><Brand suffix="Stats" /></span>
        <nav className="row wrap" style={{ gap: 4, marginLeft: "auto" }}>
          <button className="btn btn-sm" onClick={() => setPickChain(true)}>Open the explorer</button>
          <a className="btn btn-ghost btn-sm" href={DOCS_URL}>Docs</a>
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "◐" : "◑"}</button>
        </nav>
      </header>
      {pickChain && (
        <Modal title="Which chain?" width={600} onClose={() => setPickChain(false)}>
          <ChainGrid />
        </Modal>
      )}
      <div className="main-scroll">
        <StatsPage chains={STATS_NETWORKS} allChains />
      </div>
    </div>
  );
}

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { api, type Overview } from "./api";
import { ACTORS, NETWORK, shortHex } from "./chain";

/**
 * Who signs. On the local devnet it's a demo persona (anvil key, picked in the sidebar);
 * on public networks it's the user's connected wallet, or null when disconnected. Every
 * page and write path works in terms of this — the persona system is devnet tooling only.
 */
export interface Signer {
  address: Address;
  label: string;
  /** true = anvil persona (local devnet); false = real connected wallet */
  isPersona: boolean;
  actorIndex: number;
}

/** "loading" only until the first fetch resolves; a later poll failing keeps the last good data
 *  on screen rather than blanking a page the user is reading. */
export type LoadStatus = "loading" | "ready" | "error";

interface AppState {
  route: string;
  navigate: (r: string) => void;
  actorIndex: number;
  setActorIndex: (i: number) => void;
  signer: Signer | null;
  overview: Overview | null;
  status: LoadStatus;
  /** Counts up on every poll and every settle after a write. Pages re-fetch their own data on it - see useLive. */
  tick: number;
  refresh: () => Promise<void>;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  // Path routes (/identity/<ubid>, /address/<addr>, ...) so a shared link carries the page in
  // the part of the URL servers and crawlers see. Old hash links still land: #/x becomes /x.
  const [route, setRoute] = useState(() => {
    if (location.hash.startsWith("#/")) {
      const path = location.hash.slice(1);
      history.replaceState(null, "", path);
      return path;
    }
    return location.pathname || "/";
  });
  const [actorIndex, setActorIndex] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tick, setTick] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const { address: connectedAddress } = useAccount();

  const signer: Signer | null = NETWORK.personaWrites
    ? {
        address: ACTORS[actorIndex].address,
        label: ACTORS[actorIndex].name,
        isPersona: true,
        actorIndex,
      }
    : connectedAddress
      ? {
          address: connectedAddress.toLowerCase() as Address,
          label: shortHex(connectedAddress, 8),
          isPersona: false,
          actorIndex: -1,
        }
      : null;

  useEffect(() => {
    const onPop = () => setRoute(location.pathname || "/");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The poll fetches only the overview - a few hundred bytes - and tells the pages to re-ask
  // their own questions. Nothing downloads the registry.
  const refresh = useCallback(async () => {
    setTick((t) => t + 1);
    try {
      setOverview(await api.overview());
      setStatus("ready");
    } catch {
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useEffect(() => {
    refresh();
    // A hidden tab doesn't poll; it catches up the moment it is looked at again.
    const t = setInterval(() => !document.hidden && refresh(), 4000);
    const onShow = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refresh]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const navigate = useCallback((r: string) => {
    if (r !== location.pathname) history.pushState(null, "", r);
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <Ctx.Provider
      value={{
        route,
        navigate,
        actorIndex,
        setActorIndex,
        signer,
        overview,
        status,
        tick,
        refresh,
        toast,
      }}
    >
      {children}
      {toastMsg && <div className="toast fade-in">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

/**
 * Data a page asks the indexer for, kept live: fetched now, again on every tick (the poll, or a
 * settle after a write), and afresh when its inputs change. The last good value stays on screen
 * while a later fetch fails; a change of inputs reports loading until the new answer arrives.
 * `load` returning null means there is nothing to ask yet.
 */
export function useLive<T>(load: () => Promise<T> | null, deps: unknown[]): { data: T | null; status: LoadStatus; error: unknown } {
  const { tick } = useApp();
  const key = JSON.stringify(deps);
  const [state, setState] = useState<{ key: string; data: T | null; status: LoadStatus; error: unknown }>({ key: "", data: null, status: "loading", error: null });
  useEffect(() => {
    const request = load();
    if (!request) {
      setState({ key, data: null, status: "ready", error: null });
      return;
    }
    let cancelled = false;
    request
      .then((data) => !cancelled && setState({ key, data, status: "ready", error: null }))
      .catch((error) => !cancelled && setState((s) => (s.key === key && s.data !== null ? { ...s, error } : { key, data: null, status: "error", error })));
    return () => {
      cancelled = true;
    };
  }, [key, tick]);
  if (state.key !== key) return { data: null, status: "loading", error: null };
  return { data: state.data, status: state.status, error: state.error };
}

/** Wait until the indexer has caught up with a just-mined write, then refresh app data. */
export async function settle(refresh: () => Promise<void>, ms = 2600) {
  await new Promise((r) => setTimeout(r, ms));
  await refresh();
}

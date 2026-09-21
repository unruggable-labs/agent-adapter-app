import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { api, type Identity, type Overview } from "./api";
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
  identities: Identity[];
  status: LoadStatus;
  refresh: () => Promise<void>;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  const [actorIndex, setActorIndex] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [identities, setIdentities] = useState<Identity[]>([]);
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
    const onHash = () => setRoute(location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [ov, ids] = await Promise.all([api.overview(), api.identities()]);
      setOverview(ov);
      setIdentities(ids);
      setStatus("ready");
    } catch {
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const navigate = useCallback((r: string) => {
    location.hash = r;
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
        identities,
        status,
        refresh,
        toast,
      }}
    >
      {children}
      {toastMsg && <div className="toast fade-in">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

/** Wait until the indexer has caught up with a just-mined write, then refresh app data. */
export async function settle(refresh: () => Promise<void>, ms = 2600) {
  await new Promise((r) => setTimeout(r, ms));
  await refresh();
}

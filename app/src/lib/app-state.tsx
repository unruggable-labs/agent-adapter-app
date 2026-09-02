import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Identity, type Overview } from "./api";
import { ACTORS } from "./chain";

interface AppState {
  route: string;
  navigate: (r: string) => void;
  actorIndex: number;
  setActorIndex: (i: number) => void;
  actor: (typeof ACTORS)[0];
  overview: Overview | null;
  identities: Identity[];
  refresh: () => Promise<void>;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(location.hash.slice(1) || "/identities");
  const [actorIndex, setActorIndex] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(location.hash.slice(1) || "/identities");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refresh = useCallback(async () => {
    const [ov, ids] = await Promise.all([api.overview(), api.identities()]);
    setOverview(ov);
    setIdentities(ids);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const t = setInterval(() => refresh().catch(() => {}), 4000);
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
        actor: ACTORS[actorIndex],
        overview,
        identities,
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

import { useCallback, useSyncExternalStore } from "react";

/**
 * The query string as state. Pages read it with useSearchParams and change it with
 * setSearchParams; every reader re-renders when it changes, including on back and forward. A
 * page number or a filter kept here is in the address bar, so the view can be shared and the
 * back button walks through it. Path routing stays in app-state; this is only the part after ?.
 */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") window.addEventListener("popstate", notify);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => location.search, () => "");
  return new URLSearchParams(search);
}

/** Change the query string in place. `push` adds a history entry (a page turn); `replace` doesn't (a reset). */
export function setSearchParams(mutate: (p: URLSearchParams) => void, mode: "push" | "replace" = "push"): void {
  const p = new URLSearchParams(location.search);
  mutate(p);
  const qs = p.toString();
  const url = `${location.pathname}${qs ? `?${qs}` : ""}`;
  if (mode === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  notify();
}

/** A page number in the URL, 1-based there (?page=3), 0-based here. Page one is no parameter at all. */
export function usePageParam(name = "page"): [number, (page: number, mode?: "push" | "replace") => void] {
  const params = useSearchParams();
  const page = Math.max(0, (Number.parseInt(params.get(name) ?? "1", 10) || 1) - 1);
  const setPage = useCallback(
    (n: number, mode: "push" | "replace" = "push") =>
      setSearchParams((p) => {
        if (n <= 0) p.delete(name);
        else p.set(name, String(n + 1));
      }, mode),
    [name],
  );
  return [page, setPage];
}

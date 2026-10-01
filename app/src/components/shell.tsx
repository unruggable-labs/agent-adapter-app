import { useEffect, useState } from "react";

/**
 * The sidebar on a phone: a drawer. Desktop keeps the fixed sidebar; below the breakpoint the
 * same markup slides in over the page from a menu button in the header. The caller owns the
 * open state so it can close the drawer when the route changes.
 */
export function useNavDrawer(routeKey: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [routeKey]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return [open, setOpen];
}

export function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="menu-btn" aria-label="Open menu" onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}

/** The close control at the top of the open drawer. Hidden on desktop with the rest of it. */
export function NavClose({ onClick }: { onClick: () => void }) {
  return <button className="btn btn-ghost btn-sm nav-close" aria-label="Close menu" onClick={onClick}>✕</button>;
}

export function NavBackdrop({ onClick }: { onClick: () => void }) {
  return <div className="nav-backdrop" onClick={onClick} aria-hidden />;
}

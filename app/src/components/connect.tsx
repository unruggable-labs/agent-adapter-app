import { useAppKit } from "@reown/appkit/react";
import { appKitEnabled } from "../lib/wagmi";

/**
 * A "Connect wallet" button for the middle of a page - the primary action of a form when
 * nothing is connected yet. Opens the same modal as the header. AppKit's hook only exists once
 * AppKit is created, so the fallback (no project id configured) points at the header instead.
 */
export function ConnectWalletButton({ className = "btn btn-primary" }: { className?: string }) {
  return appKitEnabled ? <AppKitConnect className={className} /> : <HeaderPointer className={className} />;
}

function AppKitConnect({ className }: { className: string }) {
  const { open } = useAppKit();
  return <button className={className} onClick={() => open({ view: "Connect" })}>Connect wallet</button>;
}

function HeaderPointer({ className }: { className: string }) {
  return (
    <button className={className} title="Use the Connect button at the top right" onClick={() => document.querySelector<HTMLElement>(".topbar-right button")?.focus()}>
      Connect wallet
    </button>
  );
}

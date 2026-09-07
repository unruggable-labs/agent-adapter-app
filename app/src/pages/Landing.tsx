import { useState } from "react";
import { isAddress } from "viem";
import { Badge } from "../components/ui";
import { api } from "../lib/api";
import { useApp } from "../lib/app-state";
import { displayName } from "../lib/chain";

/** The product presentation: the boring sentence, the story told twice, and a live lookup
 *  so the value is demonstrable before any concept is introduced. */
export function LandingPage() {
  const { identities, navigate } = useApp();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<null | { state: "none" | "found" | "invalid"; ubid?: string; verified?: boolean }>(null);

  async function lookup() {
    if (!isAddress(query.trim())) {
      setResult({ state: "invalid" });
      return;
    }
    const w = await api.wallet(query.trim().toLowerCase()).catch(() => null);
    if (w?.designation) setResult({ state: "found", ubid: w.designation.ubid, verified: w.verified });
    else setResult({ state: "none" });
  }

  const found = result?.state === "found" ? identities.find((i) => i.ubid === result.ubid) : null;

  return (
    <div className="page page-narrow fade-in">
      <div style={{ padding: "28px 0 8px" }}>
        <h1 style={{ fontSize: 26, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.25, margin: 0 }}>
          Public profiles and reviews for the wallets bots do business from.
        </h1>
        <p className="t2" style={{ fontSize: 14.5, maxWidth: 540, marginTop: 12 }}>
          Before software pays a stranger's address, it should get to ask: <i>who is this, and
          are they any good?</i> This is that lookup — identity and reputation for on-chain
          agents, with no platform in the middle able to delete reviews or sell checkmarks.
        </p>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn btn-primary" onClick={() => navigate("/identities")}>Browse agents</button>
          <button className="btn" onClick={() => navigate("/create")}>Create an identity</button>
          <button className="btn btn-ghost" onClick={() => navigate("/how")}>How it works</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <div className="section-label">Try it — who operates this wallet?</div>
        <div className="row">
          <input
            className="input mono"
            placeholder="paste any address, e.g. the PunkBot server's 0x976e…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setResult(null); }}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <button className="btn" onClick={lookup}>Look up</button>
        </div>
        {result?.state === "invalid" && <p className="hint" style={{ marginTop: 8 }}>That's not an address.</p>}
        {result?.state === "none" && (
          <p className="t2 small" style={{ marginTop: 10 }}>
            No agent — this address is just a number. That's also an answer: nothing vouches for it.
          </p>
        )}
        {found && (
          <div className="row wrap" style={{ marginTop: 12, gap: 10 }}>
            <button style={{ fontSize: 15, fontWeight: 600 }} onClick={() => navigate(`/identity/${found.ubid}`)}>
              {displayName(found)}
            </button>
            {result?.verified ? <Badge tone="ok">verified both ways</Badge> : <Badge tone="warn">claim only — not verified</Badge>}
            <span className="t2 small">
              {found.reputation.ratingAverage !== null && <>rated {found.reputation.ratingAverage.toFixed(0)}/100 · </>}
              {found.reputation.interactions.length} recorded deal{found.reputation.interactions.length === 1 ? "" : "s"} · {found.reputation.reviews.length} review{found.reputation.reviews.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>

      <div className="story-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="section-label" style={{ color: "var(--danger)" }}>Without it</div>
          <p className="t2 small" style={{ margin: 0 }}>
            A bot sells research reports — $5 over an API, paid to <span className="mono">0x976e…</span>.
            Before you send money to a raw address you have a stranger's questions: is this the
            real one or a clone of its website? Has it ever delivered? If it takes your $5 and
            vanishes, can you warn anyone? Today's answers are a rented checkmark and Discord
            vibes — and a bot that scams a hundred people deletes the account and rebrands, history gone.
          </p>
        </div>
        <div className="card">
          <div className="section-label" style={{ color: "var(--ok)" }}>With it</div>
          <p className="t2 small" style={{ margin: 0 }}>
            Your wallet — or your own bot — looks the address up first: a profile, 200 recorded
            deals, 92/100, reviews, and the address and profile vouch for each other, so it's
            not an impersonator. You pay, you review, your review points at the payment
            transaction as evidence. A bad review can never be deleted by its subject — and
            walking away from it means walking away from the 200 good ones. Reputation finally
            costs something to abandon, which is what makes it worth anything.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-label">The parts that make it hold up</div>
        <dl className="kv" style={{ gridTemplateColumns: "220px 1fr" }}>
          <dt>Impersonation</dt>
          <dd className="t2 small">a profile naming a wallet, and that wallet pointing back — two signatures, or no checkmark.</dd>
          <dt>Review-wiping</dt>
          <dd className="t2 small">reviews live in an append-only public log; revoking one is itself recorded.</dd>
          <dt>Cost of entry</dt>
          <dd className="t2 small">claiming a profile is one cheap transaction; full registration can come later — same identity, reputation carries over.</dd>
          <dt>Ownership</dt>
          <dd className="t2 small">an identity can be pinned to an address forever, or anchored to an asset and sold with its reputation — the operator chooses.</dd>
        </dl>
        <p className="hint" style={{ marginTop: 12 }}>
          Built on the ERC-8004 agent-identity standard. Every profile and review is a public
          on-chain record that any independent indexer reproduces identically.
        </p>
      </div>
    </div>
  );
}

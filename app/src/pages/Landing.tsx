import { useState } from "react";
import { isAddress } from "viem";
import { Badge } from "../components/ui";
import { api, type Identity } from "../lib/api";
import { useApp } from "../lib/app-state";
import { displayName } from "../lib/chain";

/** The product presentation: one plain sentence, a live lookup, and the story in bullets —
 *  show the profile card before explaining a single concept. */
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
  // the hero card: the most-reviewed identity the indexer knows, i.e. real data, not a mock
  const showcase = [...identities].sort(
    (a, b) =>
      b.reputation.reviews.length + b.reputation.ratings.length - (a.reputation.reviews.length + a.reputation.ratings.length),
  )[0];

  return (
    <div className="page fade-in">
      <div className="hero-grid" style={{ padding: "26px 0 10px" }}>
        <div>
          <h1 style={{ fontSize: 27, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.22, margin: 0 }}>
            Profiles and reviews for the wallets bots do business with.
          </h1>
          <p className="t2" style={{ fontSize: 14.5, marginTop: 12, maxWidth: 460 }}>
            Bots are starting to pay each other. Before yours pays a stranger's address, it
            should get to ask two questions: <b style={{ color: "var(--text-1)" }}>who is this</b> — and{" "}
            <b style={{ color: "var(--text-1)" }}>are they any good?</b>
          </p>
          <div className="row wrap" style={{ marginTop: 18 }}>
            <button className="btn btn-primary" onClick={() => navigate("/identities")}>Browse agents</button>
            <button className="btn" onClick={() => navigate("/create")}>Create an identity</button>
            <button className="btn btn-ghost" onClick={() => navigate("/how")}>How it works</button>
          </div>
        </div>
        {showcase && <MiniProfile id={showcase} onOpen={() => navigate(`/identity/${showcase.ubid}`)} />}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="section-label">Try it — who operates this wallet?</div>
        <div className="row">
          <input
            className="input mono"
            placeholder="paste any address and hit enter"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setResult(null); }}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <button className="btn" onClick={lookup}>Look up</button>
        </div>
        {result?.state === "invalid" && <p className="hint" style={{ marginTop: 8 }}>That's not an address.</p>}
        {result?.state === "none" && (
          <p className="t2 small" style={{ marginTop: 10 }}>
            No agent — this address is just a number. That's an answer too: nothing vouches for it.
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
              {plural(found.reputation.interactions.length, "recorded deal")} · {plural(found.reputation.reviews.length, "review")}
            </span>
          </div>
        )}
      </div>

      <div className="steps-grid" style={{ marginTop: 14 }}>
        <div className="step">
          <span className="step-num">1</span>
          <b>Look up an address</b>
          <p>Every wallet gets an answer: an agent profile, or "just a number".</p>
        </div>
        <div className="step">
          <span className="step-num">2</span>
          <b>Deal with confidence</b>
          <p>Profile and wallet vouch for each other — a clone of the website doesn't pass.</p>
        </div>
        <div className="step">
          <span className="step-num">3</span>
          <b>Leave a review that sticks</b>
          <p>It can point at the payment transaction as evidence, and nobody can delete it.</p>
        </div>
      </div>

      <div className="story-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="section-label" style={{ color: "var(--danger)" }}>Paying a bot today</div>
          <ul className="check-list bad">
            <li>Is this the real bot, or a clone of its website?</li>
            <li>Has it ever actually delivered anything?</li>
            <li>If it takes your money, there's nowhere to warn the next person.</li>
            <li>A scammer just deletes the account and rebrands. History gone.</li>
          </ul>
        </div>
        <div className="card">
          <div className="section-label" style={{ color: "var(--ok)" }}>Paying a bot with a profile</div>
          <ul className="check-list good">
            <li>Deal history, ratings and reviews — before you pay.</li>
            <li>Impersonators fail the wallet↔profile check.</li>
            <li>Your review becomes part of the record the next buyer reads.</li>
            <li>Ditching bad reviews means ditching the good ones too — reputation costs something to abandon.</li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-label">Why it holds up</div>
        <ul className="check-list good" style={{ columns: 2, columnGap: 32 }}>
          <li><b>No fake checkmarks</b> — verification needs two signatures: the profile names the wallet, the wallet points back.</li>
          <li><b>No review-wiping</b> — everything lives in an append-only public log; even revoking is recorded.</li>
          <li><b>Free to start</b> — claiming a profile is one cheap transaction; register fully later, same identity, reputation carries over.</li>
          <li><b>Yours to keep or sell</b> — pin an identity to an address forever, or anchor it to an asset and sell it with its reputation.</li>
        </ul>
        <p className="hint" style={{ marginTop: 10 }}>
          Built on the ERC-8004 agent-identity standard. Everything here is a public on-chain
          record — any independent indexer reproduces it identically. No platform in the middle.
        </p>
      </div>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function MiniProfile({ id, onOpen }: { id: Identity; onOpen: () => void }) {
  const rep = id.reputation;
  const review = rep.reviews[0];
  return (
    <button className="mini-profile fade-in" onClick={onOpen} style={{ textAlign: "left", cursor: "pointer" }}>
      <div className="mp-head">
        <span className="mp-name">{displayName(id)}</span>
        {!id.flags.walletUnverified && id.agentWallet && <Badge tone="ok">verified</Badge>}
        {id.agentIds.length > 0 && <Badge tone="accent">registered</Badge>}
      </div>
      <div className="mp-stats">
        <span className="mp-stat"><b>{rep.ratingAverage === null ? "—" : rep.ratingAverage.toFixed(0)}</b><span>rating /100</span></span>
        <span className="mp-stat"><b>{rep.stars}</b><span>stars</span></span>
        <span className="mp-stat"><b>{rep.interactions.length}</b><span>deals</span></span>
        <span className="mp-stat"><b>{rep.reviews.length}</b><span>reviews</span></span>
      </div>
      {review && (
        <div className="mp-review">
          "{review.text.length > 90 ? review.text.slice(0, 90) + "…" : review.text}"
        </div>
      )}
      <div className="hint" style={{ marginTop: 10 }}>a live profile from this registry — click through</div>
    </button>
  );
}

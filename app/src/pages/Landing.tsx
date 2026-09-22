import { useState } from "react";
import { isAddress } from "viem";
import { Avatar, Badge } from "../components/ui";
import { api, type Identity } from "../lib/api";
import { useApp } from "../lib/app-state";
import { displayName, plural, pluralise } from "../lib/chain";

/** The product presentation: one plain sentence, a live lookup, and the story in bullets.
 *  Show a real profile before explaining a single concept. */
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
    // An address that IS an agent needs no designation and no mutual-pointing check: only that
    // address could have bound the record, so there is no second half left to fake.
    if (w?.self) setResult({ state: "found", ubid: w.self.ubid, verified: true });
    else if (w?.designation) setResult({ state: "found", ubid: w.designation.ubid, verified: w.verified });
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
            Profiles and reviews for AI agents.
          </h1>
          <p className="t2" style={{ fontSize: 14.5, marginTop: 12, maxWidth: 460 }}>
            Agents are starting to pay each other. If yours is about to pay one, you'll want to
            know two things: who is this, and are they any good? This answers both.
          </p>
          <div className="row wrap" style={{ marginTop: 18 }}>
            <button className="btn btn-primary" onClick={() => navigate("/identities")}>Browse agents</button>
            <button className="btn" onClick={() => navigate("/create")}>Create an identity</button>
            <button className="btn btn-ghost" onClick={() => navigate("/how")}>How it works</button>
          </div>
        </div>
        {showcase && (
          <div className="hero-art">
            <MiniProfile id={showcase} onOpen={() => navigate(`/identity/${showcase.ubid}`)} />
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="section-label">Try it. Who operates this wallet?</div>
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
            No agent here. This address is just a number, and nothing vouches for it. That's an answer too.
          </p>
        )}
        {found && (
          <div className="row wrap" style={{ marginTop: 12, gap: 10 }}>
            <Avatar seed={found.ubid} image={found.image} size={22} />
            <button style={{ fontSize: 15, fontWeight: 600 }} onClick={() => navigate(`/identity/${found.ubid}`)}>
              {displayName(found)}
            </button>
            {result?.verified ? <Badge tone="ok">verified both ways</Badge> : <Badge tone="warn">claim only, not verified</Badge>}
            <span className="t2 small">
              {found.reputation.ratingAverage !== null && <>rated {found.reputation.ratingAverage.toFixed(0)}/100 · </>}
              {plural(found.reputation.interactions.length, "recorded transaction")} · {plural(found.reputation.reviews.length, "review")}
            </span>
          </div>
        )}
      </div>

      <div className="steps-grid" style={{ marginTop: 14 }}>
        <div className="step">
          <StepIcon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4.35-4.35" />
          <b>Look up an address</b>
          <p>Paste it in, get an answer: an agent profile, or "just a number".</p>
        </div>
        <div className="step">
          <StepIcon d="M12 2l8 4v6c0 5.25-3.5 8.4-8 10-4.5-1.6-8-4.75-8-10V6l8-4zm-3.5 9.5l2.5 2.5 4.5-4.5" />
          <b>Check who you're dealing with</b>
          <p>The profile and the wallet vouch for each other. A copy of the website doesn't pass.</p>
        </div>
        <div className="step">
          <StepIcon d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          <b>Leave a review that sticks</b>
          <p>Point it at the payment transaction as proof. Nobody can delete it, not even us.</p>
        </div>
      </div>

      <div className="story-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="section-label" style={{ color: "var(--danger)" }}>Paying an agent today</div>
          <ul className="check-list bad">
            <li>Is this the real agent, or a copy of its site?</li>
            <li>Has it actually delivered for anyone?</li>
            <li>If it rips you off, there's nowhere to warn the next person.</li>
            <li>A scammer deletes the account and starts again under a new name.</li>
          </ul>
        </div>
        <div className="card">
          <div className="section-label" style={{ color: "var(--ok)" }}>Paying an agent with a profile</div>
          <ul className="check-list good">
            <li>See its deal history, ratings and reviews before you pay.</li>
            <li>Impersonators fail the wallet and profile check.</li>
            <li>Your review sticks, and the next buyer reads it.</li>
            <li>Ditching bad reviews means losing the good ones too, so nobody starts over lightly.</li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-label">Why it holds up</div>
        <ul className="check-list good" style={{ columns: 2, columnGap: 32 }}>
          <li><b>No fake checkmarks.</b> Verification takes two signatures: the profile names the wallet, and the wallet points back.</li>
          <li><b>No review-wiping.</b> Everything lives in a public, append-only log. Even revoking a review is recorded.</li>
          <li><b>Free to start.</b> Claiming a profile is one cheap transaction. Register properly later if you want, same identity, reviews carry over.</li>
          <li><b>Yours to keep or sell.</b> Pin an identity to an address forever, or anchor it to an asset and sell it with its reputation.</li>
        </ul>
        <p className="hint" style={{ marginTop: 10 }}>
          Built on the ERC-8004 agent identity standard. Everything here is a public on-chain
          record. Any independent indexer reproduces it identically, and there's no platform in
          the middle.
        </p>
      </div>
    </div>
  );
}


function StepIcon({ d }: { d: string }) {
  return (
    <svg className="step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function MiniProfile({ id, onOpen }: { id: Identity; onOpen: () => void }) {
  const rep = id.reputation;
  const review = rep.reviews[0];
  return (
    <button className="mini-profile fade-in" onClick={onOpen} style={{ textAlign: "left", cursor: "pointer" }}>
      <div className="mp-head">
        <Avatar seed={id.ubid} image={id.image} size={30} />
        <span className="mp-name">{displayName(id)}</span>
        {!id.flags.walletUnverified && id.agentWallet && <Badge tone="ok">verified</Badge>}
        {id.agentIds.length > 0 && <Badge tone="accent">registered</Badge>}
      </div>
      <div className="mp-stats">
        <span className="mp-stat"><b>{rep.ratingAverage === null ? "—" : rep.ratingAverage.toFixed(0)}</b><span>rating /100</span></span>
        <span className="mp-stat"><b>{rep.stars}</b><span>{pluralise(rep.stars, "star")}</span></span>
        <span className="mp-stat"><b>{rep.interactions.length}</b><span>{pluralise(rep.interactions.length, "transaction")}</span></span>
        <span className="mp-stat"><b>{rep.reviews.length}</b><span>{pluralise(rep.reviews.length, "review")}</span></span>
      </div>
      {review && (
        <div className="mp-review">
          "{review.text.length > 90 ? review.text.slice(0, 90) + "…" : review.text}"
        </div>
      )}
      <div className="hint" style={{ marginTop: 10 }}>a live profile from this registry - click through</div>
    </button>
  );
}

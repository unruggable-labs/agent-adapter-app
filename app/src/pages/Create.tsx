import { useEffect, useMemo, useState, type ReactNode } from "react";
import { encodeFunctionData, isAddress, type Address, type Hex } from "viem";
import { Addr, Badge, Spinner, StandardBadge, Tip } from "../components/ui";
import { useApp, settle } from "../lib/app-state";
import { adapterAbi, displayName, publicClient, shortHex } from "../lib/chain";
import { canSend, revertReason, sendTx } from "../lib/tx";

/**
 * Create an identity, one question at a time.
 *
 *  1. What are you registering? (a token, your own address, a contract) - plain words.
 *  2. Which one? - the coordinates.
 *  3. Who controls it? - the standard, as a visible dropdown the probe preselects. The standard is
 *     part of the UBID, so it is never guessed silently, and never asked as a bare enum either:
 *     every option is a sentence about who can change the record.
 *  4. Claim it - or, for a contract that has to speak for itself, the code and calls it needs.
 *
 * Authority is decided by simulating the real call, so the preflight and the contract's own
 * check are the same code path: delegate.xyz delegations pass here exactly when they pass there.
 */

type Kind = "token" | "eoa" | "contract";
type Mode = "claim" | "register";

interface StandardInfo {
  standard: number;
  name: string;
  /** Who can change the record, in a few words - the dropdown label. */
  short: string;
  /** The same, as one full sentence - shown under the dropdown. */
  rule: string;
}

const STANDARDS: StandardInfo[] = [
  { standard: 0, name: "ERC721", short: "whoever owns the token", rule: "Whoever owns the token (ownerOf). A delegate.xyz delegation from the owner also counts." },
  { standard: 1, name: "ERC1155", short: "anyone holding a balance of the id", rule: "Anyone holding a balance of this id. Every holder is a controller; delegations don't count." },
  { standard: 2, name: "ERC6909", short: "anyone holding a balance of the id", rule: "Anyone holding a balance of this id. Every holder is a controller; delegations don't count." },
  { standard: 3, name: "ERC1155F", short: "the single owner (1155 with ownerOf)", rule: "An ERC-1155 contract that also has ownerOf: the single owner controls it, delegations count." },
  { standard: 4, name: "ERC6909F", short: "the single owner (6909 with ownerOf)", rule: "An ERC-6909 contract that also has ownerOf: the single owner controls it, delegations count." },
  { standard: 5, name: "ACCOUNT", short: "the contract itself", rule: "The address itself. A contract bound this way has to make the calls itself." },
  { standard: 6, name: "CONTRACT_OWNABLE", short: "its owner()", rule: "The contract's current owner(), or a delegate.xyz delegate of the owner." },
  { standard: 7, name: "CONTRACT_ADMIN", short: "its admins (AccessControl)", rule: "Anyone holding the contract's DEFAULT_ADMIN_ROLE (OpenZeppelin AccessControl)." },
];
const BY_STANDARD = Object.fromEntries(STANDARDS.map((s) => [s.standard, s])) as Record<number, StandardInfo>;
const OFFERED: Record<Kind, number[]> = { token: [0, 1, 2, 3, 4], eoa: [5], contract: [6, 7, 5] };

/** What the chain says about the subject - gathered once, then read for every standard. */
interface Facts {
  hasCode: boolean;
  name: string | null;
  ownerOf: Address | null; // token standards: ownerOf(tokenId), null when it reverts
  balance: bigint | null; // token standards: balanceOf(you, tokenId), null when it reverts
  supports: { erc721: boolean; erc1155: boolean; erc6909: boolean };
  owner: Address | null; // contract standards: owner()
  isAdmin: boolean; // contract standards: hasRole(DEFAULT_ADMIN_ROLE, you)
}

const probeAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] },
] as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_ROLE = ("0x" + "00".repeat(32)) as Hex;

async function read<T>(address: Address, functionName: string, args: unknown[] = []): Promise<T | null> {
  return publicClient.readContract({ address, abi: probeAbi, functionName: functionName as never, args: args as never }).then((v) => v as T).catch(() => null);
}

async function gatherFacts(kind: Kind, address: Address, tokenId: bigint, you: Address | null): Promise<Facts> {
  const code = await publicClient.getCode({ address }).catch(() => undefined);
  const hasCode = !!code && code !== "0x";
  const me = you ?? ZERO_ADDRESS;
  const [name, ownerOf, balance, erc721, erc1155, erc6909, owner, isAdmin] = await Promise.all([
    hasCode ? read<string>(address, "name") : null,
    kind === "token" ? read<Address>(address, "ownerOf", [tokenId]) : null,
    kind === "token" ? read<bigint>(address, "balanceOf", [me, tokenId]) : null,
    kind === "token" ? read<boolean>(address, "supportsInterface", ["0x80ac58cd"]) : null,
    kind === "token" ? read<boolean>(address, "supportsInterface", ["0xd9b67a26"]) : null,
    kind === "token" ? read<boolean>(address, "supportsInterface", ["0x0f632fb3"]) : null,
    kind === "contract" ? read<Address>(address, "owner") : null,
    kind === "contract" && you ? read<boolean>(address, "hasRole", [ZERO_ROLE, you]) : null,
  ]);
  return {
    hasCode,
    name: name && name.length <= 64 ? name : null,
    ownerOf: ownerOf && ownerOf !== ZERO_ADDRESS ? (ownerOf.toLowerCase() as Address) : null,
    balance,
    supports: { erc721: !!erc721, erc1155: !!erc1155, erc6909: !!erc6909 },
    owner: owner && owner !== ZERO_ADDRESS ? (owner.toLowerCase() as Address) : null,
    isAdmin: !!isAdmin,
  };
}

/** The probe's pick, and why, in one line. The user can always override it in the dropdown. */
function suggest(kind: Kind, f: Facts, you: Address | null): { standard: number; why: string } {
  if (kind === "eoa") return { standard: 5, why: "Your own address: only it can speak for itself." };
  if (kind === "contract") {
    if (f.owner && you && f.owner === you) return { standard: 6, why: "The contract's owner() is your address." };
    if (f.isAdmin) return { standard: 7, why: "Your address holds the contract's DEFAULT_ADMIN_ROLE." };
    if (f.owner) return { standard: 6, why: `The contract has an owner() - ${shortHex(f.owner, 10)} - which isn't you.` };
    return { standard: 5, why: "No owner() and no admin role found, so the contract would have to speak for itself." };
  }
  const { erc721, erc1155, erc6909 } = f.supports;
  if (f.ownerOf && erc1155 && !erc721) return { standard: 3, why: "The contract reports ERC-1155 and also answers ownerOf, so it can bind as a single-owner token." };
  if (f.ownerOf && erc6909 && !erc721) return { standard: 4, why: "The contract reports ERC-6909 and also answers ownerOf, so it can bind as a single-owner token." };
  if (f.ownerOf) return { standard: 0, why: `ownerOf answers (${shortHex(f.ownerOf, 10)}), the ERC-721 rule.` };
  if (erc6909) return { standard: 2, why: "The contract reports ERC-6909 and ownerOf does not answer, so control is by balance." };
  if (erc1155) return { standard: 1, why: "The contract reports ERC-1155 and ownerOf does not answer, so control is by balance." };
  return { standard: 0, why: "ownerOf reverts for this id - the token may not exist yet, or be burned. Only the collection contract can claim it right now." };
}

type Path = "wallet" | "developer";

/** The root question: will this identity be created by signing here, or by a contract? */
export function CreatePage() {
  const [path, setPath] = useState<Path | null>(null);
  return (
    <div className="page fade-in">
      <h1 className="page-title">Create an identity</h1>
      <p className="page-sub">Give something you control a profile. The UBID it gets is permanent.</p>

      <Step n={1} title="How will this identity come to exist?">
        <Choice
          selected={path === "wallet"}
          onClick={() => setPath("wallet")}
          title="I'll sign a transaction here"
          sub="For a token I hold, my own address, or a contract I already control. Ends in a button."
        />
        <Choice
          selected={path === "developer"}
          onClick={() => setPath("developer")}
          title="I'm writing a contract"
          sub="It will claim identities itself - for the tokens it mints, or for itself. Ends in code."
        />
      </Step>

      {path === "wallet" && <WalletFlow />}
      {path === "developer" && <DeveloperFlow />}
    </div>
  );
}

/** Steps 2 to 5 for someone who will sign from the connected wallet. */
function WalletFlow() {
  const { signer, overview, identities, navigate, refresh, toast } = useApp();
  const [kind, setKind] = useState<Kind | null>(null);
  const [address, setAddress] = useState("");
  const [tokenIdText, setTokenIdText] = useState("");
  const [facts, setFacts] = useState<Facts | null>(null);
  const [probing, setProbing] = useState(false);
  const [standard, setStandard] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<{ standard: number; why: string } | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [ubid, setUbid] = useState<Hex | null>(null);
  const [mode, setMode] = useState<Mode>("claim");
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Hex | null>(null);

  const adapter = overview?.adapter;
  const bound: Address | null = kind === "eoa" ? (signer?.address ?? null) : isAddress(address) ? (address.toLowerCase() as Address) : null;
  const tokenId: bigint | null = kind === "token" ? (/^\d+$/.test(tokenIdText) ? BigInt(tokenIdText) : null) : kind ? 0n : null;
  const coordsReady = !!kind && !!bound && tokenId !== null;

  // Step 2 settled: gather the facts and let the probe suggest a standard.
  useEffect(() => {
    setFacts(null);
    setStandard(null);
    setSuggested(null);
    setAuthorized(null);
    setUbid(null);
    setDone(null);
    if (!coordsReady || !bound || tokenId === null) return;
    let cancelled = false;
    setProbing(true);
    gatherFacts(kind!, bound, tokenId, signer?.address ?? null)
      .then((f) => {
        if (cancelled) return;
        setFacts(f);
        const s = suggest(kind!, f, signer?.address ?? null);
        setStandard(s.standard);
        setSuggested(s);
      })
      .finally(() => !cancelled && setProbing(false));
    return () => {
      cancelled = true;
    };
  }, [kind, bound, tokenId, signer?.address]);

  // Step 3 settled: the UBID for these exact coordinates, and whether you would pass the
  // contract's own check - by simulating the real call, not by re-implementing the rule.
  useEffect(() => {
    setAuthorized(null);
    setUbid(null);
    if (!adapter || standard === null || !bound || tokenId === null) return;
    let cancelled = false;
    const args = [standard, bound, tokenId] as const;
    Promise.all([
      publicClient.readContract({ address: adapter, abi: adapterAbi, functionName: "hashBinding", args: [...args] }).catch(() => null),
      canSend(signer, adapter, adapterAbi, "counterfactualRegister", [...args, "preflight"]),
    ]).then(([h, ok]) => {
      if (cancelled) return;
      setUbid((h as Hex | null) ?? null);
      setAuthorized(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, standard, bound, tokenId, signer?.address]);

  // The same coordinates under a different standard are a different identity. Say so before
  // anyone makes a second one by accident.
  const siblings = useMemo(
    () => (bound && tokenId !== null ? identities.filter((i) => i.boundAddress === bound && BigInt(i.tokenId) === tokenId && i.standard !== standard) : []),
    [identities, bound, tokenId, standard],
  );
  const existing = useMemo(() => identities.find((i) => i.ubid === ubid) ?? null, [identities, ubid]);

  if (!adapter) return <Spinner />;

  if (done) {
    return (
      <div className="step-block fade-in">
        <h2 className="h-section">Identity {mode === "claim" ? "claimed" : "registered"}</h2>
        <p className="page-sub">This UBID is the identity's permanent name on this chain.</p>
        <div className="card">
          <div className="section-label">UBID</div>
          <div className="mono" style={{ overflowWrap: "anywhere" }}>{done}</div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" onClick={() => navigate(`/identity/${done}`)}>Open profile</button>
          <button className="btn btn-ghost" onClick={() => { setDone(null); setKind(null); setAddress(""); setTokenIdText(""); setUri(""); }}>Create another</button>
        </div>
      </div>
    );
  }

  const info = standard !== null ? BY_STANDARD[standard] : null;
  const contractAsItself = kind === "contract" && standard === 5;

  return (
    <>
      <Step n={2} title="What are you registering?">
        <Choice selected={kind === "token"} onClick={() => setKind("token")} title="A token I hold" sub="An NFT or a token id. The identity travels with the token." />
        <Choice
          selected={kind === "eoa"}
          onClick={() => setKind("eoa")}
          disabled={!signer}
          title={signer ? "My own address" : "My own address (connect a wallet first)"}
          sub={signer ? `${shortHex(signer.address, 10)} becomes the agent. One transaction, nothing else needed.` : "Your wallet itself becomes the agent."}
        />
        <Choice selected={kind === "contract"} onClick={() => setKind("contract")} title="A contract" sub="Controlled by its owner, its admins, or the contract itself." />
      </Step>

      {kind && kind !== "eoa" && (
        <Step n={3} title={kind === "token" ? "Which token?" : "Which contract?"}>
          <div className="field">
            <label>{kind === "token" ? "Token contract" : "Contract address"}</label>
            <input className="input mono" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value.trim())} />
          </div>
          {kind === "token" && (
            <div className="field">
              <label>Token id</label>
              <input className="input mono" placeholder="7" value={tokenIdText} onChange={(e) => setTokenIdText(e.target.value.trim())} />
            </div>
          )}
          {probing && <p className="hint" style={{ margin: "10px 0 0" }}><Spinner /> reading the contract…</p>}
          {facts && !facts.hasCode && <p className="hint" style={{ margin: "10px 0 0", color: "var(--danger)" }}>No contract at this address on this network.</p>}
          {facts?.name && <p className="hint" style={{ margin: "10px 0 0" }}>Found <b>{facts.name}</b>.</p>}
        </Step>
      )}

      {kind && facts && standard !== null && info && (kind === "eoa" || facts.hasCode) && (
        <Step n={kind === "eoa" ? 3 : 4} title="Who controls it?">
          <p className="t2 small" style={{ margin: "0 0 10px" }}>
            The control rule is part of the identity's name, so it can't change later. Pick the one that
            describes how this {kind === "token" ? "token" : kind === "eoa" ? "address" : "contract"} is actually held.
          </p>
          <div className="row wrap" style={{ gap: 10 }}>
            <select className="select" style={{ width: "auto", maxWidth: "100%" }} value={standard} disabled={OFFERED[kind].length === 1} onChange={(e) => setStandard(Number(e.target.value))}>
              {OFFERED[kind].map((s) => (
                <option key={s} value={s}>{BY_STANDARD[s].name} - {BY_STANDARD[s].short}</option>
              ))}
            </select>
          </div>
          <p className="hint" style={{ margin: "8px 0 0" }}>
            <StandardBadge name={info.name} /> <span> </span>{info.rule}{" "}
            {suggested && suggested.standard === standard
              ? <span className="t3">Suggested because: {suggested.why}</span>
              : suggested && <span className="t3">You changed this from the suggested {BY_STANDARD[suggested.standard].name}. <button className="agent-link" onClick={() => setStandard(suggested.standard)}>Use the suggestion</button></span>}
          </p>

          <dl className="kv" style={{ marginTop: 12 }}>
            <dt><Tip tip="The contract's own check, run here first: would counterfactualRegister succeed from your address right now? Delegate.xyz delegations are honoured because this is the real call, simulated.">Authority</Tip></dt>
            <dd>
              {authorized === null ? <Spinner /> : authorized
                ? <span className="row"><Badge tone="ok">you pass</Badge><span className="t2 small">{authorityDetail(kind, standard, facts, signer?.address ?? null, true)}</span></span>
                : <span className="row"><Badge tone="danger">you don't pass</Badge><span className="t2 small">{authorityDetail(kind, standard, facts, signer?.address ?? null, false)}</span></span>}
            </dd>
            <dt><Tip tip="The identity's permanent name - a hash the live contract computes from the standard, the address and the token id. Same whether you claim now or register fully later.">UBID</Tip></dt>
            <dd className="mono" style={{ overflowWrap: "anywhere" }}>{ubid ?? "-"}</dd>
          </dl>

          {existing && (
            <p className="callout callout-ok" style={{ marginTop: 12 }}>
              <b>This identity already exists.</b> {displayName(existing)} is {existing.agentIds.length ? "registered on-chain" : "claimed"} under exactly these
              coordinates. <button className="agent-link" onClick={() => navigate(`/identity/${existing.ubid}`)}>Open its profile</button> - claiming
              again restates the record rather than creating a second one.
            </p>
          )}
          {siblings.length > 0 && (
            <p className="callout callout-warn" style={{ marginTop: 12 }}>
              <b>Same {kind === "token" ? "token" : "address"}, different rule.</b> An identity already exists for these coordinates as{" "}
              {siblings.map((s, i) => (
                <span key={s.ubid}>{i > 0 && ", "}<button className="agent-link" onClick={() => navigate(`/identity/${s.ubid}`)}>{BY_STANDARD[s.standard]?.name ?? s.standardName}</button></span>
              ))}. A different standard is a different UBID with its own reputation. Continue only if you mean to have two.
            </p>
          )}
        </Step>
      )}

      {kind && facts && standard !== null && authorized !== null && ubid && (kind === "eoa" || facts.hasCode) && (
        authorized ? (
          <Step n={kind === "eoa" ? 4 : 5} title="Claim it">
            <div className="seg" style={{ marginBottom: 12 }}>
              <button className={mode === "claim" ? "active" : ""} onClick={() => setMode("claim")}>Claim (counterfactual)</button>
              <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Register (mint an ERC-8004 agent)</button>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              {mode === "claim"
                ? "One cheap transaction; the identity lives in the event log. Reputation earned now carries over if you register later, because the UBID is the same."
                : "Mints a real ERC-8004 agent on the shared registry, bound to this subject. Any history under this UBID joins automatically."}
            </p>
            <div className="field">
              <label>Agent URI</label>
              <input className="input" placeholder="ipfs://… or https://…/agent.json" value={uri} onChange={(e) => setUri(e.target.value)} />
              <span className="hint">Where the agent's card lives. Whoever holds authority can change it later.</span>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button
                className="btn btn-primary"
                disabled={busy || !uri.trim()}
                onClick={async () => {
                  setBusy(true);
                  const fn = mode === "claim" ? "counterfactualRegister" : "register";
                  const r = await sendTx(signer, adapter, adapterAbi, fn, [standard, bound, tokenId, uri.trim()]);
                  toast(r.ok ? r.message : revertReason(r.message));
                  if (r.ok) {
                    await settle(refresh);
                    setDone(ubid);
                  }
                  setBusy(false);
                }}
              >
                {busy ? <Spinner /> : mode === "claim" ? "Claim" : "Register"}
              </button>
              <span className="hint">Simulated first - a call that would fail never reaches your wallet.</span>
            </div>
          </Step>
        ) : contractAsItself ? (
          <ContractGuide n={5} adapter={adapter} contract={bound!} ubid={ubid} uri={uri} setUri={setUri} you={signer?.address ?? null} />
        ) : (
          <Step n={kind === "eoa" ? 4 : 5} title="Not from this wallet">
            <p className="t2 small" style={{ margin: 0 }}>
              {kind === "contract"
                ? standard === 6
                  ? <>Connect as the contract's owner{facts.owner ? <> (<Addr value={facts.owner} n={8} />)</> : null}, or have the owner grant your address a delegate.xyz delegation. If the contract has no owner(), pick a different rule above.</>
                  : <>Connect as an address that holds the contract's DEFAULT_ADMIN_ROLE, or pick a different rule above.</>
                : facts.ownerOf
                  ? <>Connect as the token's owner (<Addr value={facts.ownerOf} n={8} />), or have the owner grant your address a delegate.xyz delegation for it.</>
                  : <>Hold a balance of this id from the connected wallet, or pick a different rule above.</>}
            </p>
          </Step>
        )
      )}
    </>
  );
}

type Plan = "mint" | "self" | "controlled";

/** Steps 2 and 3 for someone writing a contract: what it will do, then the code for that. */
function DeveloperFlow() {
  const { signer, overview } = useApp();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [uri, setUri] = useState("");
  const adapter = overview?.adapter;
  if (!adapter) return <Spinner />;
  return (
    <>
      <Step n={2} title="What will the contract do?">
        <Choice selected={plan === "mint"} onClick={() => setPlan("mint")} title="Mint tokens that each get an identity" sub="An NFT collection whose every token is an agent. The identity exists before the first owner does." />
        <Choice selected={plan === "self"} onClick={() => setPlan("self")} title="Be an agent itself" sub="The contract is the agent. It claims and manages its own identity." />
        <Choice selected={plan === "controlled"} onClick={() => setPlan("controlled")} title="Be controlled by its owner or admins" sub="The contract is the subject; a person claims for it. Usually no new code at all." />
      </Step>
      {plan === "mint" && <MintGuide n={3} adapter={adapter} />}
      {plan === "self" && <ContractGuide n={3} adapter={adapter} contract={null} ubid={null} uri={uri} setUri={setUri} you={signer?.address ?? null} title="Give the contract a voice" />}
      {plan === "controlled" && <ControlledGuide n={3} />}
    </>
  );
}

/**
 * The mint-time pattern. The adapter lets a token contract act for one of its own tokens while
 * ownerOf reverts or returns zero, so a collection that claims inside mint(), before _mint,
 * gives every token an identity that the first owner then inherits.
 */
function MintGuide({ n, adapter }: { n: number; adapter: Address }) {
  const [standard, setStandard] = useState<0 | 3 | 4>(0);
  const [full, setFull] = useState(false);
  const name = BY_STANDARD[standard].name;
  const call = full ? "register" : "counterfactualRegister";
  const code = `interface IAdapter8004 {
    function ${call}(uint8 standard, address boundAddress, uint256 tokenId, string calldata agentURI)
        external returns (${full ? "uint256 agentId" : "bytes32 ubid"});
    function hashBinding(uint8 standard, address boundAddress, uint256 tokenId) external view returns (bytes32);
}

contract AgentCollection is ${standard === 0 ? "ERC721" : standard === 3 ? "ERC1155 /* with ownerOf */" : "ERC6909 /* with ownerOf */"} {
    IAdapter8004 public constant ADAPTER = IAdapter8004(${adapter});
    uint8 private constant STANDARD = ${standard}; // ${name}

    function mint(address to, uint256 tokenId, string calldata agentURI) external {
        // ownerOf(tokenId) still reverts here, so this contract may speak for the token.
        ADAPTER.${call}(STANDARD, address(this), tokenId, agentURI);
        _${standard === 0 ? "safeMint(to, tokenId)" : "mint(to, tokenId, 1, \"\")"};
        // From here on, only the holder (or their delegate.xyz delegate) controls the identity.
    }

    // The UBID is known before the token exists - put it in the token's metadata if you like.
    function ubidOf(uint256 tokenId) external view returns (bytes32) {
        return ADAPTER.hashBinding(STANDARD, address(this), tokenId);
    }
}`;
  return (
    <Step n={n} title="Claim inside mint, before the token exists">
      <p className="t2 small" style={{ margin: "0 0 10px" }}>Every token gets its identity in the same transaction that mints it.</p>
      <div className="guide-label">What the adapter allows</div>
      <ul className="guide-list">
        <li>A token contract may act for one of its own tokens while <span className="mono">ownerOf(tokenId)</span> reverts or returns zero.</li>
        <li>That is true before the mint. So the contract claims first, mints second, and the identity is waiting for the first owner.</li>
        <li>After the mint, only the holder (or their delegate.xyz delegate) controls it. The collection does not.</li>
      </ul>
      <div className="guide-label">What you do</div>
      <ol className="guide-list">
        <li>Pick the token standard and whether each mint claims or fully registers.</li>
        <li>Call the adapter inside <span className="mono">mint()</span>, before <span className="mono">_mint</span>, as in the code below.</li>
        <li>Optionally expose the UBID. It is computable before the token exists, so it can go in the token's metadata.</li>
      </ol>
      <div className="row wrap" style={{ gap: 10, marginBottom: 10 }}>
        <label className="row" style={{ gap: 8 }}>
          <span className="hint">Token standard</span>
          <select className="select" style={{ width: "auto" }} value={standard} onChange={(e) => setStandard(Number(e.target.value) as 0 | 3 | 4)}>
            <option value={0}>ERC721</option>
            <option value={3}>ERC1155F - ERC-1155 with ownerOf</option>
            <option value={4}>ERC6909F - ERC-6909 with ownerOf</option>
          </select>
        </label>
        <label className="row" style={{ gap: 8 }}>
          <span className="hint">Per token</span>
          <select className="select" style={{ width: "auto" }} value={full ? "register" : "claim"} onChange={(e) => setFull(e.target.value === "register")}>
            <option value="claim">claim (event only, cheap)</option>
            <option value="register">register (mints an ERC-8004 agent)</option>
          </select>
        </label>
      </div>
      <p className="hint" style={{ margin: "0 0 8px" }}>
        Only the single-owner standards have this window: plain ERC-1155 and ERC-6909 control by balance, so
        there is no ownerless moment. {full ? "Registering at mint costs an ERC-8004 mint per token; the UBID is the same either way." : "A claim is one event per mint. Anyone can register fully later under the same UBID."}
      </p>
      <CodeBlock code={code} />
      <div className="callout callout-warn" style={{ marginTop: 14 }}>
        <b>The window reopens after a burn.</b> A collection that burns a token and re-claims its identity is
        allowed to, and Adapterscan says so: the profile's history shows a collection-authored claim after
        an owner existed. Worth knowing before you promise holders anything.
      </div>
    </Step>
  );
}

/** Ownable or AccessControl is all the contract needs; the claim itself is a wallet transaction. */
function ControlledGuide({ n }: { n: number }) {
  const code = `import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// owner() is the whole requirement for CONTRACT_OWNABLE: whoever it returns can claim and
// manage the identity from their wallet - here, on the "I'll sign a transaction here" path.
contract MyThing is Ownable {
    constructor() Ownable(msg.sender) {}
}

// Or AccessControl: holders of DEFAULT_ADMIN_ROLE control a CONTRACT_ADMIN identity.`;
  return (
    <Step n={n} title="No new code, most likely">
      <p className="t2 small" style={{ margin: "0 0 10px" }}>The contract is the subject. A person claims for it, from a wallet, on the other path.</p>
      <div className="guide-label">What the adapter checks</div>
      <ul className="guide-list">
        <li><b>CONTRACT_OWNABLE</b> - the caller is whatever <span className="mono">owner()</span> returns, or a delegate.xyz delegate of it.</li>
        <li><b>CONTRACT_ADMIN</b> - the caller holds AccessControl's <span className="mono">DEFAULT_ADMIN_ROLE</span>.</li>
      </ul>
      <div className="guide-label">What you do</div>
      <ol className="guide-list">
        <li>Make sure the contract has one of those. OpenZeppelin's Ownable or AccessControl is the whole requirement. If it already does, there is nothing to add.</li>
        <li>Deploy it.</li>
        <li>Connect as the owner or an admin, choose "I'll sign a transaction here" above, then "A contract", and paste its address. The claim is one transaction.</li>
      </ol>
      <p className="hint" style={{ margin: "0 0 8px" }}>If it has neither yet, the smallest version:</p>
      <CodeBlock code={code} />
      <p className="hint" style={{ margin: "10px 0 0" }}>
        The owner can also grant a delegate.xyz delegation so another wallet manages the identity without holding the contract.
      </p>
    </Step>
  );
}

function authorityDetail(kind: Kind, standard: number, f: Facts, you: Address | null, pass: boolean): string {
  if (kind === "eoa") return "an ACCOUNT identity authorises exactly its own address, and you are it";
  if (standard === 6) return f.owner ? `owner() is ${shortHex(f.owner, 10)}${f.owner === you ? ", your address" : ""}` : "the contract does not answer owner()";
  if (standard === 7) return f.isAdmin ? "your address holds DEFAULT_ADMIN_ROLE" : "your address does not hold DEFAULT_ADMIN_ROLE";
  if (standard === 5) return pass ? "the contract has delegated to your address" : "only the contract itself (or a delegate.xyz delegate it named) passes";
  if (standard === 1 || standard === 2) return f.balance !== null ? `your balance of this id is ${f.balance}` : "the contract does not answer balanceOf for this id";
  return f.ownerOf ? `ownerOf is ${shortHex(f.ownerOf, 10)}${f.ownerOf === you ? ", your address" : pass ? ", and you hold a delegation" : ""}` : "ownerOf reverts for this id";
}

/**
 * A contract bound as itself has to make the calls: the adapter checks msg.sender against the
 * bound address and nothing else. So this step is instructions, not a button - the code to add,
 * or the exact call to send from a contract that can already execute arbitrary calls.
 */
function ContractGuide({ n, adapter, contract, ubid, uri, setUri, you, title }: { n: number; adapter: Address; contract: Address | null; ubid: Hex | null; uri: string; setUri: (v: string) => void; you: Address | null; title?: string }) {
  const { navigate } = useApp();
  const [route, setRoute] = useState<"execute" | "code" | "delegate">(contract ? "execute" : "code");
  const agentURI = uri.trim() || "ipfs://…/agent.json";
  const target = contract ?? ZERO_ADDRESS;
  const registerData = encodeFunctionData({ abi: adapterAbi, functionName: "counterfactualRegister", args: [5, target, 0n, agentURI] });
  const walletData = encodeFunctionData({ abi: adapterAbi, functionName: "counterfactualSetAgentWalletAndUBID", args: [5, target, 0n] });

  const solidity = `interface IAdapter8004 {
    function counterfactualRegister(uint8 standard, address boundAddress, uint256 tokenId, string calldata agentURI)
        external returns (bytes32 ubid);
    function counterfactualSetAgentURI(uint8 standard, address boundAddress, uint256 tokenId, string calldata newURI)
        external returns (bytes32 ubid);
    function counterfactualSetAgentWalletAndUBID(uint8 standard, address boundAddress, uint256 tokenId)
        external returns (bytes32 ubid);
}

contract MyAgent {
    IAdapter8004 public constant ADAPTER = IAdapter8004(${adapter});
    uint8 private constant ACCOUNT = 5; // the contract itself is the controller

    // Gate these the way you gate any admin action on your contract.
    function registerIdentity(string calldata agentURI) external /* onlyOwner */ {
        ADAPTER.counterfactualRegister(ACCOUNT, address(this), 0, agentURI);
    }

    // Optional: name this contract as its own operating wallet - one call, verified both ways.
    function linkOwnWallet() external /* onlyOwner */ {
        ADAPTER.counterfactualSetAgentWalletAndUBID(ACCOUNT, address(this), 0);
    }
}`;

  const delegateNote = `// From the contract, on the delegate.xyz registry (0x00000000000000447e69651d841bD8D104Bed493):
delegateAll(${you ?? "<your wallet>"}, keccak256("adapter8004.manage"), true)`;

  return (
    <Step n={n} title={title ?? "The contract has to speak for itself"}>
      <p className="t2 small" style={{ margin: "0 0 10px" }}>The contract is the agent, so the contract has to make the calls.</p>
      <div className="guide-label">What the adapter checks</div>
      <ul className="guide-list">
        <li>Bound as <b>ACCOUNT</b>, the identity is controlled by the address itself: the caller must <i>be</i> the contract.</li>
        <li>No wallet can do this on its behalf. The only exception is a delegate.xyz delegation the contract itself has granted.</li>
        <li>The token id is always 0 for ACCOUNT.</li>
      </ul>
      <div className="guide-label">Three ways to make the call</div>
      <ul className="guide-list">
        <li><b>Add code to it</b> - a function that calls the adapter, gated like your other admin actions.</li>
        <li><b>It can execute calls</b> - a Safe, a smart wallet, or any contract with an execute function sends the prebuilt call.{contract ? "" : " Needs the deployed address."}</li>
        <li><b>Delegate to my wallet</b> - one call from the contract, then you manage the identity from here like any other.</li>
      </ul>
      <div className="seg" style={{ margin: "0 0 12px" }}>
        <button className={route === "code" ? "active" : ""} onClick={() => setRoute("code")}>Add code to it</button>
        <button className={route === "execute" ? "active" : ""} disabled={!contract} title={contract ? undefined : "Needs the deployed address"} onClick={() => setRoute("execute")}>It can execute calls</button>
        <button className={route === "delegate" ? "active" : ""} onClick={() => setRoute("delegate")}>Delegate to my wallet</button>
      </div>

      {route === "execute" && (
        <>
          <ol className="guide-list">
            <li>Enter the agent URI; it is encoded into the register call.</li>
            <li>From the contract, send call 1: target the adapter, value 0, data as shown.</li>
            <li>Optionally send call 2, which names the contract as its own operating wallet.</li>
          </ol>
          <div className="field" style={{ marginBottom: 4 }}>
            <label>Agent URI <span className="t3">(encoded into the register call below)</span></label>
            <input className="input" placeholder="ipfs://… or https://…/agent.json" value={uri} onChange={(e) => setUri(e.target.value)} />
          </div>
          <CallBlock label="1. Register" to={adapter} data={registerData} />
          <CallBlock label="2. Link its wallet (optional)" to={adapter} data={walletData} />
        </>
      )}
      {route === "code" && (
        <>
          <ol className="guide-list">
            <li>Add a function that calls the adapter, gated the way your contract gates admin actions.</li>
            <li>Deploy, then call it once with the agent URI.</li>
            <li>Optionally call the second function so the contract is its own operating wallet, verified both ways in one call.</li>
          </ol>
          <CodeBlock code={solidity} />
        </>
      )}
      {route === "delegate" && (
        <>
          <ol className="guide-list">
            <li>From the contract, call the delegate.xyz registry as below. It grants your wallet the adapter's rights for this contract.</li>
            <li>Come back with that wallet connected: the claim, and everything after it, is a normal transaction here.</li>
          </ol>
          <CodeBlock code={delegateNote} />
        </>
      )}

      <div className="callout" style={{ marginTop: 14 }}>
        <b>Then come back.</b>{" "}
        {ubid ? (
          <>Once the call lands, the identity appears here under its UBID{" "}
            <span className="mono small" style={{ overflowWrap: "anywhere" }}>{ubid}</span>.{" "}
            <button className="agent-link" onClick={() => navigate(`/identity/${ubid}`)}>Its profile page</button> will show it as soon as the indexer sees the event.</>
        ) : (
          <>Once the contract is deployed and has made the call, search its address here: the identity appears under a UBID computed from the contract address, and nothing else.</>
        )}
      </div>
    </Step>
  );
}

function CallBlock({ label, to, data }: { label: string; to: Address; data: Hex }) {
  return (
    <div className="callblock">
      <div className="row spread"><span className="section-label" style={{ margin: 0 }}>{label}</span><CopyButton text={data} /></div>
      <dl className="kv small" style={{ marginTop: 6 }}>
        <dt>to</dt><dd className="mono">{to}</dd>
        <dt>value</dt><dd className="mono">0</dd>
        <dt>data</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{data}</dd>
      </dl>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="codeblock">
      <div className="codeblock-bar"><CopyButton text={code} /></div>
      <pre>{code}</pre>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 900); }}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** One numbered step. Steps appear as the previous one settles, so the page reads top to bottom. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="step-block fade-in">
      <div className="step-head"><span className="step-num">{n}</span><h2 className="h-section" style={{ margin: 0 }}>{title}</h2></div>
      <div className="card">{children}</div>
    </div>
  );
}

function Choice({ selected, onClick, title, sub, disabled }: { selected: boolean; onClick: () => void; title: string; sub: string; disabled?: boolean }) {
  return (
    <button className={`choice ${selected ? "selected" : ""}`} onClick={onClick} disabled={disabled}>
      <div className="c-title">{title}</div>
      <div className="c-sub">{sub}</div>
    </button>
  );
}

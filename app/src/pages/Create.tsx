import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { Addr, Badge, Spinner, StandardBadge, Tip } from "../components/ui";
import { api, type TrustBase } from "../lib/api";
import { useApp, settle } from "../lib/app-state";
import { adapterAbi, erc721Abi, publicClient, shortHex } from "../lib/chain";
import { revertReason, sendTx } from "../lib/tx";

type SubjectKind = "token" | "eoa" | "contract";

interface Probe {
  standard: number | null;
  standardName: string;
  owner: Address | null;
  youAreAuthorized: boolean;
  detail: string;
  trust: TrustBase | null;
  ubid: Hex | null;
  tokenName: string | null;
}

/** "What are you registering?" - the wizard derives the standard and the authority story
 *  from the chain instead of asking the user to know the enum. */
export function CreatePage() {
  const { signer, overview, navigate, refresh, toast } = useApp();
  const [kind, setKind] = useState<SubjectKind | null>(null);
  const [contract, setContract] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probing, setProbing] = useState(false);
  const [mode, setMode] = useState<"claim" | "register">("claim");
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Hex | null>(null);

  const adapter = overview?.adapter;

  // ---- probe the subject whenever the coordinates settle -------------------------------
  useEffect(() => {
    setProbe(null);
    setDone(null);
    if (!adapter) return;
    if (kind === "eoa") {
      if (signer) probeEoa(adapter, signer.address).then(setProbe);
      return;
    }
    if (kind === "token" && isAddress(contract) && tokenId !== "" && !Number.isNaN(Number(tokenId))) {
      setProbing(true);
      probeToken(adapter, contract as Address, BigInt(tokenId ), signer?.address ?? "0x0000000000000000000000000000000000000000")
        .then(setProbe)
        .finally(() => setProbing(false));
    }
  }, [kind, contract, tokenId, signer?.address, adapter]);

  if (!adapter) return <div className="page"><Spinner /></div>;

  if (done) {
    return (
      <div className="page page-narrow fade-in">
        <h1 className="page-title">Identity {mode === "claim" ? "claimed" : "registered"}</h1>
        <p className="page-sub">This UBID is the identity's permanent name on this chain.</p>
        <div className="card">
          <div className="section-label">UBID</div>
          <div className="mono" style={{ overflowWrap: "anywhere" }}>{done}</div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" onClick={() => navigate(`/identity/${done}`)}>Open profile</button>
          <button className="btn btn-ghost" onClick={() => { setDone(null); setKind(null); setProbe(null); setUri(""); }}>Create another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow fade-in">
      <h1 className="page-title">Create an identity</h1>
      <p className="page-sub">Bind an ERC-8004 agent identity to something you control.</p>

      <div className="section-label">What are you registering?</div>
      <ChoiceButton
        selected={kind === "token"}
        onClick={() => setKind("token")}
        title="A token I hold"
        sub="An NFT or token - its identity travels with ownership of the token."
      />
      <ChoiceButton
        selected={kind === "eoa"}
        onClick={() => setKind("eoa")}
        title={signer ? `${signer.label}'s own address` : "My own address"}
        sub={signer ? `Your wallet itself becomes the agent (${shortHex(signer.address, 10)}). One transaction, nothing else needed.` : "Connect a wallet first (bottom of the sidebar)."}
      />
      <ChoiceButton
        disabled
        selected={false}
        onClick={() => {}}
        title="A contract, as itself"
        sub="Requires the contract to make the call - via a Safe transaction or an integration snippet. Coming in the next phase."
      />

      {kind === "token" && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="field">
            <label>Token contract</label>
            <input className="input mono" placeholder="0x…" value={contract} onChange={(e) => setContract(e.target.value.trim())} />
          </div>
          <div className="field">
            <label>Token id</label>
            <input className="input mono" placeholder="7" value={tokenId} onChange={(e) => setTokenId(e.target.value.trim())} />
          </div>
          {probing && <p className="hint" style={{ marginTop: 10 }}><Spinner /> probing the contract…</p>}
        </div>
      )}

      {probe && (
        <div className="fade-in">
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-label">Preflight</div>
            <dl className="kv">
              <dt><Tip tip="The kind of controller this identity binds to. It decides who can update the identity, forever: a token standard means whoever owns the token; ACCOUNT means only this address itself. Detected by probing the subject on-chain.">Standard</Tip></dt>
              <dd className="row">
                <StandardBadge name={probe.standardName} />
                {probe.tokenName && <span className="t3 small">{probe.tokenName}</span>}
              </dd>
              <dt><Tip tip="The exact check the contract will run when you submit, run here first: do you currently pass this standard's control rule? A call that would fail never reaches your wallet.">Authority</Tip></dt>
              <dd>
                {probe.youAreAuthorized
                  ? <span className="row"><Badge tone="ok">you pass</Badge><span className="t2 small">{probe.detail}</span></span>
                  : <span className="row"><Badge tone="danger">you don't pass</Badge><span className="t2 small">{probe.detail}</span></span>}
              </dd>
              <dt><Tip tip="The identity's permanent name - a hash the live contract computes from exactly these details. It never changes, and it's the same whether you claim now or register fully later, so anything attached to it carries over.">UBID</Tip></dt>
              <dd className="mono" style={{ overflowWrap: "anywhere" }}>{probe.ubid ?? "—"}</dd>
            </dl>
          </div>

          {probe.youAreAuthorized && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="section-label">How</div>
              <div className="seg" style={{ marginBottom: 12 }}>
                <button className={mode === "claim" ? "active" : ""} onClick={() => setMode("claim")}>Claim (counterfactual)</button>
                <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Register (mint agent)</button>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                {mode === "claim"
                  ? "One cheap transaction; the identity lives in the event log. Reputation earned now carries over if you register later - the UBID is the same."
                  : "Mints a real ERC-8004 agent NFT bound to this subject. Any counterfactual history under this UBID joins automatically."}
              </p>
              <div className="field">
                <label>Agent URI</label>
                <input className="input" placeholder="ipfs://… or https://…/agent.json" value={uri} onChange={(e) => setUri(e.target.value)} />
                <span className="hint">Where the agent's card/description lives. Can be updated later by whoever holds authority.</span>
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button
                  className="btn btn-primary"
                  disabled={busy || !uri.trim()}
                  onClick={async () => {
                    setBusy(true);
                    const args = [probe.standard!, (kind === "eoa" ? signer!.address : (contract as Address)), kind === "eoa" ? 0n : BigInt(tokenId), uri.trim()];
                    const fn = mode === "claim" ? "counterfactualRegister" : "register";
                    const r = await sendTx(signer, adapter, adapterAbi, fn, args);
                    toast(r.message);
                    if (r.ok) {
                      await settle(refresh);
                      setDone(probe.ubid);
                    }
                    setBusy(false);
                  }}
                >
                  {busy ? <Spinner /> : mode === "claim" ? "Claim" : "Register"}
                </button>
                <span className="hint">Simulated first - an unauthorized call fails before anything is sent.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChoiceButton({ selected, onClick, title, sub, disabled }: { selected: boolean; onClick: () => void; title: string; sub: string; disabled?: boolean }) {
  return (
    <button className={`choice ${selected ? "selected" : ""}`} onClick={onClick} disabled={disabled}>
      <div className="c-title">{title}</div>
      <div className="c-sub">{sub}</div>
    </button>
  );
}

async function computeUbid(adapter: Address, standard: number, bound: Address, tokenId: bigint): Promise<Hex> {
  return (await publicClient.readContract({
    address: adapter,
    abi: adapterAbi,
    functionName: "hashBinding",
    args: [standard, bound, tokenId],
  })) as Hex;
}

async function probeEoa(adapter: Address, address: Address): Promise<Probe> {
  const trust = await api.trustbase(address).catch(() => null);
  return {
    standard: 5,
    standardName: "ACCOUNT",
    owner: address,
    youAreAuthorized: true,
    detail: "an ACCOUNT subject authorizes exactly its own address - you are it",
    trust,
    ubid: await computeUbid(adapter, 5, address, 0n),
    tokenName: null,
  };
}

async function probeToken(adapter: Address, contract: Address, tokenId: bigint, you: Address): Promise<Probe> {
  const trust = await api.trustbase(contract).catch(() => null);
  const tokenName = await publicClient
    .readContract({ address: contract, abi: erc721Abi, functionName: "name" })
    .catch(() => null);

  // ERC-721 first: ownerOf answering settles both the standard and the authority.
  try {
    const owner = (await publicClient.readContract({
      address: contract,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as Address;
    const yours = owner.toLowerCase() === you.toLowerCase();
    return {
      standard: 0,
      standardName: "ERC721",
      owner,
      youAreAuthorized: yours,
      detail: yours ? `ownerOf(${tokenId}) is your address` : `ownerOf(${tokenId}) is ${shortHex(owner, 10)} - a delegate.xyz delegation would also pass`,
      trust,
      ubid: await computeUbid(adapter, 0, contract, tokenId),
      tokenName: tokenName as string | null,
    };
  } catch {
    // ownerOf reverted: either not ERC-721, an unminted/burned token (the collection window),
    // or an ERC-1155-style balance token.
    try {
      const bal = (await publicClient.readContract({
        address: contract,
        abi: erc721Abi,
        functionName: "balanceOf",
        args: [you, tokenId],
      })) as bigint;
      const yours = bal > 0n;
      return {
        standard: 1,
        standardName: "ERC1155",
        owner: null,
        youAreAuthorized: yours,
        detail: yours ? `your balance of id ${tokenId} is ${bal}` : `your balance of id ${tokenId} is 0 - positive balance is the authority`,
        trust,
        ubid: await computeUbid(adapter, 1, contract, tokenId),
        tokenName: tokenName as string | null,
      };
    } catch {
      return {
        standard: 0,
        standardName: "ERC721",
        owner: null,
        youAreAuthorized: false,
        detail: `ownerOf(${tokenId}) reverts - the token doesn't exist (or is burned), so only the collection contract itself may claim right now`,
        trust,
        ubid: await computeUbid(adapter, 0, contract, tokenId).catch(() => null as unknown as Hex),
        tokenName: tokenName as string | null,
      };
    }
  }
}

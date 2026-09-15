import { spawn, type ChildProcess } from "node:child_process";
import { createPublicClient, http, type Address } from "viem";
import { foundry } from "viem/chains";
import { deployStack } from "./deploy.js";
import { runScenario } from "./demo.js";
import { Ingester } from "./ingest.js";
import { ProjectionStore } from "./projection.js";
import { startServer } from "./server.js";
import { probeTrustBase } from "./trustbase.js";
import { ATTESTATION_TYPE_NAMES, STANDARD_NAMES } from "./ubid.js";

const RPC_PORT = 8547;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const API_PORT = 8787;

async function waitForRpc(url: string, attempts = 50): Promise<void> {
  const client = createPublicClient({ chain: foundry, transport: http(url) });
  for (let i = 0; i < attempts; i++) {
    try {
      await client.getChainId();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("anvil did not come up");
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual, bigintJson) === JSON.stringify(expected, bigintJson);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — expected ${JSON.stringify(expected, bigintJson)}, got ${JSON.stringify(actual, bigintJson)}`}`);
}
function bigintJson(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

async function main() {
  const serve = process.argv.includes("--serve");
  console.log("1. Starting anvil...");
  const anvil: ChildProcess = spawn("anvil", ["--port", String(RPC_PORT), "--silent"], { stdio: "ignore" });
  const shutdown = () => anvil.kill();
  process.on("exit", shutdown);

  try {
    await waitForRpc(RPC_URL);

    console.log("2. Deploying MockIdentityRegistry, AdapterImplementation, ERC1967 proxy, DemoPunks...");
    const deployment = await deployStack(RPC_URL);
    console.log(`   registry ${deployment.registry}`);
    console.log(`   adapter  ${deployment.adapter} (proxy over ${deployment.implementation})`);
    console.log(`   punks    ${deployment.punks}`);

    console.log("3. Running the product scenario (claims, wallet loop, attestations, registration, burn hijack)...");
    const s = await runScenario(RPC_URL, deployment);

    console.log("4. Indexing the chain from genesis...");
    const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) });
    const store = new ProjectionStore(31337n, deployment.adapter);
    const ingester = new Ingester(publicClient, store, deployment.adapter);
    const count = await ingester.sync();
    console.log(`   ${count} events applied, ${store.dropped.length} dropped, ${store.inertRevocations.length} inert revocations`);

    console.log("5. Verifying projected end state:\n");

    console.log("  -- integrity");
    check("no event failed self-verification", store.dropped.length, 0);

    console.log("  -- A: Punk #7 (the happy path)");
    const id7 = store.identities.get(s.ubid7)!;
    check("claimed", id7.claimed, true);
    check("agentURI", id7.agentURI, "ipfs://punkbot-7/agent.json");
    check("agentWallet is the bot's operating key, not alice's", id7.agentWallet, s.actors.bot);
    check("joined ERC-8004 agentId", id7.agentIds.map(String), ["0"]); // the mock registry's first id is 0 — a real, settable id
    check("registered agent has same UBID", store.agents.get(0n)?.ubid, s.ubid7);
    const rep7 = store.reputation(s.ubid7);
    check("stars", rep7.stars, 2);
    check("rating average (resurrected 50 + 90)", rep7.ratingAverage, 70);
    check("bob's live rating resurrected to 50", rep7.ratings.find((r) => r.attester === s.actors.bob)?.value, 50);
    check("reviews", rep7.reviews.length, 1);
    check("interaction score", rep7.interactions[0]?.score, 95);
    check("dave confirmed and verified", rep7.confirmedAccounts, [{ attester: s.actors.dave, verified: true }]);
    const wallet = store.resolveWallet(s.actors.bot)!;
    check("bot's wallet-UBID resolves to #7", wallet.designation.ubid, s.ubid7);
    check("mutual pointing verified", wallet.verified, true);
    check("alice's own wallet has no designation", store.resolveWallet(s.actors.alice), null);

    console.log("  -- B: Punk #9 (burn-reopen hijack is flagged)");
    const id9 = store.identities.get(s.ubid9)!;
    check("current claim is the collection's", id9.agentURI, "ipfs://reclaimed-9");
    check("flag: collection-authored after an owner spoke", id9.collectionAuthoredAfterOwner, true);
    check("flag: latest event collection-authored", id9.lastEventCollectionAuthored, true);
    check("carol's rating still attached to the hash", store.reputation(s.ubid9).ratingAverage, 100);

    console.log("  -- trust-base probe (static disclosure)");
    const punksTrust = await probeTrustBase(publicClient, deployment.punks);
    check("DemoPunks: burn detected", punksTrust.canBurn, true);
    check("DemoPunks: not upgradeable", punksTrust.upgradeable, false);
    check("DemoPunks verdict (burnable, no call surface)", punksTrust.verdict, "burnable");
    const eveTrust = await probeTrustBase(publicClient, s.actors.eve);
    check("Eve is a plain EOA", eveTrust.verdict, "eoa");
    const adapterTrust = await probeTrustBase(publicClient, deployment.adapter);
    check("the adapter itself reads as an upgradeable proxy", adapterTrust.upgradeable, true);

    console.log("  -- C: Eve's EOA under ACCOUNT");
    const idEve = store.identities.get(s.ubidEve)!;
    check("claimed", idEve.claimed, true);
    check("standard", STANDARD_NAMES[idEve.standard], "ACCOUNT");

    console.log("  -- D: attestation before claim");
    const id42 = store.identities.get(s.ubid42)!;
    check("late claim exists", id42.claimed, true);
    check("bob's early star now counts", store.reputation(s.ubid42).stars, 1);

    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECKS FAILED`}`);
    console.log(`   identities: ${store.identities.size}, agents: ${store.agents.size}, attestations: ${store.attestations.size}`);
    for (const [ubid, id] of store.identities) {
      console.log(
        `   ${ubid.slice(0, 10)}…  ${STANDARD_NAMES[id.standard]} ${id.boundAddress.slice(0, 8)}…/${id.tokenId}` +
          `${id.agentIds.length ? ` agent#${id.agentIds.join(",")}` : ""}${id.collectionAuthoredAfterOwner ? "  ⚠ post-owner collection claim" : ""}`,
      );
    }

    if (serve) {
      console.log(`\n6. Serving API + UI on http://127.0.0.1:${API_PORT} (anvil stays up; Ctrl-C to stop)`);
      startServer(store, publicClient, deployment.adapter as Address, API_PORT, ingester);
      await new Promise(() => {});
    } else {
      process.exitCode = failures === 0 ? 0 : 1;
    }
  } finally {
    if (!process.argv.includes("--serve")) anvil.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
export { ATTESTATION_TYPE_NAMES };

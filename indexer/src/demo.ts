import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  parseEther,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { adapterArtifact, demoPunksArtifact } from "./abi.js";
import { makeClients, type Deployment } from "./deploy.js";
import { AttestationType, computeUbid, Standard } from "./ubid.js";

const CHAIN_ID = 31337n;

/**
 * Drives the full product story against a deployed local stack:
 *  A. counterfactual claim -> metadata -> wallet loop -> reputation -> full registration join
 *  B. pre-mint collection window -> owner takeover -> burn -> collection re-claim (hijack flag)
 *  C. an EOA agent under the ACCOUNT standard
 *  D. attestation before any claim, meaning arriving later
 */
export async function runScenario(rpcUrl: string, d: Deployment) {
  const { publicClient, testClient, wallets } = makeClients(rpcUrl);
  const [, alice, bob, carol, dave, eve] = wallets;

  const adapterWrite = (wallet: (typeof wallets)[0], functionName: string, args: unknown[]) =>
    wallet
      .writeContract({ address: d.adapter, abi: adapterArtifact.abi, functionName, args })
      .then((hash) => publicClient.waitForTransactionReceipt({ hash }));

  const punksWrite = (wallet: (typeof wallets)[0], functionName: string, args: unknown[]) =>
    wallet
      .writeContract({ address: d.punks, abi: demoPunksArtifact.abi, functionName, args })
      .then((hash) => publicClient.waitForTransactionReceipt({ hash }));

  /** Sends a call to the adapter with the token contract itself as msg.sender (collection window). */
  async function asPunksContract(functionName: string, args: unknown[]) {
    await testClient.setBalance({ address: d.punks, value: parseEther("1") });
    await testClient.impersonateAccount({ address: d.punks });
    const hash = await testClient.sendTransaction({
      account: d.punks,
      to: d.adapter,
      data: encodeFunctionData({ abi: adapterArtifact.abi, functionName, args }),
    });
    await publicClient.waitForTransactionReceipt({ hash });
    await testClient.stopImpersonatingAccount({ address: d.punks });
  }

  const ubid7 = computeUbid(CHAIN_ID, d.adapter, Standard.ERC721, d.punks, 7n);
  const ubid9 = computeUbid(CHAIN_ID, d.adapter, Standard.ERC721, d.punks, 9n);
  const ubid42 = computeUbid(CHAIN_ID, d.adapter, Standard.ERC721, d.punks, 42n);
  const ubidEve = computeUbid(CHAIN_ID, d.adapter, Standard.ACCOUNT, eve.account.address, 0n);

  // Sanity: our off-chain UBID derivation must match the contract's hashBinding byte for byte.
  for (const [standard, bound, tokenId, expected] of [
    [Standard.ERC721, d.punks, 7n, ubid7],
    [Standard.ACCOUNT, eve.account.address, 0n, ubidEve],
  ] as [Standard, Address, bigint, Hex][]) {
    const onChain = (await publicClient.readContract({
      address: d.adapter,
      abi: adapterArtifact.abi,
      functionName: "hashBinding",
      args: [standard, bound, tokenId],
    })) as Hex;
    if (onChain.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`UBID derivation mismatch: computed ${expected}, contract says ${onChain}`);
    }
  }

  // ---- D (part 1): Bob stars Punk #42 before anyone has ever claimed it -------------------
  await adapterWrite(bob, "attest", [AttestationType.STAR, ubid42, zero32(), "0x01"]);

  // ---- A: Punk #7, the happy path ---------------------------------------------------------
  await punksWrite(alice, "mint", [alice.account.address, 7n]);
  await adapterWrite(alice, "counterfactualRegister", [
    Standard.ERC721,
    d.punks,
    7n,
    "ipfs://punkbot-7/agent.json",
    [
      { metadataKey: "name", metadataValue: stringToHex("PunkBot") },
      { metadataKey: "skills", metadataValue: stringToHex("trading,research") },
    ],
  ]);
  // Forward `account` metadata naming Dave, ERC-8048 style, so his confirmation can verify.
  await adapterWrite(alice, "counterfactualSetMetadata", [
    Standard.ERC721,
    d.punks,
    7n,
    "account[31337][0]",
    encodeAbiParameters([{ type: "address" }], [dave.account.address]),
  ]);
  // One call closes the wallet loop: forward wallet = caller, reverse wallet-UBID = caller's.
  await adapterWrite(alice, "counterfactualSetAgentWalletAndUBID", [Standard.ERC721, d.punks, 7n]);
  // Dave confirms he is an additional account of this agent (reciprocal half of ERC-8048).
  await adapterWrite(dave, "confirmAdditionalAccount", [ubid7]);

  // Reputation: two stars, two ratings (with a revocation resurrecting an older one), a review,
  // an interaction record.
  await adapterWrite(bob, "attest", [AttestationType.STAR, ubid7, zero32(), "0x01"]);
  await adapterWrite(carol, "attest", [AttestationType.STAR, ubid7, zero32(), "0x01"]);
  const rate50 = await adapterWrite(bob, "attest", [AttestationType.RATING, ubid7, zero32(), toByte(50)]);
  const rate80 = await adapterWrite(bob, "attest", [AttestationType.RATING, ubid7, zero32(), toByte(80)]);
  const rate80Id = attestationIdFromReceipt(rate80);
  await adapterWrite(bob, "revoke", [rate80Id]); // resurrection: Bob's live rating is 50 again
  await adapterWrite(carol, "attest", [AttestationType.RATING, ubid7, zero32(), toByte(90)]);
  await adapterWrite(carol, "attest", [
    AttestationType.REVIEW,
    ubid7,
    zero32(),
    stringToHex("Sharp research, fast settlement. Would deal again."),
  ]);
  await adapterWrite(bob, "attest", [
    AttestationType.INTERACTION,
    ubid7,
    zero32(),
    encodePacked(
      ["uint8", "bytes32", "bytes"],
      [95, rate50.transactionHash, stringToHex("swap executed in one block")],
    ),
  ]);

  // Full registration: same coordinates, same UBID — the histories join with no link assertion.
  await adapterWrite(alice, "register", [Standard.ERC721, d.punks, 7n, "ipfs://punkbot-7/agent.json"]);

  // ---- B: Punk #9 — pre-mint window, owner takeover, burn, collection re-claim ------------
  await asPunksContract("counterfactualRegister", [
    Standard.ERC721,
    d.punks,
    9n,
    "ipfs://collection-bootstrap-9",
    [],
  ]);
  await punksWrite(alice, "mint", [bob.account.address, 9n]);
  await adapterWrite(bob, "counterfactualRegister", [Standard.ERC721, d.punks, 9n, "ipfs://bobs-agent-9", []]);
  await adapterWrite(carol, "attest", [AttestationType.RATING, ubid9, zero32(), toByte(100)]);
  await punksWrite(bob, "burn", [9n]);
  // The ownerless window has reopened; the collection re-claims the reputed identity.
  await asPunksContract("counterfactualRegister", [Standard.ERC721, d.punks, 9n, "ipfs://reclaimed-9", []]);

  // ---- C: Eve's bare EOA as an agent under ACCOUNT ----------------------------------------
  await adapterWrite(eve, "counterfactualRegister", [
    Standard.ACCOUNT,
    eve.account.address,
    0n,
    "https://eve.example/agent.json",
    [],
  ]);

  // ---- D (part 2): Punk #42 is finally claimed; Bob's early star now has a subject --------
  await punksWrite(alice, "mint", [alice.account.address, 42n]);
  await adapterWrite(alice, "counterfactualRegister", [Standard.ERC721, d.punks, 42n, "ipfs://late-claim-42", []]);

  return {
    ubid7,
    ubid9,
    ubid42,
    ubidEve,
    actors: {
      alice: alice.account.address.toLowerCase() as Address,
      bob: bob.account.address.toLowerCase() as Address,
      carol: carol.account.address.toLowerCase() as Address,
      dave: dave.account.address.toLowerCase() as Address,
      eve: eve.account.address.toLowerCase() as Address,
      punks: d.punks.toLowerCase() as Address,
    },
  };
}

function zero32(): Hex {
  return `0x${"00".repeat(32)}`;
}

function toByte(n: number): Hex {
  return `0x${n.toString(16).padStart(2, "0")}`;
}

/** The Attested event carries the derived id as its first non-indexed field. */
function attestationIdFromReceipt(receipt: { logs: { data: Hex; topics: [Hex, ...Hex[]] | [] }[] }): Hex {
  for (const log of receipt.logs) {
    if (log.data.length >= 2 + 64) {
      return ("0x" + log.data.slice(2, 66)) as Hex;
    }
  }
  throw new Error("no Attested log found in receipt");
}

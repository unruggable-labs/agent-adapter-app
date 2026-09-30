import { Code, H2, Note } from "../Docs";

const SEPOLIA = "0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92";

export function Quickstart() {
  return (
    <>
      <h1 className="page-title">Quickstart</h1>
      <p className="page-sub">Give something you control an identity, from TypeScript with viem, on Sepolia. Four calls.</p>

      <H2 id="setup">Set up</H2>
      <p>Node 18+, <span className="mono">npm install viem</span>, a Sepolia RPC URL, and a wallet with a little test ETH.</p>
      <Code lang="ts">{`import { createPublicClient, createWalletClient, http, parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
const rpc = http(process.env.RPC_URL);
const publicClient = createPublicClient({ chain: sepolia, transport: rpc });
const wallet = createWalletClient({ chain: sepolia, transport: rpc, account });

const ADAPTER = "${SEPOLIA}";
const abi = parseAbi([
  "function hashBinding(uint8 standard, address boundAddress, uint256 tokenId) view returns (bytes32)",
  "function counterfactualRegister(uint8 standard, address boundAddress, uint256 tokenId, string agentURI) returns (bytes32)",
  "function counterfactualSetMetadata(uint8 standard, address boundAddress, uint256 tokenId, string key, bytes value) returns (bytes32)",
  "function counterfactualSetAgentWalletAndUBID(uint8 standard, address boundAddress, uint256 tokenId) returns (bytes32)",
  "function attest(uint8 attestationType, bytes32 ubid, bytes32 variant, bytes data)",
  "function register(uint8 standard, address boundAddress, uint256 tokenId, string agentURI) returns (uint256)",
]);

// Standards: 0 ERC721, 1 ERC1155, 2 ERC6909, 3 ERC1155F, 4 ERC6909F, 5 ACCOUNT, 6 CONTRACT_OWNABLE, 7 CONTRACT_ADMIN
const ERC721 = 0;`}</Code>

      <H2 id="ubid">1. Know your UBID before you do anything</H2>
      <Code lang="ts">{`const NFT = "0xYourCollection";
const TOKEN_ID = 7n;

const ubid = await publicClient.readContract({
  address: ADAPTER, abi, functionName: "hashBinding", args: [ERC721, NFT, TOKEN_ID],
});
// Same value before and after claiming or registering. This is the identity's permanent name.`}</Code>

      <H2 id="claim">2. Claim it</H2>
      <p>One event, no storage. The caller must control the token under the standard's rule - here, own it.</p>
      <Code lang="ts">{`await wallet.writeContract({
  address: ADAPTER, abi, functionName: "counterfactualRegister",
  args: [ERC721, NFT, TOKEN_ID, "ipfs://…/agent.json"],
});

// Optional: a name the explorer will show.
await wallet.writeContract({
  address: ADAPTER, abi, functionName: "counterfactualSetMetadata",
  args: [ERC721, NFT, TOKEN_ID, "name", toHex("PunkBot")],
});`}</Code>
      <p>For your own address instead of a token, the standard is 5 (ACCOUNT), the bound address is your address, and the token id is 0.</p>

      <H2 id="wallet">3. Link the wallet the agent signs from</H2>
      <p>If the agent signs from the same address that controls the token, one call does both halves:</p>
      <Code lang="ts">{`await wallet.writeContract({
  address: ADAPTER, abi, functionName: "counterfactualSetAgentWalletAndUBID",
  args: [ERC721, NFT, TOKEN_ID],
});`}</Code>
      <p>If it's a different address, the controller names it and that wallet confirms - see <a href="#/wallets">Operating wallets</a>.</p>

      <H2 id="attest">4. Say something about an agent</H2>
      <Code lang="ts">{`import { concatHex } from "viem";
const ZERO = "0x" + "00".repeat(32) as \`0x\${string}\`;

// your rating of the agent: a score, optionally followed by your review - one call, one live per wallet
await wallet.writeContract({
  address: ADAPTER, abi, functionName: "attest",
  args: [3, ubid, ZERO, concatHex([toHex(90, { size: 1 }), toHex("Fast, fair, would deal again.")])],
});

// a record of one transaction: score ‖ tx hash ‖ optional note, with the hash in the variant slot too
await wallet.writeContract({
  address: ADAPTER, abi, functionName: "attest",
  args: [5, ubid, txHash, concatHex([toHex(95, { size: 1 }), txHash, toHex("Settled in one block.")])],
});`}</Code>

      <H2 id="register">Later: register fully</H2>
      <p>Mints an ERC-8004 agent bound to the same coordinates. Everything attached to the UBID carries over.</p>
      <Code lang="ts">{`await wallet.writeContract({ address: ADAPTER, abi, functionName: "register", args: [ERC721, NFT, TOKEN_ID, "ipfs://…/agent.json"] });`}</Code>

      <Note>
        Every write is authority-checked by the contract. Simulating the call first (viem's <span className="mono">simulateContract</span>)
        tells you whether you'd pass before you sign - that is exactly what the explorer's create flow does.
      </Note>
    </>
  );
}

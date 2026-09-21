import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  http,
  publicActions,
  walletActions,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { adapterArtifact, demoPunksArtifact, mockRegistryArtifact, proxyArtifact } from "./abi.js";

/** Anvil's default funded accounts. */
export const KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // deployer
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // alice
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // bob
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // carol
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // dave
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // eve
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // punkbot's server — the agent's operating key, distinct from Alice's controller-holding wallet
];

export function makeClients(rpcUrl: string) {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: foundry, transport });
  const testClient = createTestClient({ chain: foundry, mode: "anvil", transport })
    .extend(publicActions)
    .extend(walletActions);
  const wallets = KEYS.map((key) =>
    createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport }),
  );
  return { publicClient, testClient, wallets };
}

export interface Deployment {
  registry: Address;
  implementation: Address;
  adapter: Address; // the proxy — the address every identity binds to
  punks: Address;
}

export async function deployStack(rpcUrl: string): Promise<Deployment> {
  const { publicClient, wallets } = makeClients(rpcUrl);
  const deployer = wallets[0];

  async function deploy(artifact: { abi: any; bytecode: Hex }, args: unknown[] = []): Promise<Address> {
    const hash = await deployer.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error("deployment failed");
    return receipt.contractAddress;
  }

  const registry = await deploy(mockRegistryArtifact);
  const implementation = await deploy(adapterArtifact, [registry]);
  const initData = encodeFunctionData({
    abi: adapterArtifact.abi,
    functionName: "initialize",
    args: [deployer.account.address],
  });
  const adapter = await deploy(proxyArtifact, [implementation, initData]);
  const punks = await deploy(demoPunksArtifact);

  return { registry, implementation, adapter, punks };
}

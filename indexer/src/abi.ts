import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi } from "viem";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function loadArtifact(name: string): { abi: Abi; bytecode: `0x${string}`; deployedBytecode: `0x${string}` } {
  const artifact = JSON.parse(readFileSync(join(repoRoot, "out", `${name}.sol`, `${name}.json`), "utf8"));
  return {
    abi: artifact.abi as Abi,
    bytecode: artifact.bytecode.object as `0x${string}`,
    deployedBytecode: artifact.deployedBytecode.object as `0x${string}`,
  };
}

export const adapterArtifact = loadArtifact("Adapter8004");
export const mockRegistryArtifact = loadArtifact("MockIdentityRegistry");
export const demoPunksArtifact = loadArtifact("DemoPunks");
export const proxyArtifact = (() => {
  // OZ's ERC1967Proxy is compiled into the test artifacts via the upgrade tests.
  const path = join(repoRoot, "out", "ERC1967Proxy.sol", "ERC1967Proxy.json");
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  return { abi: artifact.abi as Abi, bytecode: artifact.bytecode.object as `0x${string}` };
})();

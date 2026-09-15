import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi } from "viem";

/**
 * Contract artifacts (ABI + bytecode) vendored from the contracts repo, used by the local
 * demo/deploy tooling. Regenerate after an upstream contract change — from a built checkout
 * of unruggable-labs/adapter:
 *
 *   for n in AdapterImplementation MockIdentityRegistry ERC1967Proxy DemoPunks; do
 *     jq '{abi, bytecode: {object: .bytecode.object}, deployedBytecode: {object: .deployedBytecode.object}}' \
 *       out/$n.sol/$n.json > ../adapter-app/indexer/artifacts/$n.json
 *   done
 *
 * The runtime indexer path uses `abi-runtime.ts` (ABI only) instead.
 */
const artifactsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

function loadArtifact(name: string): { abi: Abi; bytecode: `0x${string}`; deployedBytecode: `0x${string}` } {
  const artifact = JSON.parse(readFileSync(join(artifactsDir, `${name}.json`), "utf8"));
  return {
    abi: artifact.abi as Abi,
    bytecode: artifact.bytecode.object as `0x${string}`,
    deployedBytecode: artifact.deployedBytecode.object as `0x${string}`,
  };
}

export const adapterArtifact = loadArtifact("AdapterImplementation");
export const mockRegistryArtifact = loadArtifact("MockIdentityRegistry");
export const demoPunksArtifact = loadArtifact("DemoPunks");
export const proxyArtifact = loadArtifact("ERC1967Proxy");

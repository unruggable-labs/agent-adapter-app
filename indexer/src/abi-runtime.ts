import type { Abi } from "viem";
import adapterAbiJson from "./adapter-abi.json";

/**
 * The adapter ABI as a vendored import, for runtimes that bundle (serverless functions) and
 * cannot read forge artifacts from disk. Regenerate after upstream ABI changes:
 *
 *   jq .abi out/AdapterImplementation.sol/AdapterImplementation.json > src/adapter-abi.json
 *
 * The demo/deploy tooling keeps using `abi.ts` (fs-based, includes bytecode).
 */
export const adapterAbi = adapterAbiJson as Abi;

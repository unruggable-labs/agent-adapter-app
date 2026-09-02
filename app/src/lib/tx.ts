import type { Abi, Address } from "viem";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { publicClient, walletFor } from "./chain";

export interface TxResult {
  ok: boolean;
  message: string;
}

/**
 * Simulate → write → wait. Simulation first means an unauthorized action fails with the
 * contract's own error name before anything is signed, which doubles as the authority preflight.
 */
export async function sendTx(
  actorIndex: number,
  address: Address,
  abi: Abi,
  functionName: string,
  args: unknown[],
): Promise<TxResult> {
  try {
    const wallet = walletFor(actorIndex);
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address,
      abi,
      functionName,
      args,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return receipt.status === "success"
      ? { ok: true, message: `Confirmed in block ${receipt.blockNumber}` }
      : { ok: false, message: "Transaction reverted" };
  } catch (err) {
    return { ok: false, message: revertReason(err) };
  }
}

export function revertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.signature ?? "revert";
      return `Not allowed: ${name}`;
    }
    return err.shortMessage;
  }
  return String(err);
}

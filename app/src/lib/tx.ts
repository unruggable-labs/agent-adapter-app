import type { Abi, Address } from "viem";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { getWalletClient, switchChain } from "wagmi/actions";
import type { Signer } from "./app-state";
import { chainConfig, clientFor, walletFor, type NetworkId } from "./chain";
import { wagmiConfig } from "./wagmi";

export interface TxResult {
  ok: boolean;
  message: string;
}

/**
 * Simulate → write → wait, on the chain the record is on. Simulation runs first so an
 * unauthorized action fails with the contract's own error name before anything is signed — the
 * preflight and the authority check are the same code path. Local devnet signs with the
 * persona's anvil key; public networks sign with the user's connected wallet, switched to the
 * record's chain first - on the multichain explorer that is the wallet's only chain switch.
 */
export async function sendTx(
  signer: Signer | null,
  chain: NetworkId,
  address: Address,
  abi: Abi,
  functionName: string,
  args: unknown[],
): Promise<TxResult> {
  if (!signer) {
    return { ok: false, message: "Connect a wallet to do this" };
  }
  try {
    const net = chainConfig(chain);
    const client = clientFor(chain);
    const account = signer.isPersona ? walletFor(signer.actorIndex).account : signer.address;
    const { request } = await client.simulateContract({
      account,
      address,
      abi,
      functionName,
      args,
    });

    let hash: `0x${string}`;
    if (signer.isPersona) {
      hash = await walletFor(signer.actorIndex).writeContract(request);
    } else {
      try {
        await switchChain(wagmiConfig, { chainId: net.chain.id });
      } catch {
        return { ok: false, message: `This is on ${net.label} - switch your wallet to it and retry` };
      }
      const wallet = await getWalletClient(wagmiConfig, { chainId: net.chain.id });
      hash = await wallet.writeContract(request);
    }
    const receipt = await client.waitForTransactionReceipt({ hash });
    return receipt.status === "success"
      ? { ok: true, message: `Confirmed in block ${receipt.blockNumber}` }
      : { ok: false, message: "Transaction reverted" };
  } catch (err) {
    return { ok: false, message: revertReason(err) };
  }
}

/**
 * Would this call succeed if sent? Runs only the simulation half of `sendTx` - nothing is
 * signed and nothing is sent.
 *
 * This is how the app answers "may I manage this profile?" without re-implementing the
 * contract's rules in the client. `_hasBindingControl` is internal and there is no
 * coordinate-based public view, but simulating a gated call exercises the real thing: the
 * holder, a scoped or unscoped delegate.xyz delegation, and the ownerless-collection carve-out
 * all resolve correctly, and the answer cannot drift from the contract because it *is* the
 * contract.
 */
export async function canSend(
  signer: Signer | null,
  chain: NetworkId,
  address: Address,
  abi: Abi,
  functionName: string,
  args: unknown[],
): Promise<boolean> {
  if (!signer) return false;
  try {
    const account = signer.isPersona ? walletFor(signer.actorIndex).account : signer.address;
    await clientFor(chain).simulateContract({ account, address, abi, functionName, args });
    return true;
  } catch {
    return false;
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

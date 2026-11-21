import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from "viem";
import { reasonCopy } from "@/contract/reasons";

export type TxProblem = { message: string; recovery: string; reason?: string };

/**
 * Turns whatever a simulation, wallet or RPC threw into plain language. A contract revert maps to its own
 * reason string (src/contract/reasons.ts, checked against handlers.fe by a test); a refusal in the wallet is
 * said to have sent nothing; everything else keeps viem's short message so it is never swallowed.
 */
export function describeTxError(error: unknown): TxProblem {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const copy = reasonCopy(revert.reason);
      return { ...copy, reason: revert.reason };
    }
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return { message: "You declined the request in your wallet.", recovery: "Nothing was sent. Try again when you are ready." };
    }
    if (error.walk((e) => e instanceof InsufficientFundsError)) {
      return { message: "This account does not hold enough Sepolia ETH for the amount plus network fees.", recovery: "Get test ETH from a Sepolia faucet, or lower the amount." };
    }
    const name = error.name;
    if (/ChainMismatch|ConnectorChainMismatch|SwitchChain/i.test(name)) {
      return { message: "Your wallet is not on Sepolia.", recovery: "Switch the wallet to Sepolia, then try again. Nothing was sent." };
    }
    return { message: error.shortMessage || "The request failed.", recovery: "Check the wallet and your connection, then try again." };
  }
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === 4001) {
    return { message: "You declined the request in your wallet.", recovery: "Nothing was sent. Try again when you are ready." };
  }
  return { message: error instanceof Error ? error.message : "The request failed.", recovery: "Reload the page and try again." };
}

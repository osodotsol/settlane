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
    if (rpcCode(error) === -32002) {
      return { message: "MetaMask already has a request from this page waiting.", recovery: "Open MetaMask from the browser toolbar and approve or reject the waiting request, then try again here." };
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

/** The EIP-1193 / JSON-RPC error code anywhere in the error chain, if any. */
function rpcCode(error: unknown): number | undefined {
  let e: unknown = error;
  for (let i = 0; i < 8 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "number") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

const NOT_SENT_NAMES = /ConnectorChainMismatch|ChainMismatch|ConnectorAccountNotFound|ConnectorNotConnected|ConnectorUnavailableReconnecting|ConnectorNotFound|ProviderNotFound|ChainNotConfigured|SwitchChain/;

/**
 * What a wallet error says about whether anything was sent:
 * - "rejected": the user declined (EIP-1193 4001): nothing was sent.
 * - "not-sent": the request was refused before signing (wrong chain, account not connected, provider missing,
 *   unauthorized 4100, disconnected 4900/4901, request already pending -32002): nothing was sent.
 * - "ambiguous": anything else; the page cannot know, so it must not claim either.
 */
export function walletErrorKind(error: unknown): "rejected" | "not-sent" | "ambiguous" {
  const code = rpcCode(error);
  if (code === 4001) return "rejected";
  if (error instanceof BaseError && error.walk((e) => e instanceof UserRejectedRequestError)) return "rejected";
  if (code === 4100 || code === 4900 || code === 4901 || code === -32002) return "not-sent";
  let e: unknown = error;
  for (let i = 0; i < 8 && e; i++) {
    if (NOT_SENT_NAMES.test((e as { name?: string }).name ?? "")) return "not-sent";
    e = (e as { cause?: unknown }).cause;
  }
  return "ambiguous";
}

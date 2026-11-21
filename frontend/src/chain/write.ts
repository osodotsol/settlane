"use client";

import { useRef, useState } from "react";
import { decodeEventLog, type Address, type Hex, type TransactionReceipt } from "viem";
import { useConnection, useWriteContract } from "wagmi";
import { sepolia } from "wagmi/chains";
import { publicClient } from "@/chain/client";
import { SETTLANE_ADDRESS } from "@/config/chain";
import { settlaneAbi } from "@/contract/abi";
import { describeTxError, type TxProblem } from "./errors";
import { useRefreshChainData } from "./queries";

// Every write goes through one path: pin the network, SIMULATE the exact call against the contract with the
// connected account, ask the wallet to sign only if the simulation passes, then report what the RECEIPT says.
// "Confirmed" is shown only for a receipt with status success; nothing is ever assumed. Production selectors
// and argument order come straight from the generated ABI (src/contract/abi.ts), so a drift fails the types.

export type TxRequest =
  | { fn: "create"; args: readonly [Address, Address, bigint, number, readonly [bigint, bigint, bigint], readonly [bigint, bigint, bigint], readonly [bigint, bigint, bigint]]; value: bigint }
  | { fn: "submit"; args: readonly [bigint, number, bigint] }
  | { fn: "approve" | "reject"; args: readonly [bigint, number, bigint, bigint] }
  | { fn: "claim" | "refund"; args: readonly [bigint, number, Address] };

export type TxState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "signing" }
  | { phase: "confirming"; hash: Hex }
  | { phase: "confirmed"; hash: Hex; blockNumber: bigint; createdId?: bigint }
  | { phase: "failed"; problem: TxProblem; hash?: Hex; sent: boolean };

const RECEIPT_TIMEOUT_MS = 180_000;

/** The id of the agreement a confirmed `create` made, read from its AgreementCreated log. */
export function createdAgreementId(receipt: Pick<TransactionReceipt, "logs">): bigint | undefined {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SETTLANE_ADDRESS.toLowerCase()) continue;
    try {
      const d = decodeEventLog({ abi: settlaneAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
      if (d.eventName === "AgreementCreated") return d.args.id;
    } catch {
      /* not one of ours */
    }
  }
  return undefined;
}

/** Simulates the call exactly as it will be sent. Throws the contract's own revert if it would fail. */
async function simulate(req: TxRequest, account: Address) {
  const base = { address: SETTLANE_ADDRESS, abi: settlaneAbi, account } as const;
  switch (req.fn) {
    case "create":
      return (await publicClient.simulateContract({ ...base, functionName: "create", args: req.args, value: req.value })).request;
    case "submit":
      return (await publicClient.simulateContract({ ...base, functionName: "submit", args: req.args })).request;
    case "approve":
      return (await publicClient.simulateContract({ ...base, functionName: "approve", args: req.args })).request;
    case "reject":
      return (await publicClient.simulateContract({ ...base, functionName: "reject", args: req.args })).request;
    case "claim":
      return (await publicClient.simulateContract({ ...base, functionName: "claim", args: req.args })).request;
    case "refund":
      return (await publicClient.simulateContract({ ...base, functionName: "refund", args: req.args })).request;
  }
}

export function useSettlaneTx() {
  const { address, chainId } = useConnection();
  const { mutateAsync } = useWriteContract();
  const refresh = useRefreshChainData();
  const [state, setState] = useState<TxState>({ phase: "idle" });
  const busy = useRef(false);

  /** Runs one transaction end to end. Resolves true only for a confirmed, successful receipt. */
  async function send(req: TxRequest): Promise<boolean> {
    if (busy.current) return false; // a second click while one is in flight is ignored, never sent twice
    busy.current = true;
    let hash: Hex | undefined;
    try {
      if (!address) throw new Error("Connect a wallet first.");
      if (chainId !== sepolia.id) {
        setState({ phase: "failed", sent: false, problem: { message: "Your wallet is not on Sepolia.", recovery: "Switch the wallet to Sepolia, then try again. Nothing was sent." } });
        return false;
      }
      setState({ phase: "checking" });
      const request = await simulate(req, address);
      setState({ phase: "signing" });
      // chainId is pinned again here: wagmi refuses to send when the wallet is on any other network.
      hash = await mutateAsync({ ...(request as object), chainId: sepolia.id } as never);
      setState({ phase: "confirming", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS, pollingInterval: 4_000 });
      if (receipt.status !== "success") {
        setState({ phase: "failed", hash, sent: true, problem: { message: "The transaction was mined but the contract reverted it.", recovery: "No state changed and no ETH moved. Refresh to see the current state." } });
        await refresh();
        return false;
      }
      setState({ phase: "confirmed", hash, blockNumber: receipt.blockNumber, createdId: req.fn === "create" ? createdAgreementId(receipt) : undefined });
      await refresh();
      return true;
    } catch (error) {
      const problem = describeTxError(error);
      const sent = hash !== undefined;
      setState({
        phase: "failed",
        hash,
        sent,
        problem: sent ? { message: "The transaction was sent but its result could not be confirmed yet.", recovery: "Do not send it again. Check the transaction on Etherscan, then refresh this page." } : problem,
      });
      return false;
    } finally {
      busy.current = false;
    }
  }

  return { state, send, reset: () => !busy.current && setState({ phase: "idle" }), busy: state.phase === "checking" || state.phase === "signing" || state.phase === "confirming" };
}

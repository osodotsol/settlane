"use client";

import { useCallback, useSyncExternalStore } from "react";
import { decodeEventLog, type Address, type Hex, type TransactionReceipt } from "viem";
import { useConnection, useWriteContract } from "wagmi";
import { sepolia } from "wagmi/chains";
import { publicClient } from "@/chain/client";
import { SETTLANE_ADDRESS } from "@/config/chain";
import { settlaneAbi } from "@/contract/abi";
import { describeTxError, walletErrorKind } from "./errors";
import { gasWithMargin } from "./gas";
import { useRefreshChainData } from "./queries";
import { checkChain, readSnapshot, type TxAction } from "./tx-effect";
import { actionKey, blockReason, canStart, registry, type TxEntry } from "./tx-registry";

// Every write goes through one path: pin the network, SIMULATE the exact call against the contract with the
// connected account, estimate gas and add a margin (gas.ts), record the request in the registry
// (tx-registry.ts), ask the wallet to sign, then report what the RECEIPT says. "Confirmed" is shown only for a
// receipt with status success; nothing is ever assumed. A wallet that does not answer is never treated as a
// cancellation: the request stays open, a late answer is still applied, and the same action cannot be requested
// again until the chain shows it is safe. Fees (max fee, tip) are left to the wallet. Production selectors and
// argument order come straight from the generated ABI (src/contract/abi.ts), so a drift fails the types.

export type TxRequest =
  | { fn: "create"; args: readonly [Address, Address, bigint, number, readonly [bigint, bigint, bigint], readonly [bigint, bigint, bigint], readonly [bigint, bigint, bigint]]; value: bigint }
  | { fn: "submit"; args: readonly [bigint, number, bigint] }
  | { fn: "approve" | "reject"; args: readonly [bigint, number, bigint, bigint] }
  | { fn: "claim" | "refund"; args: readonly [bigint, number, Address] };

const RECEIPT_TIMEOUT_MS = 600_000;

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

export type WriteFn = (vars: never) => Promise<Hex>;

/** The action (registry key) a request belongs to. */
export function actionOf(req: TxRequest): TxAction {
  return req.fn === "create" ? { fn: "create" } : { fn: req.fn, id: req.args[0], m: req.args[1] };
}

type StartParams = { req: TxRequest; label: string; account: Address; walletChainId: number | undefined; write: WriteFn; refresh: () => unknown };

/**
 * Runs one request end to end. Synchronous up to the first await, so a second click (or a second component)
 * finds the action already registered and cannot start it again. The promise outlives the component: it
 * keeps updating the registry when the user navigates away, and applies a late wallet answer.
 */
export async function startTx({ req, label, account, walletChainId, write, refresh }: StartParams): Promise<void> {
  const action = actionOf(req);
  const key = actionKey(action);
  const previous = registry.get(key);
  if (!canStart(previous)) return;
  const attempt = (previous?.attempt ?? 0) + 1;
  registry.set({ key, label, action, account, startedAt: Date.now(), attempt, state: { phase: "checking" }, live: true, lateHashes: previous?.lateHashes ?? [] });
  const set = (patch: (e: TxEntry) => TxEntry) => registry.update(key, attempt, patch);

  if (walletChainId !== sepolia.id) {
    set((e) => ({ ...e, live: false, state: { phase: "failed", problem: { message: "Your wallet is not on Sepolia.", recovery: "Switch the wallet to Sepolia, then try again. Nothing was sent." } } }));
    return;
  }

  // 1. Simulate and estimate against the contract. Nothing is asked of the wallet yet.
  let request: Awaited<ReturnType<typeof simulate>>;
  let gas: bigint;
  try {
    request = await simulate(req, account);
    gas = gasWithMargin(await publicClient.estimateContractGas(request as never));
  } catch (error) {
    set((e) => ({ ...e, live: false, state: { phase: "failed", problem: describeTxError(error) } }));
    return;
  }

  // 2. What the chain looks like before the wallet is asked, so "Check the chain" can tell later what happened.
  const [before, nonceBefore] = await Promise.all([readSnapshot(action).catch(() => undefined), publicClient.getTransactionCount({ address: account }).catch(() => undefined)]);

  // 3. Ask the wallet. No timeout here: an unanswered request stays open (the user may still answer it).
  if (!set((e) => ({ ...e, before, nonceBefore, state: { phase: "awaiting", since: Date.now() } }))) return;
  let hash: Hex;
  try {
    // chainId is pinned again: wagmi and viem refuse to send when the wallet is on any other network.
    hash = await write({ ...(request as object), gas, chainId: sepolia.id } as never);
  } catch (error) {
    const kind = walletErrorKind(error);
    set((e) => {
      // Only an open request can be resolved by the wallet's answer; a state found by checking the chain wins.
      if (e.state.phase !== "awaiting" && !(e.state.phase === "unknown" && e.state.reason === "stopped")) return { ...e, live: false };
      if (kind === "rejected") return { ...e, live: false, state: { phase: "rejected" } };
      if (kind === "not-sent") return { ...e, live: false, state: { phase: "failed", problem: describeTxError(error) } };
      return { ...e, live: false, state: { phase: "unknown", reason: "wallet-error", problem: describeTxError(error) } };
    });
    return;
  }

  // 4. A hash means the wallet broadcast it. If this attempt was superseded, record the late hash on the current one.
  const applied = set((e) => (e.state.phase === "found" || e.state.phase === "confirmed" ? { ...e, lateHashes: [...e.lateHashes, hash] } : { ...e, state: { phase: "pending", hash, since: Date.now() } }));
  if (!applied) {
    const current = registry.get(key);
    if (current) registry.set({ ...current, lateHashes: [...current.lateHashes, hash] });
  }
  await followReceipt(key, attempt, hash, req.fn === "create", refresh);
}

/** Waits for the receipt of `hash` (following a speed-up) and records the outcome. */
async function followReceipt(key: string, attempt: number, hash: Hex, isCreate: boolean, refresh: () => unknown) {
  const set = (patch: (e: TxEntry) => TxEntry) => registry.update(key, attempt, patch);
  let replacedReason: string | undefined;
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
      pollingInterval: 4_000,
      onReplaced: (r) => {
        replacedReason = r.reason;
      },
    });
    if (replacedReason === "cancelled") set((e) => ({ ...e, live: false, state: { phase: "cancelled", hash: receipt.transactionHash } }));
    else if (replacedReason === "replaced") set((e) => ({ ...e, live: false, state: { phase: "unknown", reason: "replaced", hash: receipt.transactionHash } }));
    else if (receipt.status === "success") set((e) => ({ ...e, live: false, state: { phase: "confirmed", hash: receipt.transactionHash, blockNumber: receipt.blockNumber, createdId: isCreate ? createdAgreementId(receipt) : undefined } }));
    else set((e) => ({ ...e, live: false, state: { phase: "reverted", hash: receipt.transactionHash } }));
  } catch {
    set((e) => ({ ...e, live: false, state: { phase: "unknown", reason: "receipt-timeout", hash } }));
  }
  await refresh();
}

/** The page stops waiting. The wallet request is NOT cancelled; a late answer is still applied. */
export function stopWaiting(key: string) {
  const e = registry.get(key);
  if (!e || e.state.phase !== "awaiting") return;
  registry.update(key, e.attempt, (x) => ({ ...x, state: { phase: "unknown", reason: "stopped" } }));
}

/** Reads the chain to resolve a request the page lost track of. Never sends anything. */
export async function reconcile(key: string, refresh: () => unknown): Promise<void> {
  const e = registry.get(key);
  if (!e || e.state.phase !== "unknown") return;
  const hash = e.state.hash;
  if (hash) {
    const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt) {
      registry.update(key, e.attempt, (x) => ({ ...x, state: receipt.status === "success" ? { phase: "confirmed", hash, blockNumber: receipt.blockNumber, createdId: x.action.fn === "create" ? createdAgreementId(receipt) : undefined } : { phase: "reverted", hash } }));
      await refresh();
      return;
    }
  }
  const check = await checkChain(e.action, e.account, e.before, e.nonceBefore);
  registry.update(key, e.attempt, (x) => {
    if (x.state.phase !== "unknown") return x; // a late answer arrived meanwhile
    if (check.done) return { ...x, check: { ...check, at: Date.now() }, state: { phase: "found", createdId: check.createdId } };
    // Safe to start again only when nothing from this account is pending and there is no known hash.
    return { ...x, check: { ...check, at: Date.now() }, cleared: !check.pendingInMempool && !hash };
  });
  if (check.done) await refresh();
}

/** Removes a finished (or cleared) entry. */
export function dismiss(key: string) {
  if (canStart(registry.get(key))) registry.remove(key);
}

/** The registry key for a milestone's requests (one per milestone: its actions can never run concurrently). */
export const milestoneKey = (id: bigint, m: number) => actionKey({ fn: "submit", id, m });
export const CREATE_KEY = actionKey({ fn: "create" });

/** One action's request state, and the controls the interface offers for it. */
export function useTx(key: string) {
  const entry = useSyncExternalStore(registry.subscribe, () => registry.get(key), () => undefined);
  const { address, chainId } = useConnection();
  const { mutateAsync } = useWriteContract();
  const refresh = useRefreshChainData();
  const start = useCallback(
    (req: TxRequest, label: string) => {
      if (!address) return;
      void startTx({ req, label, account: address, walletChainId: chainId, write: mutateAsync as WriteFn, refresh });
    },
    [address, chainId, mutateAsync, refresh],
  );
  return {
    key,
    entry,
    start,
    canStart: canStart(entry),
    blockReason: blockReason(entry),
    stopWaiting: () => stopWaiting(key),
    reconcile: () => reconcile(key, refresh),
    dismiss: () => dismiss(key),
  };
}

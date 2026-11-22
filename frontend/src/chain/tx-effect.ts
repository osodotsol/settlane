import { decodeFunctionData, type Address, type Hex } from "viem";
import { agreementCount, readAgreement } from "@/contract/read";
import { publicClient } from "./client";
import { SETTLANE_ADDRESS } from "@/config/chain";
import { settlaneAbi } from "@/contract/abi";
import { storedState, type StoredState } from "@/domain/lifecycle";

// How the page finds out, from the chain alone, whether a wallet request it lost track of took effect.
// Before asking the wallet it records a snapshot (the milestone's state, revision and revision requests, or the
// number of agreements); "Check the chain" reads again and compares. The contract is the only source of truth.

export type TxAction = { fn: "create" } | { fn: "submit" | "approve" | "reject" | "claim" | "refund"; id: bigint; m: number };

export type MilestoneSnap = { kind: "milestone"; state: StoredState; revision: bigint; rejections: bigint; evidence?: bigint; deliverBy?: bigint; decideBy?: bigint };
export type CountSnap = { kind: "count"; count: number };
export type Snapshot = MilestoneSnap | CountSnap;

/** Did the milestone change in the way this action would change it? (LIFECYCLE transitions T2 to T6.) */
export function milestoneEffect(fn: Exclude<TxAction["fn"], "create">, before: MilestoneSnap, after: MilestoneSnap): boolean {
  switch (fn) {
    case "submit":
      return after.revision > before.revision; // every accepted submission increments the revision
    case "approve":
      return before.state === "submitted" && (after.state === "approved" || after.state === "paid");
    case "reject":
      return after.rejections > before.rejections;
    case "claim":
      return before.state !== "paid" && after.state === "paid";
    case "refund":
      return before.state !== "refunded" && after.state === "refunded";
  }
}

export async function readSnapshot(action: TxAction): Promise<Snapshot> {
  if (action.fn === "create") return { kind: "count", count: await agreementCount() };
  const m = await publicClient.readContract({ address: SETTLANE_ADDRESS, abi: settlaneAbi, functionName: "getMilestone", args: [action.id, action.m] });
  return { kind: "milestone", state: storedState(m[0]), revision: m[7], rejections: m[6], evidence: m[5], deliverBy: m[2], decideBy: m[3] };
}

/** The arguments of the exact call handed to the wallet, or null if it is unknown or not a Settlane call. */
export function callArgs(call: { data: Hex } | undefined): { fn: string; args: readonly unknown[] } | null {
  if (!call) return null;
  try {
    const d = decodeFunctionData({ abi: settlaneAbi, data: call.data });
    return { fn: d.functionName, args: (d.args ?? []) as readonly unknown[] };
  } catch {
    return null;
  }
}

/**
 * Has THIS request taken effect, compared with the snapshot read before the wallet was asked (R2-C: matched on the request's
 * own terms, never on "something similar happened")? Throws if the chain cannot be read (the caller then treats the outcome
 * as unproven). Without the recorded call (records made before R2-C) a create or submit is never matched.
 */
export async function effectNow(action: TxAction, account: Address, before: Snapshot, call?: { data: Hex }): Promise<{ done: boolean; createdId?: bigint }> {
  const after = await readSnapshot(action);
  const sent = callArgs(call);
  if (action.fn === "create" && before.kind === "count" && after.kind === "count") {
    if (sent?.fn !== "create") return { done: false };
    const [provider, verifier, reviewPeriod, n, amounts, deliverBys, specs] = sent.args as [Address, Address, bigint, number, readonly bigint[], readonly bigint[], readonly bigint[]];
    for (let id = before.count + 1; id <= after.count; id++) {
      const a = await readAgreement(BigInt(id));
      if (!a || a.client.toLowerCase() !== account.toLowerCase()) continue;
      const same =
        a.provider.toLowerCase() === provider.toLowerCase() &&
        a.verifier.toLowerCase() === verifier.toLowerCase() &&
        a.reviewPeriod === reviewPeriod &&
        a.n === n &&
        a.milestones.length === n &&
        a.milestones.every((m, i) => m.amount === amounts[i] && m.deliverBy === deliverBys[i] && m.spec === specs[i]);
      if (same) return { done: true, createdId: a.id };
    }
    return { done: false };
  }
  if (action.fn === "submit" && before.kind === "milestone" && after.kind === "milestone") {
    if (sent?.fn !== "submit") return { done: false };
    const evidence = sent.args[2] as bigint;
    return { done: after.revision > before.revision && after.evidence === evidence && after.state !== "funded" };
  }
  if (action.fn !== "create" && before.kind === "milestone" && after.kind === "milestone") return { done: milestoneEffect(action.fn, before, after) };
  return { done: false };
}

/**
 * Why the contract can PERMANENTLY no longer accept this milestone request, or undefined (R2-C rule 9). Only conditions that
 * can never revert: block time only grows, the revision only grows, and approved, paid and refunded are final states.
 */
export function deadReason(action: TxAction, call: { data: Hex } | undefined, m: MilestoneSnap, blockTime: bigint): string | undefined {
  if (action.fn === "create") return undefined;
  const final = m.state === "paid" || m.state === "refunded";
  switch (action.fn) {
    case "submit":
      if (final || m.state === "approved") return `the milestone is already ${m.state}`;
      if (m.deliverBy !== undefined && blockTime >= m.deliverBy) return "its delivery window has closed (by Sepolia block time)";
      return undefined;
    case "approve":
    case "reject": {
      if (final || m.state === "approved") return `the milestone is already ${m.state}`;
      if (m.decideBy !== undefined && blockTime >= m.decideBy) return "its review window has closed (by Sepolia block time)";
      const sent = callArgs(call);
      const revision = sent && (sent.fn === "approve" || sent.fn === "reject") ? (sent.args[3] as bigint) : undefined;
      if (revision !== undefined && m.revision > revision) return `it names revision ${revision}, and the milestone is at revision ${m.revision}`;
      return undefined;
    }
    case "claim":
      return final ? `the milestone is already ${m.state}` : undefined;
    case "refund":
      return final || m.state === "approved" ? `the milestone is already ${m.state}` : undefined;
  }
}

/** The search of an account's transactions by nonce needs the chain's history; it is bounded so a check stays quick. */
export const MAX_NONCES_SEARCHED = 16;

type MinedTx = { hash: Hex; from: Address; to: Address | null; input: Hex; value: bigint; nonce: number };

/**
 * The mined transaction with `nonce` from `account`, found by binary search over block numbers on the account's
 * transaction count (`fromBlock` is a block where the count was at most `nonce`). Throws if the history cannot be read.
 */
export async function minedTxByNonce(account: Address, nonce: number, fromBlock: bigint, toBlock: bigint): Promise<MinedTx | null> {
  let lo = fromBlock < 0n ? 0n : fromBlock;
  let hi = toBlock;
  if ((await publicClient.getTransactionCount({ address: account, blockNumber: hi })) <= nonce) return null;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if ((await publicClient.getTransactionCount({ address: account, blockNumber: mid })) > nonce) hi = mid;
    else lo = mid + 1n;
  }
  const block = await publicClient.getBlock({ blockNumber: lo, includeTransactions: true });
  const tx = (block.transactions as unknown as MinedTx[]).find((t) => typeof t === "object" && t.from.toLowerCase() === account.toLowerCase() && Number(t.nonce) === nonce);
  return tx ?? null;
}

/** Is this mined transaction exactly the recorded call (same contract, calldata and value)? */
export const isSameCall = (tx: Pick<MinedTx, "to" | "input" | "value">, call: { data: Hex; value: string }) =>
  !!tx.to && tx.to.toLowerCase() === SETTLANE_ADDRESS.toLowerCase() && tx.input.toLowerCase() === call.data.toLowerCase() && tx.value === BigInt(call.value);

/**
 * Searches the account's transactions with nonces [fromNonce, toNonce) for the recorded call (R2-C rule 2), and reports which
 * transaction used each nonce. `complete` is false when the range was larger than MAX_NONCES_SEARCHED.
 */
export async function searchAccountTxs(account: Address, call: { data: Hex; value: string }, fromNonce: number, toNonce: number, fromBlock: bigint): Promise<{ match?: MinedTx; byNonce: Map<number, MinedTx>; complete: boolean }> {
  const byNonce = new Map<number, MinedTx>();
  const head = await publicClient.getBlockNumber({ cacheTime: 0 }); // never viem's cached head: it can predate the transaction
  const last = Math.min(toNonce, fromNonce + MAX_NONCES_SEARCHED);
  for (let k = fromNonce; k < last; k++) {
    const tx = await minedTxByNonce(account, k, fromBlock, head);
    if (!tx) throw new Error(`the transaction with nonce ${k} could not be found`);
    byNonce.set(k, tx);
    if (isSameCall(tx, call)) return { match: tx, byNonce, complete: true };
  }
  return { byNonce, complete: last === toNonce };
}

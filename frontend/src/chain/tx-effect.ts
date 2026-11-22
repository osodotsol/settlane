import type { Address } from "viem";
import { agreementCount, readAgreement } from "@/contract/read";
import { publicClient } from "./client";
import { SETTLANE_ADDRESS } from "@/config/chain";
import { settlaneAbi } from "@/contract/abi";
import { storedState, type StoredState } from "@/domain/lifecycle";

// How the page finds out, from the chain alone, whether a wallet request it lost track of took effect.
// Before asking the wallet it records a snapshot (the milestone's state, revision and revision requests, or the
// number of agreements); "Check the chain" reads again and compares. The contract is the only source of truth.

export type TxAction = { fn: "create" } | { fn: "submit" | "approve" | "reject" | "claim" | "refund"; id: bigint; m: number };

export type MilestoneSnap = { kind: "milestone"; state: StoredState; revision: bigint; rejections: bigint };
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
  return { kind: "milestone", state: storedState(m[0]), revision: m[7], rejections: m[6] };
}

export type ChainCheck = {
  /** The action has taken effect on-chain. */
  done: boolean;
  /** For a create: the agreement this account created after the snapshot, if any. */
  createdId?: bigint;
  /** The account has a transaction the node knows of but no block has included yet. */
  pendingInMempool: boolean;
  /** The account's confirmed transaction count went up since the request started. */
  nonceMoved: boolean;
};

/** Reads the chain now and compares it with the snapshot taken before the wallet was asked. */
export async function checkChain(action: TxAction, account: Address, before: Snapshot | undefined, nonceBefore: number | undefined): Promise<ChainCheck> {
  const [latest, pending] = await Promise.all([
    publicClient.getTransactionCount({ address: account, blockTag: "latest" }),
    publicClient.getTransactionCount({ address: account, blockTag: "pending" }),
  ]);
  const base = { pendingInMempool: pending > latest, nonceMoved: nonceBefore !== undefined && latest > nonceBefore };
  if (!before) return { done: false, ...base };
  const after = await readSnapshot(action);
  if (action.fn === "create" && before.kind === "count" && after.kind === "count") {
    for (let id = before.count + 1; id <= after.count; id++) {
      const a = await readAgreement(BigInt(id));
      if (a && a.client.toLowerCase() === account.toLowerCase()) return { done: true, createdId: a.id, ...base };
    }
    return { done: false, ...base };
  }
  if (action.fn !== "create" && before.kind === "milestone" && after.kind === "milestone") return { done: milestoneEffect(action.fn, before, after), ...base };
  return { done: false, ...base };
}

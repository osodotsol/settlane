import type { Hex } from "viem";

// One decision for "the page lost track of a wallet request: what is true now, and may the user send another?"
// (R2 audit M1, M5, M6). Pure: the facts are read from the chain by `reconcile` (write.ts); this function only decides.
//
// The rules, in order. The first that applies wins:
//  1. A known transaction hash with a receipt: confirmed or reverted. Final.
//  2. The action's own effect is on-chain (compared with the state read just before signing): done. Final.
//  3. This tab still holds the open wallet request: it can still be answered, so nothing can be released.
//  4. Another tab of this site holds it (fresh heartbeat): same.
//  5. A known hash the node still has pending: it is on its way; wait for the receipt.
//  6. The account has a pending transaction: wait.
//  7. No state was read before signing (old records, or a read that failed): the outcome cannot be proven; never released.
//  8. A known hash the node does not know (dropped?): released only if the ORIGINAL transaction's nonce has since been used
//     by another transaction, because then it can never be mined. Otherwise the wallet could still send it.
//  9. No hash (the wallet never answered this page, or the page was reloaded): the chain shows nothing happened and nothing
//     pending, but the request may still be open in MetaMask, and nothing on-chain can prove it is not. The outcome stays
//     UNKNOWN. The user's statement that it is gone from the wallet is evidence of INTENT, never proof (R2-B):
//      - a milestone action may then be requested again ("override"). If the old request is still approved later: a
//        claim, refund, approve or reject is refused by the contract (a milestone is paid or refunded once; approve and
//        reject name the submission revision), costing at most a network fee; a submit is a valid RESUBMISSION while the
//        delivery window is open (LIFECYCLE T2) and would replace newer evidence. No ETH can move twice in either case.
//        Holding submit instead could make a provider miss the delivery deadline, which costs them the payment;
//      - a create is NOT released ("create-held"): an old create approved later would fund a second agreement, which no
//        contract rule prevents. It stays blocked for this account until the chain proves the outcome (the agreement
//        appears) or the record expires (tx-registry.ts, a stated policy bound, not a proof).
// Any read that fails makes the verdict "cannot prove": uncertainty is never turned into permission.

export type RecoveryFacts = {
  live: boolean;
  liveElsewhere: boolean;
  hash?: Hex;
  receipt: { status: "success" | "reverted"; blockNumber: bigint } | null;
  /** The node knows the transaction and it is not in a block yet. */
  txPending: boolean;
  /** The nonce of the original transaction, if it was ever seen. */
  txNonce?: number;
  latestNonce: number;
  pendingNonce: number;
  /** The state and nonce were read before the wallet was asked. */
  hasBaseline: boolean;
  effectDone: boolean;
  createdId?: bigint;
  /** The user confirmed the request is no longer open in their wallet (intent, not proof). */
  attested: boolean;
  /** The lost request is a create (a duplicate would fund a second agreement). */
  isCreate?: boolean;
};

export type Verdict =
  | { kind: "confirmed" }
  | { kind: "reverted" }
  | { kind: "found"; createdId?: bigint }
  | { kind: "open-here" }
  | { kind: "open-elsewhere" }
  | { kind: "pending-tx" }
  | { kind: "pending-account" }
  | { kind: "cannot-prove"; reason: string }
  | { kind: "dropped-unproven" }
  | { kind: "needs-confirmation" }
  | { kind: "override" }
  | { kind: "create-held" }
  | { kind: "released"; reason: string };

export function assessRecovery(f: RecoveryFacts): Verdict {
  if (f.hash && f.receipt) return { kind: f.receipt.status === "success" ? "confirmed" : "reverted" };
  if (f.hasBaseline && f.effectDone) return { kind: "found", createdId: f.createdId };
  if (f.live) return { kind: "open-here" };
  if (f.liveElsewhere) return { kind: "open-elsewhere" };
  if (f.hash && f.txPending) return { kind: "pending-tx" };
  if (f.pendingNonce > f.latestNonce) return { kind: "pending-account" };
  if (!f.hasBaseline) return { kind: "cannot-prove", reason: "The agreement's state was not read before the wallet was asked, so the chain cannot show whether this action happened." };
  if (f.hash) {
    if (f.txNonce !== undefined && f.latestNonce > f.txNonce) {
      return { kind: "released", reason: `The original transaction used nonce ${f.txNonce}, which another transaction has since used, so it can never be mined, and this action did not happen.` };
    }
    return { kind: "dropped-unproven" };
  }
  if (!f.attested) return { kind: "needs-confirmation" };
  return f.isCreate ? { kind: "create-held" } : { kind: "override" };
}

/**
 * May a new request start under this verdict? "released" is proof that the old request can no longer take effect;
 * "override" is the user's informed decision for an action the contract cannot apply twice. The old outcome stays unknown.
 */
export const releases = (v: Verdict | undefined) => v?.kind === "released" || v?.kind === "override";

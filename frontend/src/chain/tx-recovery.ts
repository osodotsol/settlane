import type { Hex } from "viem";

// One decision for "the page lost track of a wallet request: what is true now, and may the user send another?"
// (R2 audit M1, M5, M6). Pure: the facts are read from the chain by `reconcile` (write.ts); this function only decides.
//
// The rules, in order. The first that applies wins (R2-C revision):
//  1. The known transaction hash has a receipt: confirmed or reverted. Final. (A wallet REPLACEMENT by a different
//     transaction is never treated as this hash: write.ts keeps the original hash and records the replacement apart.)
//  2. This request's EXACT call (same calldata, value and contract) was found mined from this account among its
//     transactions since the baseline nonce: confirmed or reverted on that transaction. Final. A wallet request yields at
//     most one mined transaction (replacements share its nonce), so this settles the request even when the page never saw
//     a hash, e.g. after a reload.
//  3. The action's own effect is on-chain and matches THIS request (a create: an agreement by this client with exactly
//     these terms; a submit: exactly this evidence at a higher revision): done. Final.
//  4. This tab still holds the open wallet request: nothing can be released.
//  5. Another tab of this site holds it (its Web Lock, or a fresh heartbeat): same.
//  6. The known hash is still pending at the node: wait for the receipt.
//  7. The account has a pending transaction: wait.
//  8. No state was read before signing: the outcome cannot be proven; never released.
//  9. A milestone action the contract can PERMANENTLY no longer accept (its window closed by block time, the revision it
//     names was superseded, the milestone was paid or refunded, ...): released. It can never take effect.
// 10. A known hash the node does not know: released only when the transaction that used its nonce was found and is NOT
//     this request. A used nonce whose transaction could not be identified proves nothing ("cannot prove").
// 11. No hash: the request may still be unsigned in the wallet, and nothing on-chain can show it is not.
//      - a create stays HELD (no override, no expiry; Decision 1): a create approved later would fund a second agreement.
//      - a milestone action may be sent again only on the user's word ("override"), and then only as the SAME call
//        (write.ts): a late original is then a duplicate the contract refuses, or for a submit an identical resubmission.
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
  /** Rule 2: this request's exact call, found mined from this account since the baseline. */
  matched?: { hash: Hex; status: "success" | "reverted"; blockNumber: bigint };
  /** Rule 10: the nonce of the original (hashed) transaction was used by this DIFFERENT transaction. */
  consumedBy?: { nonce: number; hash: Hex };
  /** Rule 9: why the contract can never accept this request any more. */
  dead?: string;
};

export type Verdict =
  | { kind: "confirmed"; hash?: Hex }
  | { kind: "reverted"; hash?: Hex }
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
  if (f.hash && f.receipt) return { kind: f.receipt.status === "success" ? "confirmed" : "reverted", hash: f.hash };
  if (f.matched) return { kind: f.matched.status === "success" ? "confirmed" : "reverted", hash: f.matched.hash };
  if (f.hasBaseline && f.effectDone) return { kind: "found", createdId: f.createdId };
  if (f.live) return { kind: "open-here" };
  if (f.liveElsewhere) return { kind: "open-elsewhere" };
  if (f.hash && f.txPending) return { kind: "pending-tx" };
  if (f.pendingNonce > f.latestNonce) return { kind: "pending-account" };
  if (!f.hasBaseline) return { kind: "cannot-prove", reason: "The agreement's state was not read before the wallet was asked, so the chain cannot show whether this action happened." };
  if (f.dead) return { kind: "released", reason: `The contract can no longer accept this request: ${f.dead}. It can never take effect.` };
  if (f.hash) {
    if (f.consumedBy) return { kind: "released", reason: `The original transaction's nonce ${f.consumedBy.nonce} was used by transaction ${f.consumedBy.hash.slice(0, 10)}…, which is a different transaction, so the original can never be mined, and this action did not happen.` };
    if (f.txNonce !== undefined && f.latestNonce > f.txNonce) return { kind: "cannot-prove", reason: `The original transaction's nonce ${f.txNonce} has been used, but the transaction that used it could not be identified, so the page cannot tell whether it was this request.` };
    return { kind: "dropped-unproven" };
  }
  if (f.isCreate) return { kind: "create-held" };
  return f.attested ? { kind: "override" } : { kind: "needs-confirmation" };
}

/**
 * May a new request start under this verdict? "released" is proof that the old request can no longer take effect;
 * "override" is the user's informed decision for an action the contract cannot apply twice. The old outcome stays unknown.
 */
export const releases = (v: Verdict | undefined) => v?.kind === "released" || v?.kind === "override";

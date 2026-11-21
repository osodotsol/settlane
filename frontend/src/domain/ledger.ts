import type { Agreement } from "@/contract/read";

// Ledger strip (DESIGN.md §4): deposited = paid + refunded + outstanding, shown as one proportional bar.
// The four counters come from getAccounting; they are ALSO recomputed from the milestones (paid = Σ Paid
// amounts, refunded = Σ Refunded, outstanding = Σ Funded/Submitted/Approved, deposited = Σ all), so the
// page can state that the contract's accounting agrees with its own milestones (audit T-2 on screen).

export type LedgerPart = { kind: "paid" | "refunded" | "outstanding"; wei: bigint; basisPoints: number };

export type Ledger = {
  deposited: bigint;
  parts: LedgerPart[];
  identityHolds: boolean;
  matchesMilestones: boolean;
};

export function buildLedger(a: Pick<Agreement, "deposited" | "paid" | "refunded" | "outstanding" | "milestones">): Ledger {
  const bp = (wei: bigint) => (a.deposited === 0n ? 0 : Number((wei * 10_000n) / a.deposited));
  const parts: LedgerPart[] = [
    { kind: "paid", wei: a.paid, basisPoints: bp(a.paid) },
    { kind: "refunded", wei: a.refunded, basisPoints: bp(a.refunded) },
    { kind: "outstanding", wei: a.outstanding, basisPoints: bp(a.outstanding) },
  ];
  let paid = 0n, refunded = 0n, live = 0n, all = 0n;
  for (const m of a.milestones) {
    all += m.amount;
    if (m.state === "paid") paid += m.amount;
    else if (m.state === "refunded") refunded += m.amount;
    else if (m.state !== "none") live += m.amount;
  }
  return {
    deposited: a.deposited,
    parts,
    identityHolds: a.deposited === a.paid + a.refunded + a.outstanding,
    matchesMilestones: all === a.deposited && paid === a.paid && refunded === a.refunded && live === a.outstanding,
  };
}

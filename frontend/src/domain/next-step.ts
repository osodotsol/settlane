import type { Milestone } from "@/contract/read";
import { displayState } from "./lifecycle";

// What can happen next to a milestone, judged at block time (LIFECYCLE transition table).
export type NextStep =
  | { kind: "deliver"; by: bigint } // Funded, delivery open: the provider can submit
  | { kind: "review"; by: bigint } // Submitted, review open: the verifier can decide
  | { kind: "claim" } // Approved: the provider can claim, no deadline
  | { kind: "refund"; since: bigint } // expired: the client can refund
  | { kind: "settled" }; // Paid or Refunded

export function nextStep(m: Milestone, now: bigint): NextStep {
  const s = displayState(m.state, now, m.deliverBy, m.decideBy);
  if (s === "expired") return { kind: "refund", since: m.state === "funded" ? m.deliverBy : m.decideBy };
  if (s === "funded") return { kind: "deliver", by: m.deliverBy };
  if (s === "submitted") return { kind: "review", by: m.decideBy };
  if (s === "approved") return { kind: "claim" };
  return { kind: "settled" };
}

/** The soonest upcoming deadline across an agreement's open milestones, if any. */
export function nextDeadline(milestones: readonly Milestone[], now: bigint): bigint | null {
  let best: bigint | null = null;
  for (const m of milestones) {
    const n = nextStep(m, now);
    const at = n.kind === "deliver" || n.kind === "review" ? n.by : null;
    if (at !== null && (best === null || at < best)) best = at;
  }
  return best;
}

import type { DisplayState } from "./lifecycle";

// The progress track shown on every milestone: where it is on the road to settlement.
//   normal path   Funded -> In review -> Approved -> Paid
//   refund path   Funded -> Expired -> Refunded
// `expired` is derived from block time, not stored (LIFECYCLE); a Refunded milestone is drawn on the refund
// path because the stored state does not record whether it expired from Funded or from In review.

export type TrackNode = { label: string; status: "done" | "current" | "todo" };
export type Track = { path: "normal" | "refund"; nodes: TrackNode[] };

const NORMAL = ["Funded", "In review", "Approved", "Paid"] as const;
const REFUND = ["Funded", "Expired", "Refunded"] as const;

export function milestoneTrack(state: DisplayState): Track {
  if (state === "expired" || state === "refunded") {
    const at = state === "expired" ? 1 : 2;
    return { path: "refund", nodes: REFUND.map((label, i) => ({ label, status: i < at ? "done" : i === at ? "current" : "todo" })) };
  }
  const at = state === "none" ? -1 : state === "funded" ? 0 : state === "submitted" ? 1 : state === "approved" ? 2 : 3;
  return { path: "normal", nodes: NORMAL.map((label, i) => ({ label, status: i < at ? "done" : i === at ? "current" : "todo" })) };
}

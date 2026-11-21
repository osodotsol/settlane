import type { Activity, ActivityKind } from "@/contract/events";
import type { Milestone } from "@/contract/read";
import { displayState, type DisplayState } from "./lifecycle";

// Settlement-lane geometry (DESIGN.md §4): pure, so it is tested against the recorded Sepolia values.
//   delivery window  [created, deliver_by)  submissions are accepted (provider)
//   review window    [deliver_by, decide_by) only a submitted milestone can still be reviewed (verifier)
//   refund zone      from deliver_by (Funded) or decide_by (Submitted): the client may refund
// A refund zone is drawn only while the milestone is Funded or Submitted; Approved, Paid and Refunded
// milestones can never be refunded. Every instant is a unix second from block time.

export type Segment = { kind: "delivery" | "review" | "refund"; from: bigint; to: bigint | null };
export type Mark = { kind: ActivityKind; at: bigint; revision?: bigint; txHash: string };

export type Lane = {
  index: number;
  state: DisplayState;
  deliverBy: bigint;
  decideBy: bigint;
  segments: Segment[];
  marks: Mark[];
};

export type LaneChart = {
  start: bigint;
  end: bigint;
  now: bigint;
  nowPosition: "before" | "within" | "after";
  lanes: Lane[];
};

export function refundOpensAt(m: Pick<Milestone, "state" | "deliverBy" | "decideBy">): bigint | null {
  if (m.state === "funded") return m.deliverBy;
  if (m.state === "submitted") return m.decideBy;
  return null;
}

export function buildLaneChart(milestones: readonly Milestone[], activity: readonly Activity[], createdAt: bigint, now: bigint): LaneChart {
  const lanes: Lane[] = milestones.map((m) => {
    const segments: Segment[] = [
      { kind: "delivery", from: createdAt, to: m.deliverBy },
      { kind: "review", from: m.deliverBy, to: m.decideBy },
    ];
    const refundFrom = refundOpensAt(m);
    if (refundFrom !== null) segments.push({ kind: "refund", from: refundFrom, to: null });
    const marks = activity
      .filter((a) => a.m === m.index && a.kind !== "created")
      .map((a) => ({ kind: a.kind, at: a.timestamp, revision: a.revision, txHash: a.txHash }));
    return { index: m.index, state: displayState(m.state, now, m.deliverBy, m.decideBy), deliverBy: m.deliverBy, decideBy: m.decideBy, segments, marks };
  });
  const lastDeadline = lanes.reduce((x, l) => (l.decideBy > x ? l.decideBy : x), createdAt);
  const lastMark = activity.reduce((x, a) => (a.timestamp > x ? a.timestamp : x), createdAt);
  const latest = lastDeadline > lastMark ? lastDeadline : lastMark;
  const span = latest - createdAt > 0n ? latest - createdAt : 1n;
  const pad = span / 25n; // 4% breathing room after the last deadline or event
  const end = latest + pad;
  return { start: createdAt, end, now, nowPosition: now < createdAt ? "before" : now > end ? "after" : "within", lanes };
}

/** Position of an instant on the chart, in percent (clamped to the chart). */
export function percentAt(chart: Pick<LaneChart, "start" | "end">, t: bigint): number {
  if (t <= chart.start) return 0;
  if (t >= chart.end) return 100;
  return Number(((t - chart.start) * 10_000n) / (chart.end - chart.start)) / 100;
}

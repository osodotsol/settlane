import type { Activity, ActivityKind } from "@/contract/events";
import type { Milestone } from "@/contract/read";
import { displayState, type DisplayState, type StoredState } from "./lifecycle";

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
  /** The state the contract stores (the display state can be the derived `expired`). */
  stored: StoredState;
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
    return { index: m.index, state: displayState(m.state, now, m.deliverBy, m.decideBy), stored: m.state, deliverBy: m.deliverBy, decideBy: m.decideBy, segments, marks };
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

// ---- Axis and replay (pure, so they are tested like the rest of the lane geometry) ----

export type Tick = { at: bigint; percent: number; label: string };

// 1 minute up to 1 year (multiples of a day from 1 day on, so those ticks land on UTC midnight).
const TICK_STEPS = [60, 300, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 172800, 604800, 2_592_000, 7_776_000, 31_536_000];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "15:30" for an instant, or "Nov 21" at 00:00 UTC (the day boundary is the useful label there). */
export function tickLabel(at: bigint): string {
  const d = new Date(Number(at) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Evenly spaced axis ticks on round UTC times: the smallest step from 1 minute to 1 year that gives at most
 * `target` ticks across the chart. Ticks strictly inside the chart only.
 */
export function axisTicks(chart: Pick<LaneChart, "start" | "end">, target = 5): Tick[] {
  const span = Number(chart.end - chart.start);
  if (span <= 0) return [];
  // Beyond a year the step is simply the span divided into `target` parts, so the tick count stays bounded.
  const step = BigInt(TICK_STEPS.find((s) => span / s <= target) ?? Math.ceil(span / target));
  const ticks: Tick[] = [];
  for (let at = (chart.start / step + 1n) * step; at < chart.end; at += step) {
    ticks.push({ at, percent: percentAt(chart, at), label: tickLabel(at) });
  }
  return ticks;
}

/** The hero replay: the cursor starts after `startMs` and crosses the whole chart in `durationMs`. */
export const REPLAY = { startMs: 700, durationMs: 2600 } as const;

/** When (in ms after load) the cursor reaches `percent` of the chart; marks and rows light up then. */
export function replayDelay(percent: number): number {
  return Math.round(REPLAY.startMs + (Math.min(Math.max(percent, 0), 100) / 100) * REPLAY.durationMs);
}

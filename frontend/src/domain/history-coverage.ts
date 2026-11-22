import type { Activity, ActivityKind } from "@/contract/events";
import type { Agreement } from "@/contract/read";
import type { HistoryStatus } from "@/contract/history";

// Is an agreement's event history COMPLETE? The contract's own state says exactly how many events each agreement
// must have had (LIFECYCLE): one created; one submitted per revision; one rejected per revision request; one
// approved if the milestone is Approved or Paid; one claimed if Paid; one refunded if Refunded. If the events held
// match those counts, nothing is missing; if there are fewer, something is. This never fabricates an event: it only
// compares what is held with what the state requires.

export type Counts = Record<ActivityKind, number>;
const zero = (): Counts => ({ created: 0, submitted: 0, approved: 0, rejected: 0, claimed: 0, refunded: 0 });

export function expectedCounts(a: Pick<Agreement, "milestones">): Counts {
  const c = zero();
  c.created = 1;
  for (const m of a.milestones) {
    c.submitted += Number(m.revision);
    c.rejected += Number(m.rejections);
    if (m.state === "approved" || m.state === "paid") c.approved += 1;
    if (m.state === "paid") c.claimed += 1;
    if (m.state === "refunded") c.refunded += 1;
  }
  return c;
}

export function foundCounts(id: bigint, events: readonly Activity[]): Counts {
  const c = zero();
  for (const e of events) if (e.id === id) c[e.kind] += 1;
  return c;
}

export type Coverage = {
  /** The events held equal exactly what the contract's state requires. */
  complete: boolean;
  /** Events the state requires that are not held, as "2 submissions" style phrases. */
  missing: string[];
  /** More events than the state allows: the history is inconsistent. */
  extra: string[];
  expected: Counts;
  found: Counts;
};

const LABEL: Record<ActivityKind, [string, string]> = {
  created: ["creation", "creations"],
  submitted: ["submission", "submissions"],
  approved: ["approval", "approvals"],
  rejected: ["revision request", "revision requests"],
  claimed: ["claim", "claims"],
  refunded: ["refund", "refunds"],
};

export function agreementCoverage(a: Pick<Agreement, "id" | "milestones">, events: readonly Activity[]): Coverage {
  const expected = expectedCounts(a);
  const found = foundCounts(a.id, events);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const k of Object.keys(expected) as ActivityKind[]) {
    const d = expected[k] - found[k];
    if (d > 0) missing.push(`${d} ${LABEL[k][d === 1 ? 0 : 1]}`);
    if (d < 0) extra.push(`${-d} ${LABEL[k][-d === 1 ? 0 : 1]}`);
  }
  return { complete: missing.length === 0 && extra.length === 0, missing, extra, expected, found };
}

/** What the page may say about a history it shows: complete, or exactly why not. */
export type HistoryNotice = { level: "complete" | "incomplete"; title: string; detail: string };

export function describeHistory(status: HistoryStatus | undefined, coverage?: Coverage): HistoryNotice {
  if (!status) return { level: "incomplete", title: "History not read yet", detail: "The event history has not been read. Contract state above is read live and is unaffected." };
  const reasons: string[] = [];
  if (status.snapshot.problem) reasons.push(`The recorded history could not be used (${status.snapshot.problem}).`);
  if (status.refreshError) reasons.push(`The newest blocks could not be read (${status.refreshError}).`);
  if (status.gaps.length > 0) {
    const g = status.gaps[0]!;
    reasons.push(`Blocks ${g.from.toString()} to ${g.to.toString()}${status.gaps.length > 1 ? ` and ${status.gaps.length - 1} more range(s)` : ""} could not be read (${g.error}).`);
  }
  if (status.conflicts.length > 0) reasons.push(`The recorded history and the chain disagree: ${status.conflicts[0]}.`);
  if (coverage && coverage.missing.length > 0) reasons.push(`Missing from the history: ${coverage.missing.join(", ")}. The contract's state shows they happened; they may still be loading.`);
  if (coverage && coverage.extra.length > 0) reasons.push(`The history holds more events than the contract's state allows (${coverage.extra.join(", ")}).`);
  if (reasons.length === 0) {
    const through = status.snapshot.used ? `Recorded history verified through block ${status.snapshot.lastVerifiedBlock}, then read live` : "Read live from the chain";
    return { level: "complete", title: "History complete", detail: `${through}. The events match the contract's state.` };
  }
  return { level: "incomplete", title: "History may be incomplete", detail: reasons.join(" ") };
}

/** Coverage over several agreements: each missing or extra event is named with its agreement. */
export function aggregateCoverage(agreements: readonly Pick<Agreement, "id" | "milestones">[], events: readonly Activity[]): Coverage {
  const missing: string[] = [];
  const extra: string[] = [];
  const expected = zero();
  const found = zero();
  for (const a of agreements) {
    const c = agreementCoverage(a, events);
    for (const k of Object.keys(expected) as ActivityKind[]) {
      expected[k] += c.expected[k];
      found[k] += c.found[k];
    }
    if (c.missing.length) missing.push(`agreement #${a.id}: ${c.missing.join(", ")}`);
    if (c.extra.length) extra.push(`agreement #${a.id}: ${c.extra.join(", ")}`);
  }
  return { complete: missing.length === 0 && extra.length === 0, missing, extra, expected, found };
}

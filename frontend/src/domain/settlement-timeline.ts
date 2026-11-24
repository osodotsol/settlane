import type { Lane } from "./lane";

// The settlement timeline (DESIGN.md §15): one milestone's road to settlement, built only from what the chain
// shows. Every step is a recorded event (with its block time and transaction), or, when the contract's state
// proves a step happened but the event was not in the history read, the step without a time. Nothing is
// invented: a refunded milestone shows no submission or approval unless one was recorded. A milestone that is
// still open ends in one "now" step that names who may act next and until when (block time).

export type TimelineTone = "funded" | "submitted" | "rejected" | "approved" | "paid" | "refunded" | "refund-open";

export type TimelineStep = {
  tone: TimelineTone;
  label: string;
  /** Block time of the recorded event; undefined when the state proves the step but the event was not read. */
  at?: bigint;
  revision?: bigint;
  txHash?: string;
};

export type TimelineNow = {
  tone: TimelineTone;
  label: string;
  detail: string;
  /** The deadline that ends this step, or the moment the refund opened. */
  deadline?: { label: string; at: bigint };
};

export type Timeline = { index: number; steps: TimelineStep[]; now: TimelineNow | null; settled: boolean };

const MARK: Record<Lane["marks"][number]["kind"], { tone: TimelineTone; label: string }> = {
  created: { tone: "funded", label: "Funded" },
  submitted: { tone: "submitted", label: "Evidence submitted" },
  rejected: { tone: "rejected", label: "Revision requested" },
  approved: { tone: "approved", label: "Approved" },
  claimed: { tone: "paid", label: "Paid to the provider" },
  refunded: { tone: "refunded", label: "Refunded to the client" },
};

/** Steps the stored state proves happened (the last submission, approval and settlement). */
const PROVEN: Partial<Record<Lane["stored"], ("submitted" | "approved" | "claimed" | "refunded")[]>> = {
  submitted: ["submitted"],
  approved: ["submitted", "approved"],
  paid: ["submitted", "approved", "claimed"],
  refunded: ["refunded"],
};

export function buildTimeline(lane: Lane, created: { at: bigint; txHash?: string } | null): Timeline {
  const steps: TimelineStep[] = [{ tone: "funded", label: "Funded", at: created?.at, txHash: created?.txHash }];
  const marks = [...lane.marks].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const m of marks) steps.push({ ...MARK[m.kind], at: m.at, revision: m.revision, txHash: m.txHash });

  // A step the state proves but the history read did not contain is shown without a time, never with an invented one.
  for (const kind of PROVEN[lane.stored] ?? []) {
    if (marks.some((m) => m.kind === kind)) continue;
    if (kind === "submitted") steps.splice(1, 0, { ...MARK[kind] });
    else if (kind === "approved") {
      let last = 0;
      steps.forEach((s, i) => {
        if (s.tone === "submitted") last = i;
      });
      steps.splice(last + 1, 0, { ...MARK[kind] });
    } else steps.push({ ...MARK[kind] });
  }

  const settled = lane.stored === "paid" || lane.stored === "refunded";
  let now: TimelineNow | null = null;
  if (lane.state === "expired") {
    const from = lane.stored === "funded" ? lane.deliverBy : lane.decideBy;
    now = {
      tone: "refund-open",
      label: "Refund open to the client",
      detail: lane.stored === "funded" ? "Nothing was submitted by the delivery deadline." : "Nothing was decided by the review deadline.",
      deadline: { label: "Refundable since", at: from },
    };
  } else if (lane.state === "funded") {
    now = { tone: "funded", label: "Awaiting evidence", detail: "The provider may submit until the delivery deadline.", deadline: { label: "Delivery deadline", at: lane.deliverBy } };
  } else if (lane.state === "submitted") {
    now = { tone: "submitted", label: "Awaiting the verifier", detail: "The verifier may approve or ask for a revision until the review deadline.", deadline: { label: "Review deadline", at: lane.decideBy } };
  } else if (lane.state === "approved") {
    now = { tone: "approved", label: "Ready to claim", detail: "The provider may claim at any time: an approval never expires." };
  }
  return { index: lane.index, steps, now, settled };
}

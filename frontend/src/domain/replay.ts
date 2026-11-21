import { toHex } from "viem";
import type { Activity } from "@/contract/events";
import type { Agreement } from "@/contract/read";
import { formatEth, shortHex } from "./format";

// The landing page's replay: one real agreement told as a short sequence of steps, built from its own
// events. A refund is preceded by the deadline that made it possible (taken from the milestone's stored
// deadlines, never invented), so the story explains itself. Pure and serialisable (strings only), because
// the panel that plays it is a client component.

export type StepTone = "created" | "submitted" | "rejected" | "approved" | "claimed" | "refunded" | "deadline";
export type ReplayStep = { tone: StepTone; title: string; detail: string; note: string; time: string };
export type ReplayStory = {
  id: string;
  outcome: "paid" | "refunded" | "open";
  steps: ReplayStep[];
  summary: string;
  href: string | null;
  illustrative: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 20 · 15:21 UTC" */
export function stepTime(seconds: bigint): string {
  const d = new Date(Number(seconds) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function buildReplay(agreement: Agreement, activity: readonly Activity[], illustrative = false): ReplayStory {
  const events = activity.filter((a) => a.id === agreement.id);
  const m = agreement.milestones[0]!;
  const steps: ReplayStep[] = [];
  let submitted = false;
  for (const a of events) {
    const eth = formatEth(a.amount ?? a.total ?? 0n);
    switch (a.kind) {
      case "created":
        steps.push({ tone: "created", title: "Agreement created", detail: `${eth} ETH locked`, note: "The client funds the milestone in one call.", time: stepTime(a.timestamp) });
        break;
      case "submitted":
        submitted = true;
        steps.push({
          tone: "submitted",
          title: "Evidence submitted",
          detail: `${shortHex(toHex(a.evidence ?? 0n, { size: 32 }), 6, 4)} · revision ${a.revision}`,
          note: "A hash of the delivered work, before the delivery deadline.",
          time: stepTime(a.timestamp),
        });
        break;
      case "rejected":
        steps.push({ tone: "rejected", title: "Revision requested", detail: `revision ${a.revision}`, note: "The verifier asks for another submission.", time: stepTime(a.timestamp) });
        break;
      case "approved":
        steps.push({ tone: "approved", title: "Approved", detail: `revision ${a.revision}`, note: "The verifier accepts that exact evidence and revision.", time: stepTime(a.timestamp) });
        break;
      case "claimed":
        steps.push({ tone: "claimed", title: "Claimed", detail: `${eth} ETH to the provider`, note: "An approval never expires; the provider withdraws.", time: stepTime(a.timestamp) });
        break;
      case "refunded":
        // The rule that allowed the refund, from the milestone's stored deadlines.
        steps.push(
          submitted
            ? { tone: "deadline", title: "Review window closed", detail: "no decision by decide_by", note: "Nothing was approved before the review deadline.", time: stepTime(m.decideBy) }
            : { tone: "deadline", title: "Deadline passed", detail: "no evidence by deliver_by", note: "Nothing was submitted, so the milestone expired.", time: stepTime(m.deliverBy) },
        );
        steps.push({ tone: "refunded", title: "Refunded", detail: `${eth} ETH to the client`, note: "The client takes the amount back.", time: stepTime(a.timestamp) });
        break;
    }
  }
  const outcome = agreement.paid > 0n && agreement.outstanding === 0n && agreement.refunded === 0n ? "paid" : agreement.refunded > 0n && agreement.outstanding === 0n && agreement.paid === 0n ? "refunded" : "open";
  const summary =
    outcome === "paid"
      ? `${formatEth(agreement.paid)} ETH paid to the provider`
      : outcome === "refunded"
        ? `${formatEth(agreement.refunded)} ETH refunded to the client`
        : `${formatEth(agreement.outstanding)} ETH still held by the contract`;
  return { id: agreement.id.toString(), outcome, steps, summary, href: illustrative ? null : `/agreements/${agreement.id}`, illustrative };
}

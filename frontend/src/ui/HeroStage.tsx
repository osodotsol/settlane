import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Activity, ActivityKind } from "@/contract/events";
import type { Agreement } from "@/contract/read";
import { formatEth, formatUtc } from "@/domain/format";
import { REPLAY, buildLaneChart, percentAt, replayDelay } from "@/domain/lane";
import { displayState } from "@/domain/lifecycle";
import { StateChip } from "./StateChip";

// The landing hero's centrepiece: a dark stage that REPLAYS a real agreement on its settlement lane. A
// cursor sweeps across at a constant rate (linear: genuinely constant-rate progress), each event pops in
// and lights its transcript row as the cursor passes it, then the outcome appears. All CSS and time-based:
// no script, complete without JavaScript, and under reduced motion the cursor is hidden and every final
// state is shown at once. If the chain could not be read, an illustration is shown and labelled as one.

type Props = { agreement: Agreement; activity: Activity[]; illustrative: boolean; now: bigint };

const EVENT_TEXT: Record<ActivityKind, (a: Activity) => string> = {
  created: (a) => `Agreement created, ${formatEth(a.total ?? 0n)} ETH locked`,
  submitted: () => "Provider submitted evidence",
  approved: () => "Verifier approved the work",
  rejected: () => "Verifier asked for a revision",
  claimed: (a) => `Provider claimed ${formatEth(a.amount ?? 0n)} ETH`,
  refunded: (a) => `Client refunded ${formatEth(a.amount ?? 0n)} ETH`,
};
const DOT: Record<ActivityKind, string> = {
  created: "bg-ink",
  submitted: "bg-submitted rotate-45 rounded-[3px]",
  rejected: "border-2 border-submitted bg-surface rotate-45 rounded-[3px]",
  approved: "bg-approved rounded-full",
  claimed: "bg-paid rounded-full",
  refunded: "bg-refunded rounded-full",
};

export function HeroStage({ agreement, activity, illustrative, now }: Props) {
  const created = activity.find((a) => a.kind === "created");
  const start = created?.timestamp ?? agreement.milestones[0]!.deliverBy - 900n;
  const chart = buildLaneChart(agreement.milestones, activity, start, now);
  const lane = chart.lanes[0]!;
  const m = agreement.milestones[0]!;
  const state = displayState(m.state, now, m.deliverBy, m.decideBy);
  const events = activity;
  const endDelay = REPLAY.startMs + REPLAY.durationMs;
  const paid = agreement.paid, refunded = agreement.refunded;
  const total = agreement.deposited === 0n ? 1n : agreement.deposited;
  const pct = (v: bigint) => Number((v * 10_000n) / total) / 100;

  return (
    <div className="stage relative overflow-hidden rounded-2xl p-5 shadow-[0_30px_80px_-40px_rgb(0_0_0/0.6)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink-3">{illustrative ? "Illustration of the rules" : "A real agreement, replayed from Sepolia"}</p>
          <p className="text-title mt-0.5">Agreement #{agreement.id.toString()}</p>
        </div>
        <span className="lit" style={{ "--d": endDelay } as React.CSSProperties}>
          <StateChip state={state} />
        </span>
      </div>

      <div className="relative mt-8 h-[4.5rem] rounded-xl border border-line bg-surface [container-type:inline-size]" aria-hidden>
        {lane.segments.filter((s) => s.kind !== "refund").map((s, i) => {
          const left = percentAt(chart, s.from);
          const right = s.to === null ? 100 : percentAt(chart, s.to);
          return (
            <div key={s.kind} className="absolute inset-y-2.5 overflow-hidden rounded-md" style={{ left: `${left}%`, width: `${Math.max(right - left, 0.5)}%` }}>
              <div
                className={`draw-x absolute inset-0 ${s.kind === "delivery" ? "border-y border-funded/50 bg-funded-tint" : "border-y border-submitted/50 bg-submitted-tint"}`}
                style={{ "--d": 150 + i * 220 } as React.CSSProperties}
              />
              <span className={`absolute inset-x-0 bottom-1.5 block truncate px-2.5 text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.07em] ${s.kind === "delivery" ? "text-funded" : "text-submitted"}`}>
                {s.kind === "delivery" ? "Delivery" : "Review"}
              </span>
            </div>
          );
        })}
        {[lane.deliverBy, lane.decideBy].map((t, i) => (
          <div key={i} className="absolute inset-y-0 w-px bg-line-control" style={{ left: `${percentAt(chart, t)}%` }} />
        ))}
        {lane.marks.map((mk) => (
          <span
            key={`${mk.txHash}-${mk.kind}`}
            className="mark-pop absolute top-[36%] -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${percentAt(chart, mk.at)}%`, "--d": replayDelay(percentAt(chart, mk.at)) } as React.CSSProperties}
          >
            <span className={`block size-4 ring-2 ring-surface ${DOT[mk.kind]}`} />
          </span>
        ))}
        <div className="replay-cursor absolute -inset-y-2 left-0 w-0.5 rounded bg-cobalt" style={{ "--d": REPLAY.startMs, "--dur": `${REPLAY.durationMs}ms`, "--to": 100 } as React.CSSProperties} />
      </div>

      <ol className="mt-6 divide-y divide-line">
        {events.map((a) => {
          const at = a.kind === "created" ? 0 : percentAt(chart, a.timestamp);
          return (
            <li key={`${a.txHash}:${a.logIndex}`} className="lit flex items-baseline justify-between gap-4 py-2.5 text-sm" style={{ "--d": replayDelay(at) } as React.CSSProperties}>
              <span className="flex items-center gap-3">
                <span aria-hidden className={`inline-block size-2.5 shrink-0 ${DOT[a.kind]}`} />
                {EVENT_TEXT[a.kind](a)}
              </span>
              <span className="text-data shrink-0 text-[0.8125rem] text-ink-3">{formatUtc(a.timestamp).slice(11, 16)} UTC</span>
            </li>
          );
        })}
      </ol>

      <div className="mt-5">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
          {paid > 0n && <div className="draw-x h-full bg-paid" style={{ flexGrow: pct(paid), flexBasis: 0, "--d": endDelay } as React.CSSProperties} />}
          {refunded > 0n && <div className="draw-x h-full bg-refunded" style={{ flexGrow: pct(refunded), flexBasis: 0, "--d": endDelay } as React.CSSProperties} />}
          {agreement.outstanding > 0n && <div className="draw-x h-full border border-funded bg-funded/35" style={{ flexGrow: pct(agreement.outstanding), flexBasis: 0, "--d": endDelay } as React.CSSProperties} />}
        </div>
        <p className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
          <span>
            <span className="text-data">{formatEth(agreement.deposited)}</span> ETH deposited · <span className="text-data">{formatEth(paid)}</span> paid ·{" "}
            <span className="text-data">{formatEth(refunded)}</span> refunded
          </span>
          {!illustrative && (
            <Link href={`/agreements/${agreement.id}`} className="inline-flex items-center gap-1.5 font-medium text-cobalt hover:underline">
              Open this agreement <ArrowRight aria-hidden size={15} />
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}

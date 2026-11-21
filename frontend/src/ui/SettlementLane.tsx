import { formatRelative, formatUtc } from "@/domain/format";
import { STATE_LABEL } from "@/domain/lifecycle";
import { axisTicks, percentAt, type LaneChart, type Mark, type Segment } from "@/domain/lane";
import { StateChip } from "./StateChip";

// The signature visual (DESIGN.md §1, §4): each milestone as a lane on one shared time axis, with the
// windows in which each action is allowed and a "now" cursor set from block time. Positioned with
// percentages in HTML (not a scaled SVG), so text never distorts; a visually hidden list carries the
// same facts for screen readers, and the History section lists every event again.

const SEGMENT_FILL: Record<Segment["kind"], string> = {
  delivery: "bg-funded-tint border-y border-funded/50",
  review: "bg-submitted-tint border-y border-submitted/50",
  refund: "bg-[repeating-linear-gradient(135deg,var(--state-refunded)_0_2px,transparent_2px_7px)] opacity-60",
};
const SEGMENT_TEXT: Record<Segment["kind"], string> = { delivery: "text-funded", review: "text-submitted", refund: "text-refunded" };
const SEGMENT_NAME: Record<Segment["kind"], string> = { delivery: "Delivery window", review: "Review window", refund: "Refund open to the client" };
const SEGMENT_SHORT: Record<Segment["kind"], string> = { delivery: "Delivery", review: "Review", refund: "Refund open" };

const MARK_DOT: Record<Mark["kind"], string> = {
  created: "bg-ink",
  submitted: "bg-submitted rotate-45 rounded-[3px]",
  rejected: "bg-surface border-2 border-submitted rotate-45 rounded-[3px]",
  approved: "bg-approved rounded-full",
  claimed: "bg-paid rounded-full",
  refunded: "bg-refunded rounded-full",
};
const MARK_LABEL: Record<Mark["kind"], string> = {
  created: "Created",
  submitted: "Evidence submitted",
  rejected: "Revision requested",
  approved: "Approved",
  claimed: "Claimed by the provider",
  refunded: "Refunded to the client",
};

function markText(m: Mark) {
  return `${MARK_LABEL[m.kind]}${m.revision !== undefined ? ` (revision ${m.revision})` : ""} at ${formatUtc(m.at)}`;
}

export function SettlementLane({ chart, creationKnown = true }: { chart: LaneChart; creationKnown?: boolean }) {
  const nowPct = percentAt(chart, chart.now);
  const ticks = axisTicks(chart);
  return (
    <figure aria-labelledby="lane-title" className="m-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <h2 id="lane-title" className="text-title">Settlement lanes</h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-micro text-ink-2" aria-hidden>
          {(["delivery", "review", "refund"] as const).map((k) => (
            <li key={k} className="inline-flex items-center gap-2">
              <span className={`inline-block h-3 w-6 rounded-[3px] ${SEGMENT_FILL[k]}`} />
              {SEGMENT_NAME[k]}
            </li>
          ))}
          <li className="inline-flex items-center gap-2">
            <span className="inline-block h-3.5 w-0.5 rounded bg-cobalt" />
            Now (block time)
          </li>
        </ul>
      </figcaption>

      <div className="mt-8 space-y-4" aria-hidden>
        {chart.lanes.map((lane, row) => (
          <div key={lane.index} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 sm:grid-cols-[9.5rem_1fr] sm:gap-5">
            <div className="space-y-1.5">
              <span className="block text-sm font-medium leading-none">Milestone {lane.index + 1}</span>
              <span className="hidden sm:block"><StateChip state={lane.state} /></span>
              <span className="block text-micro text-ink-3 sm:hidden">{STATE_LABEL[lane.state]}</span>
            </div>

            <div className="relative h-14 rounded-lg border border-line bg-surface [container-type:inline-size]">
              {ticks.map((t) => (
                <div key={String(t.at)} className="absolute inset-y-0 w-px bg-line" style={{ left: `${t.percent}%` }} />
              ))}

              {lane.segments.map((s) => {
                const left = percentAt(chart, s.from);
                const right = s.to === null ? 100 : percentAt(chart, s.to);
                return (
                  <div
                    key={s.kind}
                    className="absolute inset-y-2 overflow-hidden rounded-[5px]"
                    style={{ left: `${left}%`, width: `${Math.max(right - left, 0.4)}%` }}
                    title={`${SEGMENT_NAME[s.kind]}: ${formatUtc(s.from)}${s.to === null ? " onwards" : ` to ${formatUtc(s.to)}`}`}
                  >
                    <div className={`grow-x absolute inset-0 ${SEGMENT_FILL[s.kind]}`} />
                    <span className={`absolute inset-x-0 bottom-1.5 block truncate px-2 text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.06em] ${SEGMENT_TEXT[s.kind]}`}>
                      {SEGMENT_SHORT[s.kind]}
                    </span>
                  </div>
                );
              })}

              {[lane.deliverBy, lane.decideBy].map((t, i) => (
                <div
                  key={i}
                  className="absolute inset-y-0 w-px bg-line-control"
                  style={{ left: `${percentAt(chart, t)}%` }}
                  title={`${i === 0 ? "Delivery" : "Review"} deadline ${formatUtc(t)}`}
                />
              ))}

              {lane.marks.map((m) => (
                <span
                  key={`${m.txHash}-${m.kind}`}
                  className="group/mark pop-in absolute top-[38%] grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center"
                  style={{ left: `${percentAt(chart, m.at)}%` }}
                >
                  <span className={`size-3.5 ring-2 ring-surface transition-transform duration-[var(--dur-hover)] ease-out group-hover/mark:scale-125 ${MARK_DOT[m.kind]}`} />
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-max max-w-[min(15rem,60vw)] -translate-x-1/2 rounded-md bg-ink px-2.5 py-1.5 text-center text-micro text-paper opacity-0 shadow-pop transition-opacity duration-[var(--dur-hover)] group-hover/mark:opacity-100">
                    {markText(m)}
                  </span>
                </span>
              ))}

              {chart.nowPosition === "within" && (
                <div className="absolute -inset-y-1.5 w-0.5 rounded bg-cobalt" style={{ left: `${nowPct}%` }}>
                  {row === 0 && (
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 rounded-full bg-cobalt px-2 py-0.5 text-[0.6875rem] font-semibold leading-none text-paper">now</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        <div className="grid grid-cols-[5.5rem_1fr] gap-3 sm:grid-cols-[9.5rem_1fr] sm:gap-5">
          <span />
          <div className="relative h-9 text-micro text-ink-3">
            {ticks.map((t) => (
              <span key={String(t.at)} className="text-data absolute top-0 -translate-x-1/2 text-[0.75rem]" style={{ left: `${t.percent}%` }}>
                {t.label}
              </span>
            ))}
            <span className="absolute bottom-0 left-0">{creationKnown ? `Created ${formatUtc(chart.start)}` : formatUtc(chart.start)}</span>
            {chart.nowPosition === "after" ? (
              <span className="absolute bottom-0 right-0 font-medium text-cobalt">Now {formatUtc(chart.now)} →</span>
            ) : (
              <span className="absolute bottom-0 right-0">{formatUtc(chart.end)}</span>
            )}
          </div>
        </div>
      </div>

      <ol className="sr-only">
        {chart.lanes.map((lane) => {
          const refund = lane.segments.find((s) => s.kind === "refund");
          return (
            <li key={lane.index}>
              Milestone {lane.index + 1}: {STATE_LABEL[lane.state]}. Delivery deadline {formatUtc(lane.deliverBy)} ({formatRelative(lane.deliverBy, chart.now)}).
              Review deadline {formatUtc(lane.decideBy)} ({formatRelative(lane.decideBy, chart.now)}).{" "}
              {refund ? `The client may refund from ${formatUtc(refund.from)}.` : "It cannot be refunded."}{" "}
              {lane.marks.length > 0 ? `Events: ${lane.marks.map(markText).join("; ")}.` : "No events yet."}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

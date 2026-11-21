import { formatRelative, formatUtc } from "@/domain/format";
import { STATE_LABEL } from "@/domain/lifecycle";
import { percentAt, type LaneChart, type Mark, type Segment } from "@/domain/lane";

// The signature visual (DESIGN.md §1, §4): each milestone as a lane on one shared time axis, with the
// windows in which each action is allowed and a "now" cursor set from block time. Positioned with
// percentages in HTML (not a scaled SVG), so text never distorts; a visually hidden list carries the
// same facts for screen readers.

const SEGMENT_STYLE: Record<Segment["kind"], string> = {
  delivery: "bg-funded-tint border-y border-funded/40",
  review: "bg-submitted-tint border-y border-submitted/40",
  refund: "bg-[repeating-linear-gradient(135deg,var(--state-refunded)_0_2px,transparent_2px_7px)] opacity-70",
};

const SEGMENT_LABEL: Record<Segment["kind"], string> = {
  delivery: "Delivery window",
  review: "Review window",
  refund: "Refund open to the client",
};

const MARK_STYLE: Record<Mark["kind"], string> = {
  created: "bg-ink",
  submitted: "bg-submitted rotate-45 rounded-[2px]",
  rejected: "bg-surface border-2 border-submitted rotate-45 rounded-[2px]",
  approved: "bg-approved rounded-full",
  claimed: "bg-paid rounded-full ring-2 ring-surface",
  refunded: "bg-refunded rounded-full ring-2 ring-surface",
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
  return (
    <figure aria-labelledby="lane-title" className="m-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="lane-title" className="text-title">Settlement lanes</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-ink-2" aria-hidden>
          {(["delivery", "review", "refund"] as const).map((k) => (
            <li key={k} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-3 w-5 rounded-[3px] ${SEGMENT_STYLE[k]}`} />
              {SEGMENT_LABEL[k]}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 bg-cobalt" />
            Now (block time)
          </li>
        </ul>
      </figcaption>

      <div className="mt-5 space-y-3" aria-hidden>
        {chart.lanes.map((lane, row) => (
          <div key={lane.index} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 sm:grid-cols-[8rem_1fr]">
            <div className="text-sm leading-tight">
              <span className="font-medium">Milestone {lane.index + 1}</span>
              <span className="block text-micro text-ink-3">{STATE_LABEL[lane.state]}</span>
            </div>
            <div className="relative h-9 rounded-md border border-line bg-surface">
              {lane.segments.map((s) => {
                const left = percentAt(chart, s.from);
                const right = s.to === null ? 100 : percentAt(chart, s.to);
                return (
                  <div
                    key={s.kind}
                    className={`absolute inset-y-1.5 ${SEGMENT_STYLE[s.kind]}`}
                    style={{ left: `${left}%`, width: `${Math.max(right - left, 0.4)}%` }}
                    title={`${SEGMENT_LABEL[s.kind]}: ${formatUtc(s.from)}${s.to === null ? " onwards" : ` to ${formatUtc(s.to)}`}`}
                  />
                );
              })}
              {[lane.deliverBy, lane.decideBy].map((t, i) => (
                <div key={i} className="absolute inset-y-0 w-px bg-line-control" style={{ left: `${percentAt(chart, t)}%` }} title={`${i === 0 ? "Delivery" : "Review"} deadline ${formatUtc(t)}`} />
              ))}
              {lane.marks.map((m) => (
                <span
                  key={`${m.txHash}-${m.kind}`}
                  className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 ${MARK_STYLE[m.kind]}`}
                  style={{ left: `${percentAt(chart, m.at)}%` }}
                  title={markText(m)}
                />
              ))}
              {chart.nowPosition === "within" && (
                <div className="absolute -inset-y-1 w-0.5 bg-cobalt" style={{ left: `${nowPct}%` }}>
                  {row === 0 && <span className="absolute -top-5 -translate-x-1/2 text-micro font-semibold text-cobalt">now</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[5.5rem_1fr] gap-3 text-micro text-ink-3 sm:grid-cols-[8rem_1fr]">
          <span />
          <div className="flex justify-between gap-2">
            <span>{creationKnown ? `Created ${formatUtc(chart.start)}` : formatUtc(chart.start)}</span>
            {chart.nowPosition === "after" ? (
              <span className="font-medium text-cobalt">Now {formatUtc(chart.now)} →</span>
            ) : (
              <span>{formatUtc(chart.end)}</span>
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

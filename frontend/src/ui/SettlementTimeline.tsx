import { Check, CircleDot, Clock3, ExternalLink, RotateCcw, Undo2 } from "lucide-react";
import { txUrl } from "@/config/chain";
import { formatRelative, formatUtc, shortHex } from "@/domain/format";
import type { LaneChart } from "@/domain/lane";
import { buildTimeline, type TimelineTone } from "@/domain/settlement-timeline";
import { SettlementLane } from "./SettlementLane";
import { StateChip } from "./StateChip";

// Settlement progress (DESIGN.md §15): each milestone as a short road of the steps that really happened, in
// block-time order, then one "now" step for an open milestone. Settled milestones are drawn still; only the
// open step of a live milestone breathes. The exact lane chart (windows, deadlines, block-time cursor) stays
// one click away under "View deadline details".

const TONE: Record<TimelineTone, string> = {
  funded: "var(--state-funded)",
  submitted: "var(--state-submitted)",
  rejected: "var(--state-submitted)",
  approved: "var(--state-approved)",
  paid: "var(--state-paid)",
  refunded: "var(--state-refunded)",
  "refund-open": "var(--state-refunded)",
};

function Glyph({ tone }: { tone: TimelineTone }) {
  if (tone === "refunded") return <Undo2 size={13} strokeWidth={2.75} />;
  if (tone === "rejected") return <RotateCcw size={12} strokeWidth={2.75} />;
  return <Check size={13} strokeWidth={3} />;
}

export function SettlementTimeline({ chart, created }: { chart: LaneChart; created: { at: bigint; txHash?: string } | null }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="lane-title" className="text-title">Settlement progress</h2>
        <p className="text-micro text-ink-3">From the contract&apos;s events and state, judged at block time {formatUtc(chart.now)}</p>
      </div>

      <ol className="mt-6 space-y-4">
        {chart.lanes.map((lane) => {
          const t = buildTimeline(lane, created);
          return (
            <li key={lane.index} data-timeline={lane.index} className="rounded-2xl border border-line bg-sunken/60 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-heading">Milestone {lane.index + 1}</h3>
                <StateChip state={lane.state} />
              </div>
              <ol className="tl mt-4 grid gap-0 sm:auto-cols-fr sm:grid-flow-col">
                {t.steps.map((s, i) => (
                  <li key={`${s.tone}-${i}`} className="tl-step relative flex gap-3 pb-4 sm:block sm:pb-0 sm:pr-3" style={{ "--tone": TONE[s.tone] } as React.CSSProperties}>
                    <span aria-hidden className="tl-rail" />
                    <span aria-hidden className="relative z-[1] grid size-6 shrink-0 place-items-center rounded-full text-paper" style={{ background: TONE[s.tone] }}>
                      <Glyph tone={s.tone} />
                    </span>
                    <div className="min-w-0 sm:mt-2.5">
                      <p className="text-sm font-semibold">
                        {s.label}
                        {s.revision !== undefined && <span className="font-normal text-ink-3"> · rev {s.revision.toString()}</span>}
                      </p>
                      <p className="text-micro text-ink-3">{s.at !== undefined ? formatUtc(s.at) : "Shown by the contract's state; event time not in the history read"}</p>
                      {s.txHash && (
                        <a href={txUrl(s.txHash)} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-data text-[0.75rem] text-ink-2 hover:text-ink">
                          <span className="draw-link">{shortHex(s.txHash)}</span> <ExternalLink aria-hidden size={11} />
                          <span className="sr-only">(transaction on Sepolia Etherscan, opens in a new tab)</span>
                        </a>
                      )}
                    </div>
                  </li>
                ))}
                {t.now && (
                  <li aria-current="step" className="tl-step relative flex gap-3 sm:block" style={{ "--tone": TONE[t.now.tone] } as React.CSSProperties}>
                    <span aria-hidden className="tl-rail tl-rail-open" />
                    <span aria-hidden className="tl-live relative z-[1] grid size-6 shrink-0 place-items-center rounded-full border-2 bg-surface" style={{ borderColor: TONE[t.now.tone], color: TONE[t.now.tone] }}>
                      {t.now.tone === "refund-open" ? <Clock3 size={12} strokeWidth={2.75} /> : <CircleDot size={12} strokeWidth={2.75} />}
                    </span>
                    <div className="min-w-0 sm:mt-2.5">
                      <p className="text-sm font-semibold" style={{ color: TONE[t.now.tone] }}>
                        Now: {t.now.label}
                      </p>
                      <p className="text-micro text-ink-2">{t.now.detail}</p>
                      {t.now.deadline && (
                        <p className="text-micro text-ink-3">
                          {t.now.deadline.label} {formatUtc(t.now.deadline.at)} ({formatRelative(t.now.deadline.at, chart.now)})
                        </p>
                      )}
                    </div>
                  </li>
                )}
              </ol>
            </li>
          );
        })}
      </ol>

      <details className="group mt-5 rounded-2xl border border-line">
        <summary className="flex min-h-11 items-center justify-between gap-3 rounded-2xl px-4 py-2 text-sm font-medium text-ink-2 hover:text-ink sm:px-5">
          View deadline details
          <span aria-hidden className="text-ink-3 transition-transform duration-[var(--dur-hover)] group-open:rotate-90">›</span>
        </summary>
        <div className="border-t border-line p-4 sm:p-5">
          <SettlementLane chart={chart} creationKnown={created !== null} />
        </div>
      </details>
    </div>
  );
}

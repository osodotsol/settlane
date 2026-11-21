import { Check } from "lucide-react";
import type { DisplayState } from "@/domain/lifecycle";
import { milestoneTrack } from "@/domain/milestone-track";

// Where a milestone sits on the road to settlement. Never colour alone: every node has a label, a glyph for
// completed steps and `aria-current="step"` on the current one. One rail runs behind equally spaced nodes,
// and its fill draws in as the track scrolls into view.
export function MilestoneTrack({ state }: { state: DisplayState }) {
  const { nodes, path } = milestoneTrack(state);
  const n = nodes.length;
  const reached = nodes.reduce((max, node, i) => (node.status === "todo" ? max : i), 0);
  const edge = `calc(100% / ${2 * n})`; // the rail runs from the first node's centre to the last node's centre
  const finalStyle = path === "refund" ? "border-refunded bg-refunded text-paper" : "border-paid bg-paid text-paper";
  return (
    <div className="relative">
      <div aria-hidden className="absolute top-[0.6875rem] h-0.5 rounded bg-line" style={{ left: edge, right: edge }}>
        <div className="grow-x h-full rounded bg-ink" style={{ width: `${(reached / (n - 1)) * 100}%` }} />
      </div>
      <ol aria-label="Progress to settlement" className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {nodes.map((node, i) => {
          const settled = i === n - 1 && node.status === "current";
          return (
            <li key={node.label} className="flex flex-col items-center text-center" aria-current={node.status === "current" ? "step" : undefined}>
              <span
                aria-hidden
                className={`grid size-6 place-items-center rounded-full border-2 ${
                  settled
                    ? finalStyle
                    : node.status === "done"
                      ? "border-ink bg-ink text-paper"
                      : node.status === "current"
                        ? "border-cobalt bg-surface text-cobalt"
                        : "border-line-control bg-surface"
                }`}
              >
                {settled || node.status === "done" ? (
                  <Check size={13} strokeWidth={3} />
                ) : node.status === "current" ? (
                  <span className="size-2 rounded-full bg-cobalt" />
                ) : null}
              </span>
              <span className={`mt-2 text-micro ${node.status === "todo" ? "text-ink-3" : "font-semibold text-ink"}`}>
                {node.label}
                <span className="sr-only">{node.status === "done" ? " (completed)" : node.status === "current" ? " (current)" : " (not reached)"}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

import type { Milestone } from "@/contract/read";
import { displayState } from "@/domain/lifecycle";
import { StateChip } from "./StateChip";

export function MilestoneChips({ milestones, now }: { milestones: Milestone[]; now: bigint }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Milestone states">
      {milestones.map((m) => (
        <li key={m.index}>
          <StateChip state={displayState(m.state, now, m.deliverBy, m.decideBy)} />
        </li>
      ))}
    </ul>
  );
}

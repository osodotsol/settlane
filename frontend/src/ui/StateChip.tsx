import { CircleCheck, CircleDashed, CircleDot, Clock3, Hourglass, Undo2, Wallet } from "lucide-react";
import { STATE_LABEL, isFinal, type DisplayState } from "@/domain/lifecycle";

// Hue = where the money goes; outlined = still open, solid = final (DESIGN.md §2). Never colour alone:
// every chip carries a glyph and a label.
const styles: Record<DisplayState, string> = {
  none: "border border-dashed border-line-control text-ink-3",
  funded: "border border-funded text-funded bg-funded-tint",
  submitted: "border border-submitted text-submitted bg-submitted-tint",
  approved: "border border-approved text-approved bg-approved-tint",
  paid: "border border-paid bg-paid text-paper",
  refunded: "border border-refunded bg-refunded text-paper",
  expired:
    "border border-refunded text-refunded bg-[repeating-linear-gradient(135deg,var(--state-refunded-tint)_0_6px,transparent_6px_10px)]",
};

const icons = { none: CircleDashed, funded: Wallet, submitted: Hourglass, approved: CircleCheck, paid: CircleDot, refunded: Undo2, expired: Clock3 };

export function StateChip({ state }: { state: DisplayState }) {
  const Icon = icons[state];
  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-micro ${styles[state]}`}
      data-final={isFinal(state) || undefined}
    >
      <Icon aria-hidden size={14} strokeWidth={1.75} />
      {STATE_LABEL[state]}
    </span>
  );
}

import { STATE_LABEL, isFinal, type DisplayState } from "@/domain/lifecycle";

// A quiet pill: a coloured dot and the state's name. The colour says where the money is going; the label
// always says it in words, so colour is never the only signal (DESIGN.md §2, §13).
const DOT: Record<DisplayState, string> = {
  none: "border border-line-control bg-transparent",
  funded: "bg-funded",
  submitted: "bg-submitted",
  approved: "bg-approved",
  paid: "bg-paid",
  refunded: "bg-refunded",
  expired: "bg-refunded",
};

export function StateChip({ state }: { state: DisplayState }) {
  return (
    <span
      className="inline-flex min-h-7 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-0.5 text-micro font-semibold text-ink"
      data-final={isFinal(state) || undefined}
    >
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[state]}`} />
      {STATE_LABEL[state]}
    </span>
  );
}

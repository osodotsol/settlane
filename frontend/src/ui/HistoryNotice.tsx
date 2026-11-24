import type { HistoryStatus } from "@/contract/history";
import { describeHistory, type Coverage } from "@/domain/history-coverage";

/**
 * What the page knows about the completeness of the event list next to it. "Complete" is shown only when no range is
 * missing, the recorded history and the chain agree, and (when given) the events equal what the contract's state
 * requires. Otherwise it says exactly what is missing and why. Contract state shown elsewhere is read live and is
 * unaffected either way.
 */
export function HistoryNotice({ status, coverage, className = "" }: { status: HistoryStatus | undefined; coverage?: Coverage; className?: string }) {
  const n = describeHistory(status, coverage);
  if (n.level === "complete") {
    return (
      <p role="status" data-history="complete" className={`flex items-start gap-2 text-micro text-ink-3 ${className}`}>
        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-paid" />
        <span><span className="font-medium text-ink-2">{n.title}.</span> {n.detail}</span>
      </p>
    );
  }
  return (
    <div role="status" data-history="incomplete" className={`rounded-xl border border-submitted bg-submitted-tint px-4 py-3 text-sm ${className}`}>
      <p className="font-semibold text-ink">{n.title}</p>
      <p className="mt-0.5 text-ink-2">{n.detail} The agreement&apos;s state, balances and what you can do are read live from the contract and do not depend on this list.</p>
    </div>
  );
}

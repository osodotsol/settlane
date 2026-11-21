import { formatEth } from "@/domain/format";

/** An ETH amount in tabular mono; the exact wei value is in the title. */
export function Amount({ wei, className = "" }: { wei: bigint; className?: string }) {
  return (
    <span className={`text-data whitespace-nowrap ${className}`} title={`${wei.toString()} wei`}>
      {formatEth(wei)} <span className="font-sans text-ink-3">ETH</span>
    </span>
  );
}

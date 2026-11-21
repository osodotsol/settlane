import { formatEth } from "@/domain/format";

/**
 * An ETH amount; the exact wei value is in the title.
 * `data` (default): tabular mono, for tables and running text. `numeral`: the large display figure used in
 * stat rows, with the unit set smaller beside it.
 */
export function Amount({ wei, className = "", variant = "data" }: { wei: bigint; className?: string; variant?: "data" | "numeral" }) {
  if (variant === "numeral") {
    return (
      <span className={`text-numeral whitespace-nowrap ${className}`} title={`${wei.toString()} wei`}>
        {formatEth(wei)} <span className="font-sans text-base font-medium text-ink-3">ETH</span>
      </span>
    );
  }
  return (
    <span className={`text-data whitespace-nowrap ${className}`} title={`${wei.toString()} wei`}>
      {formatEth(wei)} <span className="font-sans text-ink-3">ETH</span>
    </span>
  );
}

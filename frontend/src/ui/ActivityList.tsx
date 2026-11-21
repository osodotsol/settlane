import { ExternalLink } from "lucide-react";
import { toHex } from "viem";
import { txUrl } from "@/config/chain";
import type { Activity } from "@/contract/events";
import { formatEth, formatUtc, shortHex } from "@/domain/format";

// The agreement's history, decoded from the contract's own events (chain order: block, then log index).
function describe(a: Activity): string {
  const ms = a.m === null ? "" : `milestone ${a.m + 1}`;
  switch (a.kind) {
    case "created":
      return `Agreement created and funded with ${formatEth(a.total ?? 0n)} ETH for ${a.milestones} milestone${a.milestones === 1 ? "" : "s"}`;
    case "submitted":
      return `Provider submitted evidence ${shortHex(toHex(a.evidence ?? 0n, { size: 32 }), 8, 6)} for ${ms} (revision ${a.revision})`;
    case "approved":
      return `Verifier approved ${ms}, revision ${a.revision}`;
    case "rejected":
      return `Verifier asked for a revision of ${ms} (revision ${a.revision}; ${a.rejections} request${a.rejections === 1n ? "" : "s"} so far)`;
    case "claimed":
      return `Provider claimed ${formatEth(a.amount ?? 0n)} ETH for ${ms}, paid to ${shortHex(a.to ?? "")}`;
    case "refunded":
      return `Client refunded ${formatEth(a.amount ?? 0n)} ETH for ${ms}, sent to ${shortHex(a.to ?? "")}`;
  }
}

export function ActivityList({ items }: { items: readonly Activity[] }) {
  if (items.length === 0) return <p className="text-ink-2">No events recorded for this agreement yet.</p>;
  return (
    <ol className="divide-y divide-line border-y border-line">
      {items.map((a) => (
        <li key={`${a.txHash}:${a.logIndex}`} className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr_auto] sm:items-center sm:gap-4">
          <span className="text-data text-sm text-ink-3">{formatUtc(a.timestamp)}</span>
          <span>{describe(a)}</span>
          <a
            href={txUrl(a.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-ink-2 underline decoration-line-control underline-offset-4 hover:decoration-cobalt"
          >
            Block {a.blockNumber.toString()}
            <ExternalLink aria-hidden size={14} />
            <span className="sr-only">(transaction on Sepolia Etherscan, opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

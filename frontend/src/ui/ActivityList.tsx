import { ExternalLink } from "lucide-react";
import { toHex } from "viem";
import { txUrl } from "@/config/chain";
import type { Activity, ActivityKind } from "@/contract/events";
import { formatEth, formatUtc, shortHex } from "@/domain/format";

// The agreement's history, decoded from the contract's own events (in the order the caller gives), drawn as a
// ledger: one hairline-separated row per event with a small status dot, the UTC time, the description and the
// block, which links to the transaction. The text says what happened; the dot only echoes it.
const NODE: Record<ActivityKind, string> = {
  created: "bg-funded",
  submitted: "bg-submitted",
  approved: "bg-approved",
  rejected: "bg-submitted",
  claimed: "bg-paid",
  refunded: "bg-refunded",
};

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

export function ActivityList({ items, showAgreement = false, empty = "No events recorded for this agreement yet." }: { items: readonly Activity[]; showAgreement?: boolean; empty?: string }) {
  if (items.length === 0) return <p className="text-ink-2">{empty}</p>;
  return (
    <div className="@container">
    <ol className="reveal-stagger divide-y divide-line">
      {items.map((a, i) => (
        <li
          key={`${a.txHash}:${a.logIndex}`}
          style={{ "--i": Math.min(i, 6) } as React.CSSProperties}
          className="grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-3 first:pt-0 last:pb-0 @2xl:grid-cols-[0.625rem_9.5rem_minmax(0,1fr)_auto] @2xl:gap-x-4"
        >
          <span aria-hidden className={`col-start-1 row-start-1 size-1.5 -translate-y-px rounded-full ${NODE[a.kind]}`} />
          <span className="col-start-2 row-start-1 text-data text-[0.75rem] text-ink-3">{formatUtc(a.timestamp)}</span>
          <p className="col-span-2 col-start-2 row-start-2 text-[0.9375rem] leading-snug text-ink-2 @2xl:col-span-1 @2xl:col-start-3 @2xl:row-start-1">
            {showAgreement && <span className="text-ink">Agreement #{a.id.toString()} · </span>}
            {describe(a)}
          </p>
          <a
            href={txUrl(a.txHash)}
            target="_blank"
            rel="noreferrer"
            className="col-start-3 row-start-1 inline-flex items-center gap-1 justify-self-end whitespace-nowrap text-data text-[0.75rem] text-ink-3 hover:text-ink @2xl:col-start-4"
          >
            <span className="draw-link">Block {a.blockNumber.toString()}</span>
            <ExternalLink aria-hidden size={11} />
            <span className="sr-only">(transaction on Sepolia Etherscan, opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ol>
    </div>
  );
}

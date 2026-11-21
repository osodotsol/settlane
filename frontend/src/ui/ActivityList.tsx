import { ArrowDownToLine, BadgeCheck, ExternalLink, FilePlus2, RotateCcw, Undo2, Upload, type LucideIcon } from "lucide-react";
import { toHex } from "viem";
import { txUrl } from "@/config/chain";
import type { Activity, ActivityKind } from "@/contract/events";
import { formatEth, formatUtc, shortHex } from "@/domain/format";

// The agreement's history, decoded from the contract's own events (chain order: block, then log index),
// drawn as a timeline: a spine, one node per event, and the same text and links as before.
const ICON: Record<ActivityKind, LucideIcon> = {
  created: FilePlus2,
  submitted: Upload,
  approved: BadgeCheck,
  rejected: RotateCcw,
  claimed: ArrowDownToLine,
  refunded: Undo2,
};
const NODE: Record<ActivityKind, string> = {
  created: "border-ink bg-surface text-ink",
  submitted: "border-submitted bg-surface text-submitted",
  approved: "border-approved bg-surface text-approved",
  rejected: "border-submitted bg-surface text-submitted",
  claimed: "border-paid bg-paid text-paper",
  refunded: "border-refunded bg-refunded text-paper",
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

export function ActivityList({ items }: { items: readonly Activity[] }) {
  if (items.length === 0) return <p className="text-ink-2">No events recorded for this agreement yet.</p>;
  return (
    <ol className="reveal-stagger relative">
      {items.map((a, i) => {
        const Icon = ICON[a.kind];
        return (
          <li
            key={`${a.txHash}:${a.logIndex}`}
            style={{ "--i": Math.min(i, 6) } as React.CSSProperties}
            className="group relative grid grid-cols-[2.5rem_1fr] gap-x-4 pb-7 last:pb-0 sm:grid-cols-[2.5rem_1fr_auto]"
          >
            {i < items.length - 1 && <span aria-hidden className="absolute bottom-0 left-[1.1875rem] top-10 w-px bg-line" />}
            <span aria-hidden className={`relative z-10 grid size-10 place-items-center rounded-full border-2 transition-transform duration-[var(--dur-hover)] ease-out group-hover:scale-105 ${NODE[a.kind]}`}>
              <Icon size={17} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-data text-[0.8125rem] text-ink-3">{formatUtc(a.timestamp)}</p>
              <p className="mt-0.5">{describe(a)}</p>
            </div>
            <a
              href={txUrl(a.txHash)}
              target="_blank"
              rel="noreferrer"
              className="col-start-2 mt-2 inline-flex items-center gap-1 self-start text-sm text-ink-2 hover:text-ink sm:col-start-3 sm:mt-1"
            >
              <span className="draw-link">Block {a.blockNumber.toString()}</span>
              <ExternalLink aria-hidden size={14} />
              <span className="sr-only">(transaction on Sepolia Etherscan, opens in a new tab)</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

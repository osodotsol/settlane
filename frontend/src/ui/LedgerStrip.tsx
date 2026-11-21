import { CircleCheck, TriangleAlert } from "lucide-react";
import { formatEth } from "@/domain/format";
import type { Ledger, LedgerPart } from "@/domain/ledger";
import { Amount } from "./Amount";

// deposited = paid + refunded + outstanding as one proportional bar (DESIGN.md §4), with the exact values
// and a check that the contract's counters agree with the sums of its own milestones.
const PART_FILL = { paid: "bg-paid", refunded: "bg-refunded", outstanding: "bg-funded-tint border border-funded" } as const;
const PART_LABEL = { paid: "Paid to provider", refunded: "Refunded to client", outstanding: "Outstanding" } as const;
const PART_NOTE = {
  paid: "Claimed by the provider",
  refunded: "Returned to the client",
  outstanding: "Still held by the contract",
} as const;

function share(p: LedgerPart): string {
  if (p.wei === 0n) return "0%";
  const pct = p.basisPoints / 100;
  return pct < 1 ? "<1%" : `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

export function LedgerStrip({ ledger }: { ledger: Ledger }) {
  const ok = ledger.identityHolds && ledger.matchesMilestones;
  return (
    <section aria-labelledby="ledger-title" className="card p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h2 id="ledger-title" className="text-title">Accounting</h2>
          <p className="mt-1 text-sm text-ink-3">Every wei of the deposit is in exactly one place.</p>
        </div>
        <div className="sm:text-right">
          <p className="text-sm text-ink-3">Deposited</p>
          <p className="text-numeral" title={`${ledger.deposited.toString()} wei`}>
            {formatEth(ledger.deposited)} <span className="font-sans text-base font-medium text-ink-3">ETH</span>
          </p>
        </div>
      </div>

      <div className="mt-7 flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        {ledger.parts
          .filter((p) => p.wei > 0n)
          .map((p) => (
            <div
              key={p.kind}
              className={`grow-x h-full min-w-[6px] first:rounded-l-full last:rounded-r-full ${PART_FILL[p.kind]}`}
              style={{ flexGrow: p.basisPoints, flexBasis: 0 }}
              title={`${PART_LABEL[p.kind]}: ${formatEth(p.wei)} ETH`}
            />
          ))}
      </div>

      <dl className="mt-6 grid gap-5 sm:grid-cols-3">
        {ledger.parts.map((p) => (
          <div key={p.kind} className="border-t border-line pt-4">
            <dt className="flex items-center gap-2 text-sm text-ink-2">
              <span aria-hidden className={`inline-block size-2.5 rounded-full ${PART_FILL[p.kind]}`} />
              {PART_LABEL[p.kind]}
            </dt>
            <dd className="mt-2 flex items-baseline justify-between gap-3">
              <Amount wei={p.wei} className="text-lg" />
              <span className="text-sm text-ink-3">{share(p)}</span>
            </dd>
            <dd className="mt-1 text-micro text-ink-3">{PART_NOTE[p.kind]}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 text-sm text-ink-2">
        <span className="text-data">
          {formatEth(ledger.deposited)} = {formatEth(ledger.parts[0]!.wei)} + {formatEth(ledger.parts[1]!.wei)} + {formatEth(ledger.parts[2]!.wei)}
        </span>{" "}
        ETH: deposited equals paid plus refunded plus outstanding.
      </p>
      <p className={`mt-2 flex items-center gap-2 text-sm ${ok ? "text-paid" : "text-danger"}`}>
        {ok ? <CircleCheck aria-hidden size={16} /> : <TriangleAlert aria-hidden size={16} />}
        {ok
          ? "Each figure equals the sum of this agreement's milestone amounts in the matching state."
          : "These figures do not match the milestone amounts. Please report this."}
      </p>
    </section>
  );
}

import { CircleCheck, TriangleAlert } from "lucide-react";
import { formatEth } from "@/domain/format";
import type { Ledger } from "@/domain/ledger";
import { Amount } from "./Amount";

// deposited = paid + refunded + outstanding as one proportional bar (DESIGN.md §4), with the exact values
// and a check that the contract's counters agree with the sums of its own milestones.
const PART_STYLE = { paid: "bg-paid", refunded: "bg-refunded", outstanding: "bg-funded-tint border border-funded" } as const;
const PART_LABEL = { paid: "Paid to provider", refunded: "Refunded to client", outstanding: "Outstanding" } as const;

export function LedgerStrip({ ledger }: { ledger: Ledger }) {
  return (
    <section aria-labelledby="ledger-title" className="border-y border-line py-8">
      <h2 id="ledger-title" className="text-title">Accounting</h2>
      <div className="mt-5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        {ledger.parts.filter((p) => p.wei > 0n).map((p) => (
          <div key={p.kind} className={`h-full min-w-[3px] first:rounded-l-full last:rounded-r-full ${PART_STYLE[p.kind]}`} style={{ flexGrow: p.basisPoints, flexBasis: 0 }} />
        ))}
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-6 md:grid-cols-4">
        <div>
          <dt className="text-sm text-ink-3">Deposited</dt>
          <dd className="mt-1"><Amount wei={ledger.deposited} className="text-lg" /></dd>
        </div>
        {ledger.parts.map((p) => (
          <div key={p.kind}>
            <dt className="flex items-center gap-2 text-sm text-ink-3">
              <span aria-hidden className={`inline-block size-2.5 rounded-full ${PART_STYLE[p.kind]}`} />
              {PART_LABEL[p.kind]}
            </dt>
            <dd className="mt-1"><Amount wei={p.wei} className="text-lg" /></dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-sm text-ink-2">
        <span className="text-data">
          {formatEth(ledger.deposited)} = {formatEth(ledger.parts[0]!.wei)} + {formatEth(ledger.parts[1]!.wei)} + {formatEth(ledger.parts[2]!.wei)}
        </span>{" "}
        ETH: deposited equals paid plus refunded plus outstanding.
      </p>
      <p className={`mt-2 flex items-center gap-2 text-sm ${ledger.identityHolds && ledger.matchesMilestones ? "text-paid" : "text-danger"}`}>
        {ledger.identityHolds && ledger.matchesMilestones ? <CircleCheck aria-hidden size={16} /> : <TriangleAlert aria-hidden size={16} />}
        {ledger.identityHolds && ledger.matchesMilestones
          ? "Each figure equals the sum of this agreement's milestone amounts in the matching state."
          : "These figures do not match the milestone amounts. Please report this."}
      </p>
    </section>
  );
}

import type { ReactNode } from "react";
import { toHex } from "viem";
import type { Milestone } from "@/contract/read";
import { formatEth, formatRelative, formatUtc, shortHex } from "@/domain/format";
import { displayState } from "@/domain/lifecycle";
import { nextStep } from "@/domain/next-step";
import { MilestoneTrack } from "./MilestoneTrack";
import { StateChip } from "./StateChip";

// One milestone with its state, track, deadlines and hashes. Shared by the public agreement page and the
// application workspace (which passes the actions the connected wallet may take through `actions`).

export function NextStepText({ m, now }: { m: Milestone; now: bigint }) {
  const n = nextStep(m, now);
  switch (n.kind) {
    case "deliver":
      return <>The provider can submit evidence until {formatUtc(n.by)} ({formatRelative(n.by, now)}).</>;
    case "review":
      return <>The verifier can approve or request a revision until {formatUtc(n.by)} ({formatRelative(n.by, now)}).</>;
    case "claim":
      return <>Approved. The provider can claim the amount at any time; an approval never expires.</>;
    case "refund":
      return <>Expired since {formatUtc(n.since)}. The client can refund the amount.</>;
    case "settled":
      return <>Settled. No further action is possible.</>;
  }
}

function Deadline({ label, at, now }: { label: string; at: bigint; now: bigint }) {
  return (
    <div>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="mt-0.5">
        <span className="text-data">{formatUtc(at)}</span>
        <span className="ml-2 text-sm text-ink-3">{formatRelative(at, now)}</span>
      </dd>
    </div>
  );
}

export function MilestoneDetail({ m, now, actions }: { m: Milestone; now: bigint; actions?: ReactNode }) {
  const state = displayState(m.state, now, m.deliverBy, m.decideBy);
  const hex = (v: bigint) => toHex(v, { size: 32 });
  return (
    <li id={`milestone-${m.index + 1}`} className="reveal scroll-mt-28 grid gap-6 py-8 last:pb-0 md:grid-cols-[14rem_1fr] md:gap-10">
      <div className="space-y-3">
        <h3 className="text-heading">Milestone {m.index + 1}</h3>
        <StateChip state={state} />
        <p className="text-numeral" title={`${m.amount.toString()} wei`}>
          {formatEth(m.amount)} <span className="font-sans text-base font-medium text-ink-3">ETH</span>
        </p>
      </div>
      <div>
        <MilestoneTrack state={state} />
        <p className="mt-6 measure text-ink-2"><NextStepText m={m} now={now} /></p>
        {actions}
        <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Deadline label="Delivery deadline" at={m.deliverBy} now={now} />
          <Deadline label="Review deadline" at={m.decideBy} now={now} />
          <div>
            <dt className="text-sm text-ink-3">Specification hash</dt>
            <dd className="mt-0.5 text-data break-all" title={hex(m.spec)}>{shortHex(hex(m.spec), 10, 8)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-3">Current evidence</dt>
            <dd className="mt-0.5">
              {m.evidence === 0n ? <span className="text-ink-3">None</span> : <span className="text-data" title={hex(m.evidence)}>{shortHex(hex(m.evidence), 10, 8)}</span>}
              <span className="ml-2 text-sm text-ink-3">
                revision {m.revision.toString()} · {m.rejections.toString()} revision request{m.rejections === 1n ? "" : "s"}
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </li>
  );
}

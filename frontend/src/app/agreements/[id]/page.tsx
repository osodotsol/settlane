import type { Metadata } from "next";
import { CircleCheck, CircleDot } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toHex } from "viem";
import { getActivity, getAgreement } from "@/contract/data";
import type { Activity } from "@/contract/events";
import type { Milestone } from "@/contract/read";
import { formatEth, formatRelative, formatUtc, shortHex } from "@/domain/format";
import { buildLaneChart } from "@/domain/lane";
import { buildLedger } from "@/domain/ledger";
import { displayState, isFinal } from "@/domain/lifecycle";
import { nextStep } from "@/domain/next-step";
import { ActivityList } from "@/ui/ActivityList";
import { Address } from "@/ui/Address";
import { Avatar } from "@/ui/Avatar";
import { Banner } from "@/ui/Banner";
import { Container } from "@/ui/Container";
import { LedgerStrip } from "@/ui/LedgerStrip";
import { MilestoneTrack } from "@/ui/MilestoneTrack";
import { SettlementLane } from "@/ui/SettlementLane";
import { StateChip } from "@/ui/StateChip";

// Rendered per request from a short-lived server cache (src/contract/cache.ts): a new event or agreement
// shows up within seconds, and an RPC outage serves the last good data with a notice instead of an error.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Agreement ids are positive integers (ids start at 1; 0 is never valid). src/proxy.ts 404s the rest first. */
function parseId(raw: string): bigint | null {
  if (!/^[1-9]\d{0,76}$/.test(raw)) return null;
  return BigInt(raw);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  return { title: `Agreement #${id}` };
}

function NextStepText({ m, now }: { m: Milestone; now: bigint }) {
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

function MilestoneBlock({ m, now }: { m: Milestone; now: bigint }) {
  const state = displayState(m.state, now, m.deliverBy, m.decideBy);
  const hex = (v: bigint) => toHex(v, { size: 32 });
  return (
    <li className="reveal grid gap-6 py-9 md:grid-cols-[14rem_1fr] md:gap-10">
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

export default async function AgreementPage({ params }: Params) {
  const { id: raw } = await params;
  const id = parseId(raw);
  if (id === null) notFound();

  let view;
  try {
    view = await getAgreement(id);
  } catch {
    return (
      <Container className="py-14">
        <h1 className="text-display">Agreement #{raw}</h1>
        <div className="mt-8">
          <Banner tone="danger" title="The Sepolia endpoints did not answer">Reload the page to try again.</Banner>
        </div>
      </Container>
    );
  }
  const { agreement, blockTime: now } = view.value;
  if (agreement === null) notFound();

  // History is optional: if it cannot be read, the page still shows state, accounting and the lanes.
  let history: Activity[] | null = null;
  let historyStale = false;
  try {
    const all = await getActivity();
    history = all.value.filter((a) => a.id === id);
    historyStale = all.stale;
  } catch {
    history = null;
  }
  const created = history?.find((a) => a.kind === "created");
  const earliestDeadline = agreement.milestones.reduce((x, m) => (m.deliverBy < x ? m.deliverBy : x), agreement.milestones[0]!.deliverBy);
  const chart = buildLaneChart(agreement.milestones, history ?? [], created?.timestamp ?? earliestDeadline - agreement.reviewPeriod, now);
  const open = agreement.milestones.some((m) => !isFinal(displayState(m.state, now, m.deliverBy, m.decideBy)));

  const roles: [string, `0x${string}`][] = [
    ["Client", agreement.client],
    ["Provider", agreement.provider],
    ["Verifier", agreement.verifier],
  ];

  return (
    <Container className="relative py-12 sm:py-16">
      <p className="enter text-sm" style={{ "--d": 0 } as React.CSSProperties}>
        <Link href="/explorer" className="draw-link text-ink-2 hover:text-ink">
          All agreements
        </Link>
      </p>
      <div className="enter mt-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-4" style={{ "--d": 80 } as React.CSSProperties}>
        <h1 className="text-display-xl">Agreement #{agreement.id.toString()}</h1>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium ${
            open ? "border-cobalt/50 bg-surface text-cobalt" : "border-paid/50 bg-paid-tint text-paid"
          }`}
        >
          {open ? <CircleDot aria-hidden size={16} /> : <CircleCheck aria-hidden size={16} />}
          {open ? "Open" : "Closed: every milestone is settled"}
        </span>
      </div>

      {(view.stale || historyStale) && (
        <div className="mt-6">
          <Banner title="Showing the last data read from Sepolia">
            The public endpoints are not answering right now. These figures were read at {new Date(view.fetchedAt).toISOString().slice(0, 19).replace("T", " ")} UTC.
          </Banner>
        </div>
      )}

      <section aria-labelledby="parties" className="enter mt-10" style={{ "--d": 160 } as React.CSSProperties}>
        <h2 id="parties" className="sr-only">Parties</h2>
        <ul className="grid gap-x-8 gap-y-5 lg:grid-cols-3">
          {roles.map(([role, address]) => (
            <li key={role} className="flex items-center gap-3.5 border-t border-line pt-4">
              <Avatar address={address} size={44} />
              <Address address={address} role={role} />
            </li>
          ))}
        </ul>
        <p className="mt-5 measure text-sm text-ink-3">
          The verifier is a trusted party: its approval or revision request is final on-chain, and Settlane cannot check the work itself. Each review
          deadline is the delivery deadline plus {agreement.reviewPeriod.toString()} s.
        </p>
      </section>

      <div className="reveal mt-12">
        <LedgerStrip ledger={buildLedger(agreement)} />
      </div>

      <section className="reveal mt-14">
        <SettlementLane chart={chart} creationKnown={created !== undefined} />
        <p className="mt-3 text-sm text-ink-3">States and windows are judged at Sepolia block time {formatUtc(now)}.</p>
      </section>

      <section aria-labelledby="milestones" className="mt-16">
        <h2 id="milestones" className="text-title">Milestones</h2>
        <ol className="mt-2 divide-y divide-line border-b border-line">
          {agreement.milestones.map((m) => (
            <MilestoneBlock key={m.index} m={m} now={now} />
          ))}
        </ol>
      </section>

      <section aria-labelledby="history" className="mt-16">
        <h2 id="history" className="text-title">History</h2>
        <p className="mb-6 mt-1 text-sm text-ink-3">Decoded from the contract&apos;s events on Sepolia, in chain order.</p>
        {history === null ? (
          <Banner title="The history could not be read right now">The state above is current; reload to try the event history again.</Banner>
        ) : (
          <ActivityList items={history} />
        )}
      </section>
    </Container>
  );
}

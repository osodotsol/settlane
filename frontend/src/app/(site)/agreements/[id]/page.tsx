import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgreement, getHistory } from "@/contract/data";
import type { Activity } from "@/contract/events";
import { formatUtc } from "@/domain/format";
import { agreementCoverage } from "@/domain/history-coverage";
import { HistoryNotice } from "@/ui/HistoryNotice";
import { buildLaneChart } from "@/domain/lane";
import { buildLedger } from "@/domain/ledger";
import { displayState, isFinal } from "@/domain/lifecycle";
import { ActivityList } from "@/ui/ActivityList";
import { Address } from "@/ui/Address";
import { Avatar } from "@/ui/Avatar";
import { Banner } from "@/ui/Banner";
import { Container } from "@/ui/Container";
import { LedgerStrip } from "@/ui/LedgerStrip";
import { MilestoneDetail } from "@/ui/MilestoneDetail";
import { SettlementLane } from "@/ui/SettlementLane";

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

export default async function AgreementPage({ params }: Params) {
  const { id: raw } = await params;
  const id = parseId(raw);
  if (id === null) notFound();

  // state and history are read in parallel, each time-bounded, so the page waits for at most one budget
  const historyRead = getHistory().catch(() => null);
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

  // History never blocks the page: state, accounting and the lanes are live, and the event list says if it is incomplete.
  let history: Activity[] | null = null;
  let historyStatus: Awaited<ReturnType<typeof getHistory>>["value"]["status"] | undefined;
  const all = await historyRead;
  if (all) {
    history = all.value.events.filter((a) => a.id === id);
    historyStatus = all.value.status;
  }
  const coverage = history ? agreementCoverage(agreement, history) : undefined;
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
          className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-semibold text-ink"
        >
          <span aria-hidden className={`size-2 rounded-full ${open ? "bg-cobalt" : "bg-paid"}`} />
          {open ? "Open" : "Closed: every milestone is settled"}
        </span>
      </div>

      {view.stale && (
        <div className="mt-6">
          <Banner title="Showing the last data read from Sepolia">
            The public endpoints are not answering right now. These figures were read at {new Date(view.fetchedAt).toISOString().slice(0, 19).replace("T", " ")} UTC.
          </Banner>
        </div>
      )}

      <section aria-labelledby="parties" className="enter mt-10" style={{ "--d": 160 } as React.CSSProperties}>
        <h2 id="parties" className="sr-only">Parties</h2>
        <ul className="card grid divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {roles.map(([role, address]) => (
            <li key={role} className="flex items-center gap-3.5 p-5">
              <Avatar address={address} size={44} />
              <Address address={address} role={role} />
            </li>
          ))}
        </ul>
        <p className="mt-4 measure text-sm text-ink-3">
          The verifier is a trusted party: its approval or revision request is final on-chain, and Settlane cannot check the work itself. Each review
          deadline is the delivery deadline plus {agreement.reviewPeriod.toString()} s.
        </p>
      </section>

      <div className="reveal mt-6">
        <LedgerStrip ledger={buildLedger(agreement)} />
      </div>

      <section className="card reveal mt-6 p-6 sm:p-8">
        <SettlementLane chart={chart} creationKnown={created !== undefined} />
        <p className="mt-3 text-sm text-ink-3">States and windows are judged at Sepolia block time {formatUtc(now)}.</p>
      </section>

      <section aria-labelledby="milestones" className="card mt-6 p-6 sm:p-8">
        <h2 id="milestones" className="text-title">Milestones</h2>
        <ol className="mt-2 divide-y divide-line">
          {agreement.milestones.map((m) => (
            <MilestoneDetail key={m.index} m={m} now={now} />
          ))}
        </ol>
      </section>

      <section aria-labelledby="history" className="card mt-6 p-6 sm:p-8">
        <h2 id="history" className="text-title">History</h2>
        <p className="mb-6 mt-1 text-sm text-ink-3">Decoded from the contract&apos;s events on Sepolia, in chain order.</p>
        <HistoryNotice status={historyStatus} coverage={coverage} className="mb-5" />
        {history === null ? null : <ActivityList items={history} empty="No events could be read for this agreement." />}
      </section>
    </Container>
  );
}

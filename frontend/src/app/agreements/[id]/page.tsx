import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toHex } from "viem";
import { latestBlockTime, readAgreement, type Agreement, type Milestone } from "@/contract/read";
import { formatEth, formatRelative, formatUtc, shortHex } from "@/domain/format";
import { displayState, isFinal } from "@/domain/lifecycle";
import { Address } from "@/ui/Address";
import { Amount } from "@/ui/Amount";
import { Banner } from "@/ui/Banner";
import { Container } from "@/ui/Container";
import { StateChip } from "@/ui/StateChip";

export const revalidate = 30;

type Params = { params: Promise<{ id: string }> };

/** Agreement ids are positive integers (ids start at 1; 0 is never valid). */
function parseId(raw: string): bigint | null {
  if (!/^[1-9]\d{0,76}$/.test(raw)) return null;
  return BigInt(raw);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  return { title: `Agreement #${id}` };
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
  return (
    <li className="grid gap-5 py-8 md:grid-cols-[12rem_1fr]">
      <div className="space-y-2">
        <h3 className="text-heading">Milestone {m.index + 1}</h3>
        <StateChip state={state} />
        <p><Amount wei={m.amount} className="text-lg" /></p>
      </div>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Deadline label="Delivery deadline" at={m.deliverBy} now={now} />
        <Deadline label="Review deadline" at={m.decideBy} now={now} />
        <div>
          <dt className="text-sm text-ink-3">Specification hash</dt>
          <dd className="mt-0.5 text-data" title={toHex(m.spec, { size: 32 })}>{shortHex(toHex(m.spec, { size: 32 }), 10, 8)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-3">Evidence</dt>
          <dd className="mt-0.5">
            {m.evidence === 0n ? (
              <span className="text-ink-3">None submitted</span>
            ) : (
              <span className="text-data" title={toHex(m.evidence, { size: 32 })}>{shortHex(toHex(m.evidence, { size: 32 }), 10, 8)}</span>
            )}
            <span className="ml-2 text-sm text-ink-3">
              revision {m.revision.toString()} · {m.rejections.toString()} revision request{m.rejections === 1n ? "" : "s"}
            </span>
          </dd>
        </div>
      </dl>
    </li>
  );
}

function Accounting({ a }: { a: Agreement }) {
  const rows: [string, bigint][] = [
    ["Deposited", a.deposited],
    ["Paid to provider", a.paid],
    ["Refunded to client", a.refunded],
    ["Outstanding", a.outstanding],
  ];
  return (
    <section aria-labelledby="accounting" className="border-y border-line py-8">
      <h2 id="accounting" className="text-title">Accounting</h2>
      <dl className="mt-5 grid grid-cols-2 gap-6 md:grid-cols-4">
        {rows.map(([label, wei]) => (
          <div key={label}>
            <dt className="text-sm text-ink-3">{label}</dt>
            <dd className="mt-1"><Amount wei={wei} className="text-lg" /></dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-sm text-ink-3">
        <span className="text-data">
          {formatEth(a.deposited)} = {formatEth(a.paid)} + {formatEth(a.refunded)} + {formatEth(a.outstanding)}
        </span>{" "}
        ETH: deposited equals paid plus refunded plus outstanding.
      </p>
    </section>
  );
}

export default async function AgreementPage({ params }: Params) {
  const { id: raw } = await params;
  const id = parseId(raw);
  if (id === null) notFound();

  let agreement: Agreement | null;
  let now: bigint;
  try {
    [agreement, now] = await Promise.all([readAgreement(id), latestBlockTime()]);
  } catch {
    return (
      <Container className="py-14">
        <h1 className="text-display">Agreement #{raw}</h1>
        <div className="mt-8">
          <Banner tone="danger" title="The Sepolia endpoints did not answer">
            Reload the page to try again.
          </Banner>
        </div>
      </Container>
    );
  }
  if (agreement === null) notFound();

  const open = agreement.milestones.some((m) => !isFinal(displayState(m.state, now, m.deliverBy, m.decideBy)));

  return (
    <Container className="py-14">
      <p className="text-sm">
        <Link href="/explorer" className="text-ink-2 underline decoration-line-control underline-offset-4 hover:decoration-cobalt">
          All agreements
        </Link>
      </p>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-display">Agreement #{agreement.id.toString()}</h1>
        <span className="text-ink-2">{open ? "Open" : "Closed: every milestone is settled"}</span>
      </div>

      <section aria-labelledby="parties" className="mt-8">
        <h2 id="parties" className="sr-only">Parties</h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          <li><Address address={agreement.client} role="Client" /></li>
          <li><Address address={agreement.provider} role="Provider" /></li>
          <li><Address address={agreement.verifier} role="Verifier" /></li>
        </ul>
        <p className="mt-3 measure text-sm text-ink-3">
          The verifier is a trusted party: its approval or revision request is final on-chain, and Settlane cannot
          check the work itself. Review period {agreement.reviewPeriod.toString()} s after each delivery deadline.
        </p>
      </section>

      <div className="mt-10">
        <Accounting a={agreement} />
      </div>

      <section aria-labelledby="milestones" className="mt-10">
        <h2 id="milestones" className="text-title">Milestones</h2>
        <p className="mt-1 text-sm text-ink-3">States judged at block time {formatUtc(now)}.</p>
        <ol className="divide-y divide-line">
          {agreement.milestones.map((m) => (
            <MilestoneBlock key={m.index} m={m} now={now} />
          ))}
        </ol>
      </section>
    </Container>
  );
}

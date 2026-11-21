"use client";

import Link from "next/link";
import { useAgreementData, useActivity } from "@/chain/queries";
import { rolesOf, isOpen } from "@/domain/app-model";
import { formatUtc } from "@/domain/format";
import { buildLaneChart } from "@/domain/lane";
import { buildLedger } from "@/domain/ledger";
import { ActivityList } from "../ActivityList";
import { Address } from "../Address";
import { Avatar } from "../Avatar";
import { LedgerStrip } from "../LedgerStrip";
import { MilestoneDetail } from "../MilestoneDetail";
import { MilestoneActions } from "./MilestoneActions";
import { SettlementLane } from "../SettlementLane";
import { EmptyState, ErrorState, LoadingRows, RoleChip, useAppData } from "./parts";
import { ButtonLink } from "../Button";
import { useWallet } from "@/chain/use-wallet";

function Card({ children, title, id, lead }: { children: React.ReactNode; title: string; id: string; lead?: string }) {
  return (
    <section aria-labelledby={id} className="card mt-6 p-6 sm:p-8">
      <h2 id={id} className="text-title">{title}</h2>
      {lead && <p className="mb-6 mt-1 text-sm text-ink-3">{lead}</p>}
      {children}
    </section>
  );
}

export function AgreementWorkspace({ id }: { id: bigint }) {
  const { address } = useWallet();
  const q = useAgreementData(id);
  const activity = useActivity();
  useAppData();
  if (q.isPending || q.isError || q.data.agreement === null) {
    return (
      <>
        <h1 className="text-page">Agreement #{id.toString()}</h1>
        <div className="mt-8">
          {q.isPending ? (
            <LoadingRows rows={3} />
          ) : q.isError ? (
            <ErrorState retry={() => void q.refetch()} />
          ) : (
            <EmptyState title={`There is no agreement #${id}`} action={<ButtonLink href="/app/agreements" size="sm">Back to My Agreements</ButtonLink>}>
              Agreement numbers start at 1 and increase by one with every agreement created.
            </EmptyState>
          )}
        </div>
      </>
    );
  }
  const { agreement, blockTime: now } = q.data;
  const history = (activity.data ?? []).filter((a) => a.id === id);
  const created = history.find((a) => a.kind === "created");
  const earliest = agreement.milestones.reduce((x, m) => (m.deliverBy < x ? m.deliverBy : x), agreement.milestones[0]!.deliverBy);
  const chart = buildLaneChart(agreement.milestones, history, created?.timestamp ?? earliest - agreement.reviewPeriod, now);
  const roles = rolesOf(agreement, address);
  const open = isOpen(agreement, now);
  return (
    <>
      <p className="text-sm">
        <Link href="/app/agreements" className="draw-link text-ink-2 hover:text-ink">My Agreements</Link>
      </p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <h1 className="text-page">Agreement #{id.toString()}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1 text-sm font-semibold">
              <span aria-hidden className={`size-2 rounded-full ${open ? "bg-cobalt" : "bg-paid"}`} />
              {open ? "Open" : "Closed: every milestone is settled"}
            </span>
            {roles[0] && <RoleChip role={roles[0]} />}
          </div>
        </div>
        <Link href={`/agreements/${id}`} className="draw-link text-sm text-ink-2 hover:text-ink">Public page</Link>
      </div>

      <ul className="card mt-8 grid divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {([["Client", agreement.client], ["Provider", agreement.provider], ["Verifier", agreement.verifier]] as const).map(([role, a]) => (
          <li key={role} className="flex items-center gap-3.5 p-5">
            <Avatar address={a} size={44} />
            <Address address={a} role={role} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink-3">The verifier is a trusted party: its decision is final on-chain, and Settlane cannot check the work itself.</p>

      <div className="mt-6"><LedgerStrip ledger={buildLedger(agreement)} /></div>

      <Card title="Milestones" id="milestones">
        <ol className="mt-2 divide-y divide-line">
          {agreement.milestones.map((m) => {
            return (
              <MilestoneDetail
                key={m.index}
                m={m}
                now={now}
                actions={<MilestoneActions a={agreement} m={m} now={now} />}
              />
            );
          })}
        </ol>
      </Card>

      <section className="card mt-6 p-6 sm:p-8">
        <SettlementLane chart={chart} creationKnown={created !== undefined} />
        <p className="mt-3 text-sm text-ink-3">States and windows are judged at Sepolia block time {formatUtc(now)}.</p>
      </section>

      <Card title="History" id="history" lead="Decoded from the contract's events on Sepolia, in chain order.">
        {activity.isPending ? <p role="status" className="text-ink-2">Reading events from Sepolia…</p> : <ActivityList items={history} />}
      </Card>
    </>
  );
}

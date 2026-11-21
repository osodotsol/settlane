"use client";

import Link from "next/link";
import { ACTION_LABEL, milestonesAs, type MilestoneEntry, type Role } from "@/domain/app-model";
import { formatRelative } from "@/domain/format";
import { Amount } from "../Amount";
import { StateChip } from "../StateChip";
import { EmptyState, Loaded, PageHeader, Section, WalletGate, useAppData } from "./parts";

function Entry({ e, now, role }: { e: MilestoneEntry; now: bigint; role: Role }) {
  const due = e.state === "funded" || e.state === "submitted" ? (e.state === "funded" ? e.m.deliverBy : e.m.decideBy) : null;
  return (
    <li>
      <Link
        href={`/app/agreements/${e.a.id}#milestone-${e.m.index + 1}`}
        className="card card-hover group flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4 sm:px-5"
      >
        <div className="min-w-0">
          <p className="text-heading">Agreement #{e.a.id.toString()} · milestone {e.m.index + 1}</p>
          <p className="mt-1 text-sm text-ink-2">
            {e.actions.length > 0 ? <span className="font-semibold text-ink">{e.actions.map((a) => ACTION_LABEL[a]).join(" or ")}</span> : role === "provider" ? "Waiting on the verifier or the client" : "Waiting on the provider or the client"}
            {due !== null && e.actions.length > 0 && <> · due {formatRelative(due, now)}</>}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Amount wei={e.m.amount} className="text-[0.9375rem]" />
          <StateChip state={e.state} />
        </div>
      </Link>
    </li>
  );
}

/** My Work (role "provider") and Verifications (role "verifier"): the same milestones, grouped by who must move next. */
export function QueueView({ role }: { role: "provider" | "verifier" }) {
  const { wallet, mine, now } = useAppData();
  const g = milestonesAs(mine, wallet.address, role, now);
  const copy =
    role === "provider"
      ? { title: "My Work", lead: "Milestones you deliver as the provider: submit evidence before the delivery deadline, then claim what the verifier approves.", todo: "Ready for you", none: "Nothing to deliver or claim", noneText: "You are not the provider on any agreement yet. When a client names this account as provider, its milestones appear here." }
      : { title: "Verifications", lead: "Submissions where you are the verifier. Approve exactly the evidence you reviewed, or ask for a revision, before the review deadline.", todo: "Waiting for your decision", none: "No submissions to review", noneText: "You are not the verifier on any agreement yet. When a client names this account as verifier, submissions appear here." };
  const total = g.todo.length + g.waiting.length + g.done.length;
  return (
    <>
      <PageHeader title={copy.title} lead={copy.lead} />
      <div className="mt-8">
        <WalletGate title={`Connect a wallet to see your ${role === "provider" ? "work" : "verifications"}`}>
          <Loaded rows={3}>
            {total === 0 ? (
              <EmptyState title={copy.none}>{copy.noneText}</EmptyState>
            ) : (
              <>
                <Section title={copy.todo} id="todo" aside={<span className="text-sm text-ink-3">{g.todo.length}</span>}>
                  {g.todo.length === 0 ? <p className="text-ink-2">Nothing is waiting on you right now.</p> : <ul className="space-y-3">{g.todo.map((e) => <Entry key={`${e.a.id}:${e.m.index}`} e={e} now={now} role={role} />)}</ul>}
                </Section>
                {g.waiting.length > 0 && (
                  <Section title="Waiting on others" id="waiting" aside={<span className="text-sm text-ink-3">{g.waiting.length}</span>}>
                    <ul className="space-y-3">{g.waiting.map((e) => <Entry key={`${e.a.id}:${e.m.index}`} e={e} now={now} role={role} />)}</ul>
                  </Section>
                )}
                {g.done.length > 0 && (
                  <Section title="Finished" id="done" aside={<span className="text-sm text-ink-3">{g.done.length}</span>}>
                    <ul className="space-y-3">{g.done.map((e) => <Entry key={`${e.a.id}:${e.m.index}`} e={e} now={now} role={role} />)}</ul>
                  </Section>
                )}
              </>
            )}
          </Loaded>
        </WalletGate>
      </div>
    </>
  );
}

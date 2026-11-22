"use client";

import Link from "next/link";
import { milestoneStatusLine, milestonesAs, type MilestoneEntry, type Role } from "@/domain/app-model";
import { formatRelative } from "@/domain/format";
import { displayState } from "@/domain/lifecycle";
import { Amount } from "../Amount";
import { StateChip } from "../StateChip";
import { ConnectPrompt, EmptyState, Loaded, PageHeader, RoleExample, ScopeTag, Section, useAppData } from "./parts";

function Entry({ e, now, role, publicView = false }: { e: MilestoneEntry; now: bigint; role: Role; publicView?: boolean }) {
  // Deadlines matter only while the milestone is still open; finished and expired milestones show none.
  const due = e.state === "funded" ? e.m.deliverBy : e.state === "submitted" ? e.m.decideBy : null;
  const line = milestoneStatusLine(e.state, role, publicView ? [] : e.actions);
  return (
    <li>
      <Link href={`/app/agreements/${e.a.id}#milestone-${e.m.index + 1}`} className="card card-hover group flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-heading">Agreement #{e.a.id.toString()} · milestone {e.m.index + 1}</p>
          <p className="mt-1 text-sm text-ink-2">
            <span className={line.act ? "font-semibold text-ink" : undefined}>{line.text}</span>
            {due !== null && <> · closes {formatRelative(due, now)}</>}
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

const COPY = {
  provider: {
    title: "My Work",
    lead: "Milestones you deliver as the provider: submit evidence before the delivery deadline, then claim what the verifier approves.",
    todo: "Ready for you",
    none: "Nothing to deliver or claim",
    noneText: "You are not the provider on any agreement yet. When a client names this account as provider, its milestones appear here.",
    prompt: "Connect a wallet to see the milestones you deliver as provider and the payouts you can claim.",
    publicTitle: "Milestones waiting for evidence on the network",
    publicNone: "No milestone on the network is waiting for evidence right now.",
  },
  verifier: {
    title: "Verifications",
    lead: "Submissions where you are the verifier. Approve exactly the evidence you reviewed, or ask for a revision, before the review deadline.",
    todo: "Waiting for your decision",
    none: "No submissions to review",
    noneText: "You are not the verifier on any agreement yet. When a client names this account as verifier, submissions appear here.",
    prompt: "Connect a wallet to see the submissions waiting for your decision as verifier.",
    publicTitle: "Submissions waiting for a decision on the network",
    publicNone: "No submission on the network is waiting for a decision right now.",
  },
} as const;

/** My Work (role "provider") and Verifications (role "verifier"): the same milestones, grouped by who must move next. */
export function QueueView({ role }: { role: "provider" | "verifier" }) {
  const { wallet, all, mine, now } = useAppData();
  const copy = COPY[role];
  const address = wallet.address;

  if (!address) {
    // Public, real data: open milestones at the stage this role acts on, across every agreement.
    const stage = role === "provider" ? "funded" : "submitted";
    const open: MilestoneEntry[] = all.flatMap((a) =>
      a.milestones.filter((m) => displayState(m.state, now, m.deliverBy, m.decideBy) === stage).map((m) => ({ a, m, state: stage, actions: [] })),
    );
    return (
      <>
        <PageHeader title={copy.title} lead={copy.lead} />
        <div className="mt-6 space-y-6">
          <ConnectPrompt>{copy.prompt}</ConnectPrompt>
          <RoleExample role={role} />
        </div>
        <Section title={copy.publicTitle} id="public" aside={<ScopeTag kind="public" />}>
          <Loaded rows={2}>
            {open.length === 0 ? <p className="text-sm text-ink-2">{copy.publicNone}</p> : <ul className="space-y-2.5">{open.map((e) => <Entry key={`${e.a.id}:${e.m.index}`} e={e} now={now} role={role} publicView />)}</ul>}
          </Loaded>
        </Section>
      </>
    );
  }

  const g = milestonesAs(mine, address, role, now);
  const total = g.todo.length + g.waiting.length + g.done.length;
  return (
    <>
      <PageHeader title={copy.title} lead={copy.lead} />
      <div className="mt-6">
        <ConnectPrompt>{copy.prompt}</ConnectPrompt>
      </div>
      <Loaded rows={3}>
        {total === 0 ? (
          <div className="mt-6 space-y-6">
            <EmptyState title={copy.none}>{copy.noneText}</EmptyState>
            <RoleExample role={role} />
          </div>
        ) : (
          <>
            <Section title={copy.todo} id="todo" aside={<span className="text-sm text-ink-3">{g.todo.length}</span>}>
              {g.todo.length === 0 ? <p className="text-sm text-ink-2">Nothing is waiting on you right now.</p> : <ul className="space-y-2.5">{g.todo.map((e) => <Entry key={`${e.a.id}:${e.m.index}`} e={e} now={now} role={role} />)}</ul>}
            </Section>
            {g.waiting.length > 0 && (
              <Section title="Waiting on others" id="waiting" aside={<span className="text-sm text-ink-3">{g.waiting.length}</span>}>
                <ul className="space-y-2.5">{g.waiting.map((e) => <Entry key={`${e.a.id}:${e.m.index}`} e={e} now={now} role={role} />)}</ul>
              </Section>
            )}
            {g.done.length > 0 && (
              <Section title="Finished" id="done" aside={<span className="text-sm text-ink-3">{g.done.length}</span>}>
                <ul className="space-y-2.5">{g.done.map((e) => <Entry key={`${e.a.id}:${e.m.index}`} e={e} now={now} role={role} />)}</ul>
              </Section>
            )}
          </>
        )}
      </Loaded>
    </>
  );
}

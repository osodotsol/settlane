"use client";

import Link from "next/link";
import { useHistory } from "@/chain/queries";
import { attentionFor, totalsOf } from "@/domain/app-model";
import { shortHex } from "@/domain/format";
import { ActivityList } from "../ActivityList";
import { HistoryNotice } from "../HistoryNotice";
import { Amount } from "../Amount";
import { ButtonLink } from "../Button";
import { AgreementRow, AttentionRow, ConnectPrompt, EmptyState, Loaded, PageHeader, ScopeTag, Section, StatTile, useAppData } from "./parts";

function FundsBar({ paid, refunded, outstanding }: { paid: bigint; refunded: bigint; outstanding: bigint }) {
  const total = paid + refunded + outstanding;
  if (total === 0n) return null;
  const parts = [
    { wei: paid, fill: "bg-paid", label: "Paid" },
    { wei: refunded, fill: "bg-refunded", label: "Refunded" },
    { wei: outstanding, fill: "border border-funded bg-funded-tint", label: "Held" },
  ].filter((p) => p.wei > 0n);
  return (
    <div aria-hidden className="mt-4 flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-sunken">
      {parts.map((p) => (
        <div key={p.label} className={`h-full min-w-[6px] ${p.fill}`} style={{ flexGrow: Number((p.wei * 10_000n) / total), flexBasis: 0 }} />
      ))}
    </div>
  );
}

export function DashboardView() {
  const { wallet, all, mine, now } = useAppData();
  const activity = useHistory();
  const address = wallet.address;
  const scope = address ? mine : all;
  const totals = totalsOf(scope, now);
  const queue = attentionFor(mine, address, now);
  const ids = new Set(scope.map((a) => a.id));
  const events = (activity.data?.events ?? []).filter((e) => ids.has(e.id)).slice(-6).reverse();
  const tag = <ScopeTag kind={address ? "yours" : "public"} />;

  return (
    <>
      <PageHeader
        title={address ? "Dashboard" : "Network overview"}
        lead={
          address ? (
            <>Your agreements, the actions waiting for you and where your funds are, for <span className="text-data text-[0.875rem]">{shortHex(address)}</span>.</>
          ) : (
            "Live totals and activity for every agreement on the Sepolia deployment."
          )
        }
        action={<ButtonLink href="/app/create" size="sm">New agreement</ButtonLink>}
      />
      <div className="mt-6">
        <ConnectPrompt>Connect a wallet to turn this into your dashboard: your agreements, what is waiting for you, and your payouts.</ConnectPrompt>
      </div>

      <Section title="Funds" id="funds" aside={tag}>
        <Loaded rows={1}>
          <div className="reveal-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div style={{ "--i": 0 } as React.CSSProperties}><StatTile label="Deposited" value={<Amount wei={totals.deposited} variant="numeral" />} note={`${totals.agreements} agreement${totals.agreements === 1 ? "" : "s"}, ${totals.open} open`} /></div>
            <div style={{ "--i": 1 } as React.CSSProperties}><StatTile tone="paid" label="Claimed by providers" value={<Amount wei={totals.paid} variant="numeral" />} note="After approval, to the address each provider chose" /></div>
            <div style={{ "--i": 2 } as React.CSSProperties}><StatTile tone="refunded" label="Refunded by clients" value={<Amount wei={totals.refunded} variant="numeral" />} note="After a deadline, to the address each client chose" /></div>
            <div style={{ "--i": 3 } as React.CSSProperties}><StatTile tone="funded" label="Held by the contract" value={<Amount wei={totals.outstanding} variant="numeral" />} note="Not yet claimed or refunded" /></div>
          </div>
          <FundsBar paid={totals.paid} refunded={totals.refunded} outstanding={totals.outstanding} />
          <p className="mt-2.5 text-micro text-ink-3">Deposited equals paid plus refunded plus held, for every agreement.</p>
        </Loaded>
      </Section>

      {address && (
        <Section title="Needs your action" id="actions" aside={<ScopeTag kind="yours" />}>
          <Loaded rows={2}>
            {queue.length === 0 ? (
              <EmptyState title="Nothing needs you right now">
                {mine.length === 0
                  ? "This account is not a party to any agreement yet. Create one, or ask a client to name you as provider or verifier."
                  : "Every milestone is waiting on someone else, or is settled. New work appears here the moment it needs you."}
              </EmptyState>
            ) : (
              <ul className="space-y-2.5">
                {queue.slice(0, 6).map((item) => <AttentionRow key={item.key} item={item} now={now} />)}
              </ul>
            )}
          </Loaded>
        </Section>
      )}

      <div className="mt-9 grid gap-9 lg:grid-cols-2">
        <section aria-labelledby="mine" className="min-w-0">
          <div className="mb-3.5 flex items-center justify-between gap-4">
            <h2 id="mine" className="text-heading">{address ? "Your agreements" : "Latest agreements"}</h2>
            <Link href={address ? "/app/agreements" : "/explorer"} className="draw-link text-sm text-ink-2 hover:text-ink">{address ? "See all" : "Open the explorer"}</Link>
          </div>
          <Loaded rows={3}>
            {scope.length === 0 ? (
              <EmptyState title="No agreements yet" action={<ButtonLink href="/app/create" size="sm">Create the first one</ButtonLink>}>
                {address ? "Agreements you create, deliver or verify will be listed here." : "Nothing has been created on this deployment yet."}
              </EmptyState>
            ) : (
              <ul className="space-y-2.5">
                {scope.slice(0, 5).map((a) => <AgreementRow key={a.id.toString()} a={a} who={address} now={now} />)}
              </ul>
            )}
          </Loaded>
        </section>
        <section aria-labelledby="recent" className="min-w-0">
          <div className="mb-3.5 flex items-center justify-between gap-4">
            <h2 id="recent" className="text-heading">{address ? "Your recent activity" : "Recent network activity"}</h2>
            <Link href="/app/activity" className="draw-link text-sm text-ink-2 hover:text-ink">See all</Link>
          </div>
          <div className="card p-5 sm:p-6">
            {activity.isPending ? (
              <p role="status" className="text-ink-2">Reading events from Sepolia…</p>
            ) : activity.isError ? (
              <p role="alert" className="text-ink-2">The event history could not be read right now.</p>
            ) : (
              <>
                <HistoryNotice status={activity.data?.status} className="mb-4" />
                <ActivityList items={events} showAgreement empty="No events yet." />
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

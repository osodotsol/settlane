"use client";

import { ExternalLink } from "lucide-react";
import { useHistory } from "@/chain/queries";
import { txUrl } from "@/config/chain";
import type { Activity } from "@/contract/events";
import { payableTo, payoutsFor, rolesOf, totalsOf, type Role } from "@/domain/app-model";
import { formatUtc, shortHex } from "@/domain/format";
import { aggregateCoverage, describeHistory } from "@/domain/history-coverage";
import { Amount } from "../Amount";
import { HistoryNotice } from "../HistoryNotice";
import { AttentionRow, ConnectPrompt, EmptyState, Loaded, PageHeader, ScopeTag, Section, StatTile, useAppData } from "./parts";

type Payout = Activity & { role?: Role };

function PayoutList({ items, showRole }: { items: Payout[]; showRole: boolean }) {
  return (
    <div className="card divide-y divide-line">
      {items.map((p) => (
        <a key={`${p.txHash}:${p.logIndex}`} href={txUrl(p.txHash)} target="_blank" rel="noreferrer" className="group flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-3.5 hover:bg-sunken/60">
          <div className="min-w-0">
            <p className="font-semibold">
              {p.kind === "claimed" ? (showRole ? "Claimed" : "Claimed by the provider") : showRole ? "Refunded" : "Refunded by the client"} · agreement #{p.id.toString()}, milestone {(p.m ?? 0) + 1}
            </p>
            <p className="text-sm text-ink-3">{formatUtc(p.timestamp)} · sent to <span className="text-data text-[0.8125rem]">{shortHex(p.to ?? "")}</span></p>
          </div>
          <span className="flex items-center gap-2">
            <Amount wei={p.amount ?? 0n} />
            <ExternalLink aria-hidden size={15} className="text-ink-3 group-hover:text-ink" />
            <span className="sr-only">(transaction on Sepolia Etherscan, opens in a new tab)</span>
          </span>
        </a>
      ))}
    </div>
  );
}

export function PaymentsView() {
  const { wallet, all, mine, now } = useAppData();
  const activity = useHistory();
  const address = wallet.address;
  const lead = "Money you can take out, and money already paid out. Settlane only ever sends ETH on a provider's claim or a client's refund.";

  if (!address) {
    const t = totalsOf(all, now);
    const payouts = (activity.data?.events ?? []).filter((e) => e.kind === "claimed" || e.kind === "refunded").slice().reverse();
    return (
      <>
        <PageHeader title="Payments" lead={lead} />
        <div className="mt-6">
          <ConnectPrompt>Connect a wallet to see what you can claim or refund now, and your own payout history.</ConnectPrompt>
        </div>
        <Section title="Payouts on the network" id="network" aside={<ScopeTag kind="public" />}>
          <Loaded rows={2}>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <StatTile tone="paid" label="Claimed by providers" value={<Amount wei={t.paid} variant="numeral" />} />
              <StatTile tone="refunded" label="Refunded by clients" value={<Amount wei={t.refunded} variant="numeral" />} />
              <StatTile tone="funded" label="Still held" value={<Amount wei={t.outstanding} variant="numeral" />} />
            </div>
            {activity.isPending ? (
              <p role="status" className="text-ink-2">Reading events from Sepolia…</p>
            ) : (
              <>
                <HistoryNotice status={activity.data?.status} coverage={aggregateCoverage(all, activity.data?.events ?? [])} className="mb-4" />
                {payouts.length > 0 ? <PayoutList items={payouts} showRole={false} /> : describeHistory(activity.data?.status, aggregateCoverage(all, activity.data?.events ?? [])).level === "complete" ? <p className="text-sm text-ink-2">No claim or refund has happened yet.</p> : null}
              </>
            )}
          </Loaded>
        </Section>
      </>
    );
  }

  const pay = payableTo(mine, address, now);
  const payouts = payoutsFor(activity.data?.events ?? [], mine, address);
  const asProvider = mine.filter((a) => rolesOf(a, address).includes("provider"));
  const asClient = mine.filter((a) => rolesOf(a, address).includes("client"));
  const sum = (xs: typeof mine, f: "paid" | "refunded") => xs.reduce((s, a) => s + a[f], 0n);
  return (
    <>
      <PageHeader title="Payments" lead={lead} />
      <div className="mt-6">
        <ConnectPrompt>Switch to Sepolia to claim or refund.</ConnectPrompt>
      </div>
      <Loaded rows={3}>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile tone="paid" label="Ready to claim" value={<Amount wei={pay.claimableTotal} variant="numeral" />} note="Approved, as provider" />
          <StatTile tone="refunded" label="Ready to refund" value={<Amount wei={pay.refundableTotal} variant="numeral" />} note="Expired, as client" />
          <StatTile tone="paid" label="Claimed as provider" value={<Amount wei={sum(asProvider, "paid")} variant="numeral" />} note="Sent to the address chosen at each claim" />
          <StatTile tone="refunded" label="Refunded as client" value={<Amount wei={sum(asClient, "refunded")} variant="numeral" />} note="Sent to the address chosen at each refund" />
        </div>
        <Section title="Waiting to be taken out" id="payable" aside={<ScopeTag kind="yours" />}>
          {pay.claimable.length + pay.refundable.length === 0 ? (
            <EmptyState title="Nothing to claim or refund">An approved milestone can be claimed by its provider at any time. An expired one can be refunded by its client.</EmptyState>
          ) : (
            <ul className="space-y-2.5">{[...pay.claimable, ...pay.refundable].map((i) => <AttentionRow key={i.key} item={i} now={now} />)}</ul>
          )}
        </Section>
        <Section title="Your payout history" id="history" aside={<ScopeTag kind="yours" />}>
          {activity.isPending ? (
            <p role="status" className="text-ink-2">Reading events from Sepolia…</p>
          ) : (
            <>
              <HistoryNotice status={activity.data?.status} coverage={aggregateCoverage(mine, activity.data?.events ?? [])} className="mb-4" />
              {payouts.length > 0 ? (
                <PayoutList items={payouts} showRole />
              ) : describeHistory(activity.data?.status, aggregateCoverage(mine, activity.data?.events ?? [])).level === "complete" ? (
                <EmptyState title="No payouts yet">Claims and refunds in your agreements are listed here with their transactions.</EmptyState>
              ) : null}
            </>
          )}
        </Section>
      </Loaded>
    </>
  );
}

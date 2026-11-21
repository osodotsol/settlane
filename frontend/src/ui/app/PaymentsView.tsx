"use client";

import { ExternalLink } from "lucide-react";
import { useActivity } from "@/chain/queries";
import { txUrl } from "@/config/chain";
import { payableTo, payoutsFor, rolesOf } from "@/domain/app-model";
import { formatUtc, shortHex } from "@/domain/format";
import { Amount } from "../Amount";
import { AttentionRow, EmptyState, Loaded, PageHeader, Section, StatTile, WalletGate, useAppData } from "./parts";

export function PaymentsView() {
  const { wallet, mine, now } = useAppData();
  const activity = useActivity();
  const pay = payableTo(mine, wallet.address, now);
  const payouts = payoutsFor(activity.data ?? [], mine, wallet.address);
  const asProvider = mine.filter((a) => rolesOf(a, wallet.address).includes("provider"));
  const asClient = mine.filter((a) => rolesOf(a, wallet.address).includes("client"));
  const sum = (xs: typeof mine, f: "paid" | "refunded" | "outstanding") => xs.reduce((s, a) => s + a[f], 0n);
  return (
    <>
      <PageHeader title="Payments" lead="Money you can take out, and money already paid out. Settlane only ever sends ETH on a provider's claim or a client's refund." />
      <div className="mt-8">
        <WalletGate title="Connect a wallet to see your payments">
          <Loaded rows={3}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile tone="paid" label="Ready to claim" value={<Amount wei={pay.claimableTotal} variant="numeral" />} note="Approved, as provider" />
              <StatTile tone="refunded" label="Ready to refund" value={<Amount wei={pay.refundableTotal} variant="numeral" />} note="Expired, as client" />
              <StatTile tone="paid" label="Paid out to you" value={<Amount wei={sum(asProvider, "paid")} variant="numeral" />} note="Claimed, as provider" />
              <StatTile tone="refunded" label="Refunded to you" value={<Amount wei={sum(asClient, "refunded")} variant="numeral" />} note="Returned, as client" />
            </div>

            <Section title="Waiting to be taken out" id="payable">
              {pay.claimable.length + pay.refundable.length === 0 ? (
                <EmptyState title="Nothing to claim or refund">An approved milestone can be claimed by its provider at any time. An expired one can be refunded by its client.</EmptyState>
              ) : (
                <ul className="space-y-3">{[...pay.claimable, ...pay.refundable].map((i) => <AttentionRow key={i.key} item={i} now={now} />)}</ul>
              )}
            </Section>

            <Section title="Payout history" id="history">
              {activity.isPending ? (
                <p role="status" className="text-ink-2">Reading events from Sepolia…</p>
              ) : payouts.length === 0 ? (
                <EmptyState title="No payouts yet">Claims and refunds in your agreements are listed here with their transactions.</EmptyState>
              ) : (
                <div className="card divide-y divide-line">
                  {payouts.map((p) => (
                    <a key={`${p.txHash}:${p.logIndex}`} href={txUrl(p.txHash)} target="_blank" rel="noreferrer" className="group flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-4 hover:bg-sunken/60">
                      <div className="min-w-0">
                        <p className="font-semibold">{p.role === "provider" ? "Claimed" : "Refunded"} · agreement #{p.id.toString()}, milestone {(p.m ?? 0) + 1}</p>
                        <p className="text-sm text-ink-3">{formatUtc(p.timestamp)} · sent to <span className="text-data text-[0.8125rem]">{shortHex(p.to ?? "")}</span></p>
                      </div>
                      <span className="flex items-center gap-2"><Amount wei={p.amount ?? 0n} /><ExternalLink aria-hidden size={15} className="text-ink-3 group-hover:text-ink" /><span className="sr-only">(transaction on Sepolia Etherscan, opens in a new tab)</span></span>
                    </a>
                  ))}
                </div>
              )}
            </Section>
          </Loaded>
        </WalletGate>
      </div>
    </>
  );
}

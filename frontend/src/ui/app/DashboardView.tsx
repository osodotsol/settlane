"use client";

import Link from "next/link";
import { useActivity } from "@/chain/queries";
import { attentionFor, totalsOf } from "@/domain/app-model";
import { shortHex } from "@/domain/format";
import { ActivityList } from "../ActivityList";
import { Amount } from "../Amount";
import { ButtonLink } from "../Button";
import { AgreementRow, AttentionRow, EmptyState, Loaded, PageHeader, Section, StatTile, WalletGate, useAppData } from "./parts";

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
  const activity = useActivity();
  const address = wallet.address;
  const scope = address ? mine : all;
  const totals = totalsOf(scope, now);
  const queue = attentionFor(mine, address, now);
  const ids = new Set(scope.map((a) => a.id));
  const events = (activity.data ?? []).filter((e) => ids.has(e.id)).slice(-6).reverse();
  const scopeLabel = address ? "Your agreements" : "All agreements on Sepolia";

  return (
    <>
      <PageHeader
        title="Dashboard"
        lead={
          address ? (
            <>Signed in as <span className="text-data text-[0.9375rem]">{shortHex(address)}</span>. Everything below is read live from the Settlane contract on Sepolia.</>
          ) : (
            "You are browsing read-only. Everything here is read live from the Settlane contract on Sepolia. Connect a wallet to see your own agreements and act on them."
          )
        }
        action={<ButtonLink href="/app/create">New agreement</ButtonLink>}
      />

      <Section title="Funds" id="funds" aside={<p className="text-sm text-ink-3">{scopeLabel}</p>}>
        <Loaded rows={1}>
          <div className="reveal-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div style={{ "--i": 0 } as React.CSSProperties}><StatTile label="Deposited" value={<Amount wei={totals.deposited} variant="numeral" />} note={`${totals.agreements} agreement${totals.agreements === 1 ? "" : "s"}, ${totals.open} open`} /></div>
            <div style={{ "--i": 1 } as React.CSSProperties}><StatTile tone="paid" label="Paid to providers" value={<Amount wei={totals.paid} variant="numeral" />} note="Claimed after approval" /></div>
            <div style={{ "--i": 2 } as React.CSSProperties}><StatTile tone="refunded" label="Refunded to clients" value={<Amount wei={totals.refunded} variant="numeral" />} note="Returned after a deadline" /></div>
            <div style={{ "--i": 3 } as React.CSSProperties}><StatTile tone="funded" label="Held by the contract" value={<Amount wei={totals.outstanding} variant="numeral" />} note="Not yet claimed or refunded" /></div>
          </div>
          <FundsBar paid={totals.paid} refunded={totals.refunded} outstanding={totals.outstanding} />
          <p className="mt-3 text-sm text-ink-3">Deposited equals paid plus refunded plus held, for every agreement.</p>
        </Loaded>
      </Section>

      <Section title="Needs your action" id="actions">
        <WalletGate title="Connect a wallet to see what is waiting for you">
          <Loaded rows={2}>
            {queue.length === 0 ? (
              <EmptyState title="Nothing needs you right now">
                {mine.length === 0
                  ? "This account is not a party to any agreement yet. Create one, or ask a client to name you as provider or verifier."
                  : "Every milestone is waiting on someone else, or is settled. New work appears here the moment it needs you."}
              </EmptyState>
            ) : (
              <ul className="space-y-3">
                {queue.slice(0, 6).map((item) => <AttentionRow key={item.key} item={item} now={now} />)}
              </ul>
            )}
          </Loaded>
        </WalletGate>
      </Section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="mine" className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 id="mine" className="text-title">{address ? "Your agreements" : "Latest agreements"}</h2>
            <Link href={address ? "/app/agreements" : "/explorer"} className="draw-link text-sm text-ink-2 hover:text-ink">{address ? "See all" : "Open the explorer"}</Link>
          </div>
          <Loaded rows={3}>
            {scope.length === 0 ? (
              <EmptyState title="No agreements yet" action={<ButtonLink href="/app/create" size="sm">Create the first one</ButtonLink>}>
                {address ? "Agreements you create, deliver or verify will be listed here." : "Nothing has been created on this deployment yet."}
              </EmptyState>
            ) : (
              <ul className="space-y-3">
                {scope.slice(0, 5).map((a) => <AgreementRow key={a.id.toString()} a={a} who={address} now={now} />)}
              </ul>
            )}
          </Loaded>
        </section>
        <section aria-labelledby="recent" className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 id="recent" className="text-title">Recent activity</h2>
            <Link href="/app/activity" className="draw-link text-sm text-ink-2 hover:text-ink">See all</Link>
          </div>
          <div className="card p-6">
            {activity.isPending ? (
              <p role="status" className="text-ink-2">Reading events from Sepolia…</p>
            ) : activity.isError ? (
              <p role="alert" className="text-ink-2">The event history could not be read right now.</p>
            ) : (
              <ActivityList items={events} showAgreement empty="No events yet." />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { useHistory } from "@/chain/queries";
import type { ActivityKind } from "@/contract/events";
import { ActivityList } from "../ActivityList";
import { HistoryNotice } from "../HistoryNotice";
import { ConnectPrompt, ErrorState, LoadingRows, PageHeader, ScopeTag, useAppData } from "./parts";

const KINDS: [ActivityKind | "all", string][] = [
  ["all", "Everything"],
  ["created", "Created"],
  ["submitted", "Submitted"],
  ["approved", "Approved"],
  ["rejected", "Revisions"],
  ["claimed", "Claimed"],
  ["refunded", "Refunded"],
];

export function ActivityView() {
  const { wallet, mine } = useAppData();
  const q = useHistory();
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [kind, setKind] = useState<ActivityKind | "all">("all");
  const mineIds = new Set(mine.map((a) => a.id));
  const items = (q.data?.events ?? []).filter((e) => (scope === "all" || mineIds.has(e.id)) && (kind === "all" || e.kind === kind)).slice().reverse();
  const pill = (active: boolean) => `press h-9 rounded-full border px-4 text-sm font-medium ${active ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-line-control hover:text-ink"}`;
  return (
    <>
      <PageHeader title="Activity" lead="Every event the contract has emitted, newest first, decoded from Sepolia. Each entry links to its transaction." />
      <div className="mt-6">
        <ConnectPrompt>Connect a wallet to filter this history to the agreements you are part of.</ConnectPrompt>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div role="group" aria-label="Whose activity" className="flex gap-2">
          <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")} className={pill(scope === "all")}>All agreements</button>
          <button type="button" aria-pressed={scope === "mine"} onClick={() => setScope("mine")} disabled={!wallet.address} title={wallet.address ? undefined : "Connect a wallet to filter to your agreements"} className={`${pill(scope === "mine")} disabled:opacity-50`}>Mine</button>
        </div>
        <div role="group" aria-label="Kind of event" className="flex flex-wrap gap-2">
          {KINDS.map(([id, label]) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)} className={pill(kind === id)}>{label}</button>)}
        </div>
      </div>
      <div className="mt-5 flex flex-col-reverse items-start gap-3 sm:flex-row sm:justify-between"><div className="min-w-0 sm:flex-1"><HistoryNotice status={q.data?.status} /></div><ScopeTag kind={scope === "mine" ? "yours" : "public"} /></div>
      <div className="card mt-3 p-5 sm:p-7">
        {q.isPending ? <LoadingRows rows={4} /> : q.isError && !q.data ? <ErrorState retry={() => void q.refetch()} /> : <ActivityList items={items} showAgreement empty={scope === "mine" ? "No events in your agreements yet." : "No events match."} />}
      </div>
    </>
  );
}

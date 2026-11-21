"use client";

import { useState } from "react";
import { isOpen, rolesOf, type Role } from "@/domain/app-model";
import { ButtonLink } from "../Button";
import { AgreementRow, EmptyState, Loaded, PageHeader, WalletGate, useAppData } from "./parts";

type Filter = "all" | "open" | "closed" | Role;
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["open", "Open"],
  ["closed", "Closed"],
  ["client", "As client"],
  ["provider", "As provider"],
  ["verifier", "As verifier"],
];

export function AgreementsView() {
  const { wallet, mine, now } = useAppData();
  const [filter, setFilter] = useState<Filter>("all");
  const shown = mine.filter((a) => (filter === "all" ? true : filter === "open" ? isOpen(a, now) : filter === "closed" ? !isOpen(a, now) : rolesOf(a, wallet.address).includes(filter)));
  return (
    <>
      <PageHeader title="My Agreements" lead="Every agreement where your account is the client, the provider or the verifier." action={<ButtonLink href="/app/create">New agreement</ButtonLink>} />
      <div className="mt-8">
        <WalletGate title="Connect a wallet to list your agreements">
          <Loaded rows={3}>
            <div role="group" aria-label="Filter agreements" className="mb-5 flex flex-wrap gap-2">
              {FILTERS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                  className={`press h-9 rounded-full border px-4 text-sm font-medium ${filter === id ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-line-control hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <EmptyState title={mine.length === 0 ? "This account has no agreements yet" : "Nothing matches this filter"} action={mine.length === 0 ? <ButtonLink href="/app/create" size="sm">Create an agreement</ButtonLink> : undefined}>
                {mine.length === 0 ? "An agreement appears here once this account creates one, or is named as its provider or verifier." : "Try another filter."}
              </EmptyState>
            ) : (
              <ul className="space-y-3">{shown.map((a) => <AgreementRow key={a.id.toString()} a={a} who={wallet.address} now={now} />)}</ul>
            )}
          </Loaded>
        </WalletGate>
      </div>
    </>
  );
}

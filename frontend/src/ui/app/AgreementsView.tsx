"use client";

import { useState } from "react";
import { isOpen, rolesOf, type Role } from "@/domain/app-model";
import { ButtonLink } from "../Button";
import { AgreementRow, ConnectPrompt, EmptyState, Loaded, PageHeader, ScopeTag, Section, useAppData } from "./parts";

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
  const { wallet, all, mine, now } = useAppData();
  const [filter, setFilter] = useState<Filter>("all");
  const address = wallet.address;
  const source = address ? mine : all;
  const filters = address ? FILTERS : FILTERS.slice(0, 3); // role filters only mean something for an account
  const shown = source.filter((a) => (filter === "all" ? true : filter === "open" ? isOpen(a, now) : filter === "closed" ? !isOpen(a, now) : rolesOf(a, address).includes(filter)));
  return (
    <>
      <PageHeader title="My Agreements" lead="Every agreement where your account is the client, the provider or the verifier." action={<ButtonLink href="/app/create" size="sm">New agreement</ButtonLink>} />
      <div className="mt-6">
        <ConnectPrompt>Connect a wallet to list only your agreements, filtered by your role. Below: every agreement on the network.</ConnectPrompt>
      </div>
      <Section title={address ? "Your agreements" : "All agreements on the network"} id="list" aside={<ScopeTag kind={address ? "yours" : "public"} />}>
        <Loaded rows={3}>
          <div role="group" aria-label="Filter agreements" className="mb-4 flex flex-wrap gap-2">
            {filters.map(([id, label]) => (
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
            <EmptyState
              title={source.length === 0 ? (address ? "This account has no agreements yet" : "No agreements on the network yet") : "Nothing matches this filter"}
              action={source.length === 0 ? <ButtonLink href="/app/create" size="sm">Create an agreement</ButtonLink> : undefined}
            >
              {source.length === 0 ? "An agreement appears here once this account creates one, or is named as its provider or verifier." : "Try another filter."}
            </EmptyState>
          ) : (
            <ul className="space-y-2.5">{shown.map((a) => <AgreementRow key={a.id.toString()} a={a} who={address} now={now} />)}</ul>
          )}
        </Loaded>
      </Section>
    </>
  );
}

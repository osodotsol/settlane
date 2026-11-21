"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { DisplayState } from "@/domain/lifecycle";
import { Address } from "./Address";
import { Avatar } from "./Avatar";
import { Amount } from "./Amount";
import { StateChip } from "./StateChip";

export type ExplorerRow = {
  id: string;
  states: DisplayState[];
  /** Milestone amounts (wei, as strings) in the same order as `states`, for the proportional mini bar. */
  amounts: string[];
  client: string;
  provider: string;
  verifier: string;
  deposited: string;
  outstanding: string;
  open: boolean;
  next: string;
  created: string | null;
};

type Filter = "all" | "open" | "closed";

const BAR: Record<DisplayState, string> = {
  none: "bg-line",
  funded: "border border-funded bg-funded-tint",
  submitted: "bg-submitted",
  approved: "bg-approved",
  paid: "bg-paid",
  refunded: "bg-refunded",
  expired: "bg-[repeating-linear-gradient(135deg,var(--state-refunded)_0_2px,var(--state-refunded-tint)_2px_5px)]",
};

/** A thin bar split by milestone amount and coloured by state: the agreement's progress at a glance. */
function MiniBar({ states, amounts }: { states: DisplayState[]; amounts: string[] }) {
  return (
    <div aria-hidden className="flex h-1.5 w-full max-w-[9rem] gap-0.5 overflow-hidden rounded-full bg-sunken">
      {states.map((st, i) => (
        <div key={i} className={`grow-x h-full min-w-[4px] ${BAR[st]}`} style={{ flexGrow: Number(BigInt(amounts[i] ?? "1") / 1_000_000_000n) || 1, flexBasis: 0 }} />
      ))}
    </div>
  );
}

// Server-rendered in full (works without JavaScript); filtering and search are a client enhancement.
export function ExplorerTable({ rows }: { rows: ExplorerRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const searchId = useId();
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return rows.filter(
      (r) =>
        (filter === "all" || (filter === "open") === r.open) &&
        // A number matches the agreement number only (every address contains digits); anything else
        // is matched against the three parties' addresses.
        (q === "" || (/^\d+$/.test(q) ? r.id === q : [r.client, r.provider, r.verifier].some((a) => a.toLowerCase().includes(q)))),
    );
  }, [rows, filter, query]);

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <fieldset className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          <legend className="sr-only">Show agreements</legend>
          {(["all", "open", "closed"] as const).map((f) => (
            <label key={f} className={`press cursor-pointer rounded-md px-4 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cobalt ${filter === f ? "bg-ink text-paper" : "text-ink-2 hover:bg-sunken hover:text-ink"}`}>
              <input type="radio" name="explorer-filter" value={f} checked={filter === f} onChange={() => setFilter(f)} className="sr-only" />
              {f === "all" ? "All" : f === "open" ? "Open" : "Closed"}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="text-sm text-ink-2">Agreement number or address</label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 2 or 0x4fa3…"
            className="h-11 w-full rounded-lg border border-line-control bg-surface px-3 text-sm placeholder:text-ink-3 sm:w-80"
          />
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">{`${visible.length} of ${rows.length} agreements shown`}</p>

      {visible.length === 0 ? (
        <p className="border-y border-line py-8 text-ink-2">No agreement matches. Clear the search or choose “All”.</p>
      ) : (
        <>
          <table className="hidden w-full text-left text-sm lg:table">
            <thead className="border-b border-line-control text-ink-3">
              <tr>
                <th scope="col" className="py-3 pl-3 pr-4 font-medium">Agreement</th>
                <th scope="col" className="py-3 pr-4 font-medium">Milestones</th>
                <th scope="col" className="py-3 pr-4 font-medium">Parties</th>
                <th scope="col" className="py-3 pr-4 font-medium">Next</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">Deposited</th>
                <th scope="col" className="py-3 pr-3 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((r) => (
                <tr key={r.id} className="group align-top transition-colors duration-[var(--dur-hover)] hover:bg-surface">
                  <th scope="row" className="py-4 pl-3 pr-4 font-medium">
                    <Link href={`/agreements/${r.id}`} className="inline-flex items-center gap-1.5 text-ink">
                      <span className="draw-link">#{r.id}</span>
                      <ArrowRight aria-hidden size={15} className="-translate-x-1 text-cobalt opacity-0 transition-[opacity,transform] duration-[var(--dur-hover)] ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100" />
                    </Link>
                    {r.created && <span className="mt-1 block text-micro font-normal text-ink-3">{r.created}</span>}
                  </th>
                  <td className="py-4 pr-4">
                    <ul className="flex flex-wrap gap-1.5" aria-label="Milestone states">
                      {r.states.map((s, i) => <li key={i}><StateChip state={s} /></li>)}
                    </ul>
                    <div className="mt-2.5"><MiniBar states={r.states} amounts={r.amounts} /></div>
                  </td>
                  <td className="py-4 pr-4">
                    <div className="flex flex-col gap-2">
                      <span className="flex items-center gap-2"><Avatar address={r.client} size={24} /><Address address={r.client} role="Client" /></span>
                      <span className="flex items-center gap-2"><Avatar address={r.provider} size={24} /><Address address={r.provider} role="Provider" /></span>
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-ink-2">{r.next}</td>
                  <td className="py-4 pr-4 text-right"><Amount wei={BigInt(r.deposited)} /></td>
                  <td className="py-4 pr-3 text-right"><Amount wei={BigInt(r.outstanding)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line border-y border-line lg:hidden">
            {visible.map((r) => (
              <li key={r.id} className="py-5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/agreements/${r.id}`} className="text-heading underline decoration-line-control underline-offset-4">
                    Agreement #{r.id}
                  </Link>
                  <span className="text-sm text-ink-3">{r.open ? "Open" : "Closed"}</span>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Milestone states">
                  {r.states.map((s, i) => <li key={i}><StateChip state={s} /></li>)}
                </ul>
                <div className="mt-3"><MiniBar states={r.states} amounts={r.amounts} /></div>
                <p className="mt-2 text-sm text-ink-2">{r.next}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-ink-3">Deposited</dt>
                  <dd className="text-right"><Amount wei={BigInt(r.deposited)} /></dd>
                  <dt className="text-ink-3">Outstanding</dt>
                  <dd className="text-right"><Amount wei={BigInt(r.outstanding)} /></dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

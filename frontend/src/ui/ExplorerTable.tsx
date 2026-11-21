"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { DisplayState } from "@/domain/lifecycle";
import { Address } from "./Address";
import { Amount } from "./Amount";
import { StateChip } from "./StateChip";

export type ExplorerRow = {
  id: string;
  states: DisplayState[];
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
            <label key={f} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ${filter === f ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}>
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
                <th scope="col" className="py-3 pr-4 font-medium">Agreement</th>
                <th scope="col" className="py-3 pr-4 font-medium">Milestones</th>
                <th scope="col" className="py-3 pr-4 font-medium">Parties</th>
                <th scope="col" className="py-3 pr-4 font-medium">Next</th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">Deposited</th>
                <th scope="col" className="py-3 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((r) => (
                <tr key={r.id} className="align-top">
                  <th scope="row" className="py-4 pr-4 font-medium">
                    <Link href={`/agreements/${r.id}`} className="text-ink underline decoration-line-control underline-offset-4 hover:decoration-cobalt">
                      #{r.id}
                    </Link>
                    {r.created && <span className="mt-1 block text-micro font-normal text-ink-3">{r.created}</span>}
                  </th>
                  <td className="py-4 pr-4">
                    <ul className="flex flex-wrap gap-1.5" aria-label="Milestone states">
                      {r.states.map((s, i) => <li key={i}><StateChip state={s} /></li>)}
                    </ul>
                  </td>
                  <td className="py-4 pr-4">
                    <div className="flex flex-col gap-1">
                      <Address address={r.client} role="Client" />
                      <Address address={r.provider} role="Provider" />
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-ink-2">{r.next}</td>
                  <td className="py-4 pr-4 text-right"><Amount wei={BigInt(r.deposited)} /></td>
                  <td className="py-4 text-right"><Amount wei={BigInt(r.outstanding)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line border-y border-line lg:hidden">
            {visible.map((r) => (
              <li key={r.id} className="py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/agreements/${r.id}`} className="text-heading underline decoration-line-control underline-offset-4">
                    Agreement #{r.id}
                  </Link>
                  <span className="text-sm text-ink-3">{r.open ? "Open" : "Closed"}</span>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Milestone states">
                  {r.states.map((s, i) => <li key={i}><StateChip state={s} /></li>)}
                </ul>
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

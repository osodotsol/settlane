"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DisplayState } from "@/domain/lifecycle";
import { StateChip } from "./StateChip";

// The "how a milestone settles" story. The steps are an ordinary list (complete with no JavaScript); with
// JavaScript, the step crossing the middle of the screen drives a sticky milestone card that shows what
// the contract is doing: state, who acts, the on-chain rule and where the money is. The card is a visual
// echo of the text, so it is hidden from assistive technology and from small screens.

export type Step = { state: DisplayState; title: string; rule: string; actor: string; predicate: string };

const TRACK: Record<"normal" | "refund", string[]> = {
  normal: ["Funded", "In review", "Approved", "Paid"],
  refund: ["Funded", "Expired", "Refunded"],
};
// Which node of its track each step lights, and which track it uses.
const AT: { path: "normal" | "refund"; node: number; held: "outstanding" | "paid" | "refunded" }[] = [
  { path: "normal", node: 0, held: "outstanding" },
  { path: "normal", node: 1, held: "outstanding" },
  { path: "normal", node: 2, held: "outstanding" },
  { path: "normal", node: 3, held: "paid" },
  { path: "refund", node: 2, held: "refunded" },
];

export function StoryStepper({ steps }: { steps: Step[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const els = refs.current.filter((e): e is HTMLLIElement => e !== null);
    // A step is "active" while it crosses the band around the middle of the viewport.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-42% 0px -48% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const cur = AT[active] ?? AT[0]!;
  const nodes = TRACK[cur.path];
  const step = steps[active] ?? steps[0]!;

  return (
    <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <ol className="divide-y divide-line border-y border-line lg:space-y-4 lg:divide-y-0 lg:border-y-0">
        {steps.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-step={i}
            className={`reveal grid gap-3 py-7 transition-[background-color,border-color] duration-[var(--dur-panel)] md:grid-cols-[10.5rem_1fr] md:gap-8 lg:min-h-[32vh] lg:items-center lg:rounded-2xl lg:border lg:px-7 lg:py-8 ${
              i === active ? "lg:border-line lg:bg-surface" : "lg:border-transparent"
            }`}
          >
            <div>
              <StateChip state={s.state} />
            </div>
            <div>
              <h3 className="text-title">{s.title}</h3>
              <p className="mt-2 measure text-ink-2">{s.rule}</p>
            </div>
          </li>
        ))}
      </ol>

      <div aria-hidden className="relative hidden lg:block">
        <div className="sticky top-32">
          <div data-story-card className="card p-7 shadow-lift">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink-3">Milestone 1 · illustration</p>
              <StateChip state={step.state} />
            </div>
            <p className="text-numeral mt-6">
              0.30 <span className="font-sans text-base font-medium text-ink-3">ETH</span>
            </p>

            <div className="relative mt-9">
              <div className="absolute top-[0.6875rem] h-0.5 rounded bg-line" style={{ left: `${50 / nodes.length}%`, right: `${50 / nodes.length}%` }}>
                <div className="h-full rounded bg-ink transition-[width] duration-[var(--dur-reveal)] ease-[var(--ease-out)]" style={{ width: `${(cur.node / (nodes.length - 1)) * 100}%` }} />
              </div>
              <div className="relative grid" style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))` }}>
                {nodes.map((label, i) => {
                  const done = i < cur.node;
                  const here = i === cur.node;
                  const final = here && i === nodes.length - 1;
                  return (
                    <div key={label} className="flex flex-col items-center text-center">
                      <span
                        className={`grid size-6 place-items-center rounded-full border-2 transition-colors duration-[var(--dur-panel)] ${
                          final ? (cur.path === "refund" ? "border-refunded bg-refunded text-paper" : "border-paid bg-paid text-paper") : done ? "border-ink bg-ink text-paper" : here ? "border-cobalt bg-surface" : "border-line-control bg-surface"
                        }`}
                      >
                        {final || done ? <Check size={13} strokeWidth={3} /> : here ? <span className="size-2 rounded-full bg-cobalt" /> : null}
                      </span>
                      <span className={`mt-2 text-micro transition-colors duration-[var(--dur-panel)] ${here || done ? "font-semibold text-ink" : "text-ink-3"}`}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-9 flex h-3 overflow-hidden rounded-full bg-sunken">
              <div
                className={`h-full transition-[width,background-color] duration-[var(--dur-reveal)] ease-[var(--ease-out)] ${
                  cur.held === "paid" ? "bg-paid" : cur.held === "refunded" ? "bg-refunded" : "border border-funded bg-funded/35"
                }`}
                style={{ width: "100%" }}
              />
            </div>
            <p className="mt-2 text-sm text-ink-2">
              {cur.held === "outstanding" ? "Held by the contract" : cur.held === "paid" ? "Paid to the provider" : "Refunded to the client"}
            </p>

            <dl className="mt-7 grid gap-4 border-t border-line pt-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-3">Who acts</dt>
                <dd className="mt-1 font-medium">{step.actor}</dd>
              </div>
              <div>
                <dt className="text-ink-3">The rule on-chain</dt>
                <dd className="text-data mt-1 text-[0.8125rem]">{step.predicate}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

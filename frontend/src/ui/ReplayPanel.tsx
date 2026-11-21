"use client";

import { ArrowRight, Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReplayStory, StepTone } from "@/domain/replay";

// The landing hero: real agreements from Sepolia, replayed step by step. It renders complete on the server
// (every step done, so it is correct without JavaScript), then, the first time it scrolls into view, plays
// the steps in order (about 1.1 s each, under 5 s in total, so no pause control is required). The tabs
// switch between the paid and the refunded agreement; Replay plays it again. Under reduced motion the
// final state is shown and nothing advances on its own.

const STEP_MS = 1100;
const DOT: Record<StepTone, string> = {
  created: "bg-ink",
  submitted: "bg-submitted",
  rejected: "bg-submitted",
  approved: "bg-approved",
  claimed: "bg-paid",
  refunded: "bg-refunded",
  deadline: "bg-line-control",
};
const OUTCOME_LABEL = { paid: "Paid", refunded: "Refunded", open: "Open" } as const;

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ReplayPanel({ stories }: { stories: ReplayStory[] }) {
  const [storyIdx, setStoryIdx] = useState(0);
  const story = stories[storyIdx] ?? stories[0]!;
  const last = story.steps.length - 1;
  const [step, setStep] = useState(last);
  const [run, setRun] = useState(0); // 0 = not playing (final state); each start bumps it
  const ref = useRef<HTMLDivElement>(null);

  const play = (idx: number) => {
    setStoryIdx(idx);
    if (prefersReducedMotion()) {
      setStep((stories[idx] ?? stories[0]!).steps.length - 1);
      return;
    }
    setStep(0);
    setRun((r) => r + 1);
  };

  // Start once, when the panel first becomes visible.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          if (!prefersReducedMotion()) {
            setStep(0);
            setRun((r) => r + 1);
          }
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Advance one step at a time while a run is in progress.
  useEffect(() => {
    if (run === 0 || step >= last) return;
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, last)), STEP_MS);
    return () => clearTimeout(t);
  }, [run, step, last]);

  const n = story.steps.length;
  const pad = (i: number) => String(i).padStart(2, "0");

  return (
    <div ref={ref} data-replay className="card p-5 text-left sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="pill">
            <span aria-hidden className={`size-2 rounded-full ${story.illustrative ? "bg-line-control" : "bg-paid"}`} />
            {story.illustrative ? "Illustration of the rules" : "Replayed from Sepolia"}
          </span>
          <span className="text-sm font-semibold">Agreement #{story.id}</span>
          <span className="text-data text-sm text-ink-3" aria-label={`Step ${step + 1} of ${n}`}>
            <span className="text-ink">{pad(step + 1)}</span> / {pad(n)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {stories.length > 1 && (
            <div role="group" aria-label="Choose an agreement" className="relative flex rounded-full border border-line p-1">
              <span
                aria-hidden
                className="absolute inset-y-1 left-1 rounded-full bg-line transition-transform duration-[var(--dur-panel)] ease-[var(--ease-out)]"
                style={{ width: `calc((100% - 0.5rem) / ${stories.length})`, transform: `translateX(${storyIdx * 100}%)` }}
              />
              {stories.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={i === storyIdx}
                  onClick={() => play(i)}
                  className={`press relative z-10 min-w-24 rounded-full px-4 py-1.5 text-sm font-semibold ${i === storyIdx ? "text-ink" : "text-ink-3 hover:text-ink"}`}
                >
                  {OUTCOME_LABEL[s.outcome]}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => play(storyIdx)}
            className="press inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold hover:border-line-control"
          >
            <RotateCcw aria-hidden size={15} />
            Replay
          </button>
        </div>
      </div>

      <ol className="mt-6 grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 12.5rem), 1fr))` }}>
        {story.steps.map((s, i) => {
          const status = i < step ? "done" : i === step ? "current" : "next";
          return (
            <li
              key={`${story.id}-${i}-${status === "current" ? run : "s"}`}
              className={`relative flex flex-col rounded-2xl border p-4 transition-[border-color,background-color] duration-[var(--dur-panel)] ${
                status === "current"
                  ? "step-in border-cobalt/60 bg-surface shadow-lift"
                  : status === "done"
                    ? "border-line bg-surface"
                    : "border-dashed border-line bg-transparent"
              }`}
              aria-current={status === "current" ? "step" : undefined}
            >
              <div className="flex items-center justify-between text-micro text-ink-3">
                <span className="text-data text-[0.75rem]">
                  {pad(i + 1)} / {pad(n)}
                </span>
                {status === "done" ? (
                  <Check aria-hidden size={15} className="text-ink-2" />
                ) : status === "current" ? (
                  <span aria-hidden className={`size-2 rounded-full ${DOT[s.tone]}`} />
                ) : null}
              </div>
              <p className={`mt-3 text-heading ${status === "next" ? "text-ink-3" : ""}`}>{s.title}</p>
              <p className="text-data mt-1.5 text-[0.8125rem] text-ink-2">{s.detail}</p>
              <p className="mt-2 text-sm text-ink-3">{s.note}</p>
              <p className="mt-auto pt-3 text-micro text-ink-3">{s.time}</p>
            </li>
          );
        })}
      </ol>

      <div aria-hidden className="mt-6 h-1 overflow-hidden rounded-full bg-sunken">
        <div
          className={`h-full rounded-full transition-[width] duration-[var(--dur-reveal)] ease-[var(--ease-out)] ${story.outcome === "refunded" ? "bg-refunded" : story.outcome === "paid" ? "bg-paid" : "bg-cobalt"}`}
          style={{ width: `${((step + 1) / n) * 100}%` }}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-ink-2">
          {step === last ? <span className="font-semibold text-ink">{story.summary}.</span> : "Every step is a real transaction on Sepolia."}
        </p>
        {story.href && (
          <Link href={story.href} className="group inline-flex items-center gap-1.5 font-semibold text-cobalt">
            Open agreement #{story.id}
            <ArrowRight aria-hidden size={15} className="transition-transform duration-[var(--dur-hover)] group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

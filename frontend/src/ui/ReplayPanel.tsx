"use client";

import { ArrowRight, Check, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReplayStory, StepTone } from "@/domain/replay";

// The landing hero: the real agreements from Sepolia, played step by step, continuously: the paid one,
// then the refunded one, then again. It renders complete on the server (correct without JavaScript).
// Because it moves on its own for more than five seconds, it has a Pause button (WCAG 2.2.2); it also stops
// while off screen. A tab jumps to that agreement and keeps playing. Under reduced motion it shows the final
// state and only plays when the visitor presses Play.

const STEP_MS = 1300; // time on each step
const HOLD_MS = 2600; // time on the outcome before the next agreement
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

const reducedQuery = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (notify: () => void) => {
  const mq = window.matchMedia(reducedQuery);
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
};
const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  );

export function ReplayPanel({ stories }: { stories: ReplayStory[] }) {
  const [storyIdx, setStoryIdx] = useState(0);
  const story = stories[storyIdx] ?? stories[0]!;
  const last = story.steps.length - 1;
  const [step, setStep] = useState(last); // the server renders the finished story
  const [started, setStarted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [userPlay, setUserPlay] = useState(false);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const auto = !reduced || userPlay;
  const playing = started && visible && !paused && auto;

  // Start on first sight; afterwards only track whether it is on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        setVisible(e.isIntersecting);
        if (e.isIntersecting) {
          setStarted((was) => {
            if (!was && !window.matchMedia(reducedQuery).matches) setStep(0);
            return true;
          });
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // One tick: the next step, or after the outcome the next agreement (looping).
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(
      () => {
        if (step < last) setStep(step + 1);
        else {
          setStoryIdx((i) => (i + 1) % stories.length);
          setStep(0);
        }
      },
      step < last ? STEP_MS : HOLD_MS,
    );
    return () => clearTimeout(t);
  }, [playing, step, last, stories.length]);

  const choose = (i: number) => {
    setStoryIdx(i);
    setStep(auto ? 0 : (stories[i] ?? stories[0]!).steps.length - 1);
  };

  const toggle = () => {
    if (playing) {
      setPaused(true);
      return;
    }
    if (!auto) {
      setUserPlay(true);
      setStep(0);
    }
    setStarted(true);
    setVisible(true);
    setPaused(false);
  };

  const n = story.steps.length;
  const pad = (i: number) => String(i).padStart(2, "0");

  return (
    <div
      ref={ref}
      data-replay
      className="card p-5 text-left transition-[border-color] duration-[var(--dur-hover)] hover:border-line-control sm:p-7"
    >
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
        <div className="flex flex-wrap items-center gap-2">
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
                  onClick={() => choose(i)}
                  className={`press relative z-10 min-w-24 rounded-full px-4 py-1.5 text-sm font-semibold ${i === storyIdx ? "text-ink" : "text-ink-3 hover:text-ink"}`}
                >
                  {OUTCOME_LABEL[s.outcome]}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={toggle}
            data-replay-toggle
            className="press inline-flex h-10 min-w-24 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold hover:border-line-control"
          >
            {playing ? <Pause aria-hidden size={15} /> : <Play aria-hidden size={15} />}
            {playing ? "Pause" : "Play"}
          </button>
        </div>
      </div>

      <ol className="mt-6 grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 12.5rem), 1fr))` }}>
        {story.steps.map((s, i) => {
          const status = i < step ? "done" : i === step ? "current" : "next";
          return (
            <li
              key={`${story.id}-${i}-${status === "current" ? "c" : "s"}`}
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

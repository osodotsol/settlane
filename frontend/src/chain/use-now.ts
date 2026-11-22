"use client";

import { useEffect, useState } from "react";

/** The current time in ms, re-rendering every `everyMs` while `active` (for elapsed-time labels). */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // first tick within 250 ms so an elapsed label never shows a stale time for a full second
    const first = setTimeout(() => setNow(Date.now()), 250);
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [active, everyMs]);
  return now;
}

/** "42 s", "3 min 05 s" */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

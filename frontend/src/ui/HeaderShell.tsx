"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = (notify: () => void) => {
  window.addEventListener("scroll", notify, { passive: true });
  return () => window.removeEventListener("scroll", notify);
};
const scrolled = () => window.scrollY > 8;

/**
 * The sticky header frame. It is flat at the top of the page and gains a hairline and a soft shadow once
 * the page scrolls (the state is derived from scroll position, never stored). A hairline reading-progress
 * bar sits on its lower edge where CSS scroll-driven animations are supported.
 */
export function HeaderShell({ children }: { children: ReactNode }) {
  const isScrolled = useSyncExternalStore(subscribe, scrolled, () => false);
  return (
    <header
      data-scrolled={isScrolled || undefined}
      className="sticky top-0 z-30 border-b border-transparent bg-paper transition-[border-color,box-shadow] duration-[var(--dur-panel)] ease-out data-[scrolled]:border-line data-[scrolled]:shadow-[0_10px_24px_-18px_rgb(21_23_27/0.35)]"
    >
      {children}
      <div aria-hidden className="scroll-progress absolute inset-x-0 -bottom-px h-0.5 bg-cobalt" />
    </header>
  );
}

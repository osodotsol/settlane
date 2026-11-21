import Link from "next/link";

/** The Settlane mark: three lanes that settle into one point. Drawn, not an emoji or glyph. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 6h9.5c2.5 0 3.5 2 4.5 6M3 12h14M3 18h9.5c2.5 0 3.5-2 4.5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="19.5" cy="12" r="2.25" fill="var(--cobalt)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 rounded-md text-ink" aria-label="Settlane, home">
      <Mark />
      <span className="font-display text-[1.375rem] font-medium tracking-[-0.02em]">Settlane</span>
    </Link>
  );
}

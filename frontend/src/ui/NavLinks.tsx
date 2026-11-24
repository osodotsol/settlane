"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The public navigation (DESIGN.md §15): Home, How It Works, Explorer, Developers. Launch App is the separate
// primary button in the header. Security & Limitations lives in the footer and on the Developers page.
const LINKS = [
  { href: "/", label: "Home" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/explorer", label: "Explorer" },
  { href: "/contract", label: "Developers" },
];

function isCurrent(href: string, path: string) {
  if (href === "/") return path === "/";
  if (href === "/explorer") return path.startsWith("/explorer") || path.startsWith("/agreements");
  if (href === "/contract") return path === "/contract";
  return false;
}

export function NavLinks({ compact = false }: { compact?: boolean }) {
  const path = usePathname();
  return (
    <ul className={`flex items-center text-sm ${compact ? "justify-between py-1" : "gap-1"}`}>
      {LINKS.map((l) => {
        const current = isCurrent(l.href, path);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={current ? "page" : undefined}
              className={`inline-flex h-11 items-center whitespace-nowrap rounded-md ${compact ? "px-2" : "px-3"} ${
                current ? "font-medium text-ink" : "text-ink-2 hover:text-ink"
              } press`}
            >
              <span className="draw-link py-1" aria-current={current ? "page" : undefined}>
                {l.label}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

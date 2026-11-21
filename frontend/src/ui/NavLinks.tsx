"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/explorer", label: "Explorer", always: true },
  { href: "/contract", label: "Contract", always: true },
  { href: "/#how-it-settles", label: "How it settles", always: true },
  // On phones the footer carries this one, so the compact row never overflows.
  { href: "/#limitations", label: "Limitations", always: false },
];

export function NavLinks({ compact = false }: { compact?: boolean }) {
  const path = usePathname();
  return (
    <ul className={`flex items-center text-sm ${compact ? "justify-between gap-1 py-1" : "gap-1"}`}>
      {LINKS.map((l) => {
        const current =
          l.href === "/explorer" ? path.startsWith("/explorer") || path.startsWith("/agreements") : l.href === "/contract" ? path === "/contract" : false;
        return (
          <li key={l.href} className={l.always ? undefined : "hidden sm:block"}>
            <Link
              href={l.href}
              aria-current={current ? "page" : undefined}
              className={`inline-flex h-11 items-center whitespace-nowrap rounded-md px-3 ${
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/explorer", label: "Explorer" },
  { href: "/contract", label: "Contract" },
  { href: "/#how-it-settles", label: "How it settles" },
  { href: "/#limitations", label: "Limitations" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <ul className="flex items-center gap-1 text-sm">
      {LINKS.map((l) => {
        const current = l.href === "/explorer" ? path.startsWith("/explorer") || path.startsWith("/agreements") : l.href === "/contract" ? path === "/contract" : false;
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={current ? "page" : undefined}
              className={`inline-flex h-10 items-center whitespace-nowrap rounded-md px-3 ${current ? "text-ink underline decoration-cobalt decoration-2 underline-offset-[10px]" : "text-ink-2 hover:text-ink"}`}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

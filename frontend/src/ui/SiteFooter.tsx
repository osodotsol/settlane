import Link from "next/link";
import { CI_URL, REPOSITORY, SETTLANE_ADDRESS, addressUrl } from "@/config/chain";
import { shortHex } from "@/domain/format";
import { Container } from "./Container";
import { Wordmark } from "./Wordmark";

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Explore",
    links: [
      { href: "/explorer", label: "All agreements" },
      { href: "/agreements/1", label: "Agreement #1 (paid)" },
      { href: "/agreements/2", label: "Agreement #2 (refunded)" },
    ],
  },
  {
    title: "Evidence",
    links: [
      { href: "/contract", label: "Contract evidence" },
      { href: addressUrl(SETTLANE_ADDRESS), label: `Contract ${shortHex(SETTLANE_ADDRESS)}`, external: true },
      { href: CI_URL, label: "Continuous integration", external: true },
    ],
  },
  {
    title: "Project",
    links: [
      { href: REPOSITORY, label: "Source (Apache-2.0)", external: true },
      { href: "/#how-it-settles", label: "How it settles" },
      { href: "/#limitations", label: "Limitations" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <Container className="grid gap-12 py-14 md:grid-cols-[1.3fr_2fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-sm text-ink-2">Pay for work one milestone at a time, by rules fixed in advance. Written in Fe, on the Sepolia testnet.</p>
        </div>
        <nav aria-label="Footer" className="grid gap-8 sm:grid-cols-3">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2 className="text-sm font-semibold">{c.title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {c.links.map((l) => (
                  <li key={l.href}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noreferrer" className="draw-link text-ink-2 hover:text-ink">
                        {l.label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link href={l.href} className="draw-link text-ink-2 hover:text-ink">{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </Container>
      <div className="border-t border-line">
        <Container className="py-5 text-sm text-ink-3">
          Settlane is an unaudited prototype on the Sepolia testnet. Test ETH only. The verifier is a trusted party.
        </Container>
      </div>
    </footer>
  );
}

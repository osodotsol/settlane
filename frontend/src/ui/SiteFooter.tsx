import Link from "next/link";
import { CI_URL, REPOSITORY, SETTLANE_ADDRESS, addressUrl } from "@/config/chain";
import { Container } from "./Container";
import { Wordmark } from "./Wordmark";

type FooterLink = { href: string; label: string; external?: boolean };

// Every destination is real: a page of this site, the repository, its CI, or the contract on Etherscan.
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#how-it-works", label: "How It Works" },
      { href: "/app", label: "Launch App" },
      { href: "/explorer", label: "Explore Agreements" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/contract", label: "Fe Smart Contract" },
      { href: REPOSITORY, label: "GitHub Repository", external: true },
      { href: "/contract#verify", label: "Testing & Verification" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: `${REPOSITORY}#readme`, label: "Documentation", external: true },
      { href: "/contract#limitations", label: "Security & Limitations" },
      { href: addressUrl(SETTLANE_ADDRESS), label: "Sepolia Explorer", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer relative mt-24 overflow-hidden border-t border-line">
      <div aria-hidden className="footer-glow pointer-events-none absolute inset-x-0 top-0 h-64" />
      <Container className="relative grid gap-12 py-16 md:grid-cols-[1.4fr_2fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-ink-2">Milestone payments. Clear rules. Verifiable settlement.</p>
          <p className="mt-3 max-w-xs text-sm text-ink-3">A Fe smart contract on the Ethereum Sepolia testnet. Open source, Apache-2.0.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2 className="text-sm font-semibold text-ink">{c.title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {c.links.map((l) => (
                  <li key={l.label}>
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
      <div className="relative border-t border-line">
        <Container className="flex flex-wrap items-center justify-between gap-3 py-5 text-sm text-ink-3">
          <p>Sepolia testnet · Test ETH only · Trusted verifier · Unaudited prototype.</p>
          <a href={CI_URL} target="_blank" rel="noreferrer" className="draw-link text-ink-3 hover:text-ink">
            Continuous integration<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Container>
      </div>
    </footer>
  );
}

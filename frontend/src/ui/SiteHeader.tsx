import { Container } from "./Container";
import { NavLinks } from "./NavLinks";
import { WalletControl } from "./WalletControl";
import { Wordmark } from "./Wordmark";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur-[2px] supports-[backdrop-filter]:bg-paper/80 sticky top-0 z-20">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Wordmark />
        <nav aria-label="Main" className="hidden md:block">
          <NavLinks />
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden text-micro text-ink-3 sm:inline">Sepolia · test ETH</span>
          <WalletControl />
        </div>
      </Container>
      <nav aria-label="Main (compact)" className="border-t border-line md:hidden">
        <Container className="overflow-x-auto">
          <NavLinks />
        </Container>
      </nav>
    </header>
  );
}

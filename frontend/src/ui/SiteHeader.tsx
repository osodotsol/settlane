import { ButtonLink } from "./Button";
import { Container } from "./Container";
import { HeaderShell } from "./HeaderShell";
import { NavLinks } from "./NavLinks";
import { WalletControl } from "./WalletControl";
import { Wordmark } from "./Wordmark";

export function SiteHeader() {
  return (
    <HeaderShell>
      <Container className="flex h-16 items-center justify-between gap-4">
        <Wordmark />
        <nav aria-label="Main" className="hidden lg:block">
          <NavLinks />
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-micro text-ink-2 sm:inline-flex">
            <span aria-hidden className="size-1.5 rounded-full bg-paid" />
            Sepolia · test ETH
          </span>
          <span className="hidden sm:block"><WalletControl /></span>
          <ButtonLink href="/app" size="sm">Open App</ButtonLink>
        </div>
      </Container>
      <nav aria-label="Main (compact)" className="border-t border-line lg:hidden">
        <Container>
          <NavLinks compact />
        </Container>
      </nav>
    </HeaderShell>
  );
}

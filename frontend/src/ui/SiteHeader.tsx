import { ArrowUpRight } from "lucide-react";
import { ButtonLink } from "./Button";
import { Container } from "./Container";
import { HeaderShell } from "./HeaderShell";
import { NavLinks } from "./NavLinks";
import { Wordmark } from "./Wordmark";

// The public header stays light: brand, four links and one primary action. Wallet and network state live
// inside the application (/app), where they are needed.
export function SiteHeader() {
  return (
    <HeaderShell>
      <Container className="flex h-16 items-center justify-between gap-4">
        <Wordmark />
        <nav aria-label="Main" className="hidden lg:block">
          <NavLinks />
        </nav>
        <ButtonLink href="/app" size="sm">
          Launch App <ArrowUpRight aria-hidden size={16} />
        </ButtonLink>
      </Container>
      <nav aria-label="Main (compact)" className="border-t border-line lg:hidden">
        <Container>
          <NavLinks compact />
        </Container>
      </nav>
    </HeaderShell>
  );
}

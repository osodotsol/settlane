import { ButtonLink } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { SiteFooter } from "@/ui/SiteFooter";
import { SiteHeader } from "@/ui/SiteHeader";

// A missing page replaces the whole segment layout, so it brings its own header and footer.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Container className="py-24">
          <h1 className="text-display">Nothing settles here</h1>
          <p className="mt-4 measure text-ink-2">
            This page or agreement does not exist on the deployed contract. Agreement numbers start at 1 and
            increase by one with every agreement created.
          </p>
          <div className="mt-8">
            <ButtonLink href="/explorer">Open the explorer</ButtonLink>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

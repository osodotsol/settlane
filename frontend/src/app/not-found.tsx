import { ButtonLink } from "@/ui/Button";
import { Container } from "@/ui/Container";

export default function NotFound() {
  return (
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
  );
}

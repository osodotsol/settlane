import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { RUNTIME_SHA256, SETTLANE_ADDRESS, REPOSITORY, addressUrl } from "@/config/chain";
import { getOverview } from "@/contract/data";
import { shortHex } from "@/domain/format";
import type { DisplayState } from "@/domain/lifecycle";
import { Amount } from "@/ui/Amount";
import { ButtonLink } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { StateChip } from "@/ui/StateChip";

// Live figures are re-read from Sepolia at most once a minute; a failed read never breaks the page.
export const revalidate = 60;

const STEPS: { state: DisplayState; title: string; rule: string }[] = [
  {
    state: "funded",
    title: "The client funds every milestone up front",
    rule: "One call creates the agreement and locks exactly the sum of its one to three milestones. There is no unfunded agreement.",
  },
  {
    state: "submitted",
    title: "The provider submits evidence before the delivery deadline",
    rule: "A hash of the delivered work. Resubmitting is allowed until the deadline, and each submission gets a new revision number.",
  },
  {
    state: "approved",
    title: "The verifier approves or asks for a revision",
    rule: "Before the review deadline, naming the exact evidence and revision. A decision about an older submission is refused.",
  },
  {
    state: "paid",
    title: "Approved work is claimed by the provider",
    rule: "An approval never expires. The provider withdraws the stored amount to an address of its choice.",
  },
  {
    state: "refunded",
    title: "Expired work is refunded to the client",
    rule: "If nothing was submitted by the delivery deadline, or nothing was decided by the review deadline, the client takes the amount back.",
  },
];

/** Reads the live figures; null when the public endpoints do not answer (the page still renders). */
async function readLiveFigures() {
  try {
    const { agreements, totalOutstanding } = (await getOverview()).value;
    const settled = agreements.flatMap((a) => a.milestones).filter((m) => m.state === "paid" || m.state === "refunded").length;
    return { count: agreements.length, settled, totalOutstanding };
  } catch {
    return null;
  }
}

async function LiveProof() {
  const figures = await readLiveFigures();
  if (figures === null) {
    return <p className="text-ink-2">Live figures are unavailable right now: the public Sepolia endpoints did not answer. The explorer retries on every visit.</p>;
  }
  return (
    <dl className="grid gap-6 sm:grid-cols-3">
      <div>
        <dt className="text-sm text-ink-3">Agreements created</dt>
        <dd className="text-title mt-1">{figures.count}</dd>
      </div>
      <div>
        <dt className="text-sm text-ink-3">Milestones settled</dt>
        <dd className="text-title mt-1">{figures.settled}</dd>
      </div>
      <div>
        <dt className="text-sm text-ink-3">Test ETH held for open milestones</dt>
        <dd className="mt-1 text-title">
          <Amount wei={figures.totalOutstanding} />
        </dd>
      </div>
    </dl>
  );
}

export default function Home() {
  return (
    <>
      <section className="border-b border-line">
        <Container className="grid gap-12 py-20 md:py-28 lg:grid-cols-[1.25fr_1fr] lg:items-end">
          <div>
            <h1 className="text-display-xl">Pay for work one milestone at a time, by rules fixed in advance.</h1>
            <p className="mt-6 measure text-lg text-ink-2">
              Settlane is a smart contract written in Fe, running on the Ethereum Sepolia testnet. A client locks
              test ETH for each milestone. A verifier both sides trust approves the work. The provider claims what was
              approved, and the client takes back what expired.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink href="/explorer">
                Explore live agreements <ArrowRight aria-hidden size={18} />
              </ButtonLink>
              <ButtonLink href="#how-it-settles" variant="secondary">
                How a milestone settles
              </ButtonLink>
            </div>
          </div>
          <aside aria-label="What each outcome means" className="rounded-xl border border-line bg-surface p-6">
            <p className="text-heading">Every milestone ends one way</p>
            <ul className="mt-4 space-y-3 text-sm text-ink-2">
              <li className="flex items-start gap-3">
                <StateChip state="paid" />
                <span>The verifier approved it, and the provider withdrew the amount.</span>
              </li>
              <li className="flex items-start gap-3">
                <StateChip state="refunded" />
                <span>Its deadline passed without an approval, and the client took it back.</span>
              </li>
            </ul>
            <p className="mt-5 border-t border-line pt-4 text-sm text-ink-3">
              Never both, never twice. Paid and Refunded are final.
            </p>
          </aside>
        </Container>
      </section>

      <section aria-labelledby="problem" className="border-b border-line">
        <Container className="grid gap-10 py-20 md:grid-cols-[1fr_2fr]">
          <h2 id="problem" className="text-display">Today one side always goes first</h2>
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="text-heading">For the client</h3>
              <p className="mt-2 text-ink-2">Money sent before delivery is hard to get back when the work never arrives.</p>
            </div>
            <div>
              <h3 className="text-heading">For the provider</h3>
              <p className="mt-2 text-ink-2">Work delivered before payment is hard to collect when the client goes quiet.</p>
            </div>
            <p className="text-ink-2 sm:col-span-2">
              Settlane holds the money in between and releases each milestone on its own, by deadlines and rules both
              sides can read before they start.
            </p>
          </div>
        </Container>
      </section>

      <section id="how-it-settles" aria-labelledby="how" className="scroll-mt-20 border-b border-line">
        <Container className="py-20">
          <h2 id="how" className="text-display max-w-[22ch]">How a milestone settles</h2>
          <ol className="mt-12 divide-y divide-line border-y border-line">
            {STEPS.map((s) => (
              <li key={s.state} className="grid gap-3 py-6 md:grid-cols-[11rem_1fr] md:gap-8">
                <div>
                  <StateChip state={s.state} />
                </div>
                <div>
                  <h3 className="text-heading">{s.title}</h3>
                  <p className="mt-1 measure text-ink-2">{s.rule}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 measure text-sm text-ink-3">
            Deadlines are absolute and fixed at creation. Submission and refund can never both be open at the same
            moment, and neither can review and refund. Full rules: docs/LIFECYCLE.md in the repository.
          </p>
        </Container>
      </section>

      <section aria-labelledby="proof" className="border-b border-line">
        <Container className="grid gap-10 py-20 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 id="proof" className="text-display">Proof anyone can check</h2>
            <p className="mt-4 measure text-ink-2">
              The contract is deployed on Sepolia, and its bytecode is byte-for-byte the open-source build.
            </p>
            <p className="mt-4 text-sm text-ink-3">
              Contract{" "}
              <a className="text-data text-ink underline decoration-line-control hover:decoration-cobalt" href={addressUrl(SETTLANE_ADDRESS)}>
                {shortHex(SETTLANE_ADDRESS)}
              </a>{" "}
              · runtime SHA-256 <span className="text-data">{shortHex(RUNTIME_SHA256, 8, 6)}</span>
            </p>
          </div>
          <div className="space-y-8">
            <LiveProof />
            <Link href="/explorer" className="inline-flex items-center gap-2 font-medium text-cobalt underline-offset-4 hover:underline">
              See every agreement and its settlement <ArrowRight aria-hidden size={16} />
            </Link>
          </div>
        </Container>
      </section>

      <section aria-labelledby="fe" className="border-b border-line">
        <Container className="grid gap-10 py-20 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 id="fe" className="text-display">Built with Fe</h2>
            <p className="mt-4 measure text-ink-2">
              Time is an effect. The production contract supplies the clock from the block, and nothing else; a test
              contract runs the identical rules under a clock the tests can move, so every deadline is tested on
              both sides.
            </p>
            <p className="mt-4 measure text-sm text-ink-3">
              The compiler blocks a handler that does not list the Call effect from sending ETH. It does not stop an
              entry point that lists Call read-only, so a policy lint and tests close that gap.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-line bg-sunken p-5 text-[0.875rem] leading-relaxed">
            <code className="font-mono">{`Submit { id, m, evidence } uses (ctx, mut log, agreements, mut milestones) {
    with (Clock = Clock { now: ctx.timestamp() }) {
        handlers::submit_handler(id, m, evidence)
    }
}`}</code>
          </pre>
        </Container>
      </section>

      <section id="limitations" aria-labelledby="limits" className="scroll-mt-20">
        <Container className="py-20">
          <h2 id="limits" className="text-display">What Settlane does not do</h2>
          <ul className="mt-10 grid gap-x-10 gap-y-6 md:grid-cols-2">
            {[
              ["The verifier is trusted.", "It decides whether work is accepted. Settlane cannot check the work, and there is no appeal."],
              ["Test ETH only.", "It runs on the Sepolia testnet and is unaudited. Do not use it with real funds."],
              ["Lost keys lock funds.", "There is no admin or recovery path, by design. An approved milestone whose provider loses its key stays locked."],
              ["Payouts forward only the 2,300-gas stipend.", "Some smart-contract wallets cannot receive it; the caller can choose another address."],
            ].map(([t, d]) => (
              <li key={t}>
                <p className="text-heading">{t}</p>
                <p className="mt-1 measure text-ink-2">{d}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-sm text-ink-3">
            Source, tests and the full security model:{" "}
            <a className="underline decoration-line-control hover:decoration-cobalt" href={REPOSITORY}>
              github.com/osodotsol/settlane
            </a>
          </p>
        </Container>
      </section>
    </>
  );
}

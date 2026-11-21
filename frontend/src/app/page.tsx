import { ArrowRight, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { RUNTIME_SHA256, SETTLANE_ADDRESS, REPOSITORY, addressUrl } from "@/config/chain";
import { getActivity, getAgreement, getDeployedCodeHash, getOverview } from "@/contract/data";
import { shortHex } from "@/domain/format";
import { sampleAgreement } from "@/domain/sample";
import { Amount } from "@/ui/Amount";
import { ButtonLink } from "@/ui/Button";
import { CodeBlock, type Tok } from "@/ui/CodeBlock";
import { Container } from "@/ui/Container";
import { HeroStage } from "@/ui/HeroStage";
import { StoryStepper, type Step } from "@/ui/StoryStepper";

// Live figures are re-read from Sepolia at most once a minute; a failed read never breaks the page.
export const revalidate = 60;

const STEPS: Step[] = [
  {
    state: "funded",
    title: "The client funds every milestone up front",
    rule: "One call creates the agreement and locks exactly the sum of its one to three milestones. There is no unfunded agreement.",
    actor: "Client",
    predicate: "msg.value == Σ amounts",
  },
  {
    state: "submitted",
    title: "The provider submits evidence before the delivery deadline",
    rule: "A hash of the delivered work. Resubmitting is allowed until the deadline, and each submission gets a new revision number.",
    actor: "Provider",
    predicate: "now < deliver_by",
  },
  {
    state: "approved",
    title: "The verifier approves or asks for a revision",
    rule: "Before the review deadline, naming the exact evidence and revision. A decision about an older submission is refused.",
    actor: "Verifier (trusted)",
    predicate: "now < decide_by and evidence, revision match",
  },
  {
    state: "paid",
    title: "Approved work is claimed by the provider",
    rule: "An approval never expires. The provider withdraws the stored amount to an address of its choice.",
    actor: "Provider",
    predicate: "state == Approved (no deadline)",
  },
  {
    state: "refunded",
    title: "Expired work is refunded to the client",
    rule: "If nothing was submitted by the delivery deadline, or nothing was decided by the review deadline, the client takes the amount back.",
    actor: "Client",
    predicate: "Funded: now ≥ deliver_by · In review: now ≥ decide_by",
  },
];

const ROLES = [
  {
    name: "Client",
    line: "Funds the work. Takes back what expires.",
    can: ["Creates and funds an agreement", "Refunds a milestone once it has expired", "Chooses where a refund is sent"],
  },
  {
    name: "Provider",
    line: "Delivers the work. Claims what is approved.",
    can: ["Submits evidence, and resubmits until the deadline", "Claims an approved milestone, at any time", "Chooses where a payout is sent"],
  },
  {
    name: "Verifier",
    line: "Decides whether the work is accepted.",
    can: ["Approves or asks for a revision", "Is trusted: its decision is final on-chain", "Cannot move funds or change the parties"],
  },
];

const LIMITS: [string, string][] = [
  ["The verifier is trusted.", "It decides whether work is accepted. Settlane cannot check the work, and there is no appeal."],
  ["Test ETH only.", "It runs on the Sepolia testnet and is unaudited. Do not use it with real funds."],
  ["Lost keys lock funds.", "There is no admin or recovery path, by design. An approved milestone whose provider loses its key stays locked."],
  ["Payouts forward only the 2,300-gas stipend.", "Some smart-contract wallets cannot receive it; the caller can choose another address."],
];

const FE_LINES: Tok[][] = [
  [["c", "// the production Submit arm: a thin shell around a shared handler"]],
  [["t", "Submit"], ["p", " { id, m, evidence } "], ["k", "uses"], ["p", " (ctx, "], ["k", "mut"], ["p", " log, agreements, "], ["k", "mut"], ["p", " milestones) {"]],
  [["p", "    "], ["k", "with"], ["p", " ("], ["t", "Clock"], ["p", " = "], ["t", "Clock"], ["p", " { now: "], ["f", "ctx.timestamp()"], ["p", " }) {"]],
  [["p", "        handlers::"], ["f", "submit_handler"], ["p", "(id, m, evidence)"]],
  [["p", "    }"]],
  [["p", "}"]],
];

async function loadHero() {
  try {
    const [view, history] = await Promise.all([getAgreement(1n), getActivity()]);
    const agreement = view.value.agreement;
    if (!agreement) return null;
    return { agreement, activity: history.value.filter((a) => a.id === 1n), now: view.value.blockTime, illustrative: false };
  } catch {
    return null;
  }
}

async function loadFigures() {
  try {
    const { agreements, totalOutstanding } = (await getOverview()).value;
    const settled = agreements.flatMap((a) => a.milestones).filter((m) => m.state === "paid" || m.state === "refunded").length;
    return { count: agreements.length, settled, totalOutstanding };
  } catch {
    return null;
  }
}

async function loadCodeMatch(): Promise<boolean | null> {
  try {
    return (await getDeployedCodeHash()).value.sha256 === RUNTIME_SHA256;
  } catch {
    return null;
  }
}

const idx = (i: number) => ({ "--i": i }) as React.CSSProperties;
const delay = (ms: number) => ({ "--d": ms }) as React.CSSProperties;

export default async function Home() {
  const [heroData, figures, match] = await Promise.all([loadHero(), loadFigures(), loadCodeMatch()]);
  const hero = heroData ?? { ...sampleAgreement(), illustrative: true };

  return (
    <>
      {/* ---- Hero ---- */}
      <section className="ledger-rules relative overflow-hidden border-b border-line">
        <Container className="relative grid gap-14 py-16 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14 lg:py-24">
          <div>
            <h1 className="text-display-2xl enter" style={delay(0)}>
              Pay for work one milestone at a time,{" "}
              <em className="font-display italic font-normal text-cobalt">by rules fixed in advance.</em>
            </h1>
            <p className="enter mt-7 measure text-lg text-ink-2" style={delay(140)}>
              Settlane is a smart contract written in Fe, running on the Ethereum Sepolia testnet. A client locks test ETH for each milestone. A verifier both
              sides trust approves the work. The provider claims what was approved, and the client takes back what expired.
            </p>
            <div className="enter mt-9 flex flex-wrap items-center gap-3" style={delay(240)}>
              <ButtonLink href="/explorer">
                Explore live agreements <ArrowRight aria-hidden size={18} />
              </ButtonLink>
              <ButtonLink href="#how-it-settles" variant="secondary">
                How a milestone settles
              </ButtonLink>
              <Link href="/contract" className="draw-link ml-1 text-ink-2 hover:text-ink">
                Check the contract
              </Link>
            </div>
            <ul className="enter mt-10 flex flex-wrap gap-x-7 gap-y-2 text-sm text-ink-3" style={delay(340)}>
              <li>Written in Fe 26.6</li>
              <li>Sepolia testnet, test ETH only</li>
              <li>Open source, Apache-2.0</li>
            </ul>
          </div>
          <div className="enter" style={delay(200)}>
            <HeroStage {...hero} />
          </div>
        </Container>
      </section>

      {/* ---- Live proof strip ---- */}
      <section aria-label="Live figures from Sepolia" className="border-b border-line bg-surface">
        <Container className="grid grid-cols-2 gap-x-6 py-2 lg:grid-cols-4 lg:gap-x-0">
          {figures ? (
            <>
              <dl className="reveal py-5 lg:py-6 lg:pr-8"><dt className="text-sm text-ink-3">Agreements created</dt><dd className="text-numeral mt-2">{figures.count}</dd></dl>
              <dl className="reveal py-5 lg:py-6 lg:px-8"><dt className="text-sm text-ink-3">Milestones settled</dt><dd className="text-numeral mt-2">{figures.settled}</dd></dl>
              <dl className="reveal py-5 lg:py-6 lg:px-8"><dt className="text-sm text-ink-3">Test ETH held for open milestones</dt><dd className="mt-2"><Amount wei={figures.totalOutstanding} variant="numeral" /></dd></dl>
            </>
          ) : (
            <p className="col-span-2 py-6 text-ink-2 lg:col-span-3">Live figures are unavailable right now: the public Sepolia endpoints did not answer.</p>
          )}
          <dl className="reveal col-span-2 border-t border-line py-5 lg:col-span-1 lg:border-t-0 lg:py-6 lg:pl-8">
            <dt className="text-sm text-ink-3">Deployed bytecode</dt>
            <dd className="mt-2 flex items-center gap-2 font-medium">
              {match === true ? (
                <><CircleCheck aria-hidden size={20} className="text-paid" /> Equals the open-source build</>
              ) : match === false ? (
                <><TriangleAlert aria-hidden size={20} className="text-danger" /> Does not match the build</>
              ) : (
                <span className="text-ink-2">Could not be read right now</span>
              )}
            </dd>
          </dl>
        </Container>
      </section>

      {/* ---- The problem ---- */}
      <section aria-labelledby="problem" className="border-b border-line">
        <Container className="grid gap-12 py-20 md:grid-cols-[1fr_1.6fr] md:py-28">
          <h2 id="problem" className="text-display reveal">Today, one side always goes first</h2>
          <div className="reveal-stagger grid gap-x-10 gap-y-8 sm:grid-cols-2">
            <div style={idx(0)} className="border-t-2 border-ink pt-5">
              <h3 className="text-title">For the client</h3>
              <p className="mt-3 text-ink-2">Money sent before delivery is hard to get back when the work never arrives.</p>
            </div>
            <div style={idx(1)} className="border-t-2 border-ink pt-5">
              <h3 className="text-title">For the provider</h3>
              <p className="mt-3 text-ink-2">Work delivered before payment is hard to collect when the client goes quiet.</p>
            </div>
            <p style={idx(2)} className="text-lg text-ink-2 sm:col-span-2">
              Settlane holds the money in between and releases each milestone on its own, by deadlines and rules both sides can read before they start.
            </p>
          </div>
        </Container>
      </section>

      {/* ---- How a milestone settles (scroll story) ---- */}
      <section id="how-it-settles" aria-labelledby="how" className="scroll-mt-24 border-b border-line">
        <Container className="py-20 md:py-28">
          <h2 id="how" className="text-display reveal max-w-[20ch]">How a milestone settles</h2>
          <p className="reveal mt-4 measure text-ink-2">
            Every milestone moves through the same small set of states, one rule at a time. Scroll to follow one.
          </p>
          <div className="mt-14">
            <StoryStepper steps={STEPS} />
          </div>
          <p className="mt-8 measure text-sm text-ink-3">
            Deadlines are absolute and fixed at creation. Submission and refund can never both be open at the same moment, and neither can review and
            refund. Full rules: docs/LIFECYCLE.md in the repository.
          </p>
        </Container>
      </section>

      {/* ---- Who does what ---- */}
      <section aria-labelledby="roles" className="border-b border-line">
        <Container className="py-20 md:py-28">
          <h2 id="roles" className="text-display reveal max-w-[18ch]">Three parties, three jobs</h2>
          <div className="reveal-stagger mt-14 grid gap-x-10 gap-y-12 md:grid-cols-3">
            {ROLES.map((r, i) => (
              <div key={r.name} style={idx(i)} className="border-t-2 border-ink pt-6">
                <h3 className="text-display">{r.name}</h3>
                <p className="mt-3 text-ink-2">{r.line}</p>
                <ul className="mt-6 space-y-3 border-t border-line pt-5 text-sm">
                  {r.can.map((c) => (
                    <li key={c} className="flex gap-3">
                      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-cobalt" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ---- Proof ---- */}
      <section aria-labelledby="proof" className="border-b border-line">
        <Container className="grid gap-10 py-20 md:py-28 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
          <div className="reveal">
            <h2 id="proof" className="text-display">Proof anyone can check</h2>
            <p className="mt-5 measure text-ink-2">
              The contract is deployed on Sepolia and its bytecode is byte-for-byte the open-source build. Every agreement, every event and every figure on
              this site is read straight from the chain, with no wallet and no account.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/explorer">Open the explorer</ButtonLink>
              <ButtonLink href="/contract" variant="secondary">See the contract evidence</ButtonLink>
            </div>
          </div>
          <dl className="reveal-stagger grid gap-px self-center border-y border-line sm:grid-cols-2">
            <div style={idx(0)} className="py-6 sm:pr-8"><dt className="text-sm text-ink-3">Contract</dt><dd className="mt-2"><a className="text-data draw-link" href={addressUrl(SETTLANE_ADDRESS)}>{shortHex(SETTLANE_ADDRESS)}</a></dd></div>
            <div style={idx(1)} className="py-6 sm:pl-8"><dt className="text-sm text-ink-3">Runtime SHA-256</dt><dd className="text-data mt-2">{shortHex(RUNTIME_SHA256, 8, 6)}</dd></div>
            <div style={idx(2)} className="py-6 sm:pr-8"><dt className="text-sm text-ink-3">Compiler</dt><dd className="mt-2">Fe 26.6.0</dd></div>
            <div style={idx(3)} className="py-6 sm:pl-8"><dt className="text-sm text-ink-3">Network</dt><dd className="mt-2">Ethereum Sepolia (11155111)</dd></div>
          </dl>
        </Container>
      </section>

      {/* ---- Built with Fe ---- */}
      <section aria-labelledby="fe" className="border-b border-line">
        <Container className="grid gap-12 py-20 md:py-28 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-16">
          <div className="reveal min-w-0">
            <h2 id="fe" className="text-display">Built with Fe</h2>
            <p className="mt-5 measure text-ink-2">
              Time is an effect. The production contract supplies the clock from the block, and nothing else; a test contract runs the identical rules under a
              clock the tests can move, so every deadline is tested on both sides of the line.
            </p>
            <p className="mt-4 measure text-sm text-ink-3">
              The compiler blocks a handler that does not list the Call effect from sending ETH. It does not stop an entry point that lists Call read-only,
              so a policy lint and tests close that gap.
            </p>
          </div>
          <div className="reveal min-w-0">
            <CodeBlock lines={FE_LINES} label="ingots/settlane/src/settlane.fe" footer={<>The only place the production contract reads time is <span className="text-data text-[0.8125rem]">ctx.timestamp()</span>, enforced by a lint rule.</>} />
          </div>
        </Container>
      </section>

      {/* ---- Limitations ---- */}
      <section id="limitations" aria-labelledby="limits" className="scroll-mt-24 border-b border-line">
        <Container className="py-20 md:py-28">
          <h2 id="limits" className="text-display reveal">What Settlane does not do</h2>
          <ul className="reveal-stagger mt-12 grid gap-x-12 gap-y-9 md:grid-cols-2">
            {LIMITS.map(([t, d], i) => (
              <li key={t} style={idx(i)} className="border-t border-line-control pt-5">
                <p className="text-title">{t}</p>
                <p className="mt-2 measure text-ink-2">{d}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-sm text-ink-3">
            Source, tests and the full security model:{" "}
            <a className="draw-link text-ink-2 hover:text-ink" href={REPOSITORY}>github.com/osodotsol/settlane</a>
          </p>
        </Container>
      </section>

      {/* ---- Closing call to action ---- */}
      <section aria-labelledby="cta">
        <Container className="py-20 md:py-24">
          <div className="stage reveal relative overflow-hidden rounded-3xl px-7 py-14 sm:px-14 sm:py-20">
            <div aria-hidden className="ledger-rules absolute inset-0" />
            <div className="relative max-w-2xl">
              <h2 id="cta" className="text-display-xl">See it settle, on-chain.</h2>
              <p className="mt-5 text-lg text-ink-2">Two real agreements, one paid and one refunded, with every transaction linked to Sepolia.</p>
              <div className="mt-9 flex flex-wrap gap-3">
                <ButtonLink href="/agreements/1">Read agreement #1 <ArrowRight aria-hidden size={18} /></ButtonLink>
                <ButtonLink href="/explorer" variant="secondary">All agreements</ButtonLink>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

import { ArrowRight, ArrowUpRight, CircleCheck, Clock3, Code2, ExternalLink, FileCheck2, Lock, ShieldCheck, TriangleAlert, Workflow } from "lucide-react";
import Link from "next/link";
import { CI_URL, REPOSITORY, RUNTIME_SHA256, txUrl } from "@/config/chain";
import type { Agreement } from "@/contract/read";
import type { Activity, ActivityKind } from "@/contract/events";
import { getAgreement, getDeployedCodeHash, getHistory, getOverview } from "@/contract/data";
import { buildReplay, type ReplayStory } from "@/domain/replay";
import { agreementCoverage } from "@/domain/history-coverage";
import { formatEth, formatUtc, shortHex } from "@/domain/format";
import { sampleAgreement } from "@/domain/sample";
import { Amount } from "@/ui/Amount";
import { ButtonLink } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { ReplayPanel } from "@/ui/ReplayPanel";
import { StateChip } from "@/ui/StateChip";
import { StoryStepper, type Step } from "@/ui/StoryStepper";
import { DeadlineOrbit } from "@/ui/landing/DeadlineOrbit";
import { EthFlow } from "@/ui/landing/EthFlow";

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
    title: "Expired work can be refunded to the client",
    rule: "If nothing was submitted by the delivery deadline, or nothing was decided by the review deadline, the client may call refund and take the amount back. Nothing refunds by itself.",
    actor: "Client",
    predicate: "Funded: now ≥ deliver_by · In review: now ≥ decide_by",
  },
];

const PROBLEMS = [
  { icon: Lock, title: "Clients pay before they see the work", body: "Money sent up front is hard to recover when a delivery never arrives or misses its date." },
  { icon: FileCheck2, title: "Providers deliver before they are paid", body: "Finished work is hard to collect on when approval and payment depend on someone going quiet." },
  { icon: Workflow, title: "Informal terms are hard to check", body: "Deadlines, approvals and amounts scattered across chats and invoices leave no shared, verifiable record." },
];

const WINDOWS = [
  { tone: "var(--state-funded)", title: "Delivery window", body: "From creation until deliver_by, the provider may submit evidence, and resubmit while the window is open." },
  { tone: "var(--state-submitted)", title: "Review deadline", body: "The verifier approves or asks for a revision before decide_by, which is deliver_by plus the agreement's review period." },
  { tone: "var(--state-refunded)", title: "Refund eligibility", body: "A milestone still Funded at deliver_by, or still in review at decide_by, becomes refundable. The client must call refund: it is never automatic." },
  { tone: "var(--state-paid)", title: "Approval never expires", body: "Once approved, only the provider can claim it, at any time. An approved milestone can never be refunded." },
];

const FE_POINTS = [
  {
    icon: ShieldCheck,
    title: "Effects declare what each entry point may touch",
    body: "Every message arm lists its effects with uses: the context, the event log and the exact storage it may read or write. Submit cannot touch the totals; only Claim and Refund list the Call effect that sends ETH.",
    code: "Submit { id, m, evidence } uses (ctx, mut log, agreements, mut milestones)",
  },
  {
    icon: Clock3,
    title: "Time is an effect, supplied once",
    body: "The production contract provides the clock from the block and nothing else. A test contract in a separate ingot runs the same handlers under a clock the tests can move, so every deadline is tested on both sides.",
    code: "with (Clock = Clock { now: ctx.timestamp() }) { … }",
  },
  {
    icon: Code2,
    title: "A Solidity-compatible ABI, locked",
    body: "Every selector is declared with sol(..), so wallets and explorers decode the contract as usual. A policy lint locks the ABI, its output types and the single approved transfer.",
    code: '#[selector = sol("claim(uint256,uint8,address)")]',
  },
];

const EVENT_LABEL: Record<ActivityKind, string> = {
  created: "Created and funded",
  submitted: "Evidence submitted",
  approved: "Approved by the verifier",
  rejected: "Revision requested",
  claimed: "Paid to the provider",
  refunded: "Refunded to the client",
};

type Evidence = { agreement: Agreement; events: Activity[]; outcome: "paid" | "refunded" };

async function loadEvidence(): Promise<{ stories: ReplayStory[]; evidence: Evidence[] }> {
  try {
    const [one, two, history] = await Promise.all([getAgreement(1n), getAgreement(2n), getHistory()]);
    // Only an agreement whose recorded events equal what its state requires is shown as real evidence. Otherwise
    // the replay falls back to the labelled illustration and no transaction card is shown.
    const complete = [one, two]
      .map((v) => v.value.agreement)
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .filter((a) => agreementCoverage(a, history.value.events).complete);
    const evidence = complete.flatMap((a): Evidence[] => {
      const used = a.milestones.slice(0, a.n);
      const outcome = used.every((m) => m.state === "paid") ? "paid" : used.every((m) => m.state === "refunded") ? "refunded" : null;
      return outcome ? [{ agreement: a, events: history.value.events.filter((e) => e.id === a.id), outcome }] : [];
    });
    if (complete.length > 0) return { stories: complete.map((a) => buildReplay(a, history.value.events)), evidence };
  } catch {
    /* fall through to the labelled illustration */
  }
  const s = sampleAgreement();
  return { stories: [buildReplay(s.agreement, s.activity, true)], evidence: [] };
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

function SectionHead({ id, label, title, lead, center = false }: { id: string; label: string; title: string; lead?: string; center?: boolean }) {
  return (
    <div className={`reveal max-w-3xl ${center ? "mx-auto text-center" : ""}`}>
      <p className="eyebrow">{label}</p>
      <h2 id={id} className="text-display mt-3">{title}</h2>
      {lead && <p className="mt-4 text-lg text-ink-2">{lead}</p>}
    </div>
  );
}

function EvidenceCard({ e, i }: { e: Evidence; i: number }) {
  const tone = e.outcome === "paid" ? "var(--state-paid)" : "var(--state-refunded)";
  return (
    <article style={{ ...idx(i), "--accent": tone } as React.CSSProperties} className="card glass card-hover relative flex flex-col overflow-hidden p-6 sm:p-7">
      <span aria-hidden className="accent-bar" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-title">
          <Link href={`/agreements/${e.agreement.id}`} className="draw-link">Agreement #{e.agreement.id.toString()}</Link>
        </h3>
        <StateChip state={e.outcome} />
      </div>
      <p className="mt-2 text-sm text-ink-2">
        {formatEth(e.agreement.deposited)} ETH {e.outcome === "paid" ? "paid to the provider" : "refunded to the client"} · historical, verified on Sepolia
      </p>
      <ol className="mt-5 space-y-0 border-l border-line pl-5">
        {e.events.map((a) => (
          <li key={`${a.txHash}-${a.logIndex}`} className="relative pb-4 last:pb-0">
            <span aria-hidden className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full border-2 border-paper" style={{ background: a.kind === "claimed" ? "var(--state-paid)" : a.kind === "refunded" ? "var(--state-refunded)" : a.kind === "created" ? "var(--state-funded)" : a.kind === "approved" ? "var(--state-approved)" : "var(--state-submitted)" }} />
            <p className="text-sm font-medium">{EVENT_LABEL[a.kind]}{a.amount !== undefined && a.kind !== "created" ? ` · ${formatEth(a.amount)} ETH` : ""}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-micro text-ink-3">
              <span>{formatUtc(a.timestamp)}</span>
              <a href={txUrl(a.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-data text-[0.75rem] text-ink-2 hover:text-ink">
                <span className="draw-link">{shortHex(a.txHash)}</span> <ExternalLink aria-hidden size={11} />
                <span className="sr-only">(transaction on Sepolia Etherscan, opens in a new tab)</span>
              </a>
            </p>
          </li>
        ))}
      </ol>
    </article>
  );
}

export default async function Home() {
  const [{ stories, evidence }, figures, match] = await Promise.all([loadEvidence(), loadFigures(), loadCodeMatch()]);

  return (
    <>
      {/* ---- Hero ---- */}
      <section aria-labelledby="hero" className="hero relative overflow-hidden border-b border-line">
        <div aria-hidden className="absolute inset-0">
          <EthFlow className="hero-flow absolute inset-0 size-full" />
          <div className="hero-scrim absolute inset-0" />
        </div>
        <Container className="relative pb-[19rem] pt-16 sm:pb-[22rem] sm:pt-24 lg:pb-32 lg:pt-32">
          <div className="max-w-2xl">
            <p className="enter" style={delay(0)}>
              <span className="pill glass">
                <span aria-hidden className="size-2 rounded-full bg-paid" />
                Live on the Sepolia testnet · test ETH only
              </span>
            </p>
            <h1 id="hero" className="enter text-display-2xl mt-7" style={delay(80)}>
              Milestone payments. <span className="text-gradient">Clear rules.</span> Verifiable settlement.
            </h1>
            <p className="enter mt-6 max-w-xl text-lg text-ink-2 sm:text-xl" style={delay(160)}>
              A client funds each milestone in test ETH. The provider submits evidence, a verifier both sides trust approves it, and the contract releases
              or refunds the ETH by rules fixed in advance.
            </p>
            <div className="enter mt-9 flex flex-wrap gap-3" style={delay(240)}>
              <ButtonLink href="/app">
                Launch App <ArrowRight aria-hidden size={18} />
              </ButtonLink>
              <ButtonLink href="#evidence" variant="secondary">
                Explore Real Settlements
              </ButtonLink>
            </div>
            <p className="enter mt-6 text-sm text-ink-3" style={delay(300)}>
              Built with Fe · No wallet needed to explore · Open source, Apache-2.0
            </p>
          </div>
        </Container>
      </section>

      {/* ---- The problem ---- */}
      <section aria-labelledby="problem" className="border-b border-line">
        <Container className="py-20 md:py-28">
          <SectionHead id="problem" label="The problem" title="Today, one side always goes first." lead="Settlane holds the money in between and settles each milestone on its own, by deadlines and rules both sides can read before they start." />
          <div className="reveal-stagger mt-12 grid gap-4 md:grid-cols-3">
            {PROBLEMS.map((p, i) => (
              <div key={p.title} style={idx(i)} className="card glass card-hover relative flex flex-col overflow-hidden p-7">
                <span aria-hidden className="accent-bar" />
                <span aria-hidden className="icon-tile"><p.icon size={20} /></span>
                <h3 className="text-heading mt-5">{p.title}</h3>
                <p className="mt-2 text-ink-2">{p.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ---- How it works (scroll story) ---- */}
      <section id="how-it-works" aria-labelledby="how" className="scroll-mt-24 border-b border-line">
        <Container className="py-20 md:py-28">
          <SectionHead id="how" label="How it works" title="Fund. Submit. Approve. Claim." lead="Every milestone moves through the same small set of states, one rule at a time. Scroll to follow one, including the refund path." />
          <div className="mt-14">
            <StoryStepper steps={STEPS} />
          </div>
          <p className="mt-8 measure text-sm text-ink-3">
            The verifier is a person or service both sides trust, not an automated oracle. Deadlines are absolute and fixed at creation. Full rules:
            docs/LIFECYCLE.md in the repository.
          </p>
        </Container>
      </section>

      {/* ---- Time-based escrow ---- */}
      <section aria-labelledby="time" className="border-b border-line">
        <Container className="grid gap-14 py-20 md:py-28 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16">
          <div className="min-w-0">
            <SectionHead id="time" label="Time-based escrow" title="Every window is set before the work starts." lead="Deadlines are absolute block timestamps chosen at creation. The contract checks them on every call, so nobody can move them later." />
            <ul className="reveal-stagger mt-10 grid gap-3 sm:grid-cols-2">
              {WINDOWS.map((w, i) => (
                <li key={w.title} style={{ ...idx(i), "--accent": w.tone } as React.CSSProperties} className="card glass relative overflow-hidden p-5">
                  <span aria-hidden className="accent-bar" style={{ scale: "1 1" }} />
                  <p className="text-heading flex items-center gap-2.5">
                    <span aria-hidden className="size-2.5 rounded-full" style={{ background: w.tone }} />
                    {w.title}
                  </p>
                  <p className="mt-2 text-sm text-ink-2">{w.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="reveal min-w-0">
            <DeadlineOrbit />
          </div>
        </Container>
      </section>

      {/* ---- Real settlement evidence ---- */}
      <section id="evidence" aria-labelledby="proof" className="scroll-mt-24 border-b border-line">
        <Container className="py-20 md:py-28">
          <SectionHead id="proof" label="Real settlement evidence" title="Paid and refunded, on Sepolia." lead="Every agreement, event and figure here is read from the chain, with no wallet and no account. Each transaction links to Etherscan." />
          <div className="reveal mt-12">
            <ReplayPanel stories={stories} />
          </div>
          {evidence.length > 0 && (
            <div className="reveal-stagger mt-6 grid gap-4 md:grid-cols-2">
              {evidence.map((e, i) => <EvidenceCard key={e.agreement.id.toString()} e={e} i={i} />)}
            </div>
          )}
          <dl className="card glass reveal mt-6 grid grid-cols-2 gap-6 p-6 sm:grid-cols-4 sm:p-8">
            {figures ? (
              <>
                <div><dt className="text-label">Agreements</dt><dd className="text-numeral mt-2">{figures.count}</dd></div>
                <div><dt className="text-label">Milestones settled</dt><dd className="text-numeral mt-2">{figures.settled}</dd></div>
                <div><dt className="text-label">Held for open milestones</dt><dd className="mt-2"><Amount wei={figures.totalOutstanding} variant="numeral" /></dd></div>
              </>
            ) : (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-label">Live figures</dt>
                <dd className="mt-2 text-ink-2">Unavailable right now: the public Sepolia endpoints did not answer in time.</dd>
              </div>
            )}
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-label">Deployed bytecode</dt>
              <dd className="mt-3 flex items-center gap-2 font-semibold">
                {match === true ? (
                  <><CircleCheck aria-hidden size={19} className="text-paid" /> Equals the build</>
                ) : match === false ? (
                  <><TriangleAlert aria-hidden size={19} className="text-danger" /> Does not match</>
                ) : (
                  <span className="font-normal text-ink-2">Could not be read</span>
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-micro text-ink-3">Figures are read live from Sepolia and refreshed at most once a minute. The cards above are historical transactions.</p>
        </Container>
      </section>

      {/* ---- Built with Fe ---- */}
      <section aria-labelledby="fe" className="border-b border-line">
        <Container className="py-20 md:py-28">
          <SectionHead id="fe" label="Built with Fe" title="Escrow rules the compiler helps enforce." lead="Settlane's contract is written in Fe 26.6, a Rust-inspired language for the EVM. Its effect system makes the money-moving paths explicit." />
          <div className="reveal-stagger mt-12 grid gap-4 lg:grid-cols-3">
            {FE_POINTS.map((p, i) => (
              <div key={p.title} style={idx(i)} className="card glass card-hover relative flex flex-col overflow-hidden p-7">
                <span aria-hidden className="accent-bar" />
                <span aria-hidden className="icon-tile"><p.icon size={20} /></span>
                <h3 className="text-heading mt-5">{p.title}</h3>
                <p className="mb-6 mt-2 text-sm text-ink-2">{p.body}</p>
                <code className="mt-auto block overflow-x-auto rounded-lg border border-line bg-sunken px-3 py-2.5 text-data text-[0.75rem] text-cobalt">{p.code}</code>
              </div>
            ))}
          </div>
          <p className="reveal mt-6 measure text-sm text-ink-3">
            Honest limits: Fe does not stop a read-only entry point from listing Call, so a policy lint and tests close that gap. The verifier remains a trusted
            party.
          </p>
          <div className="reveal mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/contract" variant="secondary">Contract evidence <ArrowRight aria-hidden size={16} /></ButtonLink>
            <a href={REPOSITORY} target="_blank" rel="noreferrer" className="press inline-flex h-12 items-center gap-2 rounded-full px-4 text-[0.9375rem] text-ink-2 hover:text-ink">
              Source code <ArrowUpRight aria-hidden size={16} /><span className="sr-only">(opens in a new tab)</span>
            </a>
            <a href={CI_URL} target="_blank" rel="noreferrer" className="press inline-flex h-12 items-center gap-2 rounded-full px-4 text-[0.9375rem] text-ink-2 hover:text-ink">
              Reproducible tests <ArrowUpRight aria-hidden size={16} /><span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </Container>
      </section>

      {/* ---- Closing call to action ---- */}
      <section aria-labelledby="cta" className="cta relative overflow-hidden">
        <div aria-hidden className="cta-glow pointer-events-none absolute inset-0" />
        <Container className="relative py-24 text-center md:py-32">
          <div className="reveal">
            <h2 id="cta" className="text-display-xl mx-auto max-w-3xl">See value move by the rules.</h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-ink-2">Open the app to create a test agreement, or read the agreements already settled on Sepolia.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/app">Launch App <ArrowRight aria-hidden size={18} /></ButtonLink>
              <ButtonLink href="/explorer" variant="secondary">Explore Agreements</ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

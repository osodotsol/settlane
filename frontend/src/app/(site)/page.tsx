import { ArrowRight, ArrowUpRight, CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
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
import { CodeBlock, type Tok } from "@/ui/CodeBlock";
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
    index: "1",
    state: "funded",
    title: "Fund",
    rule: "The client creates the agreement and locks exactly the sum of its one to three milestones in one call. There is no unfunded agreement.",
    actor: "Client",
    predicate: "msg.value == Σ amounts",
  },
  {
    index: "2",
    state: "submitted",
    title: "Submit",
    rule: "Before the delivery deadline, the provider submits a hash of the delivered work. Resubmitting is allowed until then; each submission gets a new revision number.",
    actor: "Provider",
    predicate: "now < deliver_by",
  },
  {
    index: "3",
    state: "approved",
    title: "Verify",
    rule: "Before the review deadline, the verifier approves the exact evidence and revision, or asks for a revision. A decision about an older submission is refused.",
    actor: "Verifier (trusted)",
    predicate: "now < decide_by and evidence, revision match",
  },
  {
    index: "4",
    state: "paid",
    title: "Settle",
    rule: "The provider claims an approved milestone to an address of its choice. An approval never expires.",
    actor: "Provider",
    predicate: "state == Approved (no deadline)",
  },
  {
    index: "or",
    state: "refunded",
    title: "Refund, if a deadline passes first",
    rule: "If nothing was submitted by the delivery deadline, or nothing was decided by the review deadline, the client may call refund and take the amount back. Nothing refunds by itself, and an approved milestone can never be refunded.",
    actor: "Client",
    predicate: "Funded: now ≥ deliver_by · In review: now ≥ decide_by",
  },
];

const PROBLEMS = [
  { title: "Clients pay before they see the work.", body: "Money sent up front is hard to recover when a delivery never arrives or misses its date." },
  { title: "Providers deliver before they are paid.", body: "Finished work is hard to collect on when the client goes quiet after delivery." },
  { title: "Informal terms are hard to check.", body: "Deadlines, approvals and amounts spread across chats and invoices leave no shared record." },
];

const WINDOWS = [
  { tone: "var(--state-funded)", title: "Delivery window", body: "From creation until deliver_by, the provider may submit evidence, and resubmit while the window is open." },
  { tone: "var(--state-submitted)", title: "Review deadline", body: "The verifier decides before decide_by: the delivery deadline plus the agreement's review period." },
  { tone: "var(--state-refunded)", title: "Refund eligibility", body: "Still Funded at deliver_by, or still in review at decide_by: the client may call refund. It is never automatic." },
  { tone: "var(--state-paid)", title: "Approval never expires", body: "An approved milestone can only be claimed by the provider, at any time, and can never be refunded." },
];

// The featured Fe excerpt from ingots/settlane/src/settlane.fe: re-indented and re-wrapped to fit, other arms and
// storage fields elided; every token shown is in the source. The numbered comments match the explanations beside it.
const FE_EXCERPT: Tok[][] = [
  [["k", "pub contract"], ["p", " "], ["t", "Settlane"], ["p", " "], ["k", "uses"], ["p", " ("]],
  [["p", "  ctx: "], ["t", "Ctx"], ["p", ", call: "], ["k", "mut"], ["p", " "], ["t", "Call"], ["p", ", log: "], ["k", "mut"], ["p", " "], ["t", "Log"], ["p", ","]],
  [["p", ") {"]],
  [["p", "  "], ["k", "recv"], ["p", " "], ["t", "SettleMsg"], ["p", " {"]],
  [["c", "    // 1 · exactly what Submit may touch"]],
  [["p", "    "], ["t", "Submit"], ["p", " { id, m, evidence } "], ["k", "uses"], ["p", " ("]],
  [["p", "      ctx, "], ["k", "mut"], ["p", " log, agreements, "], ["k", "mut"], ["p", " milestones,"]],
  [["p", "    ) {"]],
  [["c", "      // 2 · the clock comes from the block"]],
  [["p", "      "], ["k", "with"], ["p", " ("], ["t", "Clock"], ["p", " = "], ["t", "Clock"], ["p", " { now: "], ["f", "ctx.timestamp()"], ["p", " }) {"]],
  [["p", "        handlers::"], ["f", "submit_handler"], ["p", "(id, m, evidence)"]],
  [["p", "      }"]],
  [["p", "    }"]],
  [["c", "    // 3 · only Claim and Refund list mut call"]],
  [["p", "    "], ["t", "Claim"], ["p", " { id, m, to } -> "], ["t", "Wei"], ["p", " "], ["k", "uses"], ["p", " ("]],
  [["p", "      ctx, "], ["k", "mut"], ["p", " call, "], ["k", "mut"], ["p", " log, "], ["k", "mut"], ["p", " totals,"]],
  [["p", "      "], ["k", "mut"], ["p", " agreements, "], ["k", "mut"], ["p", " milestones,"]],
  [["p", "    ) {"]],
  [["p", "      handlers::"], ["f", "claim_handler"], ["p", "(id, m, to)"]],
  [["p", "    }"]],
  [["c", "    // … Create, Approve, Reject, Refund and four reads"]],
  [["p", "  }"]],
  [["p", "}"]],
];

const FE_POINTS = [
  { title: "Effects declare what each entry point may touch.", body: "Every arm lists its effects with uses. Submit reads the context and agreements, and writes only milestones and the event log." },
  { title: "Time is an effect, supplied once.", body: "Production provides the clock from the block. A test contract in a separate ingot runs the same handlers under a clock the tests can move." },
  { title: "Only two arms can send ETH.", body: "Claim and Refund are the only arms that list Call. A policy lint pins the single approved transfer and locks the sol(..) ABI." },
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

function SectionHead({ id, label, title, lead }: { id: string; label: string; title: string; lead?: string }) {
  return (
    <div className="reveal max-w-2xl">
      <p className="eyebrow">{label}</p>
      <h2 id={id} className="text-display mt-4">{title}</h2>
      {lead && <p className="mt-4 text-ink-2">{lead}</p>}
    </div>
  );
}

function EvidenceCard({ e, i }: { e: Evidence; i: number }) {
  const tone = e.outcome === "paid" ? "var(--state-paid)" : "var(--state-refunded)";
  return (
    <article style={idx(i)} className="min-w-0 border-t border-line pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-heading">
          <Link href={`/agreements/${e.agreement.id}`} className="draw-link">Agreement #{e.agreement.id.toString()}</Link>
        </h3>
        <StateChip state={e.outcome} />
      </div>
      <p className="mt-1 text-sm text-ink-3">
        {formatEth(e.agreement.deposited)} ETH {e.outcome === "paid" ? "paid to the provider" : "refunded to the client"} · historical, verified on Sepolia
      </p>
      <ol className="mt-4 divide-y divide-line/70 text-sm">
        {e.events.map((a) => (
          <li key={`${a.txHash}-${a.logIndex}`} className="grid grid-cols-[0.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-2.5">
            <span aria-hidden className="size-1.5 translate-y-[-1px] rounded-full" style={{ background: a.kind === "claimed" || a.kind === "refunded" ? tone : "var(--line-control)" }} />
            <span className="min-w-0">
              {EVENT_LABEL[a.kind]}
              {a.amount !== undefined && a.kind !== "created" ? <span className="text-ink-2"> · {formatEth(a.amount)} ETH</span> : null}
              <span className="mt-0.5 block text-data text-[0.75rem] text-ink-3">{formatUtc(a.timestamp)}</span>
            </span>
            <a href={txUrl(a.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-data text-[0.75rem] text-ink-3 hover:text-ink">
              <span className="draw-link">{shortHex(a.txHash)}</span> <ExternalLink aria-hidden size={11} />
              <span className="sr-only">(transaction on Sepolia Etherscan, opens in a new tab)</span>
            </a>
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
          <div className="max-w-[40rem]">
            <p className="enter" style={delay(0)}>
              <span className="pill glass">
                <span aria-hidden className="size-2 rounded-full bg-paid" />
                Live on the Sepolia testnet · test ETH only
              </span>
            </p>
            <h1 id="hero" className="enter text-display-2xl mt-7" style={delay(80)}>
              Milestone payments. <span className="text-gradient">Clear rules.</span> Verifiable settlement.
            </h1>
            <p className="enter mt-6 max-w-[34rem] text-[1.0625rem] leading-relaxed text-ink-2" style={delay(160)}>
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
        <Container className="grid gap-12 py-20 md:py-28 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <SectionHead id="problem" label="The problem" title="Today, one side always goes first." />
          <div className="min-w-0">
            <ol className="reveal-stagger space-y-8">
              {PROBLEMS.map((p, i) => (
                <li key={p.title} style={idx(i)} className="ed-item">
                  <span aria-hidden className="text-index">{i + 1}</span>
                  <div>
                    <h3 className="text-heading">{p.title}</h3>
                    <p className="mt-1.5 text-ink-2">{p.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="reveal mt-10 border-l-2 border-cobalt pl-5 text-ink">
              Settlane holds the money in between and settles each milestone on its own, by deadlines and rules both sides can read before they start.
            </p>
          </div>
        </Container>
      </section>

      {/* ---- How it works (scroll story) ---- */}
      <section id="how-it-works" aria-labelledby="how" className="scroll-mt-24 border-b border-line">
        <Container className="py-20 md:py-28">
          <SectionHead id="how" label="How it works" title="Fund. Submit. Verify. Settle." lead="Every milestone moves through the same few states, one rule at a time, and ends exactly one way: paid to the provider or refunded to the client." />
          <div className="mt-14">
            <StoryStepper steps={STEPS} />
          </div>
          <p className="mt-10 measure text-sm text-ink-3">
            The verifier is a person or service both sides trust, not an automated oracle. Deadlines are absolute and fixed at creation. Full rules:
            docs/LIFECYCLE.md in the repository.
          </p>
        </Container>
      </section>

      {/* ---- Time-based escrow ---- */}
      <section aria-labelledby="time" className="border-b border-line">
        <Container className="grid gap-14 py-20 md:py-28 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-20">
          <div className="min-w-0">
            <SectionHead id="time" label="Time-based escrow" title="Every window is set before the work starts." lead="Deadlines are block timestamps chosen at creation. The contract checks them on every call, and nobody can move them later." />
            <dl className="reveal-stagger mt-10 grid gap-x-10 sm:grid-cols-2">
              {WINDOWS.map((w, i) => (
                <div key={w.title} style={idx(i)} className="border-t border-line py-5">
                  <dt className="flex items-center gap-2.5 text-heading">
                    <span aria-hidden className="size-2 rounded-full" style={{ background: w.tone }} />
                    {w.title}
                  </dt>
                  <dd className="mt-1.5 text-sm text-ink-2">{w.body}</dd>
                </div>
              ))}
            </dl>
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
            <div className="reveal-stagger mt-14 grid gap-x-14 gap-y-10 md:grid-cols-2">
              {evidence.map((e, i) => <EvidenceCard key={e.agreement.id.toString()} e={e} i={i} />)}
            </div>
          )}
          <dl className="reveal mt-14 grid grid-cols-2 gap-y-8 border-y border-line py-7 sm:grid-cols-4 sm:divide-x sm:divide-line">
            {figures ? (
              <>
                <div className="sm:pr-6"><dt className="text-sm text-ink-3">Agreements</dt><dd className="text-numeral mt-1.5">{figures.count}</dd></div>
                <div className="sm:px-6"><dt className="text-sm text-ink-3">Milestones settled</dt><dd className="text-numeral mt-1.5">{figures.settled}</dd></div>
                <div className="sm:px-6"><dt className="text-sm text-ink-3">Held for open milestones</dt><dd className="mt-1.5"><Amount wei={figures.totalOutstanding} variant="numeral" /></dd></div>
              </>
            ) : (
              <div className="col-span-2 sm:col-span-3 sm:pr-6">
                <dt className="text-sm text-ink-3">Live figures</dt>
                <dd className="mt-1.5 text-ink-2">Unavailable right now: the public Sepolia endpoints did not answer in time.</dd>
              </div>
            )}
            <div className="col-span-2 sm:col-span-1 sm:pl-6">
              <dt className="text-sm text-ink-3">Deployed bytecode</dt>
              <dd className="mt-2.5 flex items-center gap-2 font-medium">
                {match === true ? (
                  <><CircleCheck aria-hidden size={18} className="text-paid" /> Equals the build</>
                ) : match === false ? (
                  <><TriangleAlert aria-hidden size={18} className="text-danger" /> Does not match</>
                ) : (
                  <span className="font-normal text-ink-2">Could not be read</span>
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-micro text-ink-3">Figures are read live from Sepolia and refreshed at most once a minute. The agreements above are historical transactions.</p>
        </Container>
      </section>

      {/* ---- Built with Fe ---- */}
      <section aria-labelledby="fe" className="border-b border-line">
        <Container className="grid gap-14 py-20 md:py-28 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div className="min-w-0">
            <SectionHead id="fe" label="Built with Fe" title="Escrow rules the compiler helps enforce." lead="The contract is written in Fe 26.6, a Rust-inspired language for the EVM. Its effect system makes the money-moving paths explicit." />
            <ol className="reveal-stagger mt-10 space-y-6">
              {FE_POINTS.map((p, i) => (
                <li key={p.title} style={idx(i)} className="ed-item pt-5">
                  <span aria-hidden className="text-index text-[1.625rem]">{i + 1}</span>
                  <div>
                    <h3 className="text-heading">{p.title}</h3>
                    <p className="mt-1 text-sm text-ink-2">{p.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="reveal mt-8 text-sm text-ink-3">
              Honest limits: Fe does not stop a read-only entry point from listing Call, so a policy lint and tests close that gap. The verifier remains a
              trusted party.
            </p>
            <p className="reveal mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Link href="/contract" className="draw-link inline-flex items-center gap-1.5 font-medium text-ink">Contract evidence <ArrowRight aria-hidden size={15} /></Link>
              <a href={REPOSITORY} target="_blank" rel="noreferrer" className="draw-link inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
                Source code <ArrowUpRight aria-hidden size={15} /><span className="sr-only">(opens in a new tab)</span>
              </a>
              <a href={CI_URL} target="_blank" rel="noreferrer" className="draw-link inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
                Reproducible tests <ArrowUpRight aria-hidden size={15} /><span className="sr-only">(opens in a new tab)</span>
              </a>
            </p>
          </div>
          <div className="reveal min-w-0 lg:pt-14">
            <CodeBlock lines={FE_EXCERPT} label="ingots/settlane/src/settlane.fe · excerpt" footer={<>From the deployed source, re-wrapped to fit; storage fields and other arms elided.</>} />
          </div>
        </Container>
      </section>

      {/* ---- Closing call to action ---- */}
      <section aria-labelledby="cta" className="cta relative overflow-hidden">
        <div aria-hidden className="cta-glow pointer-events-none absolute inset-0" />
        <Container className="relative py-24 md:py-28">
          <div className="reveal flex flex-col items-start justify-between gap-8 border-t border-line pt-12 md:flex-row md:items-end">
            <div className="max-w-xl">
              <h2 id="cta" className="text-display">See value move by the rules.</h2>
              <p className="mt-3 text-ink-2">Open the app to create a test agreement, or read the agreements already settled on Sepolia.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/app">Launch App <ArrowRight aria-hidden size={18} /></ButtonLink>
              <ButtonLink href="/explorer" variant="secondary">Explore Agreements</ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

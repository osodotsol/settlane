import { ArrowRight, CircleCheck, TriangleAlert } from "lucide-react";
import { RUNTIME_SHA256, REPOSITORY } from "@/config/chain";
import { getActivity, getAgreement, getDeployedCodeHash, getOverview } from "@/contract/data";
import { buildReplay, type ReplayStory } from "@/domain/replay";
import { sampleAgreement } from "@/domain/sample";
import { Amount } from "@/ui/Amount";
import { ButtonLink } from "@/ui/Button";
import { CodeBlock, type Tok } from "@/ui/CodeBlock";
import { Container } from "@/ui/Container";
import { ReplayPanel } from "@/ui/ReplayPanel";
import { StateChip } from "@/ui/StateChip";
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

const OUTCOMES = [
  {
    state: "paid" as const,
    title: "The work was approved.",
    body: "The verifier accepted the exact evidence. The provider claims the amount, at any time: an approval never expires.",
    money: "Paid to the provider",
  },
  {
    state: "refunded" as const,
    title: "A deadline passed first.",
    body: "Nothing was submitted by the delivery deadline, or nothing was decided by the review deadline. The client takes it back.",
    money: "Refunded to the client",
  },
  {
    state: "submitted" as const,
    title: "Still in progress.",
    body: "Funded, in review or approved but not yet claimed. Nobody can move the money except by the rules above.",
    money: "Held by the contract",
  },
];

const ROLES = [
  {
    name: "Client",
    accent: "var(--state-funded)",
    line: "Funds the work and takes back what expires.",
    can: ["Creates and funds the agreement", "Refunds a milestone whose deadline passed"],
  },
  {
    name: "Provider",
    accent: "var(--state-paid)",
    line: "Delivers the work and claims what is approved.",
    can: ["Submits evidence of the work", "Claims an approved milestone"],
  },
  {
    name: "Verifier",
    accent: "var(--state-approved)",
    line: "Decides whether the work is accepted. Trusted.",
    can: ["Approves or asks for a revision", "Never touches the money"],
  },
];

const PROBLEMS = [
  {
    who: "For the client",
    accent: "var(--state-funded)",
    pain: "Money sent before delivery is hard to get back when the work never arrives.",
    fix: "The money waits in the contract and comes back if the deadline passes.",
  },
  {
    who: "For the provider",
    accent: "var(--state-paid)",
    pain: "Work delivered before payment is hard to collect when the client goes quiet.",
    fix: "The money is locked before work starts. Approved work is yours to claim.",
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

async function loadStories(): Promise<ReplayStory[]> {
  try {
    const [one, two, history] = await Promise.all([getAgreement(1n), getAgreement(2n), getActivity()]);
    const stories = [one, two]
      .map((v) => v.value.agreement)
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map((a) => buildReplay(a, history.value));
    if (stories.length > 0) return stories;
  } catch {
    /* fall through to the labelled illustration */
  }
  const s = sampleAgreement();
  return [buildReplay(s.agreement, s.activity, true)];
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
    <div className="reveal max-w-3xl">
      <p className="text-label">{label}</p>
      <h2 id={id} className="text-display mt-3">{title}</h2>
      {lead && <p className="mt-4 text-lg text-ink-2">{lead}</p>}
    </div>
  );
}

export default async function Home() {
  const [stories, figures, match] = await Promise.all([loadStories(), loadFigures(), loadCodeMatch()]);

  return (
    <>
      {/* ---- Hero ---- */}
      <section className="border-b border-line">
        <Container className="pb-16 pt-16 text-center sm:pb-20 sm:pt-24">
          <p className="enter flex justify-center" style={delay(0)}>
            <span className="pill">
              <span aria-hidden className="size-2 rounded-full bg-paid" />
              Live on the Sepolia testnet · test ETH only
            </span>
          </p>
          <h1 className="enter text-display-2xl mx-auto mt-8 max-w-5xl" style={delay(80)}>
            Pay for work one milestone at a time, <span className="text-cobalt">by rules fixed in advance.</span>
          </h1>
          <p className="enter mx-auto mt-7 max-w-2xl text-lg text-ink-2 sm:text-xl" style={delay(160)}>
            Settlane is a smart contract written in Fe. A client locks test ETH for each milestone. A verifier both sides trust approves the work. The
            provider claims what was approved, and the client takes back what expired.
          </p>
          <div className="enter mt-9 flex flex-wrap justify-center gap-3" style={delay(240)}>
            <ButtonLink href="/explorer">
              Explore live agreements <ArrowRight aria-hidden size={18} />
            </ButtonLink>
            <ButtonLink href="#how-it-settles" variant="secondary">
              How a milestone settles
            </ButtonLink>
          </div>
          <p className="enter mt-6 text-sm text-ink-3" style={delay(300)}>
            No wallet needed to explore. Open source, Apache-2.0.
          </p>
          <div className="enter mt-14 sm:mt-16" style={delay(360)}>
            <ReplayPanel stories={stories} />
          </div>
        </Container>
      </section>

      {/* ---- The problem ---- */}
      <section aria-labelledby="problem" className="border-b border-line">
        <Container className="py-20 md:py-28">
          <SectionHead id="problem" label="The problem" title="Today, one side always goes first." lead="Settlane holds the money in between and releases each milestone on its own, by deadlines and rules both sides can read before they start." />
          <div className="reveal-stagger mt-12 grid gap-4 md:grid-cols-2">
            {PROBLEMS.map((p, i) => (
              <div key={p.who} style={{ ...idx(i), "--accent": p.accent } as React.CSSProperties} className="card card-hover relative flex flex-col overflow-hidden p-7">
                <span aria-hidden className="accent-bar" />
                <h3 className="text-title">{p.who}</h3>
                <p className="mb-6 mt-3 text-ink-2">{p.pain}</p>
                <p className="mt-auto flex items-start gap-3 border-t border-line pt-5 text-sm">
                  <span aria-hidden className="accent-dot mt-1.5 size-2 shrink-0 rounded-full" style={{ background: p.accent }} />
                  <span>
                    <span className="font-semibold">With Settlane: </span>
                    <span className="text-ink-2">{p.fix}</span>
                  </span>
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ---- Outcomes ---- */}
      <section aria-labelledby="outcomes" className="border-b border-line">
        <Container className="py-20 md:py-28">
          <SectionHead id="outcomes" label="Outcomes" title="Paid or refunded. Never both." lead="Every milestone ends exactly one way, and the money follows the state." />
          <div className="reveal-stagger mt-12 grid gap-4 md:grid-cols-3">
            {OUTCOMES.map((o, i) => (
              <div key={o.state} style={{ ...idx(i), "--accent": `var(--state-${o.state})` } as React.CSSProperties} className="card card-hover relative flex flex-col overflow-hidden p-7">
                <span aria-hidden className="accent-bar" />
                <div><StateChip state={o.state} /></div>
                <h3 className="text-title mt-5">{o.title}</h3>
                <p className="mb-8 mt-3 text-ink-2">{o.body}</p>
                <div className="mt-auto flex items-center justify-between gap-4 border-t border-line pt-5 text-sm">
                  <span className="text-ink-3">Money</span>
                  <span className="font-semibold">{o.money}</span>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ---- How a milestone settles (scroll story) ---- */}
      <section id="how-it-settles" aria-labelledby="how" className="scroll-mt-24 border-b border-line">
        <Container className="py-20 md:py-28">
          <SectionHead id="how" label="How it works" title="How a milestone settles" lead="Every milestone moves through the same small set of states, one rule at a time. Scroll to follow one." />
          <div className="mt-14">
            <StoryStepper steps={STEPS} />
          </div>
          <p className="mt-8 measure text-sm text-ink-3">
            Deadlines are absolute and fixed at creation. Submission and refund can never both be open at the same moment, and neither can review and
            refund. Full rules: docs/LIFECYCLE.md in the repository.
          </p>
        </Container>
      </section>

      {/* ---- Roles ---- */}
      <section aria-labelledby="roles" className="border-b border-line">
        <Container className="py-20 md:py-28">
          <SectionHead id="roles" label="Roles" title="Three parties, three jobs" />
          <div className="reveal-stagger mt-12 grid gap-4 md:grid-cols-3">
            {ROLES.map((r, i) => (
              <div key={r.name} style={{ ...idx(i), "--accent": r.accent } as React.CSSProperties} className="card card-hover relative flex flex-col overflow-hidden p-7">
                <span aria-hidden className="accent-bar" />
                <h3 className="flex items-center gap-3 text-title">
                  <span aria-hidden className="accent-dot size-2.5 rounded-full" style={{ background: r.accent }} />
                  {r.name}
                </h3>
                <p className="mb-6 mt-3 text-ink-2">{r.line}</p>
                <ul className="mt-auto space-y-2 border-t border-line pt-5 text-sm text-ink-2">
                  {r.can.map((c) => (
                    <li key={c} className="flex gap-2.5">
                      <span aria-hidden className="mt-2 h-px w-3 shrink-0 bg-line-control" />
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
        <Container className="py-20 md:py-28">
          <div className="card reveal grid gap-12 p-7 sm:p-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
            <div>
              <p className="text-label">Evidence</p>
              <h2 id="proof" className="text-display mt-3">Proof anyone can check.</h2>
              <p className="mt-4 text-ink-2">
                Every agreement, event and figure on this site is read straight from Sepolia, with no wallet and no account. Nothing here asks you to trust
                the website.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/explorer">Open the explorer</ButtonLink>
                <ButtonLink href="/contract" variant="secondary">Contract evidence</ButtonLink>
              </div>
            </div>
            <ol className="space-y-2">
              {[
                ["The bytecode.", "The deployed code hashes to the open-source Fe 26.6.0 build, byte for byte."],
                ["The transactions.", "Every agreement and every event links to its transaction on Sepolia."],
                ["The accounting.", "Deposited equals paid plus refunded plus outstanding, checked against each milestone."],
                ["The tests.", "90 Fe tests, a local-chain suite on the real bytecode, and CI on every push."],
              ].map(([lead, text], i) => (
                <li key={lead} className="group -mx-3 flex gap-4 rounded-xl px-3 py-2 transition-colors duration-[var(--dur-hover)] hover:bg-sunken/70">
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-sm font-semibold text-ink-2 transition-colors duration-[var(--dur-hover)] group-hover:border-cobalt group-hover:text-cobalt">{i + 1}</span>
                  <p className="pt-0.5"><span className="font-semibold">{lead}</span> <span className="text-ink-2">{text}</span></p>
                </li>
              ))}
            </ol>
            <dl className="grid grid-cols-2 gap-6 border-t border-line pt-8 sm:grid-cols-4 lg:col-span-2">
              {figures ? (
                <>
                  <div><dt className="text-label">Agreements</dt><dd className="text-numeral mt-2">{figures.count}</dd></div>
                  <div><dt className="text-label">Milestones settled</dt><dd className="text-numeral mt-2">{figures.settled}</dd></div>
                  <div><dt className="text-label">Held for open milestones</dt><dd className="mt-2"><Amount wei={figures.totalOutstanding} variant="numeral" /></dd></div>
                </>
              ) : (
                <p className="col-span-2 text-ink-2 sm:col-span-3">Live figures are unavailable right now: the public Sepolia endpoints did not answer.</p>
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
          </div>
        </Container>
      </section>

      {/* ---- Built with Fe ---- */}
      <section aria-labelledby="fe" className="border-b border-line">
        <Container className="grid gap-12 py-20 md:py-28 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-16">
          <div className="reveal min-w-0">
            <p className="text-label">Built with Fe</p>
            <h2 id="fe" className="text-display mt-3">Time is an effect.</h2>
            <p className="mt-4 text-ink-2">
              The production contract supplies the clock from the block, and nothing else. A test contract runs the identical rules under a clock the tests
              can move, so every deadline is tested on both sides of the line.
            </p>
            <p className="mt-4 text-sm text-ink-3">
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
          <SectionHead id="limits" label="Limitations" title="What Settlane does not do" />
          <ul className="reveal-stagger mt-12 grid gap-4 md:grid-cols-2">
            {LIMITS.map(([t, d], i) => (
              <li key={t} style={idx(i)} className="card card-hover relative overflow-hidden p-7">
                <span aria-hidden className="accent-bar" />
                <p className="text-heading">{t}</p>
                <p className="mt-2 text-ink-2">{d}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm text-ink-3">
            Source, tests and the full security model:{" "}
            <a className="draw-link text-ink-2 hover:text-ink" href={REPOSITORY}>github.com/osodotsol/settlane</a>
          </p>
        </Container>
      </section>

      {/* ---- Closing call to action ---- */}
      <section aria-labelledby="cta">
        <Container className="py-20 text-center md:py-28">
          <div className="reveal">
            <h2 id="cta" className="text-display-xl mx-auto max-w-3xl">See it settle, on-chain.</h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-ink-2">Two real agreements, one paid and one refunded, with every transaction linked to Sepolia.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/agreements/1">Read agreement #1 <ArrowRight aria-hidden size={18} /></ButtonLink>
              <ButtonLink href="/explorer" variant="secondary">All agreements</ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

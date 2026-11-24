import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CI_URL, DEPLOY_BLOCK, DEPLOY_TX, FE_VERSION, HISTORY_RPC_URLS, REPOSITORY, RPC_URLS, RUNTIME_SHA256, SETTLANE_ADDRESS, txUrl } from "@/config/chain";
import { settlaneAbi } from "@/contract/abi";
import { getDeployedCodeHash, getHistory } from "@/contract/data";
import { HistoryNotice } from "@/ui/HistoryNotice";
import type { Activity, ActivityKind } from "@/contract/events";
import { formatUtc, shortHex } from "@/domain/format";
import { Address } from "@/ui/Address";
import { Banner } from "@/ui/Banner";
import { CodeBlock, type Tok } from "@/ui/CodeBlock";
import { CommandBlock } from "@/ui/CommandBlock";
import { Container } from "@/ui/Container";
import { VerificationSeal } from "@/ui/VerificationSeal";

export const metadata: Metadata = { title: "Contract evidence" };
export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<ActivityKind, string> = {
  created: "Agreement created",
  submitted: "Evidence submitted",
  approved: "Approved",
  rejected: "Revision requested",
  claimed: "Claimed",
  refunded: "Refunded",
};

const CALLER: Record<string, string> = {
  create: "Anyone (becomes the client)",
  submit: "Provider",
  approve: "Verifier",
  reject: "Verifier",
  claim: "Provider",
  refund: "Client",
};

type Fn = { type: "function"; name: string; inputs: readonly { type: string }[]; outputs: readonly { type: string }[]; stateMutability: string };
type Ev = { type: "event"; name: string; inputs: readonly { type: string; indexed?: boolean }[] };

const LIMITS = [
  "The verifier is trusted: its approval or revision request is final, and Settlane cannot check the work. There is no appeal.",
  "Unaudited prototype on the Sepolia testnet, built with a pre-1.0 compiler. Test ETH only.",
  "No owner, admin or recovery path, by design: a lost provider key locks an approved milestone, a lost client key locks an expired one.",
  "Payouts forward only the 2,300-gas stipend; a smart-contract wallet that needs more cannot receive directly, so the caller chooses the address.",
  "The client alone sets deadlines and the review period at creation; the provider does not accept them on-chain.",
  "ETH sent to the contract outside an agreement (for example forced in) is stranded; the invariant is balance ≥ outstanding.",
];

const FE_LINES: Tok[][] = [
  [["c", "// the production Submit arm: a thin shell around a shared handler"]],
  [["t", "Submit"], ["p", " { id, m, evidence } "], ["k", "uses"], ["p", " (ctx, "], ["k", "mut"], ["p", " log, agreements, "], ["k", "mut"], ["p", " milestones) {"]],
  [["p", "    "], ["k", "with"], ["p", " ("], ["t", "Clock"], ["p", " = "], ["t", "Clock"], ["p", " { now: "], ["f", "ctx.timestamp()"], ["p", " }) {"]],
  [["p", "        handlers::"], ["f", "submit_handler"], ["p", "(id, m, evidence)"]],
  [["p", "    }"]],
  [["p", "}"]],
];

const idx = (i: number) => ({ "--i": i }) as React.CSSProperties;
const delay = (ms: number) => ({ "--d": ms }) as React.CSSProperties;

export default async function ContractPage() {
  const [code, activity] = await Promise.allSettled([getDeployedCodeHash(), getHistory()]);
  const live = code.status === "fulfilled" ? code.value.value : null;
  const status = live === null ? "unknown" : live.sha256 === RUNTIME_SHA256 ? "match" : "mismatch";

  // One row per transaction, in chain order; the deployment first.
  const txs = new Map<string, Activity[]>();
  if (activity.status === "fulfilled") for (const a of activity.value.value.events) txs.set(a.txHash, [...(txs.get(a.txHash) ?? []), a]);

  const fns = settlaneAbi.filter((x) => x.type === "function") as unknown as Fn[];
  const events = settlaneAbi.filter((x) => x.type === "event") as unknown as Ev[];
  const writes = fns.filter((f) => f.stateMutability !== "view");
  const reads = fns.filter((f) => f.stateMutability === "view");

  const signature = (f: Fn) => `${f.name}(${f.inputs.map((i) => i.type).join(", ")})`;

  return (
    <Container className="py-12 sm:py-16">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16">
        <div className="enter" style={delay(0)}>
          <p className="eyebrow">Developers</p>
          <h1 className="text-display-xl mt-3">Contract evidence</h1>
          <p className="mt-5 measure text-lg text-ink-2">
            What is deployed, where, and how to check it yourself. Everything on this page is read from Sepolia or from the open-source repository, and
            nothing here asks you to trust this website.
          </p>
        </div>
        <div className="enter" style={delay(160)}>
          <VerificationSeal status={status} pinned={RUNTIME_SHA256} live={live?.sha256 ?? null} bytes={live?.bytes ?? null} />
        </div>
      </div>

      <section aria-labelledby="deployment" className="mt-20">
        <h2 id="deployment" className="text-title reveal">Deployment</h2>
        <dl className="card reveal-stagger mt-6 grid gap-x-10 px-6 md:grid-cols-2 sm:px-8">
          <div style={idx(0)} className="border-b border-line py-5 [&:nth-last-child(-n+2)]:md:border-b-0 last:border-b-0"><dt className="text-sm text-ink-3">Network</dt><dd className="mt-1">Ethereum Sepolia testnet (chain id 11155111), test ETH only</dd></div>
          <div style={idx(1)} className="border-b border-line py-5 [&:nth-last-child(-n+2)]:md:border-b-0 last:border-b-0"><dt className="text-sm text-ink-3">Contract</dt><dd className="mt-1"><Address address={SETTLANE_ADDRESS} /></dd></div>
          <div style={idx(2)} className="border-b border-line py-5 [&:nth-last-child(-n+2)]:md:border-b-0 last:border-b-0">
            <dt className="text-sm text-ink-3">Deployment transaction</dt>
            <dd className="mt-1">
              <a href={txUrl(DEPLOY_TX)} target="_blank" rel="noreferrer" className="draw-link text-data">{shortHex(DEPLOY_TX, 10, 8)}</a>{" "}
              <span className="text-sm text-ink-3">block {DEPLOY_BLOCK.toString()}</span>
            </dd>
          </div>
          <div style={idx(3)} className="border-b border-line py-5 [&:nth-last-child(-n+2)]:md:border-b-0 last:border-b-0"><dt className="text-sm text-ink-3">Compiler</dt><dd className="mt-1 text-data">{FE_VERSION}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="fe-code" className="mt-20 grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-14">
        <div className="reveal min-w-0">
          <h2 id="fe-code" className="text-title">Built with Fe: time is an effect</h2>
          <p className="mt-3 measure text-ink-2">
            The production contract supplies the clock from the block, and nothing else. A test contract in a separate ingot runs the identical rules under a
            clock the tests can move, so every deadline is tested on both sides of the line.
          </p>
          <p className="mt-3 measure text-sm text-ink-3">
            The compiler blocks a handler that does not list the Call effect from sending ETH. It does not stop an entry point that lists Call read-only, so a
            policy lint and tests close that gap.
          </p>
        </div>
        <div className="reveal min-w-0">
          <CodeBlock lines={FE_LINES} label="ingots/settlane/src/settlane.fe" footer={<>The only place the production contract reads time is <span className="text-data text-[0.8125rem]">ctx.timestamp()</span>, enforced by a lint rule.</>} />
        </div>
      </section>

      <section id="tests" aria-labelledby="verify" className="mt-20">
        <h2 id="verify" className="text-title reveal">Verify it yourself</h2>
        <p className="reveal mt-1 measure text-sm text-ink-3">
          Three commands from a checkout of the repository. They rebuild the contract with {FE_VERSION}, compare it with the pinned hashes, and compare the
          deployed bytecode and every event with a fresh build. All read-only.
        </p>
        <ol className="reveal-stagger mt-7 space-y-6">
          {[
            ["Build the production contract", "rm -rf out && fe build"],
            ["Check the build against the pinned hashes", "python3 experiments/sepolia/testnet.py artifact"],
            [
              "Compare the deployed bytecode, replay every event, check the accounting",
              `python3 experiments/sepolia/verify_deployment.py --rpc-url https://ethereum-sepolia-rpc.publicnode.com --address ${SETTLANE_ADDRESS} --from-block ${DEPLOY_BLOCK}`,
            ],
          ].map(([what, cmd], i) => (
            <li key={cmd} style={idx(i)} className="grid gap-3 md:grid-cols-[2.5rem_1fr] md:gap-5">
              <span aria-hidden className="grid size-10 place-items-center rounded-full border border-line text-sm font-semibold text-ink-2">{i + 1}</span>
              <div>
                <p className="mb-2 font-medium">{what}</p>
                <CommandBlock command={cmd as string} label={`command: ${what}`} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="transactions" className="mt-20">
        <h2 id="transactions" className="text-title reveal">Transactions</h2>
        <p className="reveal mt-1 text-sm text-ink-3">The deployment, then every transaction that emitted a Settlane event, in chain order.</p>
        {activity.status === "fulfilled" && <HistoryNotice status={activity.value.value.status} className="mt-4" />}
        {activity.status === "rejected" ? (
          <div className="mt-4"><Banner title="The event history could not be read right now">Reload to try again.</Banner></div>
        ) : (
          <ol className="card mt-6 divide-y divide-line overflow-hidden text-sm">
            <li className="grid gap-1 px-5 py-3.5 transition-colors hover:bg-sunken sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-4 sm:px-6">
              <span className="text-data text-ink-3">{DEPLOY_BLOCK.toString()}</span>
              <span>Contract deployed</span>
              <a href={txUrl(DEPLOY_TX)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-data text-ink-2 hover:text-ink">
                <span className="draw-link">{shortHex(DEPLOY_TX)}</span> <ExternalLink aria-hidden size={13} /><span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
            {[...txs.entries()].map(([hash, acts]) => (
              <li key={hash} className="grid gap-1 px-5 py-3.5 transition-colors hover:bg-sunken sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-4 sm:px-6">
                <span className="text-data text-ink-3">{acts[0]!.blockNumber.toString()}</span>
                <span>
                  {acts.map((a) => EVENT_LABEL[a.kind]).join(", ")} ·{" "}
                  <Link href={`/agreements/${acts[0]!.id}`} className="draw-link">agreement #{acts[0]!.id.toString()}</Link>{" "}
                  <span className="text-ink-3">· {formatUtc(acts[0]!.timestamp)}</span>
                </span>
                <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-data text-ink-2 hover:text-ink">
                  <span className="draw-link">{shortHex(hash)}</span> <ExternalLink aria-hidden size={13} /><span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="interface" className="mt-20">
        <h2 id="interface" className="text-title reveal">Interface</h2>
        <p className="reveal mt-1 text-sm text-ink-3">The ABI produced by the Fe build, locked by the repository&apos;s policy lint. Six writes and four reads.</p>
        <div className="card mt-6 grid gap-10 p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="mb-3 text-left font-medium">Writes: these change state</caption>
              <thead className="border-b border-line-control text-ink-3">
                <tr><th scope="col" className="py-2 pr-4 font-medium">Function</th><th scope="col" className="py-2 font-medium">Who can call it</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {writes.map((f) => (
                  <tr key={f.name} className="transition-colors hover:bg-sunken">
                    <td className="py-2.5 pr-4 text-data [overflow-wrap:anywhere]">{signature(f)}{f.stateMutability === "payable" && <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 font-sans text-micro text-ink-2">takes ETH</span>}</td>
                    <td className="whitespace-nowrap py-2.5"><span className="rounded-full border border-line-control px-2.5 py-0.5 text-micro">{CALLER[f.name]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="mb-3 text-left font-medium">Reads: free and public</caption>
              <thead className="border-b border-line-control text-ink-3">
                <tr><th scope="col" className="py-2 font-medium">Function</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {reads.map((f) => (
                  <tr key={f.name} className="transition-colors hover:bg-sunken"><td className="py-2.5 text-data [overflow-wrap:anywhere]">{signature(f)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-6 text-sm text-ink-2">
          Events: {events.map((e) => <span key={e.name} className="text-data mr-3 inline-block">{e.name}</span>)}
        </p>
      </section>

      <section id="limitations" aria-labelledby="limits" className="mt-20">
        <h2 id="limits" className="text-title reveal">Security &amp; limitations</h2>
        <p className="reveal mt-1 measure text-sm text-ink-3">Verified against the contract and its tests. Read these before funding an agreement or choosing a verifier.</p>
        <ol className="card reveal-stagger mt-6 divide-y divide-line px-6 sm:px-8">
          {LIMITS.map((t, i) => (
            <li key={t} style={idx(i)} className="grid gap-3 py-5 sm:grid-cols-[3rem_1fr]">
              <span aria-hidden className="grid size-8 place-items-center rounded-full border border-line text-sm font-semibold text-ink-2">{i + 1}</span>
              <p className="measure">{t}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-ink-2" id="privacy">
          Reading the chain: your browser reads Sepolia directly from public, keyless nodes ({[...new Set([...RPC_URLS, ...HISTORY_RPC_URLS].map((u) => new URL(u).hostname))].join(", ")}). Their operators can see your IP address and which accounts and agreements the page asks about. Settlane adds no analytics or tracking of its own, and your wallet signs only in the wallet.
        </p>
        <p className="mt-3 text-sm text-ink-3">
          Source, tests and the full security model:{" "}
          <a href={REPOSITORY} target="_blank" rel="noreferrer" className="draw-link text-ink-2 hover:text-ink">github.com/osodotsol/settlane<span className="sr-only"> (opens in a new tab)</span></a> · Continuous integration:{" "}
          <a href={CI_URL} target="_blank" rel="noreferrer" className="draw-link text-ink-2 hover:text-ink">GitHub Actions<span className="sr-only"> (opens in a new tab)</span></a>
        </p>
      </section>
    </Container>
  );
}

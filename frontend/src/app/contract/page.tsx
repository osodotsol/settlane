import { CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CI_URL, DEPLOY_BLOCK, DEPLOY_TX, FE_VERSION, REPOSITORY, RUNTIME_SHA256, SETTLANE_ADDRESS, txUrl } from "@/config/chain";
import { settlaneAbi } from "@/contract/abi";
import { getActivity, getDeployedCodeHash } from "@/contract/data";
import type { Activity, ActivityKind } from "@/contract/events";
import { formatUtc, shortHex } from "@/domain/format";
import { Address } from "@/ui/Address";
import { Banner } from "@/ui/Banner";
import { Container } from "@/ui/Container";

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
  create: "anyone (becomes the client)",
  submit: "provider",
  approve: "verifier",
  reject: "verifier",
  claim: "provider",
  refund: "client",
};

type Fn = { type: "function"; name: string; inputs: readonly { type: string }[]; outputs: readonly { type: string }[]; stateMutability: string };
type Ev = { type: "event"; name: string; inputs: readonly { type: string; indexed?: boolean }[] };

export default async function ContractPage() {
  const [code, activity] = await Promise.allSettled([getDeployedCodeHash(), getActivity()]);
  const live = code.status === "fulfilled" ? code.value.value : null;
  const matches = live?.sha256 === RUNTIME_SHA256;

  // One row per transaction, newest last (chain order); the deployment first.
  const txs = new Map<string, Activity[]>();
  if (activity.status === "fulfilled") for (const a of activity.value.value) txs.set(a.txHash, [...(txs.get(a.txHash) ?? []), a]);

  const fns = settlaneAbi.filter((x) => x.type === "function") as unknown as Fn[];
  const events = settlaneAbi.filter((x) => x.type === "event") as unknown as Ev[];

  return (
    <Container className="py-14">
      <h1 className="text-display">Contract evidence</h1>
      <p className="mt-3 measure text-ink-2">
        What is deployed, where, and how to check it yourself. Everything on this page is read from Sepolia or from the open-source repository.
      </p>

      <section aria-labelledby="deployment" className="mt-12">
        <h2 id="deployment" className="text-title">Deployment</h2>
        <dl className="mt-5 grid gap-x-10 gap-y-5 md:grid-cols-2">
          <div><dt className="text-sm text-ink-3">Network</dt><dd className="mt-1">Ethereum Sepolia testnet (chain id 11155111), test ETH only</dd></div>
          <div><dt className="text-sm text-ink-3">Contract</dt><dd className="mt-1"><Address address={SETTLANE_ADDRESS} /></dd></div>
          <div>
            <dt className="text-sm text-ink-3">Deployment transaction</dt>
            <dd className="mt-1">
              <a href={txUrl(DEPLOY_TX)} target="_blank" rel="noreferrer" className="text-data underline decoration-line-control underline-offset-4 hover:decoration-cobalt">
                {shortHex(DEPLOY_TX, 10, 8)}
              </a>{" "}
              <span className="text-sm text-ink-3">block {DEPLOY_BLOCK.toString()}</span>
            </dd>
          </div>
          <div><dt className="text-sm text-ink-3">Compiler</dt><dd className="mt-1 text-data">{FE_VERSION}</dd></div>
          <div className="md:col-span-2">
            <dt className="text-sm text-ink-3">Runtime code SHA-256</dt>
            <dd className="mt-1 space-y-2">
              <p><span className="text-sm text-ink-3">Open-source build (pinned):</span> <span className="text-data break-all">{RUNTIME_SHA256}</span></p>
              {live ? (
                <p className={`flex flex-wrap items-center gap-2 ${matches ? "text-paid" : "text-danger"}`}>
                  {matches ? <CircleCheck aria-hidden size={16} /> : <TriangleAlert aria-hidden size={16} />}
                  <span>
                    Deployed code, read now ({live.bytes.toLocaleString("en-US")} bytes): <span className="text-data break-all">{live.sha256}</span>{" "}
                    {matches ? "matches the build" : "does NOT match the build"}
                  </span>
                </p>
              ) : (
                <p className="text-ink-2">The deployed code could not be read right now.</p>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-6 measure text-sm text-ink-3">
          Reproduce it: build with <span className="text-data">{FE_VERSION}</span> (<span className="text-data">rm -rf out && fe build</span>) and compare, or run the
          repository&apos;s read-only verifier, which rebuilds, compares the bytecode and replays every event.
        </p>
      </section>

      <section aria-labelledby="transactions" className="mt-14">
        <h2 id="transactions" className="text-title">Transactions</h2>
        <p className="mt-1 text-sm text-ink-3">The deployment, then every transaction that emitted a Settlane event, in chain order.</p>
        {activity.status === "rejected" ? (
          <div className="mt-4"><Banner title="The event history could not be read right now">Reload to try again.</Banner></div>
        ) : (
          <ol className="mt-4 divide-y divide-line border-y border-line text-sm">
            <li className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-4">
              <span className="text-data text-ink-3">{DEPLOY_BLOCK.toString()}</span>
              <span>Contract deployed</span>
              <a href={txUrl(DEPLOY_TX)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-data text-ink-2 underline decoration-line-control underline-offset-4">
                {shortHex(DEPLOY_TX)} <ExternalLink aria-hidden size={13} /><span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
            {[...txs.entries()].map(([hash, acts]) => (
              <li key={hash} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-4">
                <span className="text-data text-ink-3">{acts[0]!.blockNumber.toString()}</span>
                <span>
                  {acts.map((a) => EVENT_LABEL[a.kind]).join(", ")} ·{" "}
                  <Link href={`/agreements/${acts[0]!.id}`} className="underline decoration-line-control underline-offset-4 hover:decoration-cobalt">
                    agreement #{acts[0]!.id.toString()}
                  </Link>{" "}
                  <span className="text-ink-3">· {formatUtc(acts[0]!.timestamp)}</span>
                </span>
                <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-data text-ink-2 underline decoration-line-control underline-offset-4">
                  {shortHex(hash)} <ExternalLink aria-hidden size={13} /><span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="interface" className="mt-14">
        <h2 id="interface" className="text-title">Interface</h2>
        <p className="mt-1 text-sm text-ink-3">The ABI produced by the Fe build, locked by the repository&apos;s policy lint.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-line-control text-ink-3">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Function</th>
                <th scope="col" className="py-2 pr-4 font-medium">Kind</th>
                <th scope="col" className="py-2 font-medium">Caller</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fns.map((f) => (
                <tr key={f.name}>
                  <td className="py-2 pr-4 text-data">{`${f.name}(${f.inputs.map((i) => i.type).join(", ")})`}</td>
                  <td className="py-2 pr-4">{f.stateMutability === "view" ? "read" : f.stateMutability === "payable" ? "write, takes ETH" : "write"}</td>
                  <td className="py-2 text-ink-2">{CALLER[f.name] ?? "anyone (read-only)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-ink-2">
          Events: {events.map((e) => <span key={e.name} className="mr-3 inline-block text-data">{e.name}</span>)}
        </p>
      </section>

      <section aria-labelledby="limits" className="mt-14">
        <h2 id="limits" className="text-title">Verified limitations</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 measure text-ink-2">
          <li>The verifier is trusted: its approval or revision request is final, and Settlane cannot check the work. There is no appeal.</li>
          <li>Unaudited prototype on the Sepolia testnet, built with a pre-1.0 compiler. Test ETH only.</li>
          <li>No owner, admin or recovery path, by design: a lost provider key locks an approved milestone, a lost client key locks an expired one.</li>
          <li>Payouts forward only the 2,300-gas stipend; a smart-contract wallet that needs more cannot receive directly, so the caller chooses the address.</li>
          <li>The client alone sets deadlines and the review period at creation; the provider does not accept them on-chain.</li>
          <li>ETH sent to the contract outside an agreement (for example forced in) is stranded; the invariant is balance ≥ outstanding.</li>
        </ul>
        <p className="mt-6 text-sm text-ink-3">
          Source, tests and the full security model:{" "}
          <a href={REPOSITORY} className="underline decoration-line-control underline-offset-4 hover:decoration-cobalt">github.com/osodotsol/settlane</a> · Continuous
          integration: <a href={CI_URL} className="underline decoration-line-control underline-offset-4 hover:decoration-cobalt">GitHub Actions</a>
        </p>
      </section>
    </Container>
  );
}

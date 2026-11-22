"use client";

import { useId, useState } from "react";
import { isAddress, getAddress, toHex, type Address } from "viem";
import { useWallet } from "@/chain/use-wallet";
import { milestoneKey, useTx } from "@/chain/write";
import { useWalletActions } from "@/chain/wallet-actions";
import type { Agreement, Milestone } from "@/contract/read";
import { commit } from "@/domain/commitment";
import { milestoneActions, type ActionKind } from "@/domain/app-model";
import { formatEth, formatRelative, shortHex } from "@/domain/format";
import { Button } from "../Button";
import { ConfirmBar, TxPanel } from "./TxPanel";

const field = "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[0.9375rem] placeholder:text-ink-3 hover:border-line-control focus-visible:border-cobalt";

function Payee({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">Send the ETH to</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoComplete="off" aria-invalid={!!error} aria-describedby={`${id}-note`} className={`${field} text-data mt-1.5`} />
      <p id={`${id}-note`} className="mt-1.5 text-micro text-ink-3">
        Defaults to your own account. The payout forwards only the 2,300-gas stipend, so some smart-contract wallets cannot receive it: choose a plain account if it fails.
      </p>
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** What the connected wallet can do with one milestone, right now. Every button simulates before it asks for a signature. */
export function MilestoneActions({ a, m, now }: { a: Agreement; m: Milestone; now: bigint }) {
  const uid = useId();
  const wallet = useWallet();
  const walletActions = useWalletActions();
  const tx = useTx(milestoneKey(a.id, m.index));
  const busy = !tx.canStart;
  const [evidence, setEvidence] = useState("");
  const [payee, setPayee] = useState("");
  const [confirm, setConfirm] = useState<ActionKind | "reject" | null>(null);

  const can = milestoneActions(a, m, wallet.address, now);
  if (can.length === 0 && !tx.entry) return null;
  const me = wallet.address;
  const to = payee.trim() === "" ? me : payee.trim();
  const payeeError = to === undefined ? undefined : !isAddress(to, { strict: false }) ? "Enter a valid address." : /^0x0{40}$/i.test(to) ? "The payee cannot be the zero address." : undefined;
  const ev = commit(evidence);
  const run = (req: Parameters<typeof tx.start>[0], label: string) => {
    setConfirm(null);
    tx.start(req, label);
  };
  const hex = (v: bigint) => toHex(v, { size: 32 });

  return (
    <div className="mt-5 rounded-xl border border-line bg-sunken/50 p-5" aria-label={`Actions for milestone ${m.index + 1}`} role="group">
      {wallet.wrongNetwork ? (
        <div role="alert">
          <p className="font-semibold">Your wallet is on another network.</p>
          <p className="mt-1 text-sm text-ink-2">Switch to Sepolia to act. Nothing can be sent to another network from here.</p>
          <div className="mt-3"><Button size="sm" onClick={() => void walletActions.switchToSepolia()} disabled={walletActions.waiting !== null}>{walletActions.waiting?.kind === "switch" ? "Waiting for MetaMask…" : "Switch to Sepolia"}</Button></div>
        </div>
      ) : (
        <>
          {can.includes("submit") && (
            <div className="space-y-3">
              <p className="font-semibold">{m.state === "submitted" ? "Replace your submission" : "Submit your evidence"}</p>
              <div>
                <label htmlFor={`${uid}-ev`} className="text-sm font-semibold">Evidence</label>
                <p className="text-micro text-ink-3">Describe or link the delivered work, or paste a 32-byte hash of your own file. Only its hash goes on-chain.</p>
                <textarea id={`${uid}-ev`} rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} className={`${field} mt-1.5 h-auto py-2.5`} placeholder="https://example.com/delivery or a note" />
                {evidence.trim() !== "" && ev.ok && <p className="mt-1.5 text-micro text-ink-3">Committed as <span className="text-data text-[0.75rem]">{shortHex(ev.hex, 10, 8)}</span></p>}
                {evidence.trim() !== "" && !ev.ok && <p role="alert" className="mt-1.5 text-sm text-danger">{ev.error}</p>}
              </div>
              <p className="text-micro text-ink-3">This becomes revision {(m.revision + 1n).toString()}. You can submit again until the delivery deadline ({formatRelative(m.deliverBy, now)}).</p>
              <Button size="sm" disabled={!ev.ok || busy} onClick={() => ev.ok && run({ fn: "submit", args: [a.id, m.index, ev.value] }, "Submit evidence")}>Submit evidence</Button>
            </div>
          )}

          {can.includes("review") && (
            <div className="space-y-3">
              <p className="font-semibold">Decide on this submission</p>
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-ink-3">Evidence you are deciding on</dt><dd className="text-data break-all text-[0.8125rem]" title={hex(m.evidence)}>{shortHex(hex(m.evidence), 12, 10)}</dd></div>
                <div><dt className="text-ink-3">Submission revision</dt><dd className="text-data">{m.revision.toString()}</dd></div>
              </dl>
              <p className="text-micro text-ink-3">Your decision names exactly this evidence and revision. If the provider resubmits first, it is refused and nothing changes.</p>
              {now >= m.deliverBy && (
                <p className="rounded-lg border border-submitted bg-submitted-tint px-3 py-2 text-sm text-ink">
                  The delivery deadline has passed. Requesting a revision now makes this milestone refundable by the client immediately, because the provider can no longer resubmit.
                </p>
              )}
              {confirm === null && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => setConfirm("review")}>Approve revision {m.revision.toString()}</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm("reject")}>Request a revision</Button>
                </div>
              )}
              {confirm === "review" && (
                <ConfirmBar busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => run({ fn: "approve", args: [a.id, m.index, m.evidence, m.revision] }, `Approve revision ${m.revision}`)} label="Approve and sign">
                  Approving makes {formatEth(m.amount)} ETH claimable by the provider, with no deadline. It cannot be undone and the client can no longer refund it.
                </ConfirmBar>
              )}
              {confirm === "reject" && (
                <ConfirmBar busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => run({ fn: "reject", args: [a.id, m.index, m.evidence, m.revision] }, "Request a revision")} label="Request revision and sign">
                  The milestone returns to Funded and the provider may submit again until the delivery deadline. This is recorded on-chain.
                </ConfirmBar>
              )}
            </div>
          )}

          {(can.includes("claim") || can.includes("refund")) && (
            <div className="space-y-3">
              <p className="font-semibold">{can.includes("claim") ? `Claim ${formatEth(m.amount)} ETH` : `Refund ${formatEth(m.amount)} ETH`}</p>
              <Payee id={`${uid}-to`} value={payee} onChange={setPayee} error={payeeError} />
              {confirm === null && (
                <Button size="sm" disabled={busy || payeeError !== undefined || to === undefined} onClick={() => setConfirm(can.includes("claim") ? "claim" : "refund")}>
                  {can.includes("claim") ? "Claim payout" : "Refund to client"}
                </Button>
              )}
              {(confirm === "claim" || confirm === "refund") && to !== undefined && !payeeError && (
                <ConfirmBar
                  busy={busy}
                  onCancel={() => setConfirm(null)}
                  onConfirm={() => run({ fn: confirm, args: [a.id, m.index, getAddress(to) as Address] }, confirm === "claim" ? "Claim payout" : "Refund to client")}
                  label={confirm === "claim" ? "Claim and sign" : "Refund and sign"}
                >
                  {formatEth(m.amount)} ETH will be sent from the contract to <span className="text-data text-[0.8125rem]">{shortHex(to, 8, 6)}</span>. It is paid once and cannot be repeated.
                </ConfirmBar>
              )}
            </div>
          )}
        </>
      )}
      {tx.blockReason && tx.entry?.state.phase === "unknown" && <p className="mt-3 text-sm text-ink-2">{tx.blockReason}</p>}
      <TxPanel tx={tx} />
    </div>
  );
}

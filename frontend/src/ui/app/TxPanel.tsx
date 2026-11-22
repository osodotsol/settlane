"use client";

import { ExternalLink } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { useConnection } from "wagmi";
import { sepolia } from "wagmi/chains";
import { formatElapsed, useNow } from "@/chain/use-now";
import { describeTrace, traceStore } from "@/chain/wallet-trace";
import type { TxEntry } from "@/chain/tx-registry";
import type { useTx } from "@/chain/write";
import { txUrl } from "@/config/chain";
import { formatUtc, shortHex } from "@/domain/format";
import { Button } from "../Button";

// The life of one wallet request, stated exactly: what the page knows, and what it does not. A wallet that has
// not answered is "waiting", never "cancelled"; a hash means "sent"; only a successful receipt means "confirmed".

const SLOW_MS = 15_000;
const STEPS = ["Checked with the contract", "Signed in your wallet", "Confirmed on Sepolia"] as const;

function Steps({ done, now }: { done: number; now: number }) {
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-1 text-micro">
      {STEPS.map((label, i) => (
        <li key={label} className={`flex items-center gap-2 ${i < done ? "text-ink" : i === now ? "font-semibold text-ink" : "text-ink-3"}`} aria-current={i === now ? "step" : undefined}>
          <span aria-hidden className={`size-2 rounded-full ${i < done ? "bg-paid" : i === now ? "animate-pulse bg-cobalt" : "border border-line-control"}`} />
          {label}
        </li>
      ))}
    </ol>
  );
}

const Tx = ({ hash, label = "View the transaction" }: { hash: string; label?: string }) => (
  <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="draw-link inline-flex items-center gap-1 text-ink-2 hover:text-ink">
    {label} <ExternalLink aria-hidden size={14} />
    <span className="sr-only">(Etherscan, opens in a new tab)</span>
  </a>
);

const EMPTY: never[] = [];

/** What the page asked the wallet during this request (method names and timings only). */
function WalletActivity({ entry, now }: { entry: TxEntry; now: number }) {
  const all = useSyncExternalStore(traceStore.subscribe, traceStore.snapshot, () => EMPTY);
  const lines = describeTrace(all.filter((e) => e.startedAt >= entry.startedAt), now);
  if (lines.length === 0) return null;
  return (
    <details className="mt-3 text-micro text-ink-3">
      <summary className="cursor-pointer select-none hover:text-ink">What this page asked the wallet</summary>
      <ul className="mt-1.5 space-y-0.5 text-data text-[0.75rem]">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      <p className="mt-1.5">This is only what the page sent and what came back. It cannot see inside MetaMask.</p>
    </details>
  );
}

function Guidance() {
  return (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
      <li>Click the MetaMask icon in the browser toolbar. The request may be waiting there, or in a MetaMask window behind this one.</li>
      <li>If MetaMask shows an error, for example &quot;Cannot read properties of undefined (reading &apos;origin&apos;)&quot;, press Try again in MetaMask, then look for the request.</li>
      <li>Check it (Sepolia, the right account, the amount) and approve or reject it. Do not press the button on this page again.</li>
    </ol>
  );
}

/** Requests for the same action by other accounts in this browser: they do not block this account, and are not hidden. */
function OtherAccounts({ others }: { others: TxEntry[] }) {
  if (others.length === 0) return null;
  return (
    <p className="mt-4 rounded-lg border border-submitted bg-submitted-tint px-3 py-2 text-sm text-ink" data-other-accounts>
      {others.map((o) => shortHex(o.account)).join(", ")} {others.length === 1 ? "has" : "have"} an unfinished request for this action in this browser. It belongs to that account: switch back to it to follow or check it. It does not block this account.
    </p>
  );
}

export function TxPanel({ tx, onSuccess }: { tx: ReturnType<typeof useTx>; onSuccess?: (createdId: bigint | undefined) => ReactNode }) {
  const { entry, others } = tx;
  const { chainId } = useConnection();
  const open = entry !== undefined && (entry.state.phase === "awaiting" || entry.state.phase === "pending" || entry.state.phase === "checking");
  const now = useNow(open);
  if (!entry) return <OtherAccounts others={others} />;
  const s = entry.state;
  const box = "mt-4 rounded-xl border px-4 py-3 text-sm";
  const notes = (
    <>
      {entry.previous && (
        <p className="mt-2 text-ink-2" data-previous-unproven>
          An earlier request for this action (started {formatUtc(BigInt(Math.floor(entry.previous.startedAt / 1000)))}) was never proven closed. If MetaMask still sends it, it is a separate transaction and this page cannot stop it.
        </p>
      )}
      {s.phase === "awaiting" && chainId !== undefined && chainId !== sepolia.id && (
        <p className="mt-2 rounded-lg border border-danger bg-danger-tint px-3 py-2 text-ink">Your wallet switched network while this request was open. If MetaMask still asks, check that it says Sepolia; otherwise reject it.</p>
      )}
      {entry.lateHashes.length > 0 && (
        <p className="mt-2 text-ink-2">
          An earlier request for this action was answered late and sent: {entry.lateHashes.map((h) => <span key={h} className="mr-2"><Tx hash={h} label={shortHex(h, 10, 6)} /></span>)}
        </p>
      )}
      <WalletActivity entry={entry} now={now} />
      <OtherAccounts others={others} />
    </>
  );
  const dismiss = <div className="mt-3"><Button variant="secondary" size="sm" onClick={tx.dismiss}>Dismiss</Button></div>;

  switch (s.phase) {
    case "checking":
      return <div role="status" className={`${box} border-line bg-surface`}><Steps done={0} now={0} /><p className="mt-2 text-ink-2">Checking the call against the contract. Nothing has been asked of your wallet yet.</p></div>;
    case "awaiting": {
      const elapsed = now - s.since;
      return (
        <div role="status" className={`${box} ${elapsed >= SLOW_MS ? "border-submitted" : "border-line"} bg-surface`}>
          <Steps done={1} now={1} />
          <p className="mt-2 font-semibold text-ink">Waiting for your signature in MetaMask · {formatElapsed(elapsed)}</p>
          {elapsed < SLOW_MS ? (
            <p className="mt-1 text-ink-2">Confirm it in MetaMask. Check that the network says Sepolia.</p>
          ) : (
            <>
              <p className="mt-1 text-ink-2">MetaMask has not answered yet. Nothing has been sent.</p>
              <Guidance />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" onClick={tx.stopWaiting}>Stop waiting</Button>
                <span className="text-micro text-ink-3">This does not cancel the request in MetaMask. If you answer it later, this page still records the result.</span>
              </div>
            </>
          )}
          {notes}
        </div>
      );
    }
    case "pending":
      return (
        <div role="status" className={`${box} border-line bg-surface`}>
          <Steps done={2} now={2} />
          <p className="mt-2 font-semibold text-ink">Sent. Waiting for a block · {formatElapsed(now - s.since)}</p>
          <p className="mt-1 text-ink-2">Do not send it again. <Tx hash={s.hash} /></p>
          {notes}
        </div>
      );
    case "confirmed":
      return (
        <div role="status" className={`${box} border-paid bg-paid-tint`}>
          <Steps done={3} now={-1} />
          <p className="mt-2 font-semibold text-ink">Confirmed in block {s.blockNumber.toString()}.</p>
          <p className="mt-1 text-ink-2"><Tx hash={s.hash} /></p>
          {onSuccess?.(s.createdId)}
          {notes}
          {dismiss}
        </div>
      );
    case "found":
      return (
        <div role="status" className={`${box} border-paid bg-paid-tint`}>
          <p className="font-semibold text-ink">Done on-chain: the contract shows this action took effect.</p>
          <p className="mt-1 text-ink-2">The page did not see MetaMask&apos;s answer, so it has no transaction link; the agreement&apos;s history lists it.</p>
          {onSuccess?.(s.createdId)}
          {notes}
          {dismiss}
        </div>
      );
    case "rejected":
      return <div role="status" className={`${box} border-line bg-surface`}><p className="font-semibold text-ink">You declined the request in MetaMask.</p><p className="mt-1 text-ink-2">Nothing was sent. You can try again when you are ready.</p>{notes}{dismiss}</div>;
    case "cancelled":
      return <div role="status" className={`${box} border-line bg-surface`}><p className="font-semibold text-ink">Cancelled in MetaMask.</p><p className="mt-1 text-ink-2">The wallet replaced this transaction with a cancellation, so the action did not happen. <Tx hash={s.hash} label="View the cancellation" /></p>{notes}{dismiss}</div>;
    case "reverted":
      return <div role="alert" className={`${box} border-danger bg-danger-tint`}><p className="font-semibold text-ink">Mined, but the contract reverted it.</p><p className="mt-1 text-ink-2">No state changed and no ETH moved; the network fee was paid. Refresh to see the current state. <Tx hash={s.hash} /></p>{notes}{dismiss}</div>;
    case "failed":
      return (
        <div role="alert" className={`${box} border-danger bg-danger-tint`}>
          <p className="font-semibold text-ink">{s.problem.message}</p>
          <p className="mt-1 text-ink-2">{s.problem.recovery}</p>
          {s.problem.reason && <p className="mt-2 text-micro text-ink-3">Contract reason: <span className="text-data text-[0.8125rem]">{s.problem.reason}</span></p>}
          {notes}
          {dismiss}
        </div>
      );
    case "unknown": {
      const what = {
        stopped: "The page stopped waiting. The request may still be open in MetaMask: if it appears, check it and approve or reject it.",
        "wallet-error": `${s.problem?.message ?? "The wallet returned an error."} The page cannot tell whether anything was sent.`,
        "receipt-timeout": "It was sent, but no block has included it after 10 minutes.",
        reloaded: "This page was reloaded or reopened while a request for this action was open. It may still be open in MetaMask.",
        replaced: "The wallet replaced this transaction with a different one.",
      }[s.reason];
      const v = entry.recovery?.verdict;
      const who = shortHex(entry.account);
      const said: Record<string, string> = {
        "open-here": "MetaMask still has this request open from this tab. Approve or reject it there; this page follows the answer.",
        "open-elsewhere": "Another tab of this site is still waiting for MetaMask on this action. Finish it in that tab or in MetaMask.",
        "pending-account": `A transaction from ${who} is waiting for a block. Do not send another; check again shortly.`,
        "dropped-unproven": "The node no longer knows this transaction, but its nonce has not been used, so the wallet could still send it. Cancel it in MetaMask (which replaces it), or wait; once its nonce is used by another transaction it is released automatically.",
        "needs-confirmation": `The chain shows this action has not happened and nothing from ${who} is pending. The request may still be open in MetaMask, though, and nothing on-chain can show whether it is. If MetaMask no longer shows it (you rejected or closed it), say so below.`,
        override:
          entry.action.fn === "submit"
            ? "You said the request is no longer in MetaMask. That is your decision, not proof: the outcome stays unknown. You may submit again. If the old request is still approved later, it is a valid resubmission and replaces the newer evidence (the revision goes up), so check the evidence before the verifier decides. No ETH moves on a submission."
            : "You said the request is no longer in MetaMask. That is your decision, not proof: the outcome stays unknown. You may send a new request. If the old one is still approved later, the contract refuses the duplicate (this milestone cannot be decided, claimed or refunded twice), so it can cost a network fee but cannot move ETH twice.",
        "create-held": `Your answer is recorded, but it cannot prove the old request is closed, and approving it later would fund a second agreement: no contract rule prevents that. A new create from ${who} stays blocked here until the chain settles it: if MetaMask shows the request, approve it (then Check the chain finds the agreement) or reject it. The block lifts by itself 24 hours after the request started. Your draft is kept.`,
      };
      return (
        <div role="alert" className={`${box} border-submitted bg-surface`}>
          <p className="font-semibold text-ink">Outcome not known yet</p>
          <p className="mt-1 text-ink-2">{what} {s.hash && <Tx hash={s.hash} />}</p>
          {v && (
            <p className="mt-2 text-ink-2" data-recovery={v.kind}>
              {v.kind === "released" ? `Checked: ${v.reason} You can now send a new request.` : v.kind === "cannot-prove" ? `Checked: ${v.reason}` : `${v.kind === "override" || v.kind === "create-held" ? "" : "Checked: "}${said[v.kind] ?? ""}`}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void tx.reconcile()}>Check the chain</Button>
            {v?.kind === "needs-confirmation" && (
              <Button variant="secondary" size="sm" onClick={() => void tx.confirmNotInWallet()}>
                It is no longer in MetaMask
              </Button>
            )}
            {entry.cleared && v?.kind !== "override" && <Button variant="quiet" size="sm" onClick={tx.dismiss}>Dismiss</Button>}
          </div>
          {v?.kind === "needs-confirmation" && entry.action.fn === "create" && (
            <p className="mt-2 text-micro text-ink-3">For a create, your answer does not unlock a new create: an old request approved later would fund a second agreement.</p>
          )}
          {notes}
        </div>
      );
    }
  }
}

/** The step between "I filled it in" and "I sign": says exactly what will happen. */
export function ConfirmBar({ children, onConfirm, onCancel, label = "Confirm and sign", busy }: { children: ReactNode; onConfirm: () => void; onCancel: () => void; label?: string; busy?: boolean }) {
  return (
    <div className="mt-4 rounded-xl border border-cobalt/50 bg-surface p-4">
      <div className="text-sm text-ink-2">{children}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={onConfirm} disabled={busy}>{label}</Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

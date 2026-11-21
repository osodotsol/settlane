"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { TxState } from "@/chain/write";
import { txUrl } from "@/config/chain";
import { Button } from "../Button";

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

const Tx = ({ hash }: { hash: string }) => (
  <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="draw-link inline-flex items-center gap-1 text-ink-2 hover:text-ink">
    View the transaction <ExternalLink aria-hidden size={14} />
    <span className="sr-only">(Etherscan, opens in a new tab)</span>
  </a>
);

/** The life of one transaction, from the contract check to its receipt. Nothing here is assumed: it mirrors `TxState`. */
export function TxPanel({ state, onDismiss, onSuccess }: { state: TxState; onDismiss: () => void; onSuccess?: (s: Extract<TxState, { phase: "confirmed" }>) => ReactNode }) {
  if (state.phase === "idle") return null;
  const box = "mt-4 rounded-xl border px-4 py-3 text-sm";
  switch (state.phase) {
    case "checking":
      return <div role="status" className={`${box} border-line bg-surface`}><Steps done={0} now={0} /><p className="mt-2 text-ink-2">Checking the call against the contract. Nothing is signed yet.</p></div>;
    case "signing":
      return <div role="status" className={`${box} border-line bg-surface`}><Steps done={1} now={1} /><p className="mt-2 text-ink-2">Confirm the transaction in your wallet. Check the network says Sepolia.</p></div>;
    case "confirming":
      return <div role="status" className={`${box} border-line bg-surface`}><Steps done={2} now={2} /><p className="mt-2 text-ink-2">Sent. Waiting for Sepolia to include it in a block. This usually takes under a minute. <Tx hash={state.hash} /></p></div>;
    case "confirmed":
      return (
        <div role="status" className={`${box} border-paid bg-paid-tint`}>
          <Steps done={3} now={-1} />
          <p className="mt-2 font-semibold text-ink">Confirmed in block {state.blockNumber.toString()}.</p>
          <p className="mt-1 text-ink-2"><Tx hash={state.hash} /></p>
          {onSuccess?.(state)}
          <div className="mt-3"><Button variant="secondary" size="sm" onClick={onDismiss}>Dismiss</Button></div>
        </div>
      );
    case "failed":
      return (
        <div role="alert" className={`${box} border-danger bg-danger-tint`}>
          <p className="font-semibold text-ink">{state.problem.message}</p>
          <p className="mt-1 text-ink-2">{state.problem.recovery}</p>
          {state.problem.reason && <p className="mt-2 text-micro text-ink-3">Contract reason: <span className="text-data text-[0.8125rem]">{state.problem.reason}</span></p>}
          {state.hash && <p className="mt-2"><Tx hash={state.hash} /></p>}
          <div className="mt-3"><Button variant="secondary" size="sm" onClick={onDismiss}>Dismiss</Button></div>
        </div>
      );
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

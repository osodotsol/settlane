"use client";

import { X } from "lucide-react";
import { formatElapsed, useNow } from "@/chain/use-now";
import { useWalletActions } from "@/chain/wallet-actions";
import { Button } from "./Button";

const SLOW_MS = 8_000;

/**
 * Shown when a connection or network-switch request has gone unanswered for a while, or failed. Fixed in the
 * corner so it is visible from any page; it never covers the main content's controls on desktop.
 */
export function WalletWaitNotice() {
  const { waiting, error, stop, clearError } = useWalletActions();
  const now = useNow(waiting !== null);
  const slow = waiting !== null && now - waiting.since >= SLOW_MS;
  if (!slow && !error) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-4 z-50 rounded-2xl border border-line-control bg-surface p-4 text-sm shadow-lift sm:left-auto sm:right-6 sm:w-[25rem]">
      {slow && waiting ? (
        <>
          <p className="font-semibold text-ink">
            MetaMask hasn&apos;t answered the {waiting.kind === "connect" ? "connection" : "network switch"} request · {formatElapsed(now - waiting.since)}
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
            <li>Click the MetaMask icon in the browser toolbar. The request may be waiting there.</li>
            <li>If MetaMask shows an error, for example &quot;Cannot read properties of undefined (reading &apos;origin&apos;)&quot;, press Try again in MetaMask, then look for the request.</li>
            <li>Approve or reject the request in MetaMask.</li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" onClick={stop}>Stop waiting</Button>
            <span className="text-micro text-ink-3">Stops waiting here only. The request stays open in MetaMask.</span>
          </div>
        </>
      ) : error ? (
        <div className="flex items-start justify-between gap-3">
          <p className="text-ink">{error.message}</p>
          <button type="button" onClick={clearError} aria-label="Dismiss" className="press -m-1 grid size-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink">
            <X aria-hidden size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

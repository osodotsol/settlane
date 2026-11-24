"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { CREATE_KEY, useTx } from "@/chain/write";
import { useWalletActions } from "@/chain/wallet-actions";
import { useWallet } from "@/chain/use-wallet";
import { readCreatePreflight } from "@/chain/preflight";
import { toCreateArgs, type Draft, type FormErrors } from "@/domain/create-form";
import { formatEth } from "@/domain/format";
import { Button } from "../Button";
import { ConfirmBar, TxPanel } from "./TxPanel";

type Result = { ok: true; draft: Draft } | { ok: false; errors: FormErrors };

/** The last step of Create: a summary, one confirmation, then the shared simulate, sign and receipt path. */
export function CreateSubmit({ result, onAttempt, total, onCreated, onSubmit }: { result: Result; onAttempt: () => void; total: bigint; onCreated?: (request: { phase: string; startedAt: number; createdId?: bigint }) => void; onSubmit?: () => void }) {
  const wallet = useWallet();
  const [preflight, setPreflight] = useState(false);
  const tx = useTx(CREATE_KEY);
  const busy = !tx.canStart || preflight;
  const done = tx.entry?.state.phase === "confirmed" || tx.entry?.state.phase === "found";
  // the draft is cleared only once the chain shows the agreement exists (draft-archive.ts); every other outcome keeps it
  const phase = tx.entry?.state.phase;
  const startedAt = tx.entry?.startedAt;
  const createdId = tx.entry?.state.phase === "confirmed" || tx.entry?.state.phase === "found" ? tx.entry.state.createdId : undefined;
  useEffect(() => {
    if (done && phase && startedAt !== undefined) onCreated?.({ phase, startedAt, createdId });
    // onCreated is a new function on every render of the form; the request identity is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, phase, startedAt, createdId]);
  const [confirming, setConfirming] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const walletActions = useWalletActions();

  const start = async () => {
    setConfirming(false);
    if (!result.ok || !wallet.address) return;
    setLocal(null);
    if (preflight) return;
    setPreflight(true);
    const pre = await readCreatePreflight(wallet.address).finally(() => setPreflight(false));
    if (!pre.ok) {
      // nothing was sent and nothing was asked of the wallet; the draft is untouched (final review M3)
      setLocal("Sepolia could not be read just now (the balance or the latest block), so nothing was sent and your wallet was not asked. Your draft is kept. Try again in a moment.");
      return;
    }
    const { balance, blockTime } = pre;
    if (balance < result.draft.total) {
      setLocal(`This account holds ${formatEth(balance)} ETH on Sepolia, but the agreement locks ${formatEther(result.draft.total)} ETH plus a small network fee. Get test ETH from a Sepolia faucet or lower the amounts.`);
      return;
    }
    const { args, value } = toCreateArgs(result.draft, blockTime);
    onSubmit?.(); // the exact draft being sent (M7)
    tx.start({ fn: "create", args, value }, "Create and fund");
  };

  // Without a Sepolia wallet the draft can still be checked; simulation and signing need one.
  if (!wallet.canTransact) {
    return (
      <div className="space-y-3 border-t border-line pt-4">
        <Button type="button" variant="secondary" className="w-full" onClick={onAttempt}>Check draft</Button>
        {result.ok && <p role="status" className="text-sm text-ink-2"><span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-paid" />The draft passes every rule the form can check.</p>}
        <div className="rounded-xl border border-line bg-sunken/50 p-3.5 text-sm">
          {wallet.wrongNetwork ? (
            <>
              <p className="text-ink-2">Your wallet is on another network. Signing is blocked until it is on Sepolia.</p>
              <Button size="sm" variant="danger" className="mt-3 w-full" onClick={() => void walletActions.switchToSepolia()} disabled={walletActions.waiting !== null}>
                {walletActions.waiting?.kind === "switch" ? "Waiting for MetaMask…" : "Switch to Sepolia"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-ink-2">To simulate and sign, connect the wallet that will be the client. Your draft stays as it is.</p>
              {walletActions.hasConnector ? (
                <Button size="sm" className="mt-3 w-full" onClick={() => void walletActions.connect()} disabled={walletActions.waiting !== null}>
                  {walletActions.waiting?.kind === "connect" ? "Waiting for MetaMask…" : "Connect wallet to sign"}
                </Button>
              ) : (
                <p className="mt-2 text-micro text-ink-3">No browser wallet was found. Install an extension wallet to sign.</p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-line pt-4">
      {!(confirming && result.ok) && (
        <Button
          type="button"
          className="w-full"
          disabled={busy || done}
          onClick={() => {
            onAttempt();
            if (result.ok) setConfirming(true);
          }}
        >
          Review and create
        </Button>
      )}
      {!result.ok && <p className="text-micro text-ink-3">The draft is checked again against your connected account before signing.</p>}
      {confirming && result.ok && (
        <ConfirmBar busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void start()} label="Create and sign">
          You are about to lock <span className="font-semibold text-ink">{formatEther(total)} ETH</span> of test ETH in the Settlane contract on Sepolia. It leaves only by its rules: the provider claims approved work, and you can refund a milestone after its deadline passes. The deadlines are fixed from the latest block&apos;s time when you press Create and sign; the time you take to approve in MetaMask comes out of each delivery window.
        </ConfirmBar>
      )}
      {local && <p role="alert" className="rounded-xl border border-danger bg-danger-tint px-4 py-3 text-sm text-ink">{local}</p>}
      {busy && tx.blockReason && <p className="text-micro text-ink-3">{tx.blockReason}</p>}
      <TxPanel
        tx={tx}
        onSuccess={(createdId) =>
          createdId !== undefined ? (
            <p className="mt-2">
              <Link href={`/app/agreements/${createdId}`} className="draw-link font-semibold text-cobalt">Open agreement #{createdId.toString()}</Link>
            </p>
          ) : null
        }
      />
    </div>
  );
}

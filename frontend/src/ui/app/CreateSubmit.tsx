"use client";

import Link from "next/link";
import { useState } from "react";
import { formatEther } from "viem";
import { publicClient } from "@/chain/client";
import { useSettlaneTx } from "@/chain/write";
import { useWallet } from "@/chain/use-wallet";
import { latestBlockTime } from "@/contract/read";
import { toCreateArgs, type Draft, type FormErrors } from "@/domain/create-form";
import { formatEth } from "@/domain/format";
import { Button } from "../Button";
import { ConfirmBar, TxPanel } from "./TxPanel";

type Result = { ok: true; draft: Draft } | { ok: false; errors: FormErrors };

/** The last step of Create: a summary, one confirmation, then the shared simulate, sign and receipt path. */
export function CreateSubmit({ result, onAttempt, total }: { result: Result; onAttempt: () => void; total: bigint }) {
  const wallet = useWallet();
  const { state, send, reset, busy } = useSettlaneTx();
  const [confirming, setConfirming] = useState(false);
  const [local, setLocal] = useState<string | null>(null);

  const start = async () => {
    setConfirming(false);
    if (!result.ok || !wallet.address) return;
    setLocal(null);
    const [balance, blockTime] = await Promise.all([publicClient.getBalance({ address: wallet.address }), latestBlockTime()]);
    if (balance < result.draft.total) {
      setLocal(`This account holds ${formatEth(balance)} ETH on Sepolia, but the agreement locks ${formatEther(result.draft.total)} ETH plus a small network fee. Get test ETH from a Sepolia faucet or lower the amounts.`);
      return;
    }
    const { args, value } = toCreateArgs(result.draft, blockTime);
    await send({ fn: "create", args, value });
  };

  return (
    <div className="space-y-3 border-t border-line pt-5">
      {!confirming && (
        <Button
          type="button"
          className="w-full"
          disabled={busy || state.phase === "confirmed"}
          onClick={() => {
            onAttempt();
            if (result.ok) setConfirming(true);
          }}
        >
          Review and create
        </Button>
      )}
      {!result.ok && <p className="text-micro text-ink-3">Complete the highlighted fields to continue.</p>}
      {confirming && result.ok && (
        <ConfirmBar busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void start()} label="Create and sign">
          You are about to lock <span className="font-semibold text-ink">{formatEther(total)} ETH</span> of test ETH in the Settlane contract on Sepolia. It leaves only by its rules: the provider claims approved work, and you can refund a milestone after its deadline passes.
        </ConfirmBar>
      )}
      {local && <p role="alert" className="rounded-xl border border-danger bg-danger-tint px-4 py-3 text-sm text-ink">{local}</p>}
      <TxPanel
        state={state}
        onDismiss={reset}
        onSuccess={(s) =>
          s.createdId !== undefined ? (
            <p className="mt-2">
              <Link href={`/app/agreements/${s.createdId}`} className="draw-link font-semibold text-cobalt">Open agreement #{s.createdId.toString()}</Link>
            </p>
          ) : null
        }
      />
    </div>
  );
}

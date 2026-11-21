"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnect, useConnectors, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
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
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();

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

  // Without a Sepolia wallet the draft can still be checked; simulation and signing need one.
  if (!wallet.canTransact) {
    const connector = connectors[0];
    return (
      <div className="space-y-3 border-t border-line pt-4">
        <Button type="button" variant="secondary" className="w-full" onClick={onAttempt}>Check draft</Button>
        {result.ok && <p role="status" className="text-sm text-ink-2"><span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-paid" />The draft passes every rule the form can check.</p>}
        <div className="rounded-xl border border-line bg-sunken/50 p-3.5 text-sm">
          {wallet.wrongNetwork ? (
            <>
              <p className="text-ink-2">Your wallet is on another network. Signing is blocked until it is on Sepolia.</p>
              <Button size="sm" variant="danger" className="mt-3 w-full" onClick={() => switchChain.mutate({ chainId: sepolia.id })} disabled={switchChain.isPending}>
                {switchChain.isPending ? "Switching…" : "Switch to Sepolia"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-ink-2">To simulate and sign, connect the wallet that will be the client. Your draft stays as it is.</p>
              {connector ? (
                <Button size="sm" className="mt-3 w-full" onClick={() => connect.mutate({ connector })} disabled={connect.isPending}>
                  {connect.isPending ? "Check your wallet…" : "Connect wallet to sign"}
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
          disabled={busy || state.phase === "confirmed"}
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

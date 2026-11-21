"use client";

import { useSyncExternalStore } from "react";
import { useConnection, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { shortHex } from "@/domain/format";
import { Button } from "./Button";

const subscribe = () => () => {};
/** False during server rendering and hydration, true afterwards: wallet state exists only in the browser. */
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false);

/**
 * Network and wallet state for the top bar. The site is fully usable without a wallet; this control only
 * matters when acting. Write flows (simulate, sign, receipt) arrive in milestone F5.
 */
export function WalletControl() {
  const mounted = useMounted();
  const { address, chainId, isConnected } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();

  if (!mounted) return <span className="inline-block h-10 w-36" aria-hidden />;

  if (!isConnected) {
    const connector = connectors[0];
    if (!connector) return <span className="text-sm text-ink-3">Read-only · no wallet</span>;
    return (
      <Button variant="secondary" size="sm" onClick={() => connect.mutate({ connector })} disabled={connect.isPending}>
        {connect.isPending ? "Waiting for wallet…" : "Connect wallet"}
      </Button>
    );
  }

  if (chainId !== sepolia.id) {
    return (
      <Button variant="danger" size="sm" onClick={() => switchChain.mutate({ chainId: sepolia.id })} disabled={switchChain.isPending}>
        {switchChain.isPending ? "Switching…" : "Switch to Sepolia"}
      </Button>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => disconnect.mutate()} aria-label={`Connected as ${address}. Disconnect`}>
      <span aria-hidden className="size-2 rounded-full bg-paid" />
      <span className="text-data text-sm">{address ? shortHex(address) : ""}</span>
    </Button>
  );
}

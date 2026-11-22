"use client";

import { useConnection, useDisconnect } from "wagmi";
import { sepolia } from "wagmi/chains";
import { useMounted } from "@/chain/use-wallet";
import { useWalletActions } from "@/chain/wallet-actions";
import { shortHex } from "@/domain/format";
import { Button } from "./Button";

/**
 * Network and wallet state for the top bar. The site is fully usable without a wallet. Connecting and switching
 * go through the shared wallet-request store (one request at a time; WalletWaitNotice explains a slow wallet).
 */
export function WalletControl() {
  const mounted = useMounted();
  const { address, chainId, isConnected } = useConnection();
  const disconnect = useDisconnect();
  const wallet = useWalletActions();

  if (!mounted) return <span className="inline-block h-10 w-36" aria-hidden />;

  if (!isConnected) {
    if (!wallet.hasConnector) return <span className="text-sm text-ink-3">Read-only · no wallet</span>;
    return (
      <Button variant="secondary" size="sm" onClick={() => void wallet.connect()} disabled={wallet.waiting !== null}>
        {wallet.waiting?.kind === "connect" ? "Waiting for MetaMask…" : "Connect wallet"}
      </Button>
    );
  }

  if (chainId !== sepolia.id) {
    return (
      <Button variant="danger" size="sm" onClick={() => void wallet.switchToSepolia()} disabled={wallet.waiting !== null}>
        {wallet.waiting?.kind === "switch" ? "Waiting for MetaMask…" : "Switch to Sepolia"}
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

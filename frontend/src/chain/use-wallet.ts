"use client";

import { useSyncExternalStore } from "react";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import { sepolia } from "wagmi/chains";

const subscribe = () => () => {};
/** False during server rendering and hydration, true afterwards: wallet state exists only in the browser. */
export const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false);

export type Wallet = {
  /** False until the browser has hydrated and wagmi has finished restoring a previous connection. */
  ready: boolean;
  /** The connected account, or undefined: reading never needs one. */
  address: Address | undefined;
  /** Connected, but the wallet is on a network other than Sepolia. Writes are refused until it is switched. */
  wrongNetwork: boolean;
  /** Connected on Sepolia: the only state in which the interface offers a transaction. */
  canTransact: boolean;
};

export function useWallet(): Wallet {
  const mounted = useMounted();
  const c = useConnection();
  const connected = mounted && c.isConnected && c.address !== undefined;
  const wrongNetwork = connected && c.chainId !== sepolia.id;
  return {
    ready: mounted && c.status !== "connecting" && c.status !== "reconnecting",
    address: connected ? c.address : undefined,
    wrongNetwork,
    canTransact: connected && !wrongNetwork,
  };
}

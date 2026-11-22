"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useConnect, useConnectors, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";

// Connecting and switching network are wallet requests too, and they can go unanswered (seen in the real-wallet
// run). Every Connect and Switch button in the application goes through this one store, so:
// - a second click while a request is open does not send a second request (MetaMask answers that with -32002);
// - the page can show how long it has been waiting and what to do (WalletWaitNotice);
// - "Stop waiting" only stops the page from waiting; it never claims the request in the wallet was cancelled,
//   and a late approval still connects or switches.

export type WalletWait = { kind: "connect" | "switch"; since: number; attempt: number };
type State = { wait: WalletWait | null; error: { kind: "connect" | "switch"; message: string } | null };

let state: State = { wait: null, error: null };
let attempts = 0;
const listeners = new Set<() => void>();
const setState = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const walletWaitStore = {
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
  stop: () => setState({ wait: null }),
  clearError: () => setState({ error: null }),
};
const SERVER: State = { wait: null, error: null };

function explain(kind: "connect" | "switch", error: unknown): string {
  let e: unknown = error;
  let code: number | undefined;
  for (let i = 0; i < 6 && e && code === undefined; i++) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === "number") code = c;
    e = (e as { cause?: unknown }).cause;
  }
  if (code === 4001) return kind === "connect" ? "You declined the connection in MetaMask." : "You declined the network switch in MetaMask.";
  if (code === -32002) return "MetaMask already has a request from this page waiting. Open MetaMask from the browser toolbar and approve or reject it.";
  return kind === "connect" ? "The wallet did not connect. Open MetaMask, check for a waiting request or an error, then try again." : "The network did not switch. Open MetaMask and switch to Sepolia there, or try again.";
}

export function useWalletActions() {
  const connectors = useConnectors();
  const { mutateAsync: connectAsync } = useConnect();
  const { mutateAsync: switchAsync } = useSwitchChain();
  const s = useSyncExternalStore(walletWaitStore.subscribe, walletWaitStore.get, () => SERVER);

  const run = useCallback(async (kind: "connect" | "switch", fn: () => Promise<unknown>) => {
    const current = () => walletWaitStore.get().wait; // read fresh: other code changes it while we await
    if (current()) return; // one wallet request at a time from this page
    const attempt = ++attempts;
    setState({ wait: { kind, since: Date.now(), attempt }, error: null });
    try {
      await fn();
    } catch (error) {
      const w = current();
      if (w === null || w.attempt === attempt) setState({ error: { kind, message: explain(kind, error) } });
    } finally {
      if (current()?.attempt === attempt) setState({ wait: null });
    }
  }, []);

  const connector = connectors[0];
  return {
    hasConnector: connector !== undefined,
    waiting: s.wait,
    error: s.error,
    connect: () => (connector ? run("connect", () => connectAsync({ connector })) : undefined),
    switchToSepolia: () => run("switch", () => switchAsync({ chainId: sepolia.id })),
    stop: walletWaitStore.stop,
    clearError: walletWaitStore.clearError,
  };
}

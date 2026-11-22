"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, fallback, http, injected } from "wagmi";
import { sepolia } from "wagmi/chains";
import { traceProvider } from "@/chain/wallet-trace";
import { RPC_URLS } from "@/config/chain";
import { WalletWaitNotice } from "./WalletWaitNotice";

type Eip1193 = Parameters<typeof traceProvider>[0];

// Injected wallets only. No WalletConnect: it needs a project id, which the repository rules keep out of
// tracked files (frontend/PLAN.md §3).
//
// One connector, for the browser's injected wallet (`window.ethereum`), which is the one the interface has
// always used. Its provider is wrapped by `traceProvider`, which only records which wallet requests were made
// and when they were answered (src/chain/wallet-trace.ts), so a stalled request can be described accurately.
// EIP-6963 multi-provider discovery is off: it registered the same wallet a second time under its own id,
// which the interface never offered, and on every page load wagmi's reconnect also connects every authorized
// connector whose provider is a different object, so one extension could be connected twice and its requests
// would bypass the trace. Reads never go through the wallet: they use the public endpoints below.
const config = createConfig({
  chains: [sepolia],
  multiInjectedProviderDiscovery: false,
  connectors: [
    injected({
      target: () => ({
        id: "injected",
        name: "Browser wallet",
        provider: (window) => {
          const p = (window as { ethereum?: Eip1193 } | undefined)?.ethereum;
          return (p ? traceProvider(p) : undefined) as never;
        },
      }),
    }),
  ],
  transports: { [sepolia.id]: fallback(RPC_URLS.map((url) => http(url))) },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 12_000, retry: 1, retryDelay: 1_000 } } }));
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
        <WalletWaitNotice />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, fallback, http, injected } from "wagmi";
import { sepolia } from "wagmi/chains";
import { RPC_URLS } from "@/config/chain";

// Injected wallets only (EIP-6963 discovery is on by default). No WalletConnect: it needs a
// project id, which the repository rules keep out of tracked files (frontend/PLAN.md §3).
const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: { [sepolia.id]: fallback(RPC_URLS.map((url) => http(url))) },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 12_000 } } }));
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

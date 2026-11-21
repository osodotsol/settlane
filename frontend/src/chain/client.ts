import { createPublicClient, fallback, http } from "viem";
import { CHAIN, RPC_URLS } from "@/config/chain";

/**
 * Read-only client for Sepolia, used by server components and the browser alike. View calls are
 * batched through Multicall3 (deployed on Sepolia); the second endpoint takes over when the first fails.
 */
export const publicClient = createPublicClient({
  chain: CHAIN,
  batch: { multicall: true },
  transport: fallback(RPC_URLS.map((url) => http(url, { timeout: 15_000, retryCount: 1 }))),
});

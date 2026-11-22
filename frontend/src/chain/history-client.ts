import { createPublicClient, fallback, http } from "viem";
import { CHAIN, HISTORY_RPC_URLS } from "@/config/chain";

/**
 * Read-only client for event LOGS. A pruned or failing node is skipped for the next one (viem's fallback); a range
 * that no node can serve surfaces as an error the history engine records as a gap, never as an empty result.
 * Contract state, balances and eligibility never come from here: they use `publicClient` and the live contract.
 */
export const historyClient = createPublicClient({
  chain: CHAIN,
  transport: fallback(HISTORY_RPC_URLS.map((url) => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }),
});

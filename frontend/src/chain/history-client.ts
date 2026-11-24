import { createPublicClient } from "viem";
import { adaptiveTransport } from "./adaptive-transport";
import { CHAIN, HISTORY_RPC_URLS } from "@/config/chain";

/**
 * Read-only client for event LOGS. A pruned, failing or hanging node is skipped for the next one, remembered for a
 * minute, and hedged after 2.5 s (adaptive-transport.ts); a range that no node can serve surfaces as an error the
 * history engine records as a gap, never as an empty result.
 * Contract state, balances and eligibility never come from here: they use `publicClient` and the live contract.
 */
export const historyClient = createPublicClient({
  chain: CHAIN,
  transport: adaptiveTransport(HISTORY_RPC_URLS, CHAIN, { timeout: 6_000, hedgeMs: 2_500, cooldownMs: 60_000 }),
});

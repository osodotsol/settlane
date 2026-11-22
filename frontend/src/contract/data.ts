import { createHash } from "node:crypto";
import { publicClient } from "@/chain/client";
import { SETTLANE_ADDRESS } from "@/config/chain";
import { SERVER_BUDGET_MS } from "@/chain/budget";
import { cached, type Cached } from "./cache";
import { history } from "./history-instance";
import type { History } from "./history";
import { latestBlockTime, readAgreement, readOverview, type Agreement } from "./read";

// Cached server-side reads used by the pages (see cache.ts). TTLs are short so a new agreement or a new
// event appears within seconds; Sepolia produces a block about every 12 s.
const TTL = 10_000;

export type Overview = Awaited<ReturnType<typeof readOverview>>;

export const getOverview = (): Promise<Cached<Overview>> => cached("overview", TTL, readOverview, SERVER_BUDGET_MS);

/** Events (verified snapshot + live scan) with an honest status. Never throws: a node outage is reported in `status`. */
export async function getHistory(): Promise<Cached<History>> {
  try {
    return await cached("history", TTL, () => history.refresh(), SERVER_BUDGET_MS);
  } catch (error) {
    // past the budget: what is already known (at least the verified snapshot), clearly marked as not refreshed
    return { value: history.peekStale(error instanceof Error ? error.message : "the newest blocks did not arrive in time"), fetchedAt: Date.now(), stale: true };
  }
}

export const getAgreement = (id: bigint): Promise<Cached<{ agreement: Agreement | null; blockTime: bigint }>> =>
  cached(
    `agreement:${id}`,
    TTL,
    async () => {
      const [agreement, blockTime] = await Promise.all([readAgreement(id), latestBlockTime()]);
      return { agreement, blockTime };
    },
    SERVER_BUDGET_MS,
  );

/** SHA-256 of the code deployed at the contract address (checked against the pinned build hash). */
export const getDeployedCodeHash = (): Promise<Cached<{ sha256: string; bytes: number }>> =>
  cached("code-hash", 60_000, async () => {
    const code = await publicClient.getCode({ address: SETTLANE_ADDRESS });
    const bytes = Buffer.from((code ?? "0x").slice(2), "hex");
    return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
  }, SERVER_BUDGET_MS);

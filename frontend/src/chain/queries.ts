"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { history } from "@/contract/history-instance";
import { latestBlockTime, readAgreement, readOverview } from "@/contract/read";
import { CLIENT_BUDGET_MS, withBudget } from "./budget";

// Browser-side reads of the deployed contract through the same read layer the server pages use (public,
// keyless Sepolia endpoints, Multicall3-batched). Nothing here needs a wallet. The block time returned with
// every read is the clock all windows are judged by, never the browser clock.
const POLL = 15_000;

export const keys = {
  overview: ["settlane", "overview"] as const,
  activity: ["settlane", "activity"] as const,
  agreement: (id: bigint) => ["settlane", "agreement", id.toString()] as const,
};

// Every query is time-bounded (R2 H2): one attempt waits at most CLIENT_BUDGET_MS; with the single retry configured in
// Providers.tsx, a page shows a clear failure state after about 25 s instead of loading forever. Data already shown
// stays on screen after a failed refresh, with a notice that it is not live (StaleNotice).
export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: () => withBudget(readOverview(), CLIENT_BUDGET_MS, "The Sepolia nodes"), refetchInterval: POLL });

/** Events (verified snapshot + live scan) with the status that says whether they are complete. */
// History never fails: past the budget it returns what is known (at least the verified snapshot), marked not refreshed.
// While the first read runs, the snapshot is shown at once as placeholder data (it is labelled incomplete until read).
// The placeholder is ONE object: a new object on every render (`peek()` carries a fresh read time) made React Query see
// new placeholder data on each render while a read hung, an infinite render loop (React #185, found by e2e/hang.spec.ts).
let placeholder: ReturnType<typeof history.peek> | undefined;
const historyPlaceholder = () => (placeholder ??= history.peek());

export const useHistory = () =>
  useQuery({
    queryKey: keys.activity,
    queryFn: () => withBudget(history.refresh(), CLIENT_BUDGET_MS, "The newest blocks").catch((e: Error) => history.peekStale(e.message)),
    placeholderData: historyPlaceholder,
    refetchInterval: POLL * 2,
  });

export function useAgreementData(id: bigint) {
  return useQuery({
    queryKey: keys.agreement(id),
    queryFn: () =>
      withBudget(
        Promise.all([readAgreement(id), latestBlockTime()]).then(([agreement, blockTime]) => ({ agreement, blockTime })),
        CLIENT_BUDGET_MS,
        "The Sepolia nodes",
      ),
    refetchInterval: POLL,
  });
}

/** After a confirmed transaction: refresh every list and the agreement itself. */
export function useRefreshChainData() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ["settlane"] }), [qc]);
}

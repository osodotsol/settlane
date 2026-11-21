"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { refreshActivity } from "@/contract/events";
import { latestBlockTime, readAgreement, readOverview } from "@/contract/read";

// Browser-side reads of the deployed contract through the same read layer the server pages use (public,
// keyless Sepolia endpoints, Multicall3-batched). Nothing here needs a wallet. The block time returned with
// every read is the clock all windows are judged by, never the browser clock.
const POLL = 15_000;

export const keys = {
  overview: ["settlane", "overview"] as const,
  activity: ["settlane", "activity"] as const,
  agreement: (id: bigint) => ["settlane", "agreement", id.toString()] as const,
};

export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: readOverview, refetchInterval: POLL });

export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: refreshActivity, refetchInterval: POLL * 2 });

export function useAgreementData(id: bigint) {
  return useQuery({
    queryKey: keys.agreement(id),
    queryFn: async () => {
      const [agreement, blockTime] = await Promise.all([readAgreement(id), latestBlockTime()]);
      return { agreement, blockTime };
    },
    refetchInterval: POLL,
  });
}

/** After a confirmed transaction: refresh every list and the agreement itself. */
export function useRefreshChainData() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ["settlane"] }), [qc]);
}

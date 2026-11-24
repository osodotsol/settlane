import type { Address } from "viem";
import { publicClient } from "./client";
import { latestBlockTime } from "@/contract/read";

/** The two reads a create needs before the wallet is asked. A failure is a result, never an unhandled rejection (final review M3). */
export async function readCreatePreflight(account: Address): Promise<{ ok: true; balance: bigint; blockTime: bigint } | { ok: false }> {
  try {
    const [balance, blockTime] = await Promise.all([publicClient.getBalance({ address: account }), latestBlockTime()]);
    return { ok: true, balance, blockTime };
  } catch {
    return { ok: false };
  }
}

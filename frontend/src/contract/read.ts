import { BaseError, ContractFunctionRevertedError, type Address } from "viem";
import { publicClient } from "@/chain/client";
import { SETTLANE_ADDRESS } from "@/config/chain";
import { storedState, type StoredState } from "@/domain/lifecycle";
import { settlaneAbi } from "./abi";

const contract = { address: SETTLANE_ADDRESS, abi: settlaneAbi } as const;

export type Milestone = {
  index: number;
  state: StoredState;
  amount: bigint;
  deliverBy: bigint;
  decideBy: bigint;
  spec: bigint;
  evidence: bigint;
  rejections: bigint;
  revision: bigint;
};

export type Agreement = {
  id: bigint;
  client: Address;
  provider: Address;
  verifier: Address;
  reviewPeriod: bigint;
  n: number;
  deposited: bigint;
  paid: bigint;
  refunded: bigint;
  outstanding: bigint;
  milestones: Milestone[];
};

/** True when `error` is the contract's own "unknown agreement" revert (not an RPC failure). */
function isUnknownAgreement(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError && revert.reason === "unknown agreement";
}

/** Latest block timestamp: the clock every window state is judged by (never the browser clock). */
export async function latestBlockTime(): Promise<bigint> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  return block.timestamp;
}

/**
 * Number of agreements: ids start at 1 and are consecutive (LIFECYCLE, D-018), so probe
 * `getAgreement` in batches until the first "unknown agreement" revert.
 */
export async function agreementCount(batch = 16): Promise<number> {
  let start = 1;
  for (;;) {
    const ids = Array.from({ length: batch }, (_, i) => BigInt(start + i));
    const results = await publicClient.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({ ...contract, functionName: "getAgreement" as const, args: [id] as const })),
    });
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === "failure") {
        if (isUnknownAgreement(r.error)) return start + i - 1;
        throw r.error;
      }
    }
    start += batch;
  }
}

/** One agreement with its accounting and used milestones, or null when the id does not exist. */
export async function readAgreement(id: bigint): Promise<Agreement | null> {
  let head: readonly [Address, Address, Address, bigint, number];
  try {
    head = await publicClient.readContract({ ...contract, functionName: "getAgreement", args: [id] });
  } catch (error) {
    if (isUnknownAgreement(error)) return null;
    throw error;
  }
  const [client, provider, verifier, reviewPeriod, n] = head;
  // Concurrent reads are aggregated into one Multicall3 request by the client (`batch.multicall`).
  const [accounting, ms] = await Promise.all([
    publicClient.readContract({ ...contract, functionName: "getAccounting", args: [id] }),
    Promise.all(Array.from({ length: n }, (_, m) => publicClient.readContract({ ...contract, functionName: "getMilestone", args: [id, m] }))),
  ]);
  const [deposited, paid, refunded, outstanding] = accounting;
  const milestones = ms.map((x, index) => ({
    index,
    state: storedState(x[0]),
    amount: x[1],
    deliverBy: x[2],
    decideBy: x[3],
    spec: x[4],
    evidence: x[5],
    rejections: x[6],
    revision: x[7],
  }));
  return { id, client, provider, verifier, reviewPeriod, n, deposited, paid, refunded, outstanding, milestones };
}

/** Every agreement, newest first, plus the global outstanding and the block time they were read at. */
export async function readOverview(): Promise<{ agreements: Agreement[]; totalOutstanding: bigint; blockTime: bigint }> {
  const [count, totalOutstanding, blockTime] = await Promise.all([
    agreementCount(),
    publicClient.readContract({ ...contract, functionName: "totalOutstanding" }),
    latestBlockTime(),
  ]);
  const ids = Array.from({ length: count }, (_, i) => BigInt(count - i));
  const agreements = (await Promise.all(ids.map((id) => readAgreement(id)))).filter((a): a is Agreement => a !== null);
  return { agreements, totalOutstanding, blockTime };
}

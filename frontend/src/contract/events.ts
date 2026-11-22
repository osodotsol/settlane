import { decodeEventLog, type Address, type Hex } from "viem";
import { settlaneAbi } from "./abi";

// Event decoding and merging helpers. Where the events come from (the verified snapshot, the live scan, the
// coverage checks) is in history.ts; the application never reads logs any other way.

export const CHUNK = 10_000n;
export const REORG_WINDOW = 64n;

export type ActivityKind = "created" | "submitted" | "approved" | "rejected" | "claimed" | "refunded";

export type Activity = {
  kind: ActivityKind;
  id: bigint;
  m: number | null;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  /** The hash of the block that held the log (identifies the block, so a reorganized block is told apart). */
  blockHash?: Hex;
  timestamp: bigint;
  evidence?: bigint;
  revision?: bigint;
  rejections?: bigint;
  to?: Address;
  amount?: bigint;
  client?: Address;
  provider?: Address;
  verifier?: Address;
  total?: bigint;
  milestones?: number;
};

/** The minimal log shape the decoder needs (what eth_getLogs returns, and what the fixtures record). */
export type RawLog = { topics: readonly Hex[]; data: Hex; blockNumber: bigint; logIndex: number; transactionHash: Hex; blockHash?: Hex | null };

/** Decodes one Settlane log. Returns null for anything that is not one of the six Settlane events. */
export function decodeActivity(log: RawLog, timestamp: bigint): Activity | null {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: settlaneAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
  } catch {
    return null;
  }
  const base = { blockNumber: log.blockNumber, logIndex: log.logIndex, txHash: log.transactionHash, ...(log.blockHash ? { blockHash: log.blockHash } : {}), timestamp };
  const a = decoded.args as Record<string, unknown>;
  switch (decoded.eventName) {
    case "AgreementCreated":
      return {
        ...base,
        kind: "created",
        id: a.id as bigint,
        m: null,
        client: a.client as Address,
        provider: a.provider as Address,
        verifier: a.verifier as Address,
        total: a.total as bigint,
        milestones: Number(a.milestones),
      };
    case "MilestoneSubmitted":
      return { ...base, kind: "submitted", id: a.id as bigint, m: Number(a.m), evidence: a.evidence as bigint, revision: a.revision as bigint };
    case "MilestoneApproved":
      return { ...base, kind: "approved", id: a.id as bigint, m: Number(a.m), evidence: a.evidence as bigint, revision: a.revision as bigint };
    case "MilestoneRejected":
      return {
        ...base,
        kind: "rejected",
        id: a.id as bigint,
        m: Number(a.m),
        evidence: a.evidence as bigint,
        revision: a.revision as bigint,
        rejections: a.rejections as bigint,
      };
    case "MilestoneClaimed":
      return { ...base, kind: "claimed", id: a.id as bigint, m: Number(a.m), to: a.to as Address, amount: a.amount as bigint };
    case "MilestoneRefunded":
      return { ...base, kind: "refunded", id: a.id as bigint, m: Number(a.m), to: a.to as Address, amount: a.amount as bigint };
    default:
      return null;
  }
}

/** Identity of an event: the block, the transaction and the position in it (blockHash when known). */
export const eventKey = (a: Pick<Activity, "txHash" | "logIndex" | "blockHash">) => `${(a.blockHash ?? "").toLowerCase()}:${a.txHash.toLowerCase()}:${a.logIndex}`;
const key = eventKey;

export function compareActivity(x: Activity, y: Activity): number {
  if (x.blockNumber !== y.blockNumber) return x.blockNumber < y.blockNumber ? -1 : 1;
  return x.logIndex - y.logIndex;
}

/**
 * Merges a re-scanned window into the known activity: every known entry at or after `windowFrom` is
 * replaced by what the re-scan returned (reorg-safe), duplicates collapse, and the result is ordered.
 */
export function mergeWindow(known: readonly Activity[], windowFrom: bigint, incoming: readonly Activity[]): Activity[] {
  const byKey = new Map<string, Activity>();
  for (const a of known) if (a.blockNumber < windowFrom) byKey.set(key(a), a);
  for (const a of incoming) byKey.set(key(a), a);
  return [...byKey.values()].sort(compareActivity);
}

/** Inclusive [from, to] split into chunks of at most `size` blocks. */
export function chunkRanges(from: bigint, to: bigint, size = CHUNK): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    out.push([start, end < to ? end : to]);
  }
  return out;
}

export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

import { decodeEventLog, type Address, type Hex } from "viem";
import { publicClient } from "@/chain/client";
import { DEPLOY_BLOCK, SETTLANE_ADDRESS } from "@/config/chain";
import { settlaneAbi } from "./abi";

// Activity history from the contract's own events (frontend/PLAN.md §3, §6).
// - Bounded queries: eth_getLogs in chunks of CHUNK blocks (publicnode accepts 10,000), CONCURRENCY at a time.
// - Incremental: after the first scan only new blocks are read, plus a REORG_WINDOW of recent blocks whose
//   entries are replaced (not merged), so a log from an orphaned block cannot survive a re-scan.
// - Deduplicated by (transaction hash, log index) and ordered by (block number, log index).
// Protocol ETH-transfer logs (EIP-7708, emitted by 0xfff…fffe) never match: the query filters on the contract address.

export const CHUNK = 10_000n;
export const REORG_WINDOW = 64n;
const CONCURRENCY = 4;

export type ActivityKind = "created" | "submitted" | "approved" | "rejected" | "claimed" | "refunded";

export type Activity = {
  kind: ActivityKind;
  id: bigint;
  m: number | null;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
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
export type RawLog = { topics: readonly Hex[]; data: Hex; blockNumber: bigint; logIndex: number; transactionHash: Hex };

/** Decodes one Settlane log. Returns null for anything that is not one of the six Settlane events. */
export function decodeActivity(log: RawLog, timestamp: bigint): Activity | null {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: settlaneAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
  } catch {
    return null;
  }
  const base = { blockNumber: log.blockNumber, logIndex: log.logIndex, txHash: log.transactionHash, timestamp };
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

const key = (a: Pick<Activity, "txHash" | "logIndex">) => `${a.txHash.toLowerCase()}:${a.logIndex}`;

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

async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

/** Fetches and decodes every Settlane log in [from, to]. */
export async function scanActivity(from: bigint, to: bigint): Promise<Activity[]> {
  if (to < from) return [];
  const ranges = chunkRanges(from, to);
  const logs = (
    await pool(ranges, CONCURRENCY, ([fromBlock, toBlock]) => publicClient.getLogs({ address: SETTLANE_ADDRESS, fromBlock, toBlock }))
  ).flat();
  const blocks = [...new Set(logs.map((l) => l.blockNumber).filter((b): b is bigint => b !== null))];
  const times = new Map<bigint, bigint>();
  await pool(blocks, CONCURRENCY, async (blockNumber) => {
    const block = await publicClient.getBlock({ blockNumber });
    times.set(blockNumber, block.timestamp);
  });
  const out: Activity[] = [];
  for (const l of logs) {
    if (l.blockNumber === null || l.logIndex === null || l.transactionHash === null || l.removed) continue;
    const a = decodeActivity(
      { topics: l.topics, data: l.data, blockNumber: l.blockNumber, logIndex: l.logIndex, transactionHash: l.transactionHash },
      times.get(l.blockNumber) ?? 0n,
    );
    if (a) out.push(a);
  }
  return out;
}

// Incremental state for this server process.
let known: Activity[] = [];
let scannedTo: bigint | null = null;

/** Every Settlane event from the deploy block to the latest block, ordered. */
export async function refreshActivity(): Promise<Activity[]> {
  const latest = await publicClient.getBlockNumber();
  const from = scannedTo === null ? DEPLOY_BLOCK : scannedTo - REORG_WINDOW + 1n > DEPLOY_BLOCK ? scannedTo - REORG_WINDOW + 1n : DEPLOY_BLOCK;
  const incoming = await scanActivity(from, latest);
  known = mergeWindow(known, from, incoming);
  scannedTo = latest;
  return known;
}

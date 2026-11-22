import { decodeActivity, eventKey, compareActivity, CHUNK, REORG_WINDOW, chunkRanges, pool, type Activity } from "./events";
import { snapshotFile, verifySnapshot, type LoadedSnapshot, type SnapshotFile } from "./snapshot";
import type { Hex } from "viem";

// Event history = a verified snapshot up to a finalized block + a live scan of every newer block.
//
// What it guarantees, and what it never does:
// - Events come only from the verified snapshot (checked at load) and from logs read from the chain now. Nothing is
//   invented, estimated or hard-coded. A snapshot that fails its checks, or is for another deployment, is ignored.
// - A range that cannot be read is recorded as a GAP with the node's error, retried on every refresh, and the history
//   is reported incomplete until every gap is closed. "Complete" is claimed only when there are no gaps, no conflicts
//   and every agreement's event counts match the contract's own state (history-coverage.ts).
// - The scan restarts a bounded REORG_WINDOW (64 blocks) behind the newest block it has read, and replaces what it
//   held in the rescanned part by what the chain now returns, so an orphaned block's logs cannot survive.
// - Where a rescan overlaps the (finalized) snapshot, the two must agree exactly; a difference is a CONFLICT that is
//   reported and makes the history incomplete.
// - Events are deduplicated by block hash, transaction hash and log index.
// - The history never authorizes anything. Agreement state, balances and eligibility are read from the live
//   contract (read.ts); this module cannot move or approve a transaction.

export type Gap = { from: bigint; to: bigint; error: string };

export type HistoryStatus = {
  /** The snapshot was verified and is in use. */
  snapshot: { used: boolean; lastVerifiedBlock: bigint | null; events: number; generatedAt: string | null; problem: string | null };
  /** The newest block the live scan has covered contiguously from its start (null before the first scan). */
  scannedTo: bigint | null;
  /** Block ranges that could not be read, with the node's error. Empty when nothing is missing. */
  gaps: Gap[];
  /** Differences between the snapshot and a rescan of the same blocks. */
  conflicts: string[];
  /** The newest block number could not be read on the last refresh (the live part is stale). */
  refreshError: string | null;
  /** No gaps, no conflicts, no refresh error and no snapshot problem. Per-agreement coverage is checked separately. */
  complete: boolean;
  readAt: number;
};

export type History = { events: Activity[]; status: HistoryStatus };

/** The part of a node the engine needs; `historyClient` satisfies it. Injectable for tests. */
export type LogSource = {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: { fromBlock: bigint; toBlock: bigint }): Promise<
    readonly { topics: readonly Hex[]; data: Hex; blockNumber: bigint | null; logIndex: number | null; transactionHash: Hex | null; blockHash: Hex | null; removed?: boolean }[]
  >;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

export type HistoryOptions = {
  source: LogSource;
  deployBlock: bigint;
  chainId: number;
  address: string;
  /** The snapshot file to use, if any (default: the committed one). Pass `null` for none. */
  snapshotFile?: SnapshotFile | null;
  chunk?: bigint;
  reorgWindow?: bigint;
  now?: () => number;
};

const message = (e: unknown) => (e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e)).slice(0, 160);

export function createHistory(opts: HistoryOptions) {
  const chunk = opts.chunk ?? CHUNK;
  const reorgWindow = opts.reorgWindow ?? REORG_WINDOW;
  const now = opts.now ?? Date.now;
  const file = opts.snapshotFile === undefined ? snapshotFile : opts.snapshotFile;

  let snapshot: LoadedSnapshot | null = null;
  let snapshotProblem: string | null = null;
  if (file) {
    const r = verifySnapshot(file, { chainId: opts.chainId, address: opts.address, deployBlock: opts.deployBlock });
    if (r.ok) snapshot = r.snapshot;
    // A snapshot for another deployment (the local test chain) is simply not used; any other failure is a problem.
    else if (!/different contract address|different deployment block|for chain/.test(r.reason)) snapshotProblem = r.reason;
  }

  let known: Activity[] = snapshot ? [...snapshot.events] : [];
  let scannedTo: bigint | null = snapshot ? snapshot.lastVerifiedBlock : null;
  let gaps: Gap[] = [];
  let conflicts: string[] = [];
  let refreshError: string | null = null;
  let started = false;
  let inflight: Promise<History> | null = null;

  const snapshotCeiling = snapshot?.lastVerifiedBlock ?? -1n;

  /**
   * One node can report a head the node that answers `getLogs` has not reached yet ("block range extends beyond
   * current head block"). That is not a pruned range: ask for a few blocks fewer. The blocks left out are read again
   * on the next refresh (the scan restarts a reorg window behind the newest block), so nothing is skipped.
   */
  async function getLogsTolerant(from: bigint, to: bigint) {
    let upper = to;
    for (let attempt = 0; ; attempt++) {
      try {
        return await opts.source.getLogs({ fromBlock: from, toBlock: upper });
      } catch (error) {
        const lag = /beyond (the )?current head|header not found|unknown block|block .* not found|not yet (available|indexed)/i.test(message(error));
        if (!lag || attempt >= 3 || upper - 3n < from) throw error;
        upper -= 3n;
      }
    }
  }

  /** Reads and decodes every Settlane log in [from, to] from the source, with block timestamps. Throws on any failure. */
  async function scanRange(from: bigint, to: bigint): Promise<Activity[]> {
    const logs = (await getLogsTolerant(from, to)).filter((l) => l.blockNumber !== null && l.logIndex !== null && l.transactionHash !== null && !l.removed);
    const times = new Map<bigint, bigint>();
    await pool([...new Set(logs.map((l) => l.blockNumber!))], 4, async (blockNumber) => {
      times.set(blockNumber, (await opts.source.getBlock({ blockNumber })).timestamp);
    });
    const out: Activity[] = [];
    for (const l of logs) {
      const a = decodeActivity({ topics: l.topics, data: l.data, blockNumber: l.blockNumber!, logIndex: l.logIndex!, transactionHash: l.transactionHash!, blockHash: l.blockHash }, times.get(l.blockNumber!) ?? 0n);
      if (a) out.push(a);
    }
    return out;
  }

  /** Replaces what is known in [from, to] by `incoming`, noting any disagreement with the finalized snapshot. */
  function replaceRange(from: bigint, to: bigint, incoming: readonly Activity[]) {
    const before = known.filter((a) => a.blockNumber >= from && a.blockNumber <= to);
    const inKeys = new Set(incoming.map(eventKey));
    for (const old of before) {
      // only finalized (snapshot) events are expected to be identical; newer ones may legitimately change in a reorg
      if (old.blockNumber <= snapshotCeiling && !inKeys.has(eventKey(old))) conflicts.push(`snapshot event ${old.txHash.slice(0, 10)}…:${old.logIndex} at block ${old.blockNumber} is not in the chain's logs now`);
    }
    if (snapshot) {
      const oldKeys = new Set(before.map(eventKey));
      for (const inc of incoming) if (inc.blockNumber <= snapshotCeiling && !oldKeys.has(eventKey(inc))) conflicts.push(`the chain has an event at block ${inc.blockNumber} (${inc.txHash.slice(0, 10)}…:${inc.logIndex}) that the snapshot does not`);
    }
    const byKey = new Map<string, Activity>();
    for (const a of known) if (a.blockNumber < from || a.blockNumber > to) byKey.set(eventKey(a), a);
    for (const a of incoming) byKey.set(eventKey(a), a);
    known = [...byKey.values()].sort(compareActivity);
  }

  const mergeRanges = (rs: { from: bigint; to: bigint }[]) => {
    const sorted = [...rs].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const out: { from: bigint; to: bigint }[] = [];
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (last && r.from <= last.to + 1n) last.to = r.to > last.to ? r.to : last.to;
      else out.push({ ...r });
    }
    return out;
  };

  async function refresh(): Promise<History> {
    refreshError = null;
    let latest: bigint;
    try {
      latest = await opts.source.getBlockNumber();
    } catch (error) {
      refreshError = message(error);
      return view();
    }
    conflicts = [];
    // 1. ranges to read: earlier gaps, plus everything from a bounded overlap behind the last scan to the newest block
    const windowFrom = scannedTo === null ? opts.deployBlock : scannedTo - reorgWindow + 1n > opts.deployBlock ? scannedTo - reorgWindow + 1n : opts.deployBlock;
    const wanted = mergeRanges([...gaps.map((g) => ({ from: g.from, to: g.to })), ...(windowFrom <= latest ? [{ from: windowFrom, to: latest }] : [])]);
    const todo = wanted.flatMap((r) => chunkRanges(r.from, r.to, chunk));
    // 2. read every chunk; a chunk that fails becomes a gap (with the node's error), never an empty result
    const failed: Gap[] = [];
    await pool(todo, 3, async ([from, to]) => {
      try {
        replaceRange(from, to, await scanRange(from, to));
      } catch (error) {
        failed.push({ from, to, error: message(error) });
      }
    });
    gaps = mergeRanges(failed).map((g) => ({ ...g, error: failed.find((f) => f.from >= g.from && f.to <= g.to)?.error ?? "unreadable" }));
    if (scannedTo === null || latest > scannedTo) scannedTo = latest;
    started = true;
    return view();
  }

  function view(): History {
    const status: HistoryStatus = {
      snapshot: { used: snapshot !== null, lastVerifiedBlock: snapshot?.lastVerifiedBlock ?? null, events: snapshot?.events.length ?? 0, generatedAt: snapshot?.generatedAt ?? null, problem: snapshotProblem },
      scannedTo,
      gaps: gaps.map((g) => ({ ...g })),
      conflicts: [...conflicts],
      refreshError,
      complete: started && gaps.length === 0 && conflicts.length === 0 && refreshError === null && snapshotProblem === null,
      readAt: now(),
    };
    return { events: [...known], status };
  }

  // A refresh asked for while another is running must not return that older read: it may predate a block the caller
  // just learned about (for example a transaction that confirmed a moment ago). Callers that arrive during a read
  // share ONE follow-up read that starts after it ends.
  let queued: Promise<History> | null = null;
  const start = (): Promise<History> => {
    inflight = refresh().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return {
    /** Reads new blocks and returns everything known. The read it returns started after this call. */
    refresh(): Promise<History> {
      if (!inflight) return start();
      if (!queued) {
        queued = inflight
          .catch(() => undefined)
          .then(() => {
            queued = null;
            return start();
          });
      }
      return queued;
    },
    /** What is known now, without reading anything. */
    peek: view,
  };
}

export type HistoryEngine = ReturnType<typeof createHistory>;

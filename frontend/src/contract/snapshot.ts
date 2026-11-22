import { keccak256, stringToBytes, type Hex } from "viem";
import { decodeActivity, eventKey, type Activity } from "./events";
import raw from "./history-snapshot.json";

// The verified event snapshot (scripts/build-event-snapshot.mjs, docs/EVENT_HISTORY.md): every Settlane event from the
// deployment block to a finalized block, as raw logs with block hash, transaction hash and log index. This module
// does not trust the file: it checks its structure, its content hash and that every log decodes, and it is used only
// for the deployment it describes (same chain and contract address). Anything wrong means the snapshot is IGNORED and
// the history is reported as incomplete, never silently used.

export type SnapshotFile = {
  chainId: number;
  address: string;
  deployBlock: string;
  lastVerifiedBlock: string;
  lastVerifiedBlockHash: Hex;
  agreements: number;
  generatedAt: string;
  provenance: { sources: string[]; method: string; finality: string; segments?: { from: string; to: string; sources: string[]; verifiedAt: string }[] };
  contentHash: string;
  events: { blockNumber: string; blockHash: Hex; transactionHash: Hex; logIndex: number; topics: Hex[]; data: Hex; timestamp: string }[];
};

export type LoadedSnapshot = {
  lastVerifiedBlock: bigint;
  lastVerifiedBlockHash: Hex;
  agreements: number;
  generatedAt: string;
  provenance: SnapshotFile["provenance"];
  events: Activity[];
};

export type SnapshotResult = { ok: true; snapshot: LoadedSnapshot } | { ok: false; reason: string };

/** The snapshot's content hash: a digest of the raw logs and timestamps in order (same recipe as the builder). */
export function snapshotContentHash(events: SnapshotFile["events"]): string {
  const canonical = events.map((e) => ({
    blockNumber: e.blockNumber,
    blockHash: e.blockHash,
    transactionHash: e.transactionHash,
    logIndex: e.logIndex,
    topics: e.topics,
    data: e.data,
    timestamp: e.timestamp,
  }));
  return "keccak256:" + keccak256(stringToBytes(JSON.stringify(canonical)));
}

/**
 * Checks a snapshot file for the given deployment and decodes it. Never throws: a problem is returned as a reason.
 */
export function verifySnapshot(file: SnapshotFile, expected: { chainId: number; address: string; deployBlock: bigint }): SnapshotResult {
  try {
    if (file.chainId !== expected.chainId) return { ok: false, reason: `the snapshot is for chain ${file.chainId}, not ${expected.chainId}` };
    if (file.address.toLowerCase() !== expected.address.toLowerCase()) return { ok: false, reason: "the snapshot is for a different contract address" };
    if (BigInt(file.deployBlock) !== expected.deployBlock) return { ok: false, reason: "the snapshot starts at a different deployment block" };
    const last = BigInt(file.lastVerifiedBlock);
    if (last < expected.deployBlock) return { ok: false, reason: "the snapshot's last verified block is before the deployment" };
    if (!/^0x[0-9a-f]{64}$/i.test(file.lastVerifiedBlockHash)) return { ok: false, reason: "the snapshot has no valid boundary block hash" };
    if (file.contentHash !== snapshotContentHash(file.events)) return { ok: false, reason: "the snapshot's content hash does not match its events (the file was changed)" };
    const events: Activity[] = [];
    const seen = new Set<string>();
    let previous: { block: bigint; index: number } | null = null;
    for (const e of file.events) {
      const blockNumber = BigInt(e.blockNumber);
      if (blockNumber < expected.deployBlock || blockNumber > last) return { ok: false, reason: `an event at block ${blockNumber} lies outside the snapshot's range` };
      if (previous && (blockNumber < previous.block || (blockNumber === previous.block && e.logIndex <= previous.index))) return { ok: false, reason: "the snapshot's events are not in chain order" };
      previous = { block: blockNumber, index: e.logIndex };
      const a = decodeActivity({ topics: e.topics, data: e.data, blockNumber, logIndex: e.logIndex, transactionHash: e.transactionHash, blockHash: e.blockHash }, BigInt(e.timestamp));
      if (!a) return { ok: false, reason: `the log at block ${blockNumber} is not a Settlane event` };
      const k = eventKey(a);
      if (seen.has(k)) return { ok: false, reason: "the snapshot contains a duplicate event" };
      seen.add(k);
      events.push(a);
    }
    if (file.agreements !== events.filter((e) => e.kind === "created").length) return { ok: false, reason: "the snapshot's agreement count does not match its AgreementCreated events" };
    const inconsistent = snapshotConsistency(events);
    if (inconsistent) return { ok: false, reason: `the snapshot's events break the contract's rules: ${inconsistent}` };
    return { ok: true, snapshot: { lastVerifiedBlock: last, lastVerifiedBlockHash: file.lastVerifiedBlockHash, agreements: file.agreements, generatedAt: file.generatedAt, provenance: file.provenance, events } };
  } catch (error) {
    return { ok: false, reason: `the snapshot could not be read: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

/**
 * Offline internal consistency (R2-B): the events, in chain order, must be a sequence the contract could have produced
 * (LIFECYCLE T1 to T6). Returns the first violation, or null. It cannot prove completeness (only the independent check
 * against the contract's state can, scripts/build-event-snapshot.mjs), but a missing, extra or reordered event usually
 * breaks one of these rules.
 */
export function snapshotConsistency(events: Activity[]): string | null {
  const created = new Map<bigint, number>(); // id -> milestones
  type M = { revision: bigint; rejections: bigint; submitted: boolean; approved: boolean; closed: boolean };
  const ms = new Map<string, M>();
  let nextId = 1n;
  for (const e of events) {
    const where = `agreement ${e.id}${e.m === null ? "" : ` milestone ${e.m + 1}`} at block ${e.blockNumber}`;
    if (e.kind === "created") {
      if (e.id !== nextId) return `AgreementCreated for id ${e.id} where id ${nextId} was next (ids are consecutive from 1)`;
      const n = e.milestones ?? 0;
      if (n < 1 || n > 3) return `AgreementCreated for id ${e.id} with ${n} milestones`;
      created.set(e.id, n);
      nextId++;
      continue;
    }
    const n = created.get(e.id);
    if (n === undefined) return `${where}: an event before its agreement was created`;
    if (e.m === null || e.m < 0 || e.m >= n) return `${where}: no such milestone`;
    const k = `${e.id}:${e.m}`;
    const st = ms.get(k) ?? { revision: 0n, rejections: 0n, submitted: false, approved: false, closed: false };
    ms.set(k, st);
    if (st.closed) return `${where}: an event after the milestone was paid or refunded`;
    switch (e.kind) {
      case "submitted":
        if (st.approved) return `${where}: a submission after approval`;
        if (e.revision !== st.revision + 1n) return `${where}: submission revision ${e.revision} after revision ${st.revision} (revisions are consecutive)`;
        st.revision = e.revision;
        st.submitted = true;
        break;
      case "approved":
        if (!st.submitted || st.approved) return `${where}: an approval without a pending submission`;
        if (e.revision !== st.revision) return `${where}: approval names revision ${e.revision}, the latest is ${st.revision}`;
        st.approved = true;
        break;
      case "rejected":
        if (!st.submitted || st.approved) return `${where}: a rejection without a pending submission`;
        if (e.revision !== st.revision) return `${where}: rejection names revision ${e.revision}, the latest is ${st.revision}`;
        if (e.rejections !== st.rejections + 1n) return `${where}: rejection count ${e.rejections} after ${st.rejections} (counts are consecutive)`;
        st.rejections = e.rejections;
        st.submitted = false;
        break;
      case "claimed":
        if (!st.approved) return `${where}: a claim without an approval`;
        st.closed = true;
        break;
      case "refunded":
        if (st.approved) return `${where}: a refund after approval`;
        st.closed = true;
        break;
    }
  }
  return null;
}

/** The committed snapshot file. */
export const snapshotFile = raw as unknown as SnapshotFile;

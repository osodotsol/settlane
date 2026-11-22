import { describe, expect, it } from "vitest";
import { DEPLOY_BLOCK, SETTLANE_ADDRESS } from "@/config/chain";
import { decodeActivity } from "@/contract/events";
import { snapshotConsistency, snapshotContentHash, snapshotFile, verifySnapshot, type SnapshotFile } from "@/contract/snapshot";

// R2-B part 3: DETERMINISTIC, OFFLINE integrity of the committed event snapshot (CI step "Snapshot integrity").
// This is separate from the independent check against archival nodes (scripts/build-event-snapshot.mjs --check), which
// needs the network. Passing here means the file is well formed, unchanged since it was hashed, and a sequence the
// contract could have produced. It does not prove completeness against the chain; that is the independent check's job.

const expected = { chainId: 11155111, address: SETTLANE_ADDRESS, deployBlock: DEPLOY_BLOCK };
const clone = (): SnapshotFile => JSON.parse(JSON.stringify(snapshotFile));
/** A tampered copy whose content hash is RECOMPUTED, so only the structural and lifecycle rules can catch it. */
const rehash = (f: SnapshotFile) => ({ ...f, contentHash: snapshotContentHash(f.events) });
const kinds = (f: SnapshotFile) =>
  f.events.map((e) => decodeActivity({ topics: e.topics, data: e.data, blockNumber: BigInt(e.blockNumber), logIndex: e.logIndex, transactionHash: e.transactionHash, blockHash: e.blockHash }, BigInt(e.timestamp))!.kind);

describe("the committed snapshot, offline", () => {
  it("is for this deployment, unchanged since it was hashed, decodes completely and follows the contract's rules", () => {
    const r = verifySnapshot(snapshotFile, expected);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.snapshot.events.length).toBe(snapshotFile.events.length);
    expect(r.snapshot.agreements).toBe(r.snapshot.events.filter((e) => e.kind === "created").length);
    expect(snapshotConsistency(r.snapshot.events)).toBeNull();
    expect(snapshotFile.provenance.sources.length).toBeGreaterThanOrEqual(2); // recorded as verified by two sources
    expect(new Set(snapshotFile.provenance.sources.map((u) => new URL(u).hostname)).size).toBe(snapshotFile.provenance.sources.length);
  });

  it("rejects an edited byte (content hash)", () => {
    const f = clone();
    f.events[0]!.data = (f.events[0]!.data.slice(0, -1) + (f.events[0]!.data.endsWith("0") ? "1" : "0")) as `0x${string}`;
    expect(verifySnapshot(f, expected)).toMatchObject({ ok: false, reason: expect.stringContaining("content hash") });
  });

  it("rejects a removed event even when the hash is recomputed (lifecycle rules)", () => {
    const f = clone();
    const i = kinds(f).indexOf("submitted");
    expect(i).toBeGreaterThanOrEqual(0);
    f.events.splice(i, 1);
    expect(verifySnapshot(rehash(f), expected)).toMatchObject({ ok: false, reason: expect.stringContaining("contract's rules") });
  });

  it("rejects a removed AgreementCreated even when the agreement count is lowered to match", () => {
    const f = clone();
    const i = kinds(f).indexOf("created");
    f.events.splice(i, 1);
    f.agreements -= 1;
    expect(verifySnapshot(rehash(f), expected)).toMatchObject({ ok: false });
  });

  it("rejects a duplicated event, a reordering, a wrong agreement count, an event outside the range and another deployment", () => {
    const dup = clone();
    dup.events.splice(1, 0, dup.events[1]!);
    expect(verifySnapshot(rehash(dup), expected).ok).toBe(false);
    const swapped = clone();
    [swapped.events[0], swapped.events[1]] = [swapped.events[1]!, swapped.events[0]!];
    expect(verifySnapshot(rehash(swapped), expected).ok).toBe(false);
    expect(verifySnapshot({ ...clone(), agreements: snapshotFile.agreements + 1 }, expected)).toMatchObject({ ok: false, reason: expect.stringContaining("agreement count") });
    expect(verifySnapshot({ ...clone(), lastVerifiedBlock: String(BigInt(snapshotFile.events.at(-1)!.blockNumber) - 1n) }, expected)).toMatchObject({ ok: false, reason: expect.stringContaining("outside") });
    expect(verifySnapshot(clone(), { ...expected, chainId: 1 }).ok).toBe(false);
    expect(verifySnapshot(clone(), { ...expected, address: "0x0000000000000000000000000000000000000001" }).ok).toBe(false);
  });
});

describe("lifecycle consistency rules", () => {
  const ev = (kind: string, id: bigint, m: number | null, extra: object = {}) => ({ kind, id, m, blockNumber: 1n, logIndex: 0, txHash: "0x" as const, timestamp: 0n, ...extra }) as never;
  it("accepts submit, reject, resubmit, approve, claim; and submit then refund", () => {
    expect(
      snapshotConsistency([
        ev("created", 1n, null, { milestones: 2 }),
        ev("submitted", 1n, 0, { revision: 1n }),
        ev("rejected", 1n, 0, { revision: 1n, rejections: 1n }),
        ev("submitted", 1n, 0, { revision: 2n }),
        ev("submitted", 1n, 0, { revision: 3n }), // resubmission while submitted
        ev("approved", 1n, 0, { revision: 3n }),
        ev("claimed", 1n, 0),
        ev("submitted", 1n, 1, { revision: 1n }),
        ev("refunded", 1n, 1),
      ]),
    ).toBeNull();
  });
  it("names the first broken rule", () => {
    expect(snapshotConsistency([ev("created", 2n, null, { milestones: 1 })])).toContain("consecutive");
    expect(snapshotConsistency([ev("created", 1n, null, { milestones: 1 }), ev("claimed", 1n, 0)])).toContain("without an approval");
    expect(snapshotConsistency([ev("created", 1n, null, { milestones: 1 }), ev("submitted", 1n, 0, { revision: 2n })])).toContain("consecutive");
    expect(snapshotConsistency([ev("created", 1n, null, { milestones: 1 }), ev("submitted", 1n, 0, { revision: 1n }), ev("approved", 1n, 0, { revision: 1n }), ev("refunded", 1n, 0)])).toContain("refund after approval");
    expect(snapshotConsistency([ev("created", 1n, null, { milestones: 1 }), ev("submitted", 1n, 1, { revision: 1n })])).toContain("no such milestone");
    expect(snapshotConsistency([ev("created", 1n, null, { milestones: 1 }), ev("refunded", 1n, 0), ev("submitted", 1n, 0, { revision: 1n })])).toContain("after the milestone was paid or refunded");
  });
});

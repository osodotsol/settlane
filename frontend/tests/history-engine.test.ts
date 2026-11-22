import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { settlaneAbi } from "@/contract/abi";
import { createHistory, type LogSource } from "@/contract/history";
import { snapshotContentHash, snapshotFile, verifySnapshot, type SnapshotFile } from "@/contract/snapshot";
import { agreementCoverage, aggregateCoverage, describeHistory } from "@/domain/history-coverage";

const ADDR = "0xf79d229a039bf5c84ecc7327060f8bbc888d2182";
const CLIENT = "0x00000000000000000000000000000000000000c1";
const PROVIDER = "0x00000000000000000000000000000000000000b2";
const VERIFIER = "0x00000000000000000000000000000000000000a3";
const hex = (n: number, pad = 64) => `0x${n.toString(16).padStart(pad, "0")}` as Hex;
const DEPLOY = 100n;

type Fake = { blockNumber: bigint; blockHash: Hex; transactionHash: Hex; logIndex: number; topics: Hex[]; data: Hex };
let seq = 1;
/** A syntactically real Settlane log (encoded with the ABI), at a block, with a given block hash. */
function log(kind: "created" | "submitted" | "approved" | "claimed" | "refunded", id: bigint, block: bigint, blockHash = hex(Number(block) + 0x1000), logIndex = 0): Fake {
  const tx = hex(seq++ + 0xabc000);
  const e = (name: string, args: Record<string, unknown>, types: { type: string }[], values: unknown[]) => ({
    topics: encodeEventTopics({ abi: settlaneAbi, eventName: name, args } as never),
    data: encodeAbiParameters(types as never, values as never),
  });
  const body =
    kind === "created"
      ? e("AgreementCreated", { id, client: CLIENT, provider: PROVIDER }, [{ type: "address" }, { type: "uint256" }, { type: "uint8" }], [VERIFIER, 5n, 1])
      : kind === "submitted"
        ? e("MilestoneSubmitted", { id, m: 0, evidence: 7n }, [{ type: "uint256" }], [1n])
        : kind === "approved"
          ? e("MilestoneApproved", { id, m: 0, evidence: 7n }, [{ type: "uint256" }], [1n])
          : kind === "claimed"
            ? e("MilestoneClaimed", { id, m: 0, to: PROVIDER }, [{ type: "uint256" }], [5n])
            : e("MilestoneRefunded", { id, m: 0, to: CLIENT }, [{ type: "uint256" }], [5n]);
  return { blockNumber: block, blockHash, transactionHash: tx, logIndex, topics: body.topics as Hex[], data: body.data };
}

type World = { head: bigint; logs: Fake[]; fail: (from: bigint, to: bigint) => string | null; headError: string | null; calls: { from: bigint; to: bigint }[] };
function world(partial: Partial<World> = {}): World & { source: LogSource } {
  const w: World = { head: 1000n, logs: [], fail: () => null, headError: null, calls: [], ...partial };
  const source: LogSource = {
    getBlockNumber: async () => {
      if (w.headError) throw new Error(w.headError);
      return w.head;
    },
    getLogs: async ({ fromBlock, toBlock }) => {
      w.calls.push({ from: fromBlock, to: toBlock });
      const err = w.fail(fromBlock, toBlock);
      if (err) throw new Error(err);
      return w.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock && l.blockNumber <= w.head);
    },
    getBlock: async ({ blockNumber }) => ({ timestamp: blockNumber * 12n }),
  };
  return Object.assign(w, { source });
}

/** A snapshot file for the given logs, with its content hash, up to `last`. */
function snap(logs: Fake[], last: bigint, over: Partial<SnapshotFile> = {}): SnapshotFile {
  const events = logs.map((l) => ({ blockNumber: l.blockNumber.toString(), blockHash: l.blockHash, transactionHash: l.transactionHash, logIndex: l.logIndex, topics: l.topics, data: l.data, timestamp: (l.blockNumber * 12n).toString() }));
  return { chainId: 11155111, address: ADDR, deployBlock: DEPLOY.toString(), lastVerifiedBlock: last.toString(), lastVerifiedBlockHash: hex(Number(last) + 0x1000), agreements: 1, generatedAt: "2026-01-01T00:00:00Z", provenance: { sources: [], method: "test", finality: "test" }, contentHash: snapshotContentHash(events), events, ...over };
}
const engine = (w: ReturnType<typeof world>, file: SnapshotFile | null, extra = {}) =>
  createHistory({ source: w.source, deployBlock: DEPLOY, chainId: 11155111, address: ADDR, snapshotFile: file, chunk: 100n, reorgWindow: 10n, ...extra });
const kinds = (h: { events: { kind: string }[] }) => h.events.map((e) => e.kind);

describe("the committed snapshot", () => {
  const r = verifySnapshot(snapshotFile, { chainId: 11155111, address: ADDR, deployBlock: 12175958n });
  it("passes every integrity check for this deployment", () => {
    expect(r.ok).toBe(true);
  });
  it("holds exactly the twelve events of agreements 1 to 4, in chain order, with the recorded hashes and blocks", () => {
    if (!r.ok) throw new Error(r.reason);
    const seen = r.snapshot.events.map((e) => `${e.id}:${e.kind}@${e.blockNumber}:${e.txHash}`);
    expect(seen).toEqual([
      "1:created@12176008:0x661752e47fe7076b7f54f4bb33c6ec32bd0e1222e80f4d8c93e4131a55f470b3",
      "1:submitted@12176039:0xe01e80607d67f72ae9374bde613afc0d3fcc1a25b5fc50dc6ee696e548f78c04",
      "1:approved@12176144:0x234075c6df23ba987c0fa68dc66e0d9652c68dd9bc45423d2da142034696fdf3",
      "1:claimed@12176195:0xf1a40207a9f407f5f1d9994b213e4980dd6d8083593b9e68dd70734a60f771cc",
      "2:created@12176230:0xdb4d4d75e2d2aa2d505696ced033032e74c322b175267cb41079b28e12c0c4f2",
      "2:refunded@12176299:0xa9a25f2197a906340c285afb908959cc0952b6c1f2c019c23419a36862df398d",
      "3:created@12185976:0x48c9ddc9c628ff81079d554360ef99aa8c8388235365d7624322feae1b84fe10",
      "3:refunded@12186149:0xf8dfb824accf25d64be41e7d688cb77631f0b87593da387a841b6347e1d90569",
      "4:created@12186214:0xd5ec3e77ecfea1880f34b2d60dfe31d5ce4d23eee7d139d37c44218bc82fa721",
      "4:submitted@12186229:0x115005cd0390e0b555441dfe6900453589a43e1bd8e562ace5a38be57df55c29",
      "4:approved@12186296:0x59e0470975aaa630b3f8d417bd1e32bf6c7332da01dc9bf21d43b2b1595b5589",
      "4:claimed@12186326:0xf8a54e2aa7e155d3e0b130bb208665713a8c31e37e63dc396068adc83bd7dca4",
    ]);
  });
  it("records its provenance and a boundary at or after the last known event", () => {
    if (!r.ok) throw new Error(r.reason);
    expect(r.snapshot.lastVerifiedBlock).toBeGreaterThanOrEqual(12186326n);
    expect(snapshotFile.provenance.sources).toHaveLength(2);
    expect(snapshotFile.lastVerifiedBlockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(snapshotFile.agreements).toBe(4);
  });
  it("the events decode to the exact recorded amounts, recipients and revisions", () => {
    if (!r.ok) throw new Error(r.reason);
    const by = (id: bigint, kind: string) => r.snapshot.events.find((e) => e.id === id && e.kind === kind)!;
    expect(by(1n, "claimed")).toMatchObject({ amount: 1_000_000_000_000_000n, to: "0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4" });
    expect(by(2n, "refunded")).toMatchObject({ amount: 1_000_000_000_000_000n, to: "0xBf267532e755a1C002B4749dC3fdedAffB154706" });
    expect(by(3n, "refunded")).toMatchObject({ amount: 200_000_000_000_000n, to: "0xBf267532e755a1C002B4749dC3fdedAffB154706" });
    expect(by(4n, "claimed")).toMatchObject({ amount: 200_000_000_000_000n, to: "0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4" });
    expect(by(4n, "submitted")).toMatchObject({ revision: 1n, evidence: BigInt("0x916f9678cbeaa6fe5e7f51be5717a3772498237003ab709e3c6c63a5d9efdee1") });
  });
});

describe("snapshot integrity (a changed or foreign file is never used)", () => {
  const l = [log("created", 1n, 120n)];
  const check = (file: SnapshotFile) => verifySnapshot(file, { chainId: 11155111, address: ADDR, deployBlock: DEPLOY });
  it("accepts a consistent file", () => expect(check(snap(l, 150n)).ok).toBe(true));
  it("rejects a changed event, a wrong chain, another contract, another start block and a bad boundary", () => {
    const good = snap(l, 150n);
    expect(check({ ...good, events: [{ ...good.events[0]!, logIndex: 5 }] })).toMatchObject({ ok: false, reason: expect.stringMatching(/content hash/) });
    expect(check({ ...good, chainId: 1 })).toMatchObject({ ok: false });
    expect(check({ ...good, address: "0x0000000000000000000000000000000000000001" })).toMatchObject({ ok: false });
    expect(check({ ...good, deployBlock: "99" })).toMatchObject({ ok: false });
    expect(check({ ...good, lastVerifiedBlockHash: "0x12" as Hex })).toMatchObject({ ok: false });
    expect(check({ ...good, lastVerifiedBlock: "110" })).toMatchObject({ ok: false, reason: expect.stringMatching(/outside/) });
  });
  it("rejects unordered events, duplicates and logs that are not Settlane events", () => {
    const a = log("created", 1n, 120n);
    const b = log("submitted", 1n, 130n);
    expect(check(snap([b, a], 150n))).toMatchObject({ ok: false, reason: expect.stringMatching(/chain order/) });
    expect(check(snap([a, { ...a }], 150n))).toMatchObject({ ok: false });
    const junk = { ...a, topics: [hex(1)] as Hex[] };
    expect(check(snap([junk], 150n))).toMatchObject({ ok: false, reason: expect.stringMatching(/not a Settlane event/) });
  });
});

describe("history engine: snapshot plus live scan", () => {
  it("serves the snapshot immediately, then finds events after the boundary, exactly once", async () => {
    const created = log("created", 1n, 120n);
    const submitted = log("submitted", 1n, 600n);
    const w = world({ logs: [created, submitted], head: 700n });
    const e = engine(w, snap([created], 500n));
    expect(kinds(e.peek())).toEqual(["created"]); // before any network read
    const h = await e.refresh();
    expect(kinds(h)).toEqual(["created", "submitted"]);
    expect(h.status.complete).toBe(true);
    expect(h.status.snapshot).toMatchObject({ used: true, lastVerifiedBlock: 500n, events: 1 });
    // the old range is never requested: the scan starts a bounded overlap behind the boundary
    expect(Math.min(...w.calls.map((c) => Number(c.from)))).toBe(491);
    const again = await e.refresh();
    expect(kinds(again)).toEqual(["created", "submitted"]); // refreshing does not duplicate
  });

  it("new events keep arriving on later refreshes", async () => {
    const w = world({ logs: [log("created", 1n, 120n)], head: 700n });
    const e = engine(w, snap([w.logs[0]!], 500n));
    await e.refresh();
    w.logs.push(log("submitted", 1n, 710n));
    w.head = 720n;
    expect(kinds(await e.refresh())).toEqual(["created", "submitted"]);
    w.logs.push(log("approved", 1n, 730n));
    w.head = 740n;
    expect(kinds(await e.refresh())).toEqual(["created", "submitted", "approved"]);
  });

  it("without a snapshot (another deployment) it scans from the deployment block", async () => {
    const w = world({ logs: [log("created", 1n, 120n)], head: 400n });
    const h = await engine(w, null).refresh();
    expect(kinds(h)).toEqual(["created"]);
    expect(h.status.snapshot.used).toBe(false);
    expect(Math.min(...w.calls.map((c) => Number(c.from)))).toBe(100);
    expect(h.status.complete).toBe(true);
  });

  it("a snapshot for a different contract is ignored quietly; a damaged one is reported", async () => {
    const w = world({ logs: [], head: 300n });
    const foreign = await engine(w, snap([], 200n, { address: "0x0000000000000000000000000000000000000001" })).refresh();
    expect(foreign.status.snapshot).toMatchObject({ used: false, problem: null });
    const damaged = await engine(w, { ...snap([], 200n), contentHash: "keccak256:0x00" }).refresh();
    expect(damaged.status.snapshot.used).toBe(false);
    expect(damaged.status.snapshot.problem).toMatch(/content hash/);
    expect(damaged.status.complete).toBe(false);
  });
});

describe("pruned history, partial responses and outages", () => {
  const PRUNED = "4444 pruned history unavailable";
  it("a pruned range becomes a gap with the node's error, never an empty result", async () => {
    const w = world({ logs: [log("created", 1n, 120n), log("submitted", 1n, 350n)], head: 400n, fail: (f, t) => (f <= 150n && t >= 100n ? PRUNED : null) });
    const h = await engine(w, null).refresh();
    expect(h.status.complete).toBe(false);
    expect(h.status.gaps).toHaveLength(1);
    expect(h.status.gaps[0]).toMatchObject({ from: 100n, error: expect.stringContaining("pruned history unavailable") });
    expect(kinds(h)).toEqual(["submitted"]); // what could be read is kept; the creation is NOT invented
    expect(describeHistory(h.status).level).toBe("incomplete");
  });

  it("a gap is retried on every refresh and closes when the range becomes readable", async () => {
    let broken = true;
    const w = world({ logs: [log("created", 1n, 120n)], head: 300n, fail: (f, t) => (broken && f <= 150n && t >= 100n ? PRUNED : null) });
    const e = engine(w, null);
    expect((await e.refresh()).status.gaps).toHaveLength(1);
    broken = false;
    const h = await e.refresh();
    expect(h.status.gaps).toHaveLength(0);
    expect(kinds(h)).toEqual(["created"]);
    expect(h.status.complete).toBe(true);
  });

  it("one failing chunk does not discard the others (partial response)", async () => {
    const w = world({ logs: [log("created", 1n, 120n), log("submitted", 1n, 250n), log("approved", 1n, 380n)], head: 399n, fail: (f) => (f === 200n ? "boom" : null) });
    const h = await engine(w, null).refresh();
    expect(kinds(h)).toEqual(["created", "approved"]);
    expect(h.status.gaps.map((g) => [g.from, g.to])).toEqual([[200n, 299n]]);
    expect(h.status.complete).toBe(false);
  });

  it("when the newest block cannot be read, the snapshot's events are still served and the status says so", async () => {
    const w = world({ logs: [], head: 700n, headError: "ETIMEDOUT" });
    const created = log("created", 1n, 120n);
    const h = await engine(w, snap([created], 500n)).refresh();
    expect(kinds(h)).toEqual(["created"]);
    expect(h.status).toMatchObject({ complete: false, refreshError: "ETIMEDOUT" });
    expect(describeHistory(h.status).detail).toMatch(/newest blocks could not be read/);
  });

  it("a recovered node completes the history on the next refresh", async () => {
    const created = log("created", 1n, 120n);
    const w = world({ logs: [created], head: 700n, headError: "ETIMEDOUT" });
    const e = engine(w, snap([created], 500n));
    await e.refresh();
    w.headError = null;
    const h = await e.refresh();
    expect(h.status.complete).toBe(true);
    expect(h.status.refreshError).toBeNull();
  });
});

describe("duplicates, ordering and reorganizations", () => {
  it("collapses a log returned twice and orders by block then log index", async () => {
    const a = log("created", 1n, 200n);
    const b = log("submitted", 1n, 200n, a.blockHash, 3);
    const w = world({ logs: [b, a, { ...a }], head: 300n });
    const h = await engine(w, null).refresh();
    expect(kinds(h)).toEqual(["created", "submitted"]);
    expect(h.events.map((e) => e.logIndex)).toEqual([0, 3]);
  });

  it("a reorganization near the boundary replaces the orphaned block's events (different block hash)", async () => {
    const orphan = log("submitted", 1n, 695n, hex(0xdead));
    const w = world({ logs: [orphan], head: 700n });
    const e = engine(w, null, { reorgWindow: 20n });
    expect(kinds(await e.refresh())).toEqual(["submitted"]);
    // the chain reorganizes: block 695 now has a different hash and a different transaction
    const replacement = log("submitted", 1n, 695n, hex(0xbeef));
    w.logs = [replacement];
    w.head = 703n;
    const h = await e.refresh();
    expect(h.events).toHaveLength(1);
    expect(h.events[0]!.txHash).toBe(replacement.transactionHash);
    expect(h.events[0]!.blockHash).toBe(hex(0xbeef));
  });

  it("a reorganized-away event disappears; one that moved block appears once", async () => {
    const x = log("submitted", 1n, 690n);
    const w = world({ logs: [x], head: 700n });
    const e = engine(w, null, { reorgWindow: 30n });
    await e.refresh();
    w.logs = [{ ...x, blockNumber: 702n, blockHash: hex(0xcafe) }]; // same transaction, included later
    w.head = 705n;
    const h = await e.refresh();
    expect(h.events.map((a) => a.blockNumber)).toEqual([702n]);
  });

  it("the finalized snapshot and a rescan of the same blocks must agree: a difference is a conflict, not a silent merge", async () => {
    const created = log("created", 1n, 495n);
    const w = world({ logs: [], head: 520n }); // the chain shows NO event at 495
    const h = await engine(w, snap([created], 500n)).refresh();
    expect(h.status.conflicts.length).toBeGreaterThan(0);
    expect(h.status.complete).toBe(false);
    expect(describeHistory(h.status).detail).toMatch(/disagree/);
    // and the other direction: the chain has an event the snapshot lacks
    const extra = log("approved", 1n, 498n);
    const w2 = world({ logs: [created, extra], head: 520n });
    const h2 = await engine(w2, snap([created], 500n)).refresh();
    expect(h2.status.conflicts.some((c) => /does not/.test(c))).toBe(true);
  });

  it("an unchanged overlap with the snapshot is not a conflict", async () => {
    const created = log("created", 1n, 495n);
    const w = world({ logs: [created], head: 520n });
    const h = await engine(w, snap([created], 500n)).refresh();
    expect(h.status.conflicts).toEqual([]);
    expect(kinds(h)).toEqual(["created"]);
  });

  it("callers that arrive during a read share one follow-up read, so no caller gets a result older than its call", async () => {
    const w = world({ logs: [log("created", 1n, 120n)], head: 300n });
    const e = engine(w, null);
    const results = await Promise.all([e.refresh(), e.refresh(), e.refresh()]);
    expect(w.calls.length).toBeLessThan(9); // one read plus one shared follow-up, not three full reads
    expect(results.every((r) => kinds(r).length === 1)).toBe(true);
  });

  it("an event that appears while a read is running is in the result of a refresh asked for after it", async () => {
    const w = world({ logs: [log("created", 1n, 120n)], head: 300n });
    const e = engine(w, null);
    const first = e.refresh(); // starts reading at head 300
    w.logs.push(log("submitted", 1n, 305n)); // a block lands and a transaction confirms...
    w.head = 310n;
    const second = await e.refresh(); // ...and the page asks again at once
    expect(kinds(second)).toEqual(["created", "submitted"]);
    expect(kinds(await first)).toContain("created");
  });
});

describe("a node that lags the head it reported", () => {
  it("retries a few blocks lower instead of recording a gap, and reads the rest next time", async () => {
    const created = log("created", 1n, 120n);
    const submitted = log("submitted", 1n, 399n);
    let nodeHead = 397n; // the log-serving node is two blocks behind the node that said 399
    const w = world({ logs: [created, submitted], head: 399n });
    const inner = w.source.getLogs;
    w.source.getLogs = async (a) => {
      if (a.toBlock > nodeHead) throw new Error(`block range extends beyond current head block: requested ${a.toBlock}, head ${nodeHead}`);
      return inner(a);
    };
    const e = engine(w, null);
    const h = await e.refresh();
    expect(h.status.gaps).toEqual([]);
    expect(h.status.complete).toBe(true);
    expect(kinds(h)).toEqual(["created"]); // block 399 not served yet
    nodeHead = 399n;
    expect(kinds(await e.refresh())).toEqual(["created", "submitted"]); // picked up by the overlap
  });
  it("a different error is still a gap", async () => {
    const w = world({ logs: [], head: 300n, fail: () => "4444 pruned history unavailable" });
    expect((await engine(w, null).refresh()).status.gaps.length).toBeGreaterThan(0);
  });
});

describe("coverage: complete only when the events match the contract's state", () => {
  const ms = (state: string, revision = 0n, rejections = 0n) => ({ index: 0, state: state as never, amount: 5n, deliverBy: 0n, decideBy: 0n, spec: 1n, evidence: 0n, rejections, revision });
  const events = (spec: [Parameters<typeof log>[0], bigint][]) => spec.map(([k, id], i) => ({ ...(verify(log(k, id, 100n + BigInt(i)))) }));
  function verify(l: Fake) {
    const r = verifySnapshot(snap([l], 200n), { chainId: 11155111, address: ADDR, deployBlock: DEPLOY });
    if (!r.ok) throw new Error(r.reason);
    return r.snapshot.events[0]!;
  }
  it("a paid agreement needs created, one submission, one approval and one claim", () => {
    const a = { id: 1n, milestones: [ms("paid", 1n)] };
    expect(agreementCoverage(a, events([["created", 1n], ["submitted", 1n], ["approved", 1n], ["claimed", 1n]])).complete).toBe(true);
    const missing = agreementCoverage(a, events([["created", 1n], ["submitted", 1n], ["claimed", 1n]]));
    expect(missing).toMatchObject({ complete: false, missing: ["1 approval"] });
  });
  it("a refunded agreement needs created and a refund; a funded one only its creation", () => {
    expect(agreementCoverage({ id: 2n, milestones: [ms("refunded")] }, events([["created", 2n], ["refunded", 2n]])).complete).toBe(true);
    expect(agreementCoverage({ id: 3n, milestones: [ms("funded")] }, events([["created", 3n]])).complete).toBe(true);
    expect(agreementCoverage({ id: 3n, milestones: [ms("funded")] }, []).missing).toEqual(["1 creation"]);
  });
  it("more events than the state allows is inconsistent, and other agreements' events do not count", () => {
    const a = { id: 3n, milestones: [ms("funded")] };
    const c = agreementCoverage(a, events([["created", 3n], ["created", 3n], ["created", 9n]]));
    expect(c).toMatchObject({ complete: false, extra: ["1 creation"] });
  });
  it("the page never says 'complete' for a history with missing events, and names what is missing", () => {
    const a = { id: 1n, milestones: [ms("paid", 1n)] };
    const cov = agreementCoverage(a, events([["created", 1n]]));
    const status = createHistory({ source: world().source, deployBlock: DEPLOY, chainId: 11155111, address: ADDR, snapshotFile: null }).peek().status;
    const notice = describeHistory({ ...status, complete: true }, cov);
    expect(notice.level).toBe("incomplete");
    expect(notice.detail).toMatch(/1 submission, 1 approval, 1 claim/);
    expect(aggregateCoverage([a], events([["created", 1n]])).missing[0]).toMatch(/^agreement #1:/);
  });
});

import { describe, expect, it } from "vitest";
import { chunkRanges, compareActivity, mergeWindow, type Activity } from "@/contract/events";
import { buildLaneChart, percentAt, refundOpensAt } from "@/domain/lane";
import { buildLedger } from "@/domain/ledger";
import { nextDeadline, nextStep } from "@/domain/next-step";
import { fixture, fixtureActivity, fixtureAgreement } from "./fixture";

const ONE_MILLI_ETH = 1_000_000_000_000_000n; // 0.001 ETH, the amount of both Sepolia milestones
const NOW = 1_795_300_000n; // a block time after the whole first-run plan

describe("recorded Sepolia agreements (A1 Paid, A2 Refunded)", () => {
  it("A1: one milestone, paid in full, nothing outstanding", () => {
    const a = fixtureAgreement(1);
    expect([a.deposited, a.paid, a.refunded, a.outstanding]).toEqual([ONE_MILLI_ETH, ONE_MILLI_ETH, 0n, 0n]);
    expect(a.milestones.map((m) => [m.state, m.amount, m.deliverBy, m.decideBy, m.evidence, m.revision])).toEqual([
      ["paid", ONE_MILLI_ETH, 1795188972n, 1795192572n, 0xe1n, 1n],
    ]);
  });
  it("A2: one milestone, refunded in full, never submitted", () => {
    const a = fixtureAgreement(2);
    expect([a.deposited, a.paid, a.refunded, a.outstanding]).toEqual([ONE_MILLI_ETH, 0n, ONE_MILLI_ETH, 0n]);
    expect(a.milestones.map((m) => [m.state, m.amount, m.deliverBy, m.decideBy, m.evidence, m.revision])).toEqual([
      ["refunded", ONE_MILLI_ETH, 1795191120n, 1795194720n, 0n, 0n],
    ]);
    expect(fixture.totalOutstanding).toBe("0");
  });
  it("same three parties in both agreements, pairwise distinct", () => {
    const [a1, a2] = [fixtureAgreement(1), fixtureAgreement(2)];
    expect([a2.client, a2.provider, a2.verifier]).toEqual([a1.client, a1.provider, a1.verifier]);
    expect(new Set([a1.client, a1.provider, a1.verifier]).size).toBe(3);
  });
});

describe("activity history from the real event logs", () => {
  const acts = fixtureActivity();
  it("decodes all six events in chain order with exact values", () => {
    const [a1, a2] = [fixtureAgreement(1), fixtureAgreement(2)];
    expect(acts.map((a) => [a.kind, a.id, a.m])).toEqual([
      ["created", 1n, null],
      ["submitted", 1n, 0],
      ["approved", 1n, 0],
      ["claimed", 1n, 0],
      ["created", 2n, null],
      ["refunded", 2n, 0],
    ]);
    expect(acts[0]).toMatchObject({ client: a1.client, provider: a1.provider, verifier: a1.verifier, total: ONE_MILLI_ETH, milestones: 1 });
    expect(acts[1]).toMatchObject({ evidence: 0xe1n, revision: 1n });
    expect(acts[2]).toMatchObject({ evidence: 0xe1n, revision: 1n });
    expect(acts[3]).toMatchObject({ to: a1.provider, amount: ONE_MILLI_ETH });
    expect(acts[5]).toMatchObject({ to: a2.client, amount: ONE_MILLI_ETH });
    expect(acts.map((a) => a.blockNumber)).toEqual([12176008n, 12176039n, 12176144n, 12176195n, 12176230n, 12176299n]);
  });
  it("orders, deduplicates and replaces a re-scanned window", () => {
    const shuffled = [...acts].reverse();
    expect(mergeWindow([], 0n, shuffled)).toEqual(acts);
    // a re-scan of the last two blocks returning the same logs changes nothing (deduplicated)
    expect(mergeWindow(acts, 12176230n, acts.slice(4))).toEqual(acts);
    // a reorg: the re-scanned window no longer contains the refund, so it is dropped
    expect(mergeWindow(acts, 12176230n, acts.slice(4, 5)).map((a) => a.kind)).toEqual(["created", "submitted", "approved", "claimed", "created"]);
    const sameBlock: Activity = { ...acts[0]!, logIndex: acts[0]!.logIndex + 1, kind: "submitted" };
    expect(compareActivity(acts[0]!, sameBlock)).toBeLessThan(0);
  });
  it("splits block ranges into bounded, contiguous chunks", () => {
    expect(chunkRanges(100n, 100n, 10n)).toEqual([[100n, 100n]]);
    expect(chunkRanges(0n, 25n, 10n)).toEqual([[0n, 9n], [10n, 19n], [20n, 25n]]);
    const r = chunkRanges(12175958n, 12195957n);
    expect(r).toHaveLength(2);
    expect(r.every(([a, b]) => b - a + 1n <= 10_000n)).toBe(true);
    expect(chunkRanges(5n, 4n)).toEqual([]);
  });
});

describe("settlement lane", () => {
  const acts = fixtureActivity();
  it("A1: delivery and review windows from the stored deadlines, events as marks, no refund zone (Paid)", () => {
    const a = fixtureAgreement(1);
    const created = acts.find((x) => x.kind === "created" && x.id === 1n)!.timestamp;
    const chart = buildLaneChart(a.milestones, acts.filter((x) => x.id === 1n), created, NOW);
    const lane = chart.lanes[0]!;
    expect(lane.state).toBe("paid");
    expect(lane.segments).toEqual([
      { kind: "delivery", from: created, to: 1795188972n },
      { kind: "review", from: 1795188972n, to: 1795192572n },
    ]);
    expect(lane.marks.map((m) => m.kind)).toEqual(["submitted", "approved", "claimed"]);
    expect(chart.nowPosition).toBe("after");
    expect(percentAt(chart, created)).toBe(0);
    expect(percentAt(chart, 1795188972n)).toBeGreaterThan(0);
    expect(percentAt(chart, 1795192572n)).toBeLessThan(100);
  });
  it("A2: refunded milestone shows its refund as a mark and no open refund zone", () => {
    const a = fixtureAgreement(2);
    const created = acts.find((x) => x.kind === "created" && x.id === 2n)!.timestamp;
    const lane = buildLaneChart(a.milestones, acts.filter((x) => x.id === 2n), created, NOW).lanes[0]!;
    expect(lane.state).toBe("refunded");
    expect(lane.segments.map((s) => s.kind)).toEqual(["delivery", "review"]);
    expect(lane.marks.map((m) => m.kind)).toEqual(["refunded"]);
  });
  it("refund eligibility follows the state: Funded from deliver_by, Submitted from decide_by, else never", () => {
    const m = fixtureAgreement(1).milestones[0]!;
    expect(refundOpensAt({ ...m, state: "funded" })).toBe(m.deliverBy);
    expect(refundOpensAt({ ...m, state: "submitted" })).toBe(m.decideBy);
    for (const s of ["approved", "paid", "refunded"] as const) expect(refundOpensAt({ ...m, state: s })).toBeNull();
    const funded = buildLaneChart([{ ...m, state: "funded" }], [], m.deliverBy - 900n, m.deliverBy - 1n).lanes[0]!;
    expect(funded.segments.at(-1)).toEqual({ kind: "refund", from: m.deliverBy, to: null });
    expect(funded.state).toBe("funded");
    expect(buildLaneChart([{ ...m, state: "funded" }], [], m.deliverBy - 900n, m.deliverBy).lanes[0]!.state).toBe("expired");
  });
});

describe("ledger strip", () => {
  it("A1 is all paid, A2 all refunded, and both agree with their milestones", () => {
    const l1 = buildLedger(fixtureAgreement(1));
    expect(l1.parts.map((p) => [p.kind, p.wei, p.basisPoints])).toEqual([["paid", ONE_MILLI_ETH, 10000], ["refunded", 0n, 0], ["outstanding", 0n, 0]]);
    expect([l1.identityHolds, l1.matchesMilestones]).toEqual([true, true]);
    const l2 = buildLedger(fixtureAgreement(2));
    expect(l2.parts.map((p) => p.basisPoints)).toEqual([0, 10000, 0]);
    expect([l2.identityHolds, l2.matchesMilestones]).toEqual([true, true]);
  });
  it("detects counters that disagree with the milestones", () => {
    const a = fixtureAgreement(1);
    expect(buildLedger({ ...a, paid: 0n, refunded: ONE_MILLI_ETH }).matchesMilestones).toBe(false);
    expect(buildLedger({ ...a, outstanding: 1n }).identityHolds).toBe(false);
  });
});

describe("next step", () => {
  it("settled milestones have no next step or deadline", () => {
    for (const id of [1, 2] as const) {
      const a = fixtureAgreement(id);
      expect(nextStep(a.milestones[0]!, NOW)).toEqual({ kind: "settled" });
      expect(nextDeadline(a.milestones, NOW)).toBeNull();
    }
  });
  it("open milestones point at the deadline that matters", () => {
    const m = fixtureAgreement(1).milestones[0]!;
    expect(nextStep({ ...m, state: "funded" }, m.deliverBy - 1n)).toEqual({ kind: "deliver", by: m.deliverBy });
    expect(nextStep({ ...m, state: "funded" }, m.deliverBy)).toEqual({ kind: "refund", since: m.deliverBy });
    expect(nextStep({ ...m, state: "submitted" }, m.deliverBy)).toEqual({ kind: "review", by: m.decideBy });
    expect(nextStep({ ...m, state: "submitted" }, m.decideBy)).toEqual({ kind: "refund", since: m.decideBy });
    expect(nextStep({ ...m, state: "approved" }, m.decideBy + 10n ** 6n)).toEqual({ kind: "claim" });
  });
});

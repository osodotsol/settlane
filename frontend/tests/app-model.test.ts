import { describe, expect, it } from "vitest";
import type { Agreement, Milestone } from "@/contract/read";
import { accountingHolds, agreementsFor, attentionFor, milestoneActions, nextLine, payableTo, payoutsFor, rolesOf, totalsOf } from "@/domain/app-model";

const CLIENT = "0x00000000000000000000000000000000000000c1" as const;
const PROVIDER = "0x00000000000000000000000000000000000000b2" as const;
const VERIFIER = "0x00000000000000000000000000000000000000a3" as const;
const STRANGER = "0x00000000000000000000000000000000000000d4" as const;

const T = 1_000n;
const ms = (index: number, state: Milestone["state"], amount = 100n, deliverBy = T + 100n, decideBy = T + 200n): Milestone => ({
  index, state, amount, deliverBy, decideBy, spec: 1n, evidence: state === "submitted" || state === "approved" || state === "paid" ? 7n : 0n, rejections: 0n, revision: 1n,
});
const agreement = (id: bigint, milestones: Milestone[]): Agreement => {
  const sum = (f: (m: Milestone) => boolean) => milestones.filter(f).reduce((s, m) => s + m.amount, 0n);
  return {
    id, client: CLIENT, provider: PROVIDER, verifier: VERIFIER, reviewPeriod: 100n, n: milestones.length,
    deposited: sum(() => true), paid: sum((m) => m.state === "paid"), refunded: sum((m) => m.state === "refunded"),
    outstanding: sum((m) => ["funded", "submitted", "approved"].includes(m.state)), milestones,
  };
};

describe("roles", () => {
  it("matches addresses case-insensitively and gives strangers nothing", () => {
    const a = agreement(1n, [ms(0, "funded")]);
    expect(rolesOf(a, PROVIDER.toUpperCase().replace("0X", "0x") as `0x${string}`)).toEqual(["provider"]);
    expect(rolesOf(a, STRANGER)).toEqual([]);
    expect(rolesOf(a, undefined)).toEqual([]);
    expect(agreementsFor([a], undefined)).toEqual([]);
    expect(agreementsFor([a], VERIFIER)).toEqual([a]);
  });
});

describe("what each role may do, judged at block time", () => {
  const funded = agreement(1n, [ms(0, "funded")]);
  it("the provider submits while delivery is open, and not at deliver_by", () => {
    expect(milestoneActions(funded, funded.milestones[0]!, PROVIDER, T + 99n)).toEqual(["submit"]);
    expect(milestoneActions(funded, funded.milestones[0]!, PROVIDER, T + 100n)).toEqual([]);
  });
  it("a submitted milestone can be resubmitted by the provider and reviewed by the verifier, until their own deadlines", () => {
    const a = agreement(1n, [ms(0, "submitted")]);
    expect(milestoneActions(a, a.milestones[0]!, PROVIDER, T + 50n)).toEqual(["submit"]);
    expect(milestoneActions(a, a.milestones[0]!, VERIFIER, T + 150n)).toEqual(["review"]);
    expect(milestoneActions(a, a.milestones[0]!, VERIFIER, T + 200n)).toEqual([]);
    expect(milestoneActions(a, a.milestones[0]!, CLIENT, T + 150n)).toEqual([]);
    expect(milestoneActions(a, a.milestones[0]!, CLIENT, T + 200n)).toEqual(["refund"]);
  });
  it("the client refunds exactly when the milestone has expired; never an approved one", () => {
    expect(milestoneActions(funded, funded.milestones[0]!, CLIENT, T + 99n)).toEqual([]);
    expect(milestoneActions(funded, funded.milestones[0]!, CLIENT, T + 100n)).toEqual(["refund"]);
    const approved = agreement(2n, [ms(0, "approved")]);
    expect(milestoneActions(approved, approved.milestones[0]!, CLIENT, T + 9_999n)).toEqual([]);
  });
  it("an approval is claimable by the provider at any time, by nobody else", () => {
    const a = agreement(1n, [ms(0, "approved")]);
    expect(milestoneActions(a, a.milestones[0]!, PROVIDER, T + 9_999n)).toEqual(["claim"]);
    expect(milestoneActions(a, a.milestones[0]!, VERIFIER, T + 1n)).toEqual([]);
    expect(milestoneActions(a, a.milestones[0]!, STRANGER, T + 1n)).toEqual([]);
  });
  it("settled milestones offer nothing", () => {
    for (const state of ["paid", "refunded"] as const) {
      const a = agreement(1n, [ms(0, state)]);
      for (const who of [CLIENT, PROVIDER, VERIFIER]) expect(milestoneActions(a, a.milestones[0]!, who, T + 9_999n)).toEqual([]);
    }
  });
});

describe("the action queue", () => {
  const a1 = agreement(1n, [ms(0, "funded", 100n, T + 500n, T + 600n), ms(1, "funded", 50n, T + 300n, T + 400n)]);
  const a2 = agreement(2n, [ms(0, "approved")]);
  it("orders by the soonest deadline first, payouts after", () => {
    const q = attentionFor([a1, a2], PROVIDER, T);
    expect(q.map((i) => `${i.agreementId}:${i.m}:${i.action}`)).toEqual(["1:1:submit", "1:0:submit", "2:0:claim"]);
  });
  it("is empty without a wallet and for strangers", () => {
    expect(attentionFor([a1, a2], undefined, T)).toEqual([]);
    expect(attentionFor([a1, a2], STRANGER, T)).toEqual([]);
  });
  it("splits what is payable to the connected wallet", () => {
    const p = payableTo([a1, a2], PROVIDER, T);
    expect(p.claimableTotal).toBe(100n);
    expect(p.refundableTotal).toBe(0n);
    const c = payableTo([a1, a2], CLIENT, T + 400n);
    expect(c.refundableTotal).toBe(50n);
  });
  it("describes the next step in words", () => {
    expect(nextLine(a1, PROVIDER, T).urgent).toBe(true);
    expect(nextLine(a1, STRANGER, T)).toEqual({ text: "Waiting for the provider's evidence", urgent: false });
    expect(nextLine(agreement(3n, [ms(0, "paid")]), PROVIDER, T)).toEqual({ text: "Settled", urgent: false });
  });
});

describe("totals", () => {
  it("sums the counters, counts open agreements and settled milestones, and the identity holds", () => {
    const a = agreement(1n, [ms(0, "paid", 10n), ms(1, "refunded", 20n), ms(2, "funded", 30n)]);
    const b = agreement(2n, [ms(0, "paid", 5n)]);
    const t = totalsOf([a, b], T);
    expect(t).toMatchObject({ deposited: 65n, paid: 15n, refunded: 20n, outstanding: 30n, agreements: 2, open: 1, settled: 3 });
    expect(t.deposited).toBe(t.paid + t.refunded + t.outstanding);
    expect(accountingHolds(a)).toBe(true);
    expect(accountingHolds({ ...a, paid: 0n })).toBe(false);
  });
});

describe("payouts", () => {
  it("lists a wallet's own claims (provider) and refunds (client) only", () => {
    const a = agreement(1n, [ms(0, "paid")]);
    const ev = (kind: "claimed" | "refunded" | "submitted", id: bigint) => ({ kind, id, m: 0, blockNumber: 1n, logIndex: 0, txHash: "0x00" as const, timestamp: 1n });
    const list = [ev("claimed", 1n), ev("refunded", 1n), ev("submitted", 1n), ev("claimed", 9n)];
    expect(payoutsFor(list, [a], PROVIDER).map((e) => e.kind)).toEqual(["claimed"]);
    expect(payoutsFor(list, [a], CLIENT).map((e) => e.kind)).toEqual(["refunded"]);
    expect(payoutsFor(list, [a], VERIFIER)).toEqual([]);
  });
});

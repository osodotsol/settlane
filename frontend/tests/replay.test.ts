import { describe, expect, it } from "vitest";
import { buildReplay, stepTime } from "@/domain/replay";
import { sampleAgreement } from "@/domain/sample";
import { fixtureActivity, fixtureAgreement } from "./fixture";

describe("hero replay story, from the recorded Sepolia agreements", () => {
  const acts = fixtureActivity();
  it("A1: created, submitted, approved, claimed; outcome paid", () => {
    const s = buildReplay(fixtureAgreement(1), acts);
    expect(s.steps.map((x) => x.title)).toEqual(["Agreement created", "Evidence submitted", "Approved", "Claimed"]);
    expect(s.steps.map((x) => x.detail)).toEqual(["0.001 ETH locked", "0x0000…00e1 · revision 1", "revision 1", "0.001 ETH to the provider"]);
    expect(s.steps[0]!.time).toBe("Nov 20 · 15:21 UTC");
    expect([s.outcome, s.summary, s.href, s.illustrative]).toEqual(["paid", "0.001 ETH paid to the provider", "/agreements/1", false]);
  });
  it("A2: the refund is preceded by the deadline that allowed it, taken from the stored deliver_by", () => {
    const a = fixtureAgreement(2);
    const s = buildReplay(a, acts);
    expect(s.steps.map((x) => x.title)).toEqual(["Agreement created", "Deadline passed", "Refunded"]);
    expect(s.steps[1]!.time).toBe(stepTime(a.milestones[0]!.deliverBy));
    expect(s.steps[2]!.detail).toBe("0.001 ETH to the client");
    expect([s.outcome, s.summary]).toEqual(["refunded", "0.001 ETH refunded to the client"]);
  });
  it("uses only the agreement's own events", () => {
    expect(buildReplay(fixtureAgreement(1), acts).steps).toHaveLength(4);
    expect(buildReplay(fixtureAgreement(2), acts).steps).toHaveLength(3);
  });
  it("after a submission, an expiry is the review deadline, not the delivery deadline", () => {
    const a = fixtureAgreement(2);
    const submitted = { ...acts[1]!, id: 2n, kind: "submitted" as const };
    const s = buildReplay(a, [acts[4]!, submitted, acts[5]!]);
    expect(s.steps.map((x) => x.title)).toEqual(["Agreement created", "Evidence submitted", "Review window closed", "Refunded"]);
    expect(s.steps[2]!.time).toBe(stepTime(a.milestones[0]!.decideBy));
  });
  it("the illustration is labelled and links nowhere", () => {
    const { agreement, activity } = sampleAgreement();
    const s = buildReplay(agreement, activity, true);
    expect([s.illustrative, s.href, s.outcome]).toEqual([true, null, "paid"]);
  });
});

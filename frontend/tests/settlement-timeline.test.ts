import { describe, expect, it } from "vitest";
import type { Lane } from "@/domain/lane";
import { buildTimeline } from "@/domain/settlement-timeline";

const lane = (over: Partial<Lane>): Lane => ({
  index: 0,
  state: "funded",
  stored: "funded",
  deliverBy: 1_000n,
  decideBy: 2_000n,
  segments: [],
  marks: [],
  ...over,
});
const created = { at: 100n, txHash: "0xc0" };

describe("settlement timeline", () => {
  it("a paid milestone shows funded, submitted, approved and paid from its real events, in time order, with nothing open", () => {
    const t = buildTimeline(
      lane({
        state: "paid",
        stored: "paid",
        marks: [
          { kind: "claimed", at: 400n, txHash: "0x4" },
          { kind: "submitted", at: 200n, revision: 1n, txHash: "0x2" },
          { kind: "approved", at: 300n, revision: 1n, txHash: "0x3" },
        ],
      }),
      created,
    );
    expect(t.steps.map((s) => [s.tone, s.at, s.txHash])).toEqual([
      ["funded", 100n, "0xc0"],
      ["submitted", 200n, "0x2"],
      ["approved", 300n, "0x3"],
      ["paid", 400n, "0x4"],
    ]);
    expect(t.now).toBeNull();
    expect(t.settled).toBe(true);
  });

  it("a refund after the delivery deadline shows only funded then refunded: no invented submission or approval", () => {
    const t = buildTimeline(lane({ state: "refunded", stored: "refunded", marks: [{ kind: "refunded", at: 1_500n, txHash: "0x9" }] }), created);
    expect(t.steps.map((s) => s.tone)).toEqual(["funded", "refunded"]);
    expect(t.now).toBeNull();
  });

  it("a step the state proves but the history did not contain is shown without a time, never with one", () => {
    const t = buildTimeline(lane({ state: "paid", stored: "paid", marks: [{ kind: "submitted", at: 200n, revision: 1n, txHash: "0x2" }] }), null);
    expect(t.steps.map((s) => [s.tone, s.at])).toEqual([
      ["funded", undefined],
      ["submitted", 200n],
      ["approved", undefined],
      ["paid", undefined],
    ]);
  });

  it("an open milestone ends in one 'now' step naming the next action and its block-time deadline", () => {
    expect(buildTimeline(lane({}), created).now).toMatchObject({ tone: "funded", label: "Awaiting evidence", deadline: { at: 1_000n } });
    const review = buildTimeline(lane({ state: "submitted", stored: "submitted", marks: [{ kind: "submitted", at: 200n, revision: 1n, txHash: "0x2" }] }), created);
    expect(review.now).toMatchObject({ tone: "submitted", label: "Awaiting the verifier", deadline: { label: "Review deadline", at: 2_000n } });
    const approved = buildTimeline(lane({ state: "approved", stored: "approved", marks: [{ kind: "submitted", at: 200n, txHash: "0x2" }, { kind: "approved", at: 300n, txHash: "0x3" }] }), created);
    expect(approved.now).toMatchObject({ tone: "approved", label: "Ready to claim" });
    expect(approved.now?.deadline).toBeUndefined();
  });

  it("an expired milestone says the refund is open from the right deadline (delivery when Funded, review when Submitted)", () => {
    expect(buildTimeline(lane({ state: "expired", stored: "funded" }), created).now).toMatchObject({ tone: "refund-open", deadline: { at: 1_000n } });
    expect(buildTimeline(lane({ state: "expired", stored: "submitted", marks: [{ kind: "submitted", at: 200n, txHash: "0x2" }] }), created).now).toMatchObject({
      tone: "refund-open",
      deadline: { at: 2_000n },
    });
  });

  it("a revision request stays on the road and the milestone is open again", () => {
    const t = buildTimeline(
      lane({ marks: [{ kind: "submitted", at: 200n, revision: 1n, txHash: "0x2" }, { kind: "rejected", at: 250n, revision: 1n, txHash: "0x5" }] }),
      created,
    );
    expect(t.steps.map((s) => s.tone)).toEqual(["funded", "submitted", "rejected"]);
    expect(t.now?.label).toBe("Awaiting evidence");
  });
});

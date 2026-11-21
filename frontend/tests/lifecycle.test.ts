import { describe, expect, it } from "vitest";
import { STATE_CODES, deliveryOpen, displayState, expired, reviewOpen, storedState } from "@/domain/lifecycle";

// docs/LIFECYCLE.md: open means now < limit, expired means now >= limit, tested at d-1, d, d+1.
const D = 2_000n; // deliver_by
const R = 5_600n; // decide_by

describe("windows", () => {
  it("delivery is open strictly before deliver_by", () => {
    expect([deliveryOpen(D - 1n, D), deliveryOpen(D, D), deliveryOpen(D + 1n, D)]).toEqual([true, false, false]);
  });
  it("review is open strictly before decide_by", () => {
    expect([reviewOpen(R - 1n, R), reviewOpen(R, R), reviewOpen(R + 1n, R)]).toEqual([true, false, false]);
  });
});

describe("expired", () => {
  it("a Funded milestone expires at deliver_by", () => {
    expect([D - 1n, D, D + 1n].map((t) => expired("funded", t, D, R))).toEqual([false, true, true]);
  });
  it("a Submitted milestone expires at decide_by, not at deliver_by", () => {
    expect([D, R - 1n, R, R + 1n].map((t) => expired("submitted", t, D, R))).toEqual([false, false, true, true]);
  });
  it("Approved, Paid, Refunded and None never expire", () => {
    for (const s of ["approved", "paid", "refunded", "none"] as const) expect(expired(s, R + 10n ** 9n, D, R)).toBe(false);
  });
  it("submission and refund are disjoint at every boundary instant (I10)", () => {
    for (const t of [D - 1n, D, D + 1n]) expect(deliveryOpen(t, D) && expired("funded", t, D, R)).toBe(false);
    for (const t of [R - 1n, R, R + 1n]) expect(reviewOpen(t, R) && expired("submitted", t, D, R)).toBe(false);
  });
  it("displays expired as a derived state", () => {
    expect(displayState("funded", D, D, R)).toBe("expired");
    expect(displayState("approved", R + 1n, D, R)).toBe("approved");
  });
});

describe("state codes", () => {
  it("match rules::state_code (None first, D-017)", () => {
    expect(STATE_CODES).toEqual(["none", "funded", "submitted", "approved", "paid", "refunded"]);
    expect(storedState(4)).toBe("paid");
    expect(() => storedState(6)).toThrow();
  });
});

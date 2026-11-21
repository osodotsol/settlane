import { describe, expect, it } from "vitest";
import { identiconOf, IDENTICON_COLORS } from "@/domain/identicon";
import { REPLAY, axisTicks, buildLaneChart, percentAt, replayDelay, tickLabel } from "@/domain/lane";
import { milestoneTrack } from "@/domain/milestone-track";
import { sampleAgreement } from "@/domain/sample";
import { buildLedger } from "@/domain/ledger";
import { fixtureActivity, fixtureAgreement } from "./fixture";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => BigInt(Date.UTC(y, mo - 1, d, h, mi) / 1000);

describe("axis ticks", () => {
  it("labels round UTC times, and the day at midnight", () => {
    expect(tickLabel(utc(2026, 11, 20, 15, 30))).toBe("15:30");
    expect(tickLabel(utc(2026, 11, 20, 0, 5))).toBe("00:05");
    expect(tickLabel(utc(2026, 11, 21))).toBe("Nov 21");
  });
  it("A1's lane gets ticks at 15:30, 16:00 and 16:30, evenly spaced and inside the chart", () => {
    const a = fixtureAgreement(1);
    const acts = fixtureActivity().filter((x) => x.id === 1n);
    const created = acts.find((x) => x.kind === "created")!.timestamp;
    const chart = buildLaneChart(a.milestones, acts, created, 1_795_300_000n);
    const ticks = axisTicks(chart);
    expect(ticks.map((t) => t.label)).toEqual(["15:30", "16:00", "16:30"]);
    expect(ticks.every((t) => t.at > chart.start && t.at < chart.end)).toBe(true);
    expect(ticks[1]!.at - ticks[0]!.at).toBe(1800n);
    expect(ticks.map((t) => t.percent)).toEqual(ticks.map((t) => percentAt(chart, t.at)));
  });
  it("never produces more than the target number of ticks, whatever the span", () => {
    for (const span of [90n, 3_000n, 40_000n, 900_000n, 70_000_000n]) {
      const start = 1_800_000_000n;
      expect(axisTicks({ start, end: start + span }, 5).length).toBeLessThanOrEqual(6);
    }
    expect(axisTicks({ start: 10n, end: 10n })).toEqual([]);
  });
});

describe("hero replay timing", () => {
  it("starts after the entrance and spans the whole sweep, clamped to the chart", () => {
    expect(replayDelay(0)).toBe(REPLAY.startMs);
    expect(replayDelay(100)).toBe(REPLAY.startMs + REPLAY.durationMs);
    expect(replayDelay(50)).toBe(REPLAY.startMs + REPLAY.durationMs / 2);
    expect(replayDelay(-20)).toBe(replayDelay(0));
    expect(replayDelay(180)).toBe(replayDelay(100));
  });
  it("events are lit in chain order (later events never light earlier)", () => {
    const a = fixtureAgreement(1);
    const acts = fixtureActivity().filter((x) => x.id === 1n);
    const chart = buildLaneChart(a.milestones, acts, acts[0]!.timestamp, 1_795_300_000n);
    const delays = acts.map((x) => replayDelay(percentAt(chart, x.timestamp)));
    expect([...delays].sort((x, y) => x - y)).toEqual(delays);
  });
});

describe("milestone progress track", () => {
  const status = (s: Parameters<typeof milestoneTrack>[0]) => milestoneTrack(s).nodes.map((n) => `${n.label}:${n.status}`);
  it("follows the happy path", () => {
    expect(status("funded")).toEqual(["Funded:current", "In review:todo", "Approved:todo", "Paid:todo"]);
    expect(status("submitted")).toEqual(["Funded:done", "In review:current", "Approved:todo", "Paid:todo"]);
    expect(status("approved")).toEqual(["Funded:done", "In review:done", "Approved:current", "Paid:todo"]);
    expect(status("paid")).toEqual(["Funded:done", "In review:done", "Approved:done", "Paid:current"]);
  });
  it("uses the refund path for expired and refunded milestones", () => {
    expect(milestoneTrack("expired").path).toBe("refund");
    expect(status("expired")).toEqual(["Funded:done", "Expired:current", "Refunded:todo"]);
    expect(status("refunded")).toEqual(["Funded:done", "Expired:done", "Refunded:current"]);
  });
  it("an unused slot has nothing reached", () => {
    expect(status("none").every((x) => x.endsWith(":todo"))).toBe(true);
  });
});

describe("identicon", () => {
  const A1_CLIENT = fixtureAgreement(1).client;
  const A1_PROVIDER = fixtureAgreement(1).provider;
  it("is deterministic and ignores address case", () => {
    expect(identiconOf(A1_CLIENT)).toEqual(identiconOf(A1_CLIENT));
    expect(identiconOf(A1_CLIENT)).toEqual(identiconOf(A1_CLIENT.toLowerCase()));
  });
  it("is mirrored left to right, 5x5, with a token colour", () => {
    const { cells, colorIndex } = identiconOf(A1_CLIENT);
    expect(cells).toHaveLength(5);
    for (const row of cells) {
      expect(row).toHaveLength(5);
      expect([row[0], row[1]]).toEqual([row[4], row[3]]);
    }
    expect(colorIndex).toBeGreaterThanOrEqual(0);
    expect(colorIndex).toBeLessThan(IDENTICON_COLORS.length);
  });
  it("tells the recorded parties apart", () => {
    expect(identiconOf(A1_CLIENT)).not.toEqual(identiconOf(A1_PROVIDER));
    expect(identiconOf(fixtureAgreement(1).verifier)).not.toEqual(identiconOf(A1_PROVIDER));
  });
});

describe("illustrative fallback", () => {
  it("is internally consistent (so the hero can never show broken accounting) and uses no real address", () => {
    const { agreement, activity } = sampleAgreement();
    const ledger = buildLedger(agreement);
    expect([ledger.identityHolds, ledger.matchesMilestones]).toEqual([true, true]);
    expect(activity.map((a) => a.kind)).toEqual(["created", "submitted", "approved", "claimed"]);
    expect(agreement.client).not.toBe(fixtureAgreement(1).client);
    expect(activity.every((a) => a.txHash === `0x${"0".repeat(64)}`)).toBe(true);
  });
});

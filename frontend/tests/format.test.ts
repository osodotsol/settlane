import { describe, expect, it } from "vitest";
import { formatEth, formatRelative, formatUtc, shortHex } from "@/domain/format";

describe("formatEth", () => {
  it("shows whole and fractional ETH without trailing zeros", () => {
    expect(formatEth(10n ** 18n)).toBe("1");
    expect(formatEth(10n ** 15n)).toBe("0.001");
    expect(formatEth(1_234_567_890_000_000_000n)).toBe("1.234567");
  });
  it("truncates and never rounds up", () => {
    expect(formatEth(999_999_999_999_999_999n)).toBe("0.999999");
  });
  it("never shows a nonzero amount as zero", () => {
    expect(formatEth(1n)).toBe("< 0.000001");
    expect(formatEth(0n)).toBe("0");
  });
});

describe("shortHex", () => {
  it("elides in the middle", () => {
    expect(shortHex("0xf79d229a039bf5c84ecc7327060f8bbc888d2182")).toBe("0xf79d…2182");
    expect(shortHex("0x1234")).toBe("0x1234");
  });
});

describe("time", () => {
  it("formats absolute UTC", () => {
    expect(formatUtc(1795191120n)).toBe("2026-11-20 16:12 UTC");
  });
  it("formats relative to block time", () => {
    expect(formatRelative(1000n + 3n * 3600n + 12n * 60n, 1000n)).toBe("in 3 h 12 min");
    expect(formatRelative(1000n, 1000n + 2n * 86_400n)).toBe("2 d ago");
    expect(formatRelative(1000n, 1000n)).toBe("now");
  });
});

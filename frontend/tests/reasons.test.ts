import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REVERT_REASONS, reasonCopy } from "@/contract/reasons";

// Every revert reason in the production handlers, parsed from the Fe source itself.
const handlers = readFileSync(new URL("../../ingots/settlane/src/handlers.fe", import.meta.url), "utf8");
const reasons = new Set(
  handlers
    .split("\n")
    .filter((l) => l.includes("assert!(false,") || /^\s*"[^"]+",\s*$/.test(l))
    .map((l) => l.match(/"([^"]+)"/)?.[1])
    .filter((r): r is string => Boolean(r)),
);

describe("revert reason copy", () => {
  it("parses the full set of reasons from handlers.fe", () => {
    expect(reasons.size).toBe(31);
    expect(reasons.has("transfer failed")).toBe(true);
  });
  it("covers exactly the contract's reasons (no gap, no typo)", () => {
    expect(new Set(Object.keys(REVERT_REASONS))).toEqual(reasons);
  });
  it("falls back to the raw reason for anything unknown", () => {
    expect(reasonCopy("something new").message).toContain("something new");
    expect(reasonCopy(undefined).message).toMatch(/no reason/);
  });
});

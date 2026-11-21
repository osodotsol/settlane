import { beforeEach, describe, expect, it } from "vitest";
import { cached, clearCache } from "@/contract/cache";

describe("server read cache", () => {
  beforeEach(() => clearCache());
  it("serves fresh data within the TTL and refetches after it", async () => {
    let calls = 0;
    const f = async () => ++calls;
    expect((await cached("k", 50, f)).value).toBe(1);
    expect((await cached("k", 50, f)).value).toBe(1);
    await new Promise((r) => setTimeout(r, 60));
    expect((await cached("k", 50, f)).value).toBe(2);
  });
  it("collapses concurrent requests into one", async () => {
    let calls = 0;
    const f = () => new Promise<number>((r) => setTimeout(() => r(++calls), 20));
    const results = await Promise.all([cached("c", 1000, f), cached("c", 1000, f), cached("c", 1000, f)]);
    expect(results.map((r) => r.value)).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
  });
  it("serves the last good value, marked stale, when the RPC fails", async () => {
    await cached("s", 0, async () => "good");
    const r = await cached("s", 0, async () => {
      throw new Error("rpc down");
    });
    expect(r).toMatchObject({ value: "good", stale: true });
  });
  it("surfaces the failure when nothing was ever read", async () => {
    await expect(cached("e", 0, async () => Promise.reject(new Error("rpc down")))).rejects.toThrow("rpc down");
  });
});

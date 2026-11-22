import { beforeEach, describe, expect, it, vi } from "vitest";

// R2-B part 2: made-up agreement ids must not multiply RPC traffic; caches are bounded; failures recover.
const reads = vi.hoisted(() => ({ count: 12, countCalls: 0, agreementCalls: 0, fail: false, hang: false }));
vi.mock("@/contract/read", () => ({
  agreementCount: vi.fn(async () => {
    reads.countCalls++;
    if (reads.hang) return new Promise(() => undefined);
    if (reads.fail) throw new Error("rpc down");
    return reads.count;
  }),
  readAgreement: vi.fn(async (id: bigint) => {
    reads.agreementCalls++;
    return id <= BigInt(reads.count) ? { id, client: "0x00000000000000000000000000000000000000a1" } : null;
  }),
  latestBlockTime: vi.fn(async () => 1_000n),
  readOverview: vi.fn(async () => ({})),
}));
vi.mock("@/chain/client", () => ({ publicClient: {} }));
vi.mock("@/contract/history-instance", () => ({ history: { refresh: vi.fn(), peekStale: vi.fn() } }));

const { createKnownIds, ID_PATTERN, COUNT_TTL_MS, NEAR_REFRESH_MS, FAILURE_BACKOFF_MS } = await import("@/contract/known-ids");
const { cached, cacheSize, clearCache, MAX_ENTRIES } = await import("@/contract/cache");

let clock = 1_000_000;
const now = () => clock;
const counter = () => {
  const state = { calls: 0, value: 12, fail: false, hang: false };
  const read = async () => {
    state.calls++;
    if (state.hang) return new Promise<number>(() => undefined);
    if (state.fail) throw new Error("rpc down");
    return state.value;
  };
  return { state, read };
};

beforeEach(() => {
  clock += 1_000_000;
});

describe("agreement ids: one shared count answers every id", () => {
  it("rejects malformed and absurd ids before any read", () => {
    for (const bad of ["0", "-1", "01", "1.5", "1e3", "abc", "", " 1", "1 ", "123456789012345678901", "9".repeat(77)]) expect(ID_PATTERN.test(bad)).toBe(false);
    for (const ok of ["1", "12", "18446744073709551615"]) expect(ID_PATTERN.test(ok)).toBe(true);
  });

  it("a flood of 1,000 different made-up ids costs ONE count read, not one per id", async () => {
    const c = counter();
    const known = createKnownIds(c.read, now);
    const answers = await Promise.all(Array.from({ length: 1_000 }, (_, i) => known.check(10_000n + BigInt(i) * 7919n, 3_000)));
    expect(answers.every((a) => a === "missing")).toBe(true);
    expect(c.state.calls).toBe(1);
    // and again, sequentially, within the TTL: still no new read
    for (let i = 0; i < 200; i++) await known.check(99_999n + BigInt(i), 3_000);
    expect(c.state.calls).toBe(1);
  });

  it("existing ids never cost a read once the count is known (positive answers do not expire)", async () => {
    const c = counter();
    const known = createKnownIds(c.read, now);
    expect(await known.check(5n, 3_000)).toBe("exists");
    clock += 100 * COUNT_TTL_MS;
    for (let i = 1n; i <= 12n; i++) expect(await known.check(i, 3_000)).toBe("exists");
    expect(c.state.calls).toBe(1);
  });

  it("a genuinely new agreement is found: the next ids are re-checked after a few seconds, far ids after the TTL", async () => {
    const c = counter();
    const known = createKnownIds(c.read, now);
    expect(await known.check(13n, 3_000)).toBe("missing");
    c.state.value = 13; // someone creates agreement #13
    expect(await known.check(13n, 3_000)).toBe("missing"); // within NEAR_REFRESH_MS: answered from the count
    clock += NEAR_REFRESH_MS;
    expect(await known.check(13n, 3_000)).toBe("exists");
    expect(c.state.calls).toBe(2);
    c.state.value = 500;
    expect(await known.check(400n, 3_000)).toBe("missing"); // far id, count read 0 s ago
    clock += COUNT_TTL_MS;
    expect(await known.check(400n, 3_000)).toBe("exists");
    expect(c.state.calls).toBe(3);
  });

  it("an RPC failure is 'unknown' (never 'missing'), is not retried per request during the backoff, and recovers", async () => {
    const c = counter();
    c.state.fail = true;
    const known = createKnownIds(c.read, now);
    expect(await known.check(3n, 3_000)).toBe("unknown");
    for (let i = 0; i < 500; i++) expect(await known.check(BigInt(1 + i), 3_000)).toBe("unknown");
    expect(c.state.calls).toBe(1); // the outage is not multiplied by the request rate
    c.state.fail = false;
    clock += FAILURE_BACKOFF_MS;
    expect(await known.check(3n, 3_000)).toBe("exists");
    expect(c.state.calls).toBe(2);
  });

  it("a hanging node: callers get 'unknown' within their budget, and only ONE read is ever in flight", async () => {
    const c = counter();
    c.state.hang = true;
    const known = createKnownIds(c.read, () => Date.now());
    const t0 = Date.now();
    const answers = await Promise.all(Array.from({ length: 300 }, (_, i) => known.check(BigInt(1 + i), 50)));
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(answers.every((a) => a === "unknown")).toBe(true);
    expect(c.state.calls).toBe(1);
  });
});

describe("the page's agreement read goes through the same count", () => {
  it("made-up ids never read an agreement and never add cache entries; real ids are read once per TTL", async () => {
    clearCache();
    const { getAgreement, knownIds } = await import("@/contract/data");
    const before = reads.countCalls;
    for (let i = 0; i < 300; i++) {
      const r = await getAgreement(1_000_000n + BigInt(i));
      expect(r.value.agreement).toBeNull();
    }
    expect(reads.agreementCalls).toBe(0);
    expect(reads.countCalls - before).toBe(1);
    expect(cacheSize()).toBe(0);
    expect((await getAgreement(3n)).value.agreement).not.toBeNull();
    expect((await getAgreement(3n)).value.agreement).not.toBeNull();
    expect(reads.agreementCalls).toBe(1);
    expect(cacheSize()).toBe(1);
    expect(knownIds.reads).toBe(1);
  });
});

describe("the server cache is bounded", () => {
  it("never holds more than MAX_ENTRIES keys, evicting the least recently used", async () => {
    clearCache();
    for (let i = 0; i < MAX_ENTRIES * 4; i++) await cached(`k${i}`, 60_000, async () => i);
    expect(cacheSize()).toBe(MAX_ENTRIES);
    // the most recent keys are still served from memory
    let calls = 0;
    await cached(`k${MAX_ENTRIES * 4 - 1}`, 60_000, async () => ++calls);
    expect(calls).toBe(0);
    // the oldest were evicted and are read again
    await cached("k0", 60_000, async () => ++calls);
    expect(calls).toBe(1);
  });

  it("an entry whose read is still in flight is not evicted (its callers keep one shared read)", async () => {
    clearCache();
    let release!: (v: number) => void;
    let calls = 0;
    const slow = () => {
      calls++;
      return new Promise<number>((r) => (release = r));
    };
    const first = cached("slow", 60_000, slow);
    for (let i = 0; i < MAX_ENTRIES * 2; i++) await cached(`f${i}`, 60_000, async () => i);
    const second = cached("slow", 60_000, slow);
    release(7);
    expect((await first).value).toBe(7);
    expect((await second).value).toBe(7);
    expect(calls).toBe(1);
    expect(cacheSize()).toBeLessThanOrEqual(MAX_ENTRIES + 1);
  });
});

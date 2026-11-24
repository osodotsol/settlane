import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRanker, hedged } from "@/chain/adaptive-transport";

// The event-log transport under the outage measured on 2026-11-24: publicnode rejects old ranges after ~1.6 s ("pruned
// history unavailable"), Tenderly hangs until the 6 s timeout, ethpandaops answers in ~2 s.
const PN = "publicnode", TD = "tenderly", EP = "ethpandaops";
const URLS = [PN, TD, EP];

type Behaviour = { ms: number; ok: boolean };
const OUTAGE: Record<string, Behaviour> = { [PN]: { ms: 1_600, ok: false }, [TD]: { ms: 6_000, ok: false }, [EP]: { ms: 2_000, ok: true } };

function endpoints(b: Record<string, Behaviour>) {
  const calls: string[] = [];
  const call = (url: string) => {
    calls.push(url);
    const { ms, ok } = b[url]!;
    return new Promise<string>((resolve, reject) => setTimeout(() => (ok ? resolve(`logs from ${url}`) : reject(new Error(`${url} failed`))), ms));
  };
  return { calls, call };
}

/** Runs one request to completion under fake timers; returns the result (or error) and the simulated time it took. */
async function timed<T>(p: Promise<T>) {
  const t0 = Date.now();
  let out: { value?: T; error?: unknown } | undefined;
  p.then((value) => (out = { value }), (error) => (out = { error }));
  while (!out) await vi.advanceTimersByTimeAsync(100);
  return { ...out, ms: Date.now() - t0 };
}

describe("adaptive event-log transport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("under the measured outage, the first request finishes in about 6 s instead of 9.6 s (hedged past the hanging node)", async () => {
    const { calls, call } = endpoints(OUTAGE);
    const ranker = createRanker(URLS);
    const r = await timed(hedged(ranker.order(), call, ranker, 2_500));
    expect(r.value).toBe("logs from ethpandaops");
    expect(r.ms).toBeLessThanOrEqual(6_200); // 1.6 s (pruned) + 2.5 s hedge + 2 s; a plain fallback walk takes 9.6 s
    expect(calls).toEqual([PN, TD, EP]);
  });

  it("the next request goes straight to the endpoint that answered, without retrying the failed ones", async () => {
    const { calls, call } = endpoints(OUTAGE);
    const ranker = createRanker(URLS);
    await timed(hedged(ranker.order(), call, ranker, 2_500));
    calls.length = 0;
    expect(ranker.order()[0]).toBe(EP);
    const r = await timed(hedged(ranker.order(), call, ranker, 2_500));
    expect(r.value).toBe("logs from ethpandaops");
    expect(r.ms).toBeLessThanOrEqual(2_100);
    expect(calls).toEqual([EP]);
  });

  it("a fast failure moves on at once, with no hedge wait", async () => {
    const { call } = endpoints({ [PN]: { ms: 100, ok: false }, [TD]: { ms: 300, ok: true }, [EP]: { ms: 300, ok: true } });
    const ranker = createRanker(URLS);
    const r = await timed(hedged(ranker.order(), call, ranker, 2_500));
    expect(r.value).toBe("logs from tenderly");
    expect(r.ms).toBeLessThanOrEqual(500);
  });

  it("when every endpoint fails, it fails with every node's answer (the history engine then records a gap, never empty logs)", async () => {
    const { call } = endpoints({ [PN]: { ms: 100, ok: false }, [TD]: { ms: 200, ok: false }, [EP]: { ms: 300, ok: false } });
    const ranker = createRanker(URLS);
    const r = await timed(hedged(ranker.order(), call, ranker, 2_500));
    expect(r.value).toBeUndefined();
    expect((r.error as Error).message).toBe("publicnode failed | tenderly failed | ethpandaops failed");
  });

  it("a recoverable answer from one node is not hidden by a later timeout from another (live regression, 2026-11-24)", async () => {
    // ethpandaops has not reached the head another node reported; tenderly times out after it
    const lag = Object.assign(new Error("RPC Request failed."), { details: "block range extends beyond current head block" });
    const timeout = Object.assign(new Error("The request took too long to respond."), { name: "TimeoutError" });
    const pruned = Object.assign(new Error("RPC Request failed."), { details: "pruned history unavailable" });
    const at: Record<string, [number, Error]> = { [PN]: [1_600, pruned], [TD]: [6_000, timeout], [EP]: [2_000, lag] };
    const call = (url: string) => new Promise<never>((_, reject) => setTimeout(() => reject(at[url]![1]), at[url]![0]));
    const ranker = createRanker(URLS);
    const r = await timed(hedged(ranker.order(), call, ranker, 2_500));
    const msg = (r.error as Error).message;
    expect(msg.slice(0, 160)).toMatch(/beyond (the )?current head/i); // what the history engine's tolerance reads
    expect(msg.indexOf("took too long")).toBeGreaterThan(msg.indexOf("beyond current head"));
  });

  it("a single failure is rethrown unchanged", async () => {
    const ranker = createRanker([EP]);
    const e = new Error("only one");
    const r = await timed(hedged(ranker.order(), () => Promise.reject(e), ranker, 2_500));
    expect(r.error).toBe(e);
  });

  it("a failed endpoint cools down for a minute, stays available as a last resort, and returns to its place after", async () => {
    let t = 0;
    const ranker = createRanker(URLS, { cooldownMs: 60_000, now: () => t });
    ranker.failure(PN);
    expect(ranker.order()).toEqual([TD, EP, PN]);
    t = 61_000;
    expect(ranker.order()).toEqual([PN, TD, EP]);
  });

  it("a slower endpoint that answers after the winner is marked healthy but does not become the preferred one", async () => {
    const { call } = endpoints({ [PN]: { ms: 4_000, ok: true }, [TD]: { ms: 500, ok: true }, [EP]: { ms: 500, ok: true } });
    const ranker = createRanker(URLS);
    const r = await timed(hedged(ranker.order(), call, ranker, 2_500));
    expect(r.value).toBe("logs from tenderly");
    await vi.advanceTimersByTimeAsync(2_000); // publicnode answers late
    expect(ranker.order()[0]).toBe(TD);
  });
});

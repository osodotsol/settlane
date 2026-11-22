// Which agreement ids exist, answered with as few RPC calls as possible (R2-B, audit hardening "agreement-id flooding").
//
// Ids start at 1, are consecutive and are never deleted (LIFECYCLE, D-018), so ONE number answers every id: the number
// of agreements. Once `count` is known, every id <= count exists with no further call, ever (positive answers never
// expire). An id above it is answered from that same number while it is fresh (negative answers expire after
// COUNT_TTL_MS), so a flood of made-up ids costs nothing per id. The count is re-read:
//  - at most once per COUNT_TTL_MS for ids far above it (a new agreement appears within that time), and
//  - at most once per NEAR_REFRESH_MS for the next few ids (count + 1 .. count + NEAR_WINDOW), so a creator who opens the
//    agreement they just made sees it within seconds.
// Only one read is in flight at a time (all callers share it), it is time-bounded for the caller, and after a failure the
// next attempt waits FAILURE_BACKOFF_MS, so a node outage is not multiplied by the request rate either. Malformed or
// absurd ids never reach this module (ID_PATTERN).

import { withBudget } from "@/chain/budget";

/** Positive decimal, no leading zero, at most 20 digits (beyond u64: no real id can get there one agreement at a time). */
export const ID_PATTERN = /^[1-9]\d{0,19}$/;
export const COUNT_TTL_MS = 10_000;
export const NEAR_WINDOW = 8n;
export const NEAR_REFRESH_MS = 2_000;
export const FAILURE_BACKOFF_MS = 5_000;

export type IdAnswer = "exists" | "missing" | "unknown";

/** `readCount(from)` returns the number of agreements; `from` ids are already known to exist (it may probe only past them). */
export function createKnownIds(readCount: (from: bigint) => Promise<number>, now: () => number = Date.now) {
  let count = 0n; // highest id known to exist (positive knowledge never expires)
  let readAt = -Infinity; // when `count` was last read successfully
  let failedAt = -Infinity;
  let inflight: Promise<bigint> | undefined;
  let reads = 0;

  const refresh = (): Promise<bigint> => {
    if (!inflight) {
      reads++;
      inflight = readCount(count)
        .then((n) => {
          const c = BigInt(n);
          if (c > count) count = c;
          readAt = now();
          return count;
        })
        .catch((e) => {
          failedAt = now();
          throw e;
        })
        .finally(() => {
          inflight = undefined;
        });
    }
    return inflight;
  };

  return {
    /** Whether `id` exists; "unknown" only when the count could not be read in time. */
    async check(id: bigint, budgetMs: number): Promise<IdAnswer> {
      if (id < 1n) return "missing";
      if (id <= count) return "exists";
      const t = now();
      const near = id <= count + NEAR_WINDOW;
      const fresh = t - readAt < (near ? NEAR_REFRESH_MS : COUNT_TTL_MS);
      if (fresh) return "missing";
      // just failed: do not ask again yet; the caller says the nodes are not answering instead of guessing "missing"
      if (!inflight && t - failedAt < FAILURE_BACKOFF_MS) return "unknown";
      try {
        const c = await withBudget(refresh(), budgetMs, "agreement count");
        return id <= c ? "exists" : "missing";
      } catch {
        return "unknown";
      }
    },
    /** Records an id seen to exist by another read. */
    saw(id: bigint) {
      if (id > count) count = id;
    },
    /** For tests and diagnostics: how many count reads were started. */
    get reads() {
      return reads;
    },
  };
}

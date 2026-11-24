// Small in-process cache for chain reads on the server (frontend/PLAN.md §3, F2).
//
// Why not only ISR: a statically cached explorer could hide an agreement created a moment ago, and a
// failed RPC read would be cached as an error page. Instead the explorer and agreement pages render on
// each request and read through this cache: fresh data at most `ttlMs` old, one in-flight request per
// key, and on an RPC failure the last good value is served with its age ("stale"). Only when nothing
// was ever read does the failure surface. The cache lives in one server process; a cold start reads fresh.

import { withBudget } from "@/chain/budget";

export type Cached<T> = { value: T; fetchedAt: number; stale: boolean };

type Entry = { value?: unknown; fetchedAt?: number; inflight?: Promise<unknown> };

/**
 * Bounded (R2-B): at most MAX_ENTRIES keys, least recently used evicted first (an entry with a read in flight is kept until
 * it settles). Keys are a few fixed reads plus one per EXISTING agreement (known-ids.ts keeps made-up ids out), so the
 * bound is a safety net, not the normal case.
 */
export const MAX_ENTRIES = 256;
const entries = new Map<string, Entry>();

/** Thrown when every slot has a read in flight: the bound holds, and the caller reports the server as busy (residual fix M6). */
export class CacheFullError extends Error {
  constructor() {
    super("The server is busy reading Sepolia; try again in a moment.");
    this.name = "CacheFullError";
  }
}

function touch(key: string): Entry {
  const existing = entries.get(key);
  if (!existing && entries.size >= MAX_ENTRIES) {
    // admission: make room by evicting the least recently used settled entry; with every slot in flight, admit nothing
    let evicted = false;
    for (const [k, e] of entries) {
      if (!e.inflight) {
        entries.delete(k);
        evicted = true;
        break;
      }
    }
    if (!evicted) throw new CacheFullError();
  }
  const entry = existing ?? {};
  entries.delete(key);
  entries.set(key, entry); // most recently used last
  return entry;
}

/**
 * `budgetMs` bounds how long a CALLER waits (R2 H1): past it, the last good value is served as stale, or the call fails
 * fast. The read itself keeps running in the background and refreshes the entry when it finishes, so a hanging node
 * does not spawn a new hanging read on every request.
 */
export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>, budgetMs?: number): Promise<Cached<T>> {
  const now = Date.now();
  const entry = touch(key);
  if (entry.fetchedAt !== undefined && now - entry.fetchedAt < ttlMs) {
    return { value: entry.value as T, fetchedAt: entry.fetchedAt, stale: false };
  }
  if (!entry.inflight) {
    entry.inflight = fetcher()
      .then((value) => {
        entry.value = value;
        entry.fetchedAt = Date.now();
        return value;
      })
      .finally(() => {
        entry.inflight = undefined;
      });
  }
  try {
    const value = (await (budgetMs ? withBudget(entry.inflight, budgetMs, key) : entry.inflight)) as T;
    return { value, fetchedAt: entry.fetchedAt ?? Date.now(), stale: false };
  } catch (error) {
    if (entry.fetchedAt !== undefined) return { value: entry.value as T, fetchedAt: entry.fetchedAt, stale: true };
    throw error;
  }
}

/** Number of keys held (tests, diagnostics). */
export const cacheSize = () => entries.size;

/** Test helper: forget everything. */
export function clearCache() {
  entries.clear();
}

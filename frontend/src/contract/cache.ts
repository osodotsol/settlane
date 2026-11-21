// Small in-process cache for chain reads on the server (frontend/PLAN.md §3, F2).
//
// Why not only ISR: a statically cached explorer could hide an agreement created a moment ago, and a
// failed RPC read would be cached as an error page. Instead the explorer and agreement pages render on
// each request and read through this cache: fresh data at most `ttlMs` old, one in-flight request per
// key, and on an RPC failure the last good value is served with its age ("stale"). Only when nothing
// was ever read does the failure surface. The cache lives in one server process; a cold start reads fresh.

export type Cached<T> = { value: T; fetchedAt: number; stale: boolean };

type Entry = { value?: unknown; fetchedAt?: number; inflight?: Promise<unknown> };

const entries = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<Cached<T>> {
  const now = Date.now();
  const entry = entries.get(key) ?? {};
  entries.set(key, entry);
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
    const value = (await entry.inflight) as T;
    return { value, fetchedAt: entry.fetchedAt ?? Date.now(), stale: false };
  } catch (error) {
    if (entry.fetchedAt !== undefined) return { value: entry.value as T, fetchedAt: entry.fetchedAt, stale: true };
    throw error;
  }
}

/** Test helper: forget everything. */
export function clearCache() {
  entries.clear();
}

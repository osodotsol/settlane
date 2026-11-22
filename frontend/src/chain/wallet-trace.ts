// A passive record of the requests this page makes to the browser wallet (EIP-1193 `request`): the method,
// when it was handed to the wallet and when (and how) it was answered. It never records parameters or
// results, only method names, times and error codes. It changes nothing about the request.
//
// Why: in the real-wallet run three signing requests produced no MetaMask prompt, and the page could not tell
// whether its request was still unanswered or had never been made. With this record the page can state facts:
// "eth_sendTransaction was handed to the wallet 42 s ago and has not been answered." It cannot see inside the
// wallet, and the interface says so.

export type TraceEntry = {
  id: number;
  method: string;
  startedAt: number;
  endedAt?: number;
  outcome?: "answered" | "error";
  errorCode?: number;
};

type Eip1193 = { request: (args: { method: string; params?: unknown }) => Promise<unknown> };

const MAX = 60;
let entries: TraceEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  entries = entries.slice(-MAX);
  listeners.forEach((l) => l());
};

export const traceStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  snapshot: () => entries,
  /** Requests made at or after `since` (ms), oldest first. */
  since: (since: number) => entries.filter((e) => e.startedAt >= since),
  clear() {
    entries = [];
    emit();
  },
};

/** Records one request around an existing `request` function. Exported for tests. */
export async function traced<T>(method: string, run: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const entry: TraceEntry = { id: nextId++, method, startedAt: now() };
  entries = [...entries, entry];
  emit();
  try {
    const result = await run();
    entries = entries.map((e) => (e.id === entry.id ? { ...e, endedAt: now(), outcome: "answered" } : e));
    emit();
    return result;
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "number" ? ((error as { code: number }).code as number) : undefined;
    entries = entries.map((e) => (e.id === entry.id ? { ...e, endedAt: now(), outcome: "error", errorCode: code } : e));
    emit();
    throw error;
  }
}

const wrapped = new WeakMap<object, unknown>();

/**
 * The same provider, with `request` recorded. Every other property and method is the original, read from the ORIGINAL
 * object (R2-B: getters and setters run with `this` = the provider, never the wrapper, so a provider that keeps state in
 * private class fields or checks `this` keeps working), and methods are bound to it once (the same function on every
 * read, so identity checks and add/remove listener pairs behave). `window.ethereum` itself is never replaced or changed;
 * only the object handed to wagmi's one connector is wrapped. The wrapper is created once per provider, so wagmi sees one
 * stable object.
 */
export function traceProvider<P extends Eip1193>(provider: P): P {
  const existing = wrapped.get(provider);
  if (existing) return existing as P;
  const bound = new Map<PropertyKey, { original: unknown; fn: unknown }>();
  const request = (args: { method: string; params?: unknown }) => traced(args.method, () => provider.request(args));
  const proxy = new Proxy(provider, {
    get(target, prop) {
      if (prop === "request") return request;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const cachedFn = bound.get(prop);
      if (cachedFn && cachedFn.original === value) return cachedFn.fn;
      const fn = (value as (...a: unknown[]) => unknown).bind(target);
      bound.set(prop, { original: value, fn });
      return fn;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
  wrapped.set(provider, proxy);
  return proxy;
}

/**
 * Plain-language lines for the requests of one attempt, e.g. "eth_sendTransaction: handed to the wallet 42 s ago,
 * no answer yet". Only what the page did and what came back; never what happened inside the wallet.
 */
export function describeTrace(list: readonly TraceEntry[], now: number): string[] {
  const secs = (ms: number) => (ms < 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
  return list.map((e) => {
    if (e.endedAt === undefined) return `${e.method}: handed to the wallet ${secs(now - e.startedAt)} ago, no answer yet`;
    if (e.outcome === "answered") return `${e.method}: answered after ${secs(e.endedAt - e.startedAt)}`;
    return `${e.method}: the wallet returned an error${e.errorCode !== undefined ? ` (code ${e.errorCode})` : ""} after ${secs(e.endedAt - e.startedAt)}`;
  });
}

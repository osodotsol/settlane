import { custom, http, type Chain, type Transport } from "viem";

// An event-log transport that survives a dead or pruning endpoint (2026-11-24, Sepolia outage). viem's `fallback` walks
// the endpoints in a fixed order for every request and remembers nothing, so one endpoint that hangs costs its full
// timeout on every chunk of every refresh, and the history could not finish inside its time budget although a healthy
// archival node was available. This transport:
//   - remembers health: an endpoint that just failed (error, timeout, pruned range) is tried last for `cooldownMs`, and
//     the endpoint that last answered is tried first;
//   - hedges: if the endpoint being tried has not answered within `hedgeMs`, the next one is started as well, and the
//     first success wins (the slower request is left to finish within its own timeout and its result is ignored);
//   - fails only when every endpoint has failed. One error is rethrown as it is; several are combined into one error
//     whose message lists each node's own answer first and timeouts last, so a caller that inspects the message (the
//     history engine's "beyond current head" tolerance) still sees a recoverable answer from any node. (With hedging,
//     the error that arrives last in time is usually a timeout, which would hide it.)
// It is used for event LOGS only (`history-client.ts`). Contract state, simulation and receipts keep `publicClient`.

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || /took too long|timed? ?out/i.test(e.message));

/** One short line for an endpoint's error: the node's own words (viem `details`) when there are any. */
function brief(e: unknown): string {
  if (!(e instanceof Error)) return String(e).slice(0, 80);
  const x = e as Error & { details?: string; shortMessage?: string };
  return (x.details || x.shortMessage || x.message).replace(/\s+/g, " ").slice(0, 80);
}

/** The error to surface when every endpoint failed (see the header). */
export function combineErrors(errors: unknown[]): unknown {
  if (errors.length === 1) return errors[0];
  const ordered = [...errors.filter((e) => !isTimeout(e)), ...errors.filter(isTimeout)];
  return new Error(ordered.map(brief).join(" | "), { cause: errors });
}

export type Ranker = { order(): string[]; success(url: string, won: boolean): void; failure(url: string): void };

export function createRanker(urls: readonly string[], { cooldownMs = 60_000, now = () => Date.now() }: { cooldownMs?: number; now?: () => number } = {}): Ranker {
  const failedAt = new Map<string, number>();
  let preferred: string | null = null;
  return {
    order() {
      const t = now();
      const cooling = (u: string) => (failedAt.get(u) ?? -Infinity) > t - cooldownMs;
      const healthy = urls.filter((u) => !cooling(u));
      if (preferred !== null && healthy.includes(preferred)) {
        healthy.splice(healthy.indexOf(preferred), 1);
        healthy.unshift(preferred);
      }
      // cooling endpoints stay available as a last resort, the longest-cooling first
      const cold = urls.filter(cooling).sort((a, b) => failedAt.get(a)! - failedAt.get(b)!);
      return [...healthy, ...cold];
    },
    success(url, won) {
      failedAt.delete(url);
      if (won) preferred = url;
    },
    failure(url) {
      failedAt.set(url, now());
      if (preferred === url) preferred = null;
    },
  };
}

/** Runs `call` against the endpoints in `order`, hedging after `hedgeMs`; resolves with the first success. */
export function hedged<T>(order: readonly string[], call: (url: string) => Promise<T>, ranker: Ranker, hedgeMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let next = 0;
    let pending = 0;
    let done = false;
    const errors: unknown[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      done = true;
      clearTimeout(timer);
    };
    const launch = () => {
      if (done || next >= order.length) return;
      const url = order[next++]!;
      pending++;
      clearTimeout(timer);
      if (next < order.length) timer = setTimeout(launch, hedgeMs);
      call(url).then(
        (value) => {
          pending--;
          ranker.success(url, !done);
          if (done) return;
          finish();
          resolve(value);
        },
        (error: unknown) => {
          pending--;
          ranker.failure(url);
          if (done) return;
          errors.push(error);
          if (next < order.length) launch();
          else if (pending === 0) {
            finish();
            reject(combineErrors(errors));
          }
        },
      );
    };
    if (order.length === 0) reject(new Error("no endpoint configured"));
    else launch();
  });
}

/** The viem transport: one http transport per URL (no retries of its own), ordered and hedged as above. */
export function adaptiveTransport(urls: readonly string[], chain: Chain, { timeout, hedgeMs, cooldownMs }: { timeout: number; hedgeMs: number; cooldownMs?: number }): Transport {
  const endpoints = new Map(urls.map((url) => [url, http(url, { timeout, retryCount: 0 })({ chain, retryCount: 0 })] as const));
  const ranker = createRanker(urls, { cooldownMs });
  return custom(
    {
      request: ({ method, params }: { method: string; params?: unknown }) =>
        hedged(ranker.order(), (url) => endpoints.get(url)!.request({ method, params } as never), ranker, hedgeMs),
    },
    { retryCount: 0 },
  );
}

// End-to-end time budgets for chain reads (R2 audit H1, H2). A read is a chain of calls through fallback endpoints with
// their own timeouts and retries; when every endpoint hangs, that chain can take minutes. A budget bounds what a page
// WAITS for, not the read itself: the underlying request may finish later (and refresh a cache), but the page has
// already moved on to a clear "not answering" or "showing last good data" state.

export class BudgetExceeded extends Error {
  constructor(public readonly what: string, public readonly ms: number) {
    super(`${what} did not answer within ${Math.round(ms / 1000)} s`);
    this.name = "BudgetExceeded";
  }
}

export function withBudget<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BudgetExceeded(what, ms)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/**
 * Server rendering: what any one server read may make a visitor wait for. Real Sepolia reads take 0.5 to 4 s; the budget
 * leaves room for one failover past a dead endpoint (5 s per-endpoint timeout, src/chain/client.ts).
 */
export const SERVER_BUDGET_MS = 10_000;
/** The agreement-existence check in proxy.ts (before a page renders). */
export const PROXY_BUDGET_MS = 3_000;
/** Browser queries: one attempt; with one retry the total wait is about twice this. */
export const CLIENT_BUDGET_MS = 12_000;

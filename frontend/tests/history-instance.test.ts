import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ blockNumber: [] as unknown[] }));
vi.mock("@/chain/history-client", () => ({
  historyClient: {
    getBlockNumber: vi.fn(async (args: unknown) => {
      calls.blockNumber.push(args);
      return 12_190_000n;
    }),
    getLogs: vi.fn(async () => []),
    getBlock: vi.fn(async () => ({ timestamp: 1n })),
  },
}));

describe("the application's history engine", () => {
  it("reads the head block without viem's block-number cache, so a scan right after a confirmation reaches the new block", async () => {
    const { history } = await import("@/contract/history-instance");
    await history.refresh();
    expect(calls.blockNumber[0]).toEqual({ cacheTime: 0 });
  }, 20_000); // verifying the bundled snapshot is CPU work: under a loaded machine 5 s was not always enough
});

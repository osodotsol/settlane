import { beforeEach, describe, expect, it, vi } from "vitest";

// The runner against a mocked chain: the wallet is a function the test controls, so unanswered, late,
// rejected and ambiguous answers can be produced exactly. No network, no wallet.
const chain = vi.hoisted(() => ({
  simulateContract: vi.fn(async () => ({ request: { functionName: "claim" } })),
  estimateContractGas: vi.fn(async () => 100_000n),
  getTransactionCount: vi.fn(async () => 5),
  readContract: vi.fn(async () => [3, 1n, 0n, 0n, 0n, 0n, 0n, 1n] as const), // Approved, revision 1
  waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => ({ status: "success", blockNumber: 42n, transactionHash: hash, logs: [] })),
  getTransactionReceipt: vi.fn(async () => null),
  getTransaction: vi.fn(async () => null),
}));
vi.mock("@/chain/client", () => ({ publicClient: chain }));
vi.mock("@/contract/read", () => ({ agreementCount: vi.fn(async () => 2), readAgreement: vi.fn(async () => null) }));

const { startTx, stopWaiting, reconcile, confirmNotInWallet, milestoneKey } = await import("@/chain/write");
const { registry } = await import("@/chain/tx-registry");

const ACCOUNT = "0x00000000000000000000000000000000000000b2" as const;
const HASH = `0x${"cd".repeat(32)}` as `0x${string}`;
const tick = () => new Promise((r) => setTimeout(r, 0));
let id = 100n;
/** A wallet whose answer the test decides later. */
function heldWallet() {
  let resolve!: (h: `0x${string}`) => void;
  let reject!: (e: unknown) => void;
  const calls: unknown[] = [];
  const write = vi.fn((vars: never) => {
    calls.push(vars);
    return new Promise<`0x${string}`>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return { write, calls, answer: (h: `0x${string}`) => resolve(h), fail: (e: unknown) => reject(e) };
}
const claim = (n: bigint) => ({ fn: "claim" as const, args: [n, 0, ACCOUNT] as const });
const run = (n: bigint, write: (v: never) => Promise<`0x${string}`>, walletChainId = 11155111) =>
  startTx({ req: claim(n), label: "Claim payout", account: ACCOUNT, walletChainId, write, refresh: () => undefined });
const until = async (pred: () => boolean) => {
  for (let i = 0; i < 50 && !pred(); i++) await tick();
};

beforeEach(() => {
  id += 1n;
  chain.getTransactionReceipt.mockResolvedValue(null);
});

describe("the request runner", () => {
  it("passes the gas limit with the margin and never sets fees", async () => {
    const w = heldWallet();
    void run(id, w.write);
    await until(() => w.calls.length === 1);
    expect(w.calls[0]).toMatchObject({ gas: 125_000n, chainId: 11155111 });
    expect(Object.keys(w.calls[0] as object)).not.toEqual(expect.arrayContaining(["maxFeePerGas"]));
    expect(Object.keys(w.calls[0] as object)).not.toEqual(expect.arrayContaining(["maxPriorityFeePerGas"]));
    w.answer(HASH);
  });

  it("a double click sends one request", async () => {
    const w = heldWallet();
    void run(id, w.write);
    void run(id, w.write); // same action, same tick
    await until(() => w.calls.length > 0);
    await tick();
    expect(w.write).toHaveBeenCalledTimes(1);
    w.answer(HASH);
  });

  it("an unanswered request stays open: no timeout cancels it, and a new request is refused", async () => {
    const w = heldWallet();
    void run(id, w.write);
    await until(() => registry.get(milestoneKey(id, 0))?.state.phase === "awaiting");
    void run(id, w.write);
    await tick();
    expect(w.write).toHaveBeenCalledTimes(1);
    expect(registry.get(milestoneKey(id, 0))!.state.phase).toBe("awaiting");
  });

  it("after 'Stop waiting', a late answer from the wallet is still applied and followed to its receipt", async () => {
    const w = heldWallet();
    const key = milestoneKey(id, 0);
    const done = run(id, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    stopWaiting(key);
    expect(registry.get(key)!.state).toEqual({ phase: "unknown", reason: "stopped" });
    void run(id, w.write); // still refused: the old request may be open in the wallet
    await tick();
    expect(w.write).toHaveBeenCalledTimes(1);
    w.answer(HASH); // the user approves in MetaMask later
    await done;
    expect(registry.get(key)!.state).toMatchObject({ phase: "confirmed", hash: HASH, blockNumber: 42n });
  });

  it("a declined signature is 'rejected' (nothing sent) and allows a new request", async () => {
    const w = heldWallet();
    const key = milestoneKey(id, 0);
    const done = run(id, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    w.fail(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    await done;
    expect(registry.get(key)!.state).toEqual({ phase: "rejected" });
  });

  it("an ambiguous wallet error is 'unknown', never 'rejected' or 'failed'", async () => {
    const w = heldWallet();
    const key = milestoneKey(id, 0);
    const done = run(id, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    w.fail(new Error("Internal JSON-RPC error."));
    await done;
    expect(registry.get(key)!.state).toMatchObject({ phase: "unknown", reason: "wallet-error" });
  });

  it("a wallet on another network is refused before anything is asked of it", async () => {
    const w = heldWallet();
    await run(id, w.write, 1);
    expect(w.write).not.toHaveBeenCalled();
    expect(registry.get(milestoneKey(id, 0))!.state.phase).toBe("failed");
  });

  it("'Check the chain' finds an action that took effect while the page was not watching", async () => {
    const w = heldWallet();
    const key = milestoneKey(id, 0);
    void run(id, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    stopWaiting(key);
    chain.readContract.mockResolvedValueOnce([4, 1n, 0n, 0n, 0n, 0n, 0n, 1n] as never); // now Paid
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.state.phase).toBe("found");
  });

  it("'Check the chain' releases a lost request only after the user confirms it is gone from the wallet, and never while something is pending", async () => {
    const w = heldWallet();
    const key = milestoneKey(id, 0);
    void run(id, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    stopWaiting(key);
    // as after a reload: the page no longer holds the request (it may still be open in the wallet)
    registry.set({ ...registry.get(key)!, live: false, state: { phase: "unknown", reason: "reloaded" } });
    chain.getTransactionCount.mockResolvedValueOnce(5).mockResolvedValueOnce(6); // latest 5, pending 6
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("pending-account");
    expect(registry.get(key)!.cleared).toBe(false);
    await reconcile(key, () => undefined); // nothing pending now
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("needs-confirmation");
    expect(registry.get(key)!.cleared).toBe(false);
    await confirmNotInWallet(key, () => undefined);
    expect(registry.get(key)!.cleared).toBe(true);
  });

  it("a reverted receipt is 'reverted', not 'confirmed'", async () => {
    chain.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted", blockNumber: 43n, transactionHash: HASH, logs: [] } as never);
    const w = heldWallet();
    const key = milestoneKey(id, 0);
    const done = run(id, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    w.answer(HASH);
    await done;
    expect(registry.get(key)!.state).toEqual({ phase: "reverted", hash: HASH });
  });
});

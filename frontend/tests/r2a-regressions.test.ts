// R2-A regression tests for the R2 audit findings (docs/AUDIT_R2... see the R2 report). Written FIRST, against the
// existing public interfaces, asserting the CORRECT behavior: they failed at 35be788 and pass after the fixes.
import { describe, expect, it, vi } from "vitest";

const chain = vi.hoisted(() => ({
  simulateContract: vi.fn(async () => ({ request: { functionName: "x" } })),
  estimateContractGas: vi.fn(async () => 100_000n),
  getTransactionCount: vi.fn(async () => 5),
  getTransaction: vi.fn(async (): Promise<unknown> => null),
  readContract: vi.fn(async () => [3, 1n, 0n, 0n, 0n, 0n, 0n, 1n] as never),
  waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => ({ status: "success", blockNumber: 42n, transactionHash: hash, logs: [] })),
  getTransactionReceipt: vi.fn(async (): Promise<unknown> => null),
}));
const count = vi.hoisted(() => ({ value: 2, fail: false }));
vi.mock("@/chain/client", () => ({ publicClient: chain }));
vi.mock("@/contract/read", () => ({
  agreementCount: vi.fn(async () => {
    if (count.fail) throw new Error("RPC timeout");
    return count.value;
  }),
  readAgreement: vi.fn(async (id: bigint) => ({ id, client: "0x00000000000000000000000000000000000000c1" })),
}));

const { startTx, stopWaiting, reconcile, CREATE_KEY, milestoneKey } = await import("@/chain/write");
const { registry, canStart } = await import("@/chain/tx-registry");
const { createHistory } = await import("@/contract/history");
const { validateCreate } = await import("@/domain/create-form");

const ACCOUNT = "0x00000000000000000000000000000000000000c1" as const;
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (p: () => boolean) => {
  for (let i = 0; i < 80 && !p(); i++) await tick();
};
const createReq = { fn: "create" as const, args: ["0x00000000000000000000000000000000000000b2", "0x00000000000000000000000000000000000000a3", 1n, 1, [1n, 0n, 0n], [9n, 0n, 0n], [7n, 0n, 0n]] as const, value: 1n };
function held() {
  let resolve!: (h: `0x${string}`) => void;
  const write = vi.fn(() => new Promise<`0x${string}`>((r) => (resolve = r)));
  return { write, answer: (h: `0x${string}`) => resolve(h) };
}
const reset = () => {
  chain.getTransactionCount.mockReset().mockResolvedValue(5);
  chain.getTransaction.mockReset().mockResolvedValue(null);
  chain.getTransactionReceipt.mockReset().mockResolvedValue(null);
  chain.readContract.mockReset().mockResolvedValue([3, 1n, 0n, 0n, 0n, 0n, 0n, 1n] as never);
  count.value = 2;
  count.fail = false;
};

describe("M1: a missing before-signing read never justifies releasing a request", () => {
  it("if the state cannot be read before signing, the wallet is never asked (nothing to compare with later)", async () => {
    reset();
    count.fail = true;
    const w = held();
    await startTx({ req: createReq, label: "Create", account: ACCOUNT, walletChainId: 11155111, write: w.write, refresh: () => undefined });
    expect(w.write).not.toHaveBeenCalled();
    expect(registry.get(CREATE_KEY)!.state.phase).toBe("failed");
  });

  it("a moved account nonce does not unlock a second create: the request stays blocked without the user's confirmation", async () => {
    reset();
    registry.remove(CREATE_KEY);
    const w = held();
    void startTx({ req: createReq, label: "Create", account: ACCOUNT, walletChainId: 11155111, write: w.write, refresh: () => undefined });
    await until(() => registry.get(CREATE_KEY)?.state.phase === "awaiting");
    stopWaiting(CREATE_KEY);
    // simulate a reload: the page's promise is gone (not live), the wallet may still hold the request
    registry.set({ ...registry.get(CREATE_KEY)!, live: false, state: { phase: "unknown", reason: "reloaded" } });
    chain.getTransactionCount.mockResolvedValue(6); // the account sent something; no new agreement by it
    await reconcile(CREATE_KEY, () => undefined);
    expect(canStart(registry.get(CREATE_KEY))).toBe(false);
  });
});

describe("M6: an unresolved live wallet request cannot be bypassed by Check the chain", () => {
  it("while this tab still holds the open request, checking never releases the action", async () => {
    reset();
    const w = held();
    const req = { fn: "claim" as const, args: [700n, 0, ACCOUNT] as const };
    void startTx({ req, label: "Claim", account: ACCOUNT, walletChainId: 11155111, write: w.write, refresh: () => undefined });
    const key = milestoneKey(700n, 0);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    stopWaiting(key);
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.live).toBe(true);
    expect(canStart(registry.get(key))).toBe(false);
    w.answer(`0x${"bb".repeat(32)}`);
    await until(() => registry.get(key)?.state.phase === "confirmed");
    expect(registry.get(key)!.state.phase).toBe("confirmed"); // the late answer is still followed
  });
});

describe("M5: a dropped transaction is released only with proof the original can never be mined", () => {
  const base = (id: bigint, hash: `0x${string}`) => ({ key: milestoneKey(id, 0), label: "Claim", action: { fn: "claim" as const, id, m: 0 }, account: ACCOUNT, startedAt: Date.now(), attempt: 1, state: { phase: "unknown" as const, reason: "receipt-timeout" as const, hash }, live: false, lateHashes: [], before: { kind: "milestone" as const, state: "approved" as const, revision: 1n, rejections: 0n }, nonceBefore: 5 });
  it("released when the original's nonce has been used by another transaction and the action did not happen", async () => {
    reset();
    const hash = `0x${"cc".repeat(32)}` as const;
    registry.set({ ...base(701n, hash), txNonce: 5 } as never);
    chain.getTransactionCount.mockResolvedValue(6); // nonce 5 consumed by something else
    await reconcile(milestoneKey(701n, 0), () => undefined);
    expect(canStart(registry.get(milestoneKey(701n, 0)))).toBe(true);
  });
  it("NOT released while the original's nonce is unused (the wallet could still send it)", async () => {
    reset();
    const hash = `0x${"cd".repeat(32)}` as const;
    registry.set({ ...base(702n, hash), txNonce: 5 } as never);
    chain.getTransactionCount.mockResolvedValue(5);
    await reconcile(milestoneKey(702n, 0), () => undefined);
    expect(canStart(registry.get(milestoneKey(702n, 0)))).toBe(false);
  });
  it("a known hash that is still pending goes back to waiting for its receipt", async () => {
    reset();
    const hash = `0x${"ce".repeat(32)}` as const;
    registry.set(base(703n, hash) as never);
    chain.getTransaction.mockResolvedValue({ hash, nonce: 5, blockNumber: null });
    chain.waitForTransactionReceipt.mockImplementationOnce(() => new Promise(() => {}) as never);
    await reconcile(milestoneKey(703n, 0), () => undefined);
    expect(registry.get(milestoneKey(703n, 0))!.state.phase).toBe("pending");
  });
});

describe("M2: checksum-protected addresses", () => {
  const form = (provider: string) => ({ provider, verifier: "0x1F812Da990e91ECaeE455bA6AF815Cf43d3531c9", review: "1", reviewUnit: "days" as const, milestones: [{ amount: "0.01", every: "2", unit: "days" as const, spec: "x" }] });
  it("rejects a mixed-case address whose EIP-55 checksum is wrong", () => {
    const r = validateCreate(form("0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e5"), ACCOUNT);
    expect(r.ok).toBe(false);
  });
  it("accepts a correctly checksummed address", () => {
    expect(validateCreate(form("0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4"), ACCOUNT).ok).toBe(true);
  });
});

describe("M3/M4: history integrity", () => {
  const ADDR = "0xf79d229a039bf5c84ecc7327060f8bbc888d2182";
  const pad = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
  const created = (id: number, block: bigint) => ({
    blockNumber: block, blockHash: pad(Number(block) + 1000), transactionHash: pad(5000 + id), logIndex: 0,
    topics: ["0x5a4452b83280be38fc3f3026669c9535fc0f866883681db6ecef28ee26edd6b7", pad(id), pad(0xc1), pad(0xb2)] as `0x${string}`[],
    data: `0x${"0".repeat(24)}${"a3".padStart(40, "0")}${pad(5).slice(2)}${pad(1).slice(2)}` as `0x${string}`,
  });
  it("M3: a lagging node never deletes events from blocks it did not scan", async () => {
    let lag = 0n;
    let head = 399n;
    const logs = [created(1, 120n), created(2, 398n)];
    const source = {
      getBlockNumber: async () => head,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock > head - lag) throw new Error(`block range extends beyond current head block: requested ${toBlock}, head ${head - lag}`);
        return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
      },
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
    };
    const e = createHistory({ source, deployBlock: 100n, chainId: 11155111, address: ADDR, snapshotFile: null, chunk: 1000n, reorgWindow: 64n });
    await e.refresh();
    head = 401n;
    lag = 4n;
    const h = await e.refresh();
    expect(h.events.map((a) => a.id)).toEqual([1n, 2n]);
  });
  it("M4: a conflict with the snapshot stays visible and the verified event is kept", async () => {
    const snapLog = created(1, 495n);
    const { snapshotContentHash } = await import("@/contract/snapshot");
    const ev = [{ blockNumber: "495", blockHash: snapLog.blockHash, transactionHash: snapLog.transactionHash, logIndex: 0, topics: snapLog.topics, data: snapLog.data, timestamp: "495" }];
    const file = { chainId: 11155111, address: ADDR, deployBlock: "100", lastVerifiedBlock: "500", lastVerifiedBlockHash: pad(1), agreements: 1, generatedAt: "x", provenance: { sources: [], method: "", finality: "" }, contentHash: snapshotContentHash(ev), events: ev };
    let head = 520n;
    const source = { getBlockNumber: async () => head, getLogs: async () => [], getBlock: async () => ({ timestamp: 1n }) };
    const e = createHistory({ source, deployBlock: 100n, chainId: 11155111, address: ADDR, snapshotFile: file, chunk: 1000n, reorgWindow: 64n });
    expect((await e.refresh()).status.conflicts.length).toBeGreaterThan(0);
    head = 600n;
    const second = await e.refresh();
    expect(second.status.conflicts.length).toBeGreaterThan(0);
    expect(second.status.complete).toBe(false);
    expect(second.events).toHaveLength(1);
  });
});

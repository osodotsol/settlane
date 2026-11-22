import { beforeEach, describe, expect, it, vi } from "vitest";

// R2-B part 1: request records scoped by chain, contract and account; the user's "it is no longer in MetaMask" is
// evidence of intent, never proof; a create is never unlocked by it. Mocked chain and wallet, no network.
const chain = vi.hoisted(() => ({
  simulateContract: vi.fn(async () => ({ request: { functionName: "x" } })),
  estimateContractGas: vi.fn(async () => 100_000n),
  getTransactionCount: vi.fn(async () => 5),
  readContract: vi.fn(async () => [3, 1n, 0n, 0n, 0n, 0n, 0n, 1n] as const), // Approved, revision 1
  waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => ({ status: "success", blockNumber: 42n, transactionHash: hash, logs: [] })),
  getTransactionReceipt: vi.fn(async (): Promise<unknown> => null),
  getBlockNumber: vi.fn(async () => 1_000n),
  getBlock: vi.fn(async (): Promise<unknown> => ({ number: 1_000n, timestamp: 1_000n, transactions: [] })),
  getTransaction: vi.fn(async (): Promise<unknown> => null),
}));
const reads = vi.hoisted(() => ({ count: 2, agreements: new Map<bigint, Record<string, unknown> & { id: bigint; client: string }>() }));
vi.mock("@/chain/client", () => ({ publicClient: chain }));
vi.mock("@/contract/read", () => ({ agreementCount: vi.fn(async () => reads.count), readAgreement: vi.fn(async (id: bigint) => reads.agreements.get(id) ?? null) }));

const { startTx, stopWaiting, reconcile, confirmNotInWallet, milestoneKey, CREATE_KEY } = await import("@/chain/write");
const { registry, requestKey, canStart, createRegistry, STORAGE_KEY, LEGACY_STORAGE_KEY, scopeOf } = await import("@/chain/tx-registry");

const A = "0x00000000000000000000000000000000000000a1" as const;
const B = "0x00000000000000000000000000000000000000b2" as const;
const HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (pred: () => boolean) => {
  for (let i = 0; i < 80 && !pred(); i++) await tick();
};
function held() {
  let resolve!: (h: `0x${string}`) => void;
  let reject!: (e: unknown) => void;
  const write = vi.fn(() => new Promise<`0x${string}`>((res, rej) => ((resolve = res), (reject = rej))));
  return { write, answer: (h: `0x${string}`) => resolve(h), fail: (e: unknown) => reject(e) };
}
const claim = (id: bigint, to: `0x${string}`) => ({ fn: "claim" as const, args: [id, 0, to] as const });
const createReq = { fn: "create" as const, args: [B, "0x00000000000000000000000000000000000000c3", 3600n, 1, [1n, 0n, 0n], [9_999_999_999n, 0n, 0n], [7n, 0n, 0n]] as const, value: 1n };
const go = (req: Parameters<typeof startTx>[0]["req"], account: `0x${string}`, write: (v: never) => Promise<`0x${string}`>) =>
  startTx({ req, label: "x", account, walletChainId: 11155111, write, refresh: () => undefined });
/** What a reload leaves behind: the page's promise is gone, the wallet may still hold the request. */
const reload = (key: string) => registry.set({ ...registry.get(key)!, live: false, state: { phase: "unknown", reason: "reloaded" } });

let id = 900n;
beforeEach(() => {
  id += 1n;
  reads.count = 2;
  reads.agreements.clear();
  chain.getTransactionCount.mockResolvedValue(5);
  chain.getTransactionReceipt.mockResolvedValue(null);
  chain.getTransaction.mockResolvedValue(null);
  for (const k of [requestKey(A, CREATE_KEY), requestKey(B, CREATE_KEY)]) registry.remove(k);
});

describe("records are scoped by chain, contract and account", () => {
  it("account A's open request neither blocks account B nor is unlocked by anything B does", async () => {
    const wa = held();
    const wb = held();
    const keyA = requestKey(A, milestoneKey(id, 0));
    const keyB = requestKey(B, milestoneKey(id, 0));
    void go(claim(id, A), A, wa.write);
    await until(() => registry.get(keyA)?.state.phase === "awaiting");
    // the user switches to B in MetaMask: B has its own record and may act
    void go(claim(id, B), B, wb.write);
    await until(() => registry.get(keyB)?.state.phase === "awaiting");
    expect(wb.write).toHaveBeenCalledTimes(1);
    // B declines; A's request is untouched and still blocks A
    wb.fail(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    await until(() => registry.get(keyB)?.state.phase === "rejected");
    expect(registry.get(keyA)!.state.phase).toBe("awaiting");
    expect(canStart(registry.get(keyA))).toBe(false);
    void go(claim(id, A), A, wa.write); // A cannot start a second one
    await tick();
    expect(wa.write).toHaveBeenCalledTimes(1);
    // A's late signature is applied to A's record only
    wa.answer(HASH);
    await until(() => registry.get(keyA)?.state.phase === "confirmed");
    expect(registry.get(keyB)!.state.phase).toBe("rejected");
  });

  it("the key names the chain, the contract and the account (case-insensitive)", () => {
    expect(requestKey(A, "create")).toBe(`11155111:${"0xf79d229a039bf5c84ecc7327060f8bbc888d2182"}:${A}|create`);
    expect(requestKey(A.toUpperCase().replace("0X", "0x") as `0x${string}`, "create")).toBe(requestKey(A, "create"));
    expect(scopeOf(A, 1)).not.toBe(scopeOf(A));
  });

  it("records for another chain or contract are never consulted, and are written back untouched", () => {
    const store = new Map<string, string>();
    const foreignKey = `${scopeOf(A, 31337, "0x0000000000000000000000000000000000000Fe0")}|create`;
    store.set(STORAGE_KEY, JSON.stringify([{ key: foreignKey, account: A, label: "x", action: { fn: "create" }, startedAt: 1_000, attempt: 1, state: { phase: "awaiting", since: 1_000 }, live: false, lateHashes: [] }]));
    const reg = createRegistry(() => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }), () => 2_000, "t");
    expect(reg.all()).toEqual([]); // not this deployment: it blocks nothing here
    reg.set({ key: requestKey(A, "create"), account: A, label: "y", action: { fn: "create" }, startedAt: 2_000, attempt: 1, state: { phase: "awaiting", since: 2_000 }, live: true, lateHashes: [] });
    expect(store.get(STORAGE_KEY)).toContain(foreignKey); // kept for the deployment it belongs to
    expect(store.get(STORAGE_KEY)).toContain(requestKey(A, "create"));
  });

  it("records stored before R2-B (keyed by action only) keep blocking exactly what they blocked, under their account", () => {
    const store = new Map<string, string>();
    store.set(LEGACY_STORAGE_KEY, JSON.stringify([{ key: "create", account: A, label: "Create", action: { fn: "create" }, startedAt: 1_000, attempt: 1, state: { phase: "awaiting", since: 1_000 }, live: false, lateHashes: [] }]));
    const reg = createRegistry(() => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) }), () => 2_000, "t");
    const e = reg.get(requestKey(A, "create"))!;
    expect(e.state).toMatchObject({ phase: "unknown", reason: "reloaded" });
    expect(canStart(e, 2_000)).toBe(false);
    expect(reg.get(requestKey(B, "create"))).toBeUndefined(); // another account is not blocked by it
    expect(store.has(LEGACY_STORAGE_KEY)).toBe(false);
  });
});

describe("the user's confirmation is intent, not proof", () => {
  it("a create is never unlocked by it: after a reload with no hash, confirming leaves the create blocked and the outcome unknown", async () => {
    const w = held();
    const key = requestKey(A, CREATE_KEY);
    void go(createReq, A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    await reconcile(key, () => undefined);
    // R2-C: a create is held at once; there is no confirmation step that could unlock it
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("create-held");
    await confirmNotInWallet(key, () => undefined); // not offered for a create, and a no-op if called
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("create-held");
    expect(registry.get(key)!.state.phase).toBe("unknown");
    expect(canStart(registry.get(key))).toBe(false);
    void go(createReq, A, w.write); // a second create is refused before anything reaches the wallet
    await tick();
    expect(w.write).toHaveBeenCalledTimes(1);
  });

  it("a held create is settled by the chain: the old request approved late is found as the account's new agreement", async () => {
    const w = held();
    const key = requestKey(A, CREATE_KEY);
    void go(createReq, A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    await reconcile(key, () => undefined);
    // the user approves the old prompt after all: agreement #3 appears with A as client and EXACTLY these terms (R2-C)
    reads.count = 3;
    reads.agreements.set(3n, { id: 3n, client: A, provider: B, verifier: "0x00000000000000000000000000000000000000c3", reviewPeriod: 3600n, n: 1, milestones: [{ amount: 1n, deliverBy: 9_999_999_999n, spec: 7n }] });
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.state).toEqual({ phase: "found", createdId: 3n });
    expect(canStart(registry.get(key))).toBe(true);
  });

  it("another account's agreement does not settle A's create", async () => {
    const w = held();
    const key = requestKey(A, CREATE_KEY);
    void go(createReq, A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    reads.count = 3;
    reads.agreements.set(3n, { id: 3n, client: B });
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.state.phase).toBe("unknown");
    expect(canStart(registry.get(key))).toBe(false);
  });

  it("R2-C Decision 1: an unresolved create never stops blocking because time passed", async () => {
    const w = held();
    const key = requestKey(A, CREATE_KEY);
    void go(createReq, A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    const e = registry.get(key)!;
    for (const later of [24 * 3_600_000, 30 * 24 * 3_600_000]) expect(canStart(e, e.startedAt + later)).toBe(false);
  });

  it("a milestone action may be requested again after the confirmation (an override), the old outcome stays unknown and is remembered", async () => {
    const w = held();
    const key = requestKey(A, milestoneKey(id, 0));
    void go(claim(id, A), A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    await reconcile(key, () => undefined);
    await confirmNotInWallet(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("override");
    expect(registry.get(key)!.state.phase).toBe("unknown");
    expect(canStart(registry.get(key))).toBe(true);
    const w2 = held();
    void go(claim(id, A), A, w2.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    expect(registry.get(key)!.ghosts).toEqual([expect.objectContaining({ fn: "claim" })]); // the old request is a ghost of the new one
    w2.answer(HASH);
    await until(() => registry.get(key)?.state.phase === "confirmed");
  });

  it("the confirmation never overrides an open request in another tab, a pending transaction or a missing baseline", async () => {
    const w = held();
    const key = requestKey(A, milestoneKey(id, 0));
    void go(claim(id, A), A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    // another tab holds it (fresh heartbeat), seen from here
    registry.set({ ...registry.get(key)!, live: false, ownerTab: "other-tab", heartbeatAt: Date.now(), state: { phase: "unknown", reason: "reloaded" }, recovery: { verdict: { kind: "needs-confirmation" }, at: 0 } });
    registry.set({ ...registry.get(key)!, ownerTab: "other-tab", heartbeatAt: Date.now() });
    // registry.set stamps live entries only; this one is not live, so the other tab's ownership stands
    await confirmNotInWallet(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("open-elsewhere");
    expect(canStart(registry.get(key))).toBe(false);
    // a pending transaction from the account
    registry.set({ ...registry.get(key)!, ownerTab: undefined, heartbeatAt: undefined, attested: true });
    chain.getTransactionCount.mockImplementation(async (args?: { blockTag?: string }) => (args?.blockTag === "pending" ? 6 : 5));
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("pending-account");
    expect(canStart(registry.get(key))).toBe(false);
    chain.getTransactionCount.mockReset();
    chain.getTransactionCount.mockResolvedValue(5);
    // no baseline
    registry.set({ ...registry.get(key)!, before: undefined, nonceBefore: undefined, attested: true });
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("cannot-prove");
    expect(canStart(registry.get(key))).toBe(false);
  });
});

describe("late signatures and delayed receipts", () => {
  it("a receipt that misses the page's wait is found again: timeout, then pending, then confirmed", async () => {
    const w = held();
    const key = requestKey(A, milestoneKey(id, 0));
    chain.waitForTransactionReceipt.mockRejectedValueOnce(new Error("Timed out while waiting for transaction"));
    const done = go(claim(id, A), A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    w.answer(HASH);
    await done;
    expect(registry.get(key)!.state).toMatchObject({ phase: "unknown", reason: "receipt-timeout", hash: HASH });
    expect(canStart(registry.get(key))).toBe(false);
    chain.getTransaction.mockResolvedValue({ nonce: 5, blockNumber: null }); // still in the mempool
    await reconcile(key, () => undefined);
    await until(() => registry.get(key)?.state.phase === "confirmed");
    expect(registry.get(key)!.state).toMatchObject({ phase: "confirmed", hash: HASH });
  });

  it("a signature that arrives after 'Stop waiting' and a reload of another tab still lands on its own account's record", async () => {
    const w = held();
    const key = requestKey(A, milestoneKey(id, 0));
    const done = go(claim(id, A), A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    stopWaiting(key);
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("open-here"); // this tab still holds it
    registry.syncFromStorage(); // another tab wrote the store: the live record here is kept
    expect(registry.get(key)!.live).toBe(true);
    w.answer(HASH);
    await done;
    expect(registry.get(key)!.state).toMatchObject({ phase: "confirmed", hash: HASH });
    expect(registry.get(requestKey(B, milestoneKey(id, 0)))).toBeUndefined();
  });
});

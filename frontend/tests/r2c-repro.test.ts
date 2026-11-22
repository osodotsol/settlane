import { beforeEach, describe, expect, it, vi } from "vitest";

// R2-C independent review: concrete reproductions of transaction-safety defects in the R1 + R2-A + R2-B code. Each test
// states the SAFE behavior; at 5963bba they fail (see docs/PROGRESS.md R2-C). Mocked chain and wallet, no network.
const chain = vi.hoisted(() => ({
  simulateContract: vi.fn(async (a: { functionName: string; args: unknown[]; value?: bigint }) => ({ request: { functionName: a.functionName, args: a.args, value: a.value } })),
  estimateContractGas: vi.fn(async () => 100_000n),
  getTransactionCount: vi.fn(async (...args: unknown[]) => (void args, 5)),
  getBlockNumber: vi.fn(async () => 1_000n),
  getBlock: vi.fn(async (...args: unknown[]): Promise<unknown> => (void args, { number: 1_000n, timestamp: 1_000n, transactions: [] })),
  readContract: vi.fn(async (): Promise<unknown> => [2, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xaan, 0n, 1n]), // Submitted, evidence 0xaa, revision 1
  waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }): Promise<unknown> => ({ status: "success", blockNumber: 42n, transactionHash: hash, logs: [] })),
  getTransactionReceipt: vi.fn(async (...args: unknown[]): Promise<unknown> => (void args, null)),
  getTransaction: vi.fn(async (...args: unknown[]): Promise<unknown> => (void args, null)),
}));
type Ag = { id: bigint; client: string; provider: string; verifier: string; reviewPeriod: bigint; n: number; milestones: { amount: bigint; deliverBy: bigint; spec: bigint }[] };
const reads = vi.hoisted(() => ({ count: 2, agreements: new Map<bigint, unknown>() }));
vi.mock("@/chain/client", () => ({ publicClient: chain }));
vi.mock("@/contract/read", () => ({ agreementCount: vi.fn(async () => reads.count), readAgreement: vi.fn(async (id: bigint) => reads.agreements.get(id) ?? null) }));

const { startTx, reconcile, confirmNotInWallet, milestoneKey, CREATE_KEY } = await import("@/chain/write");
const { registry, requestKey, canStart, createRegistry, serialize, deserialize } = await import("@/chain/tx-registry");

const A = "0x00000000000000000000000000000000000000a1" as const;
const P = "0x00000000000000000000000000000000000000b2" as const;
const V = "0x00000000000000000000000000000000000000c3" as const;
const X = "0x00000000000000000000000000000000000000d4" as const;
const HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const OTHER = `0x${"ef".repeat(32)}` as `0x${string}`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (pred: () => boolean) => {
  for (let i = 0; i < 80 && !pred(); i++) await tick();
};
function held() {
  let resolve!: (h: `0x${string}`) => void;
  const write = vi.fn((...args: never[]) => (void args, new Promise<`0x${string}`>((res) => (resolve = res))));
  return { write, answer: (h: `0x${string}`) => resolve(h) };
}
const createReq = { fn: "create" as const, args: [P, V, 3600n, 1, [1n, 0n, 0n], [9_999_999_999n, 0n, 0n], [7n, 0n, 0n]] as const, value: 1n };
const go = (req: Parameters<typeof startTx>[0]["req"], account: `0x${string}`, write: (v: never) => Promise<`0x${string}`>) =>
  startTx({ req, label: "x", account, walletChainId: 11155111, write, refresh: () => undefined });
const reload = (key: string) => registry.set({ ...registry.get(key)!, live: false, state: { phase: "unknown", reason: "reloaded" } });
const agreement = (id: bigint, client: string, over: Partial<Ag> = {}): Ag => ({ id, client, provider: P, verifier: V, reviewPeriod: 3600n, n: 1, milestones: [{ amount: 1n, deliverBy: 9_999_999_999n, spec: 7n }], ...over });

let id = 5_000n;
beforeEach(() => {
  id += 1n;
  reads.count = 2;
  reads.agreements.clear();
  chain.getTransactionCount.mockReset();
  chain.getTransactionCount.mockResolvedValue(5);
  chain.getTransactionReceipt.mockReset();
  chain.getTransactionReceipt.mockResolvedValue(null);
  chain.getTransaction.mockReset();
  chain.getTransaction.mockResolvedValue(null);
  chain.readContract.mockResolvedValue([2, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xaan, 0n, 1n]);
  registry.remove(requestKey(A, CREATE_KEY));
});

describe("R2-C reproductions", () => {
  it("C1: another agreement by the same client, with DIFFERENT terms, must not count as this create having happened", async () => {
    const w = held();
    const key = requestKey(A, CREATE_KEY);
    void go(createReq, A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    // the client created a different agreement elsewhere (another device): other provider, other amount
    reads.count = 3;
    reads.agreements.set(3n, agreement(3n, A, { provider: X, milestones: [{ amount: 5n, deliverBy: 9_999_999_999n, spec: 9n }] }));
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.state.phase).toBe("unknown"); // NOT "found": the lost request may still fund a second agreement
    expect(canStart(registry.get(key))).toBe(false);
  });

  it("C2: a transaction REPLACED by a different one in the wallet must never become 'confirmed' on the replacement's receipt", async () => {
    const w = held();
    const key = requestKey(A, milestoneKey(id, 0));
    chain.waitForTransactionReceipt.mockImplementationOnce(async (a: unknown) => {
      (a as { onReplaced: (r: unknown) => void }).onReplaced({ reason: "replaced", transaction: { hash: OTHER } });
      return { status: "success", blockNumber: 43n, transactionHash: OTHER, logs: [] };
    });
    const done = go({ fn: "claim", args: [id, 0, A] }, A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    w.answer(HASH);
    await done;
    expect(registry.get(key)!.state.phase).toBe("unknown");
    chain.getTransactionReceipt.mockImplementation(async (a: unknown) => ((a as { hash: string }).hash === OTHER ? { status: "success", blockNumber: 43n, transactionHash: OTHER, logs: [] } : null));
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.state.phase).not.toBe("confirmed"); // the replacement was a different transaction
  });

  it("C3: a submission with DIFFERENT evidence (another device) must not count as this submit having happened", async () => {
    const w = held();
    const key = requestKey(P, milestoneKey(id, 0));
    chain.readContract.mockResolvedValue([1, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0n, 0n, 0n]); // Funded, revision 0
    void go({ fn: "submit", args: [id, 0, 0x11n] }, P, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    chain.readContract.mockResolvedValue([2, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0x22n, 0n, 1n]); // Submitted with evidence 0x22
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.state.phase).toBe("unknown");
  });

  it("C4: an unresolved create never becomes retryable because time passed (Decision 1)", async () => {
    const w = held();
    const key = requestKey(A, CREATE_KEY);
    void go(createReq, A, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    const e = registry.get(key)!;
    expect(canStart(e, e.startedAt + 365 * 24 * 3_600_000)).toBe(false);
    // and a stored record is not dropped by age on load
    expect(deserialize(serialize([e]), e.startedAt + 365 * 24 * 3_600_000)).toHaveLength(1);
  });

  it("C5: after an override, a DIFFERENT call (another payee) must not be sent while the original may still land", async () => {
    const w = held();
    const key = requestKey(P, milestoneKey(id, 0));
    chain.readContract.mockResolvedValue([3, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xaan, 0n, 1n]); // Approved
    void go({ fn: "claim", args: [id, 0, P] }, P, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    await reconcile(key, () => undefined);
    await confirmNotInWallet(key, () => undefined);
    const w2 = held();
    void go({ fn: "claim", args: [id, 0, X] }, P, w2.write); // the user now wants the ETH sent elsewhere
    await tick();
    await tick();
    expect(w2.write).not.toHaveBeenCalled(); // a late original would pay the OLD address first
  });

  it("C8: after an override, a verifier cannot switch an unproven approve into a reject (a late approve would pay the provider first)", async () => {
    const w = held();
    const key = requestKey(V, milestoneKey(id, 0));
    void go({ fn: "approve", args: [id, 0, 0xaan, 1n] }, V, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    await reconcile(key, () => undefined);
    await confirmNotInWallet(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("override");
    const w2 = held();
    void go({ fn: "reject", args: [id, 0, 0xaan, 1n] }, V, w2.write);
    await until(() => registry.get(key)?.state.phase === "failed");
    expect(w2.write).not.toHaveBeenCalled();
    // the same decision may be sent again: a late duplicate approve is refused by the contract (it names the revision)
    const w3 = held();
    void go({ fn: "approve", args: [id, 0, 0xaan, 1n] }, V, w3.write);
    await until(() => w3.write.mock.calls.length === 1);
    // once the review window has closed by block time, the old approve can never land: the ghost is dropped by proof
    chain.getBlock.mockResolvedValue({ number: 1_000n, timestamp: 10_000_000_000n, transactions: [] });
    w3.answer(HASH);
    await until(() => registry.get(key)?.state.phase === "confirmed");
    chain.getBlock.mockResolvedValue({ number: 1_000n, timestamp: 1_000n, transactions: [] });
  });

  it("C6: an overridden (still unproven) request survives a reload, so the constraint above cannot be bypassed by reloading", async () => {
    const w = held();
    const key = requestKey(P, milestoneKey(id, 0));
    chain.readContract.mockResolvedValue([3, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xaan, 0n, 1n]);
    void go({ fn: "claim", args: [id, 0, P] }, P, w.write);
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    await reconcile(key, () => undefined);
    await confirmNotInWallet(key, () => undefined);
    const stored = deserialize(serialize([registry.get(key)!]), Date.now());
    expect(stored.map((e) => e.key)).toContain(key);
  });

  it("C7: a tab whose heartbeat is throttled (hidden tab) but which still holds the request must still count as open elsewhere", async () => {
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    // one browser-wide lock manager shared by both tabs (navigator.locks), as the Web Locks API is
    const held = new Set<string>();
    const locks = () => ({
      request: (name: string, cb: () => Promise<void>) => {
        held.add(name);
        return cb().finally(() => held.delete(name));
      },
      query: async () => ({ held: [...held].map((name) => ({ name })) }),
    });
    let now = 10_000;
    const a = createRegistry(storage, () => now, "tab-a", locks);
    const b = createRegistry(storage, () => now, "tab-b", locks);
    const key = requestKey(A, "milestone:1:0");
    a.set({ key, label: "Claim", action: { fn: "claim", id: 1n, m: 0 }, account: A, startedAt: now, attempt: 1, state: { phase: "awaiting", since: now }, live: true, lateHashes: [] });
    now += 10 * 60_000; // Chrome runs timers in a long-hidden tab about once a minute: no heartbeat for 10 minutes
    b.syncFromStorage();
    expect(await b.openElsewhere(b.get(key)!)).toBe(true); // tab A still holds its lock
    // tab A answers (or closes): its lock is released, and B no longer sees the request as open elsewhere
    a.update(key, 1, (e) => ({ ...e, live: false, state: { phase: "rejected" } }));
    await tick();
    expect(held.size).toBe(0);
    b.syncFromStorage();
  });
});

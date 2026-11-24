import { beforeEach, describe, expect, it, vi } from "vitest";

// Final independent review (HEAD deefab5): regression tests for M1, H3, H4 and M3. Each starts from the reproduction of the
// review and states the SAFE behavior. Mocked chain and wallet, no network.
const chain = vi.hoisted(() => ({
  simulateContract: vi.fn(async (a: { functionName: string; args: unknown[]; value?: bigint }) => ({ request: { functionName: a.functionName, args: a.args, value: a.value } })),
  estimateContractGas: vi.fn(async () => 100_000n),
  getTransactionCount: vi.fn(async (...args: unknown[]) => (void args, 5)),
  getBlockNumber: vi.fn(async (...args: unknown[]) => (void args, 1_000n)),
  getBlock: vi.fn(async (...args: unknown[]): Promise<unknown> => (void args, { number: 1_000n, timestamp: 1_000n, transactions: [] })),
  getBalance: vi.fn(async (...args: unknown[]): Promise<bigint> => (void args, 10n ** 18n)),
  readContract: vi.fn(async (): Promise<unknown> => [3, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xaan, 0n, 1n]),
  waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }): Promise<unknown> => ({ status: "success", blockNumber: 42n, transactionHash: hash, logs: [] })),
  getTransactionReceipt: vi.fn(async (...args: unknown[]): Promise<unknown> => (void args, null)),
  getTransaction: vi.fn(async (...args: unknown[]): Promise<unknown> => (void args, null)),
}));
vi.mock("@/chain/client", () => ({ publicClient: chain }));
vi.mock("@/contract/read", () => ({ agreementCount: vi.fn(async () => 2), readAgreement: vi.fn(async () => null), latestBlockTime: vi.fn(async () => (await chain.getBlock() as { timestamp: bigint }).timestamp) }));

const { startTx, reconcile, confirmNotInWallet, dismiss, milestoneKey, callOf, CREATE_KEY } = await import("@/chain/write");
const { registry, requestKey, canStart, serialize, deserialize, createRegistry } = await import("@/chain/tx-registry");
const { readCreatePreflight } = await import("@/chain/preflight");
const { SETTLANE_ADDRESS } = await import("@/config/chain");

const P = "0x00000000000000000000000000000000000000b2" as const;
const PAYEE_A = "0x00000000000000000000000000000000000000a1" as const;
const PAYEE_B = "0x00000000000000000000000000000000000000d4" as const;
const H2 = `0x${"cd".repeat(32)}` as `0x${string}`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (pred: () => boolean) => {
  for (let i = 0; i < 80 && !pred(); i++) await tick();
};
const never = () => vi.fn((...args: never[]) => (void args, new Promise<`0x${string}`>(() => {})));
const go = (req: Parameters<typeof startTx>[0]["req"], write: (v: never) => Promise<`0x${string}`>, acceptLateReplace?: boolean) =>
  startTx({ req, label: "x", account: P, walletChainId: 11155111, write, refresh: () => undefined, acceptLateReplace });
const reload = (key: string) => registry.set({ ...registry.get(key)!, live: false, state: { phase: "unknown", reason: "reloaded" } });
const MS_APPROVED = [3, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xaan, 0n, 1n];

let id = 20_000n;
beforeEach(() => {
  id += 1n;
  chain.getTransactionCount.mockReset();
  chain.getTransactionCount.mockResolvedValue(5);
  chain.getBlock.mockReset();
  chain.getBlock.mockResolvedValue({ number: 1_000n, timestamp: 1_000n, transactions: [] });
  chain.getBalance.mockReset();
  chain.getBalance.mockResolvedValue(10n ** 18n);
  chain.getTransactionReceipt.mockReset();
  chain.getTransactionReceipt.mockResolvedValue(null);
  chain.readContract.mockResolvedValue(MS_APPROVED);
});

describe("M1: an incomplete pre-wallet 'checking' record is never a permanent blocker", () => {
  for (const [name, base, action] of [["create", CREATE_KEY, { fn: "create" }], ["claim", milestoneKey(77n, 0), { fn: "claim", id: 77n, m: 0 }]] as const) {
    it(`${name}: a record stored while 'checking' (old versions stored it) is released on load, so a new request may start`, () => {
      const key = requestKey(P, base);
      const raw = JSON.stringify([{ key, label: "x", action: JSON.parse(JSON.stringify(action, (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v))), account: P, startedAt: 1, attempt: 1, state: { phase: "checking" }, live: false, lateHashes: [] }]);
      const [e] = deserialize(raw);
      expect(e!.state.phase).toBe("failed");
      expect(canStart(e)).toBe(true);
    });
    it(`${name}: a live 'checking' entry is not stored at all`, () => {
      const key = requestKey(P, base);
      expect(serialize([{ key, label: "x", action: action as never, account: P, startedAt: 1, attempt: 1, state: { phase: "checking" }, live: true, lateHashes: [] }])).toBe("[]");
    });
  }

  it("a reload during 'checking' keeps the entry's GHOSTS (unresolved earlier requests) but not the block", () => {
    const key = requestKey(P, milestoneKey(88n, 0));
    const ghost = { startedAt: 1, fn: "claim" as const, data: "0x1234" as const, value: "0" };
    const [e] = deserialize(serialize([{ key, label: "x", action: { fn: "claim", id: 88n, m: 0 }, account: P, startedAt: 2, attempt: 2, state: { phase: "checking" }, live: true, lateHashes: [], ghosts: [ghost] }]));
    expect(e!.ghosts).toEqual([ghost]);
    expect(canStart(e)).toBe(true);
  });

  it("a real unresolved wallet request ('awaiting') still survives a reload and still blocks (safety preserved)", async () => {
    const key = requestKey(P, milestoneKey(id, 0));
    void go({ fn: "claim", args: [id, 0, PAYEE_A] }, never());
    await until(() => registry.get(key)?.state.phase === "awaiting");
    const [e] = deserialize(serialize([registry.get(key)!]));
    expect(e!.state.phase).toBe("unknown");
    expect(e!.call).toBeDefined();
    expect(canStart(e)).toBe(false);
  });

  it("another tab never sees a checking entry of this tab: it holds no wallet request", () => {
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const a = createRegistry(storage, Date.now, "tabA");
    const b = createRegistry(storage, Date.now, "tabB");
    const key = requestKey(P, CREATE_KEY);
    a.set({ key, label: "x", action: { fn: "create" }, account: P, startedAt: 1, attempt: 1, state: { phase: "checking" }, live: true, lateHashes: [] });
    b.syncFromStorage();
    expect(b.get(key)).toBeUndefined();
  });
});

describe("H3: Dismiss must not delete an earlier unresolved request", () => {
  async function lostClaimToA() {
    const key = requestKey(P, milestoneKey(id, 0));
    void go({ fn: "claim", args: [id, 0, PAYEE_A] }, never());
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    await reconcile(key, () => undefined);
    await confirmNotInWallet(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("override");
    return key;
  }

  it("after Dismiss, a claim to ANOTHER payee still never reaches the wallet; the original payee is preserved", async () => {
    const key = await lostClaimToA();
    const w2 = vi.fn(async () => H2);
    await go({ fn: "claim", args: [id, 0, PAYEE_B] }, w2 as never);
    expect(registry.get(key)!.state.phase).toBe("failed");
    dismiss(key); // the Dismiss button on the failed panel
    expect(registry.get(key)?.ghosts?.length).toBe(1);
    expect(registry.get(key)?.dismissed).toBe(true);
    await go({ fn: "claim", args: [id, 0, PAYEE_B] }, w2 as never);
    expect(w2).not.toHaveBeenCalled();
    expect(registry.get(key)!.state.phase).toBe("failed");
    // the original request's parameters survive intact
    const g = registry.get(key)!.ghosts![0]!;
    expect(g.data).toBe(callOf({ fn: "claim", args: [id, 0, PAYEE_A] }).data);
  });

  it("the ghost survives Dismiss AND a reload; the SAME payee may still be requested again", async () => {
    const key = await lostClaimToA();
    await go({ fn: "claim", args: [id, 0, PAYEE_B] }, vi.fn(async () => H2) as never);
    dismiss(key);
    const [back] = deserialize(serialize([registry.get(key)!]));
    expect(back!.ghosts?.length).toBe(1);
    registry.set(back!);
    const wSame = vi.fn(async () => H2);
    await go({ fn: "claim", args: [id, 0, PAYEE_A] }, wSame as never);
    expect(wSame).toHaveBeenCalledTimes(1);
  });

  it("Dismiss of an entry WITHOUT ghosts still removes it", async () => {
    const key = requestKey(P, milestoneKey(id, 0));
    await go({ fn: "claim", args: [id, 0, PAYEE_A] }, vi.fn(async () => { throw Object.assign(new Error("denied"), { code: 4001 }); }) as never);
    expect(registry.get(key)!.state.phase).toBe("rejected");
    dismiss(key);
    expect(registry.get(key)).toBeUndefined();
  });
});

describe("H4: a later successful evidence retry is not confirmation of an earlier submission", () => {
  it("the earlier request and its warning survive; different evidence still needs the explicit acknowledgment", async () => {
    chain.readContract.mockResolvedValue([1, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0n, 0n, 0n]); // Funded, revision 0
    const key = requestKey(P, milestoneKey(id, 0));
    const req11 = { fn: "submit" as const, args: [id, 0, 0x11n] as const };
    void go(req11, never());
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    await reconcile(key, () => undefined);
    await confirmNotInWallet(key, () => undefined);

    await go(req11, vi.fn(async () => H2) as never); // identical retry, mined
    expect(registry.get(key)!.state.phase).toBe("confirmed");

    // the chain now shows the retry (nonce 5, same calldata) and revision 1
    chain.readContract.mockResolvedValue([2, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0x11n, 0n, 1n]);
    chain.getTransactionCount.mockResolvedValue(6);
    chain.getBlock.mockResolvedValue({ number: 1_000n, timestamp: 1_000n, transactions: [{ hash: H2, from: P, to: SETTLANE_ADDRESS, input: callOf(req11).data, value: 0n, nonce: 5 }] });

    const w22 = vi.fn(async () => H2);
    await go({ fn: "submit", args: [id, 0, 0x22n] }, w22 as never); // NO acknowledgment
    expect(w22).not.toHaveBeenCalled();
    expect(registry.get(key)!.state.phase).toBe("failed");
    expect(registry.get(key)!.ghosts?.length).toBe(1); // the earlier request is still remembered

    await go({ fn: "submit", args: [id, 0, 0x22n] }, w22 as never, true); // with the acknowledgment it may proceed
    expect(w22).toHaveBeenCalledTimes(1);
    expect(registry.get(key)!.ghosts?.length).toBe(1); // and the warning data is still there
  });

  it("an earlier request IS dropped when a DIFFERENT transaction with its exact call is mined (its own proof)", async () => {
    chain.readContract.mockResolvedValue([1, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0n, 0n, 0n]);
    const key = requestKey(P, milestoneKey(id, 0));
    const req11 = { fn: "submit" as const, args: [id, 0, 0x11n] as const };
    void go(req11, never());
    await until(() => registry.get(key)?.state.phase === "awaiting");
    reload(key);
    await reconcile(key, () => undefined);
    await confirmNotInWallet(key, () => undefined);
    await go(req11, vi.fn(async () => H2) as never); // the retry, hash H2
    // two mined transactions with the same calldata: nonce 5 (some other hash) and nonce 6 (the retry H2)
    const OLD = `0x${"ee".repeat(32)}` as `0x${string}`;
    chain.readContract.mockResolvedValue([2, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0x11n, 0n, 2n]);
    chain.getTransactionCount.mockImplementation(async (a: unknown) => ((a as { blockNumber?: bigint }).blockNumber !== undefined ? 7 : 7));
    chain.getBlock.mockResolvedValue({ number: 1_000n, timestamp: 1_000n, transactions: [
      { hash: OLD, from: P, to: SETTLANE_ADDRESS, input: callOf(req11).data, value: 0n, nonce: 5 },
      { hash: H2, from: P, to: SETTLANE_ADDRESS, input: callOf(req11).data, value: 0n, nonce: 6 },
    ] });
    const w22 = vi.fn(async () => H2);
    await go({ fn: "submit", args: [id, 0, 0x22n] }, w22 as never);
    expect(w22).toHaveBeenCalledTimes(1);
  });
});

describe("M3: create preflight RPC failures are caught", () => {
  it("a failed balance or block read is a result, not a rejection, and nothing touches the registry", async () => {
    chain.getBalance.mockRejectedValueOnce(new Error("rpc down"));
    expect(await readCreatePreflight(P)).toEqual({ ok: false });
    chain.getBlock.mockRejectedValueOnce(new Error("rpc down"));
    expect(await readCreatePreflight(P)).toEqual({ ok: false });
    expect(registry.get(requestKey(P, CREATE_KEY))).toBeUndefined();
    expect(await readCreatePreflight(P)).toEqual({ ok: true, balance: 10n ** 18n, blockTime: 1_000n });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLocks } from "./fake-locks";

// Residual-risk fixes after 900da59: C1, H1, H2 (second probe), M2a, M2b, M4, M5a, M6, M7 and the proof-based release of a held
// create. Each test started as the reproduction of the verification (the defect) and states the SAFE behavior.
// One browser's Web Locks, shared by this module's registry (this tab) and by `otherTab` below.
const browser = vi.hoisted(() => ({ locks: undefined as unknown }));
const { locks: sharedLocks } = fakeLocks();
browser.locks = sharedLocks();
vi.stubGlobal("navigator", { locks: browser.locks });

const chain = vi.hoisted(() => ({
  simulateContract: vi.fn(async (a: { functionName: string; args: unknown[]; value?: bigint }) => ({ request: { functionName: a.functionName, args: a.args, value: a.value } })),
  estimateContractGas: vi.fn(async () => 100_000n),
  getTransactionCount: vi.fn(async (...a: unknown[]) => (void a, 5)),
  getBlockNumber: vi.fn(async (...a: unknown[]) => (void a, 1_000n)),
  getBlock: vi.fn(async (...a: unknown[]): Promise<unknown> => (void a, { number: 1_000n, timestamp: 1_000n, transactions: [] })),
  readContract: vi.fn(async (): Promise<unknown> => [3, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xaan, 0n, 1n]),
  waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }): Promise<unknown> => ({ status: "success", blockNumber: 42n, transactionHash: hash, logs: [] })),
  getTransactionReceipt: vi.fn(async (...a: unknown[]): Promise<unknown> => (void a, null)),
  getTransaction: vi.fn(async (...a: unknown[]): Promise<unknown> => (void a, null)),
}));
vi.mock("@/chain/client", () => ({ publicClient: chain }));
vi.mock("@/contract/read", () => ({ agreementCount: vi.fn(async () => 2), readAgreement: vi.fn(async () => null), latestBlockTime: vi.fn(async () => 1_000n) }));

const { startTx, reconcile, callOf, milestoneKey, CREATE_KEY } = await import("@/chain/write");
const { registry, requestKey, createRegistry, canStart, lockName } = await import("@/chain/tx-registry");
const { createHistory } = await import("@/contract/history");
const { describeHistory } = await import("@/domain/history-coverage");
const { cached, cacheSize, clearCache, CacheFullError, MAX_ENTRIES } = await import("@/contract/cache");
const { checkAddress } = await import("@/domain/address");
const { archiveIfCreated, readArchive, readSubmitted, rememberSubmitted, sameDraft } = await import("@/domain/draft-archive");
const { emptyForm } = await import("@/domain/create-form");
const { SETTLANE_ADDRESS } = await import("@/config/chain");

const P = "0x00000000000000000000000000000000000000b2" as const;
const V = "0x00000000000000000000000000000000000000c3" as const;
const H = `0x${"cd".repeat(32)}` as `0x${string}`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const createReq = (deliverBy = 9_999_999_999n) => ({ fn: "create" as const, args: [P, V, 3600n, 1, [1n, 0n, 0n], [deliverBy, 0n, 0n], [7n, 0n, 0n]] as const, value: 1n });
const go = (req: Parameters<typeof startTx>[0]["req"], write: (v: never) => Promise<`0x${string}`>) => startTx({ req, label: "x", account: P, walletChainId: 11155111, write, refresh: () => undefined });
/** Another tab of the same browser holding the action's lock (it is checking or waiting for the wallet). */
function otherTabHolds(name: string) {
  let release!: () => void;
  void (browser.locks as { request: (n: string, o: object, cb: () => Promise<void>) => Promise<unknown> }).request(name, {}, () => new Promise<void>((r) => (release = r)));
  return () => release();
}

let id = 70_000n;
beforeEach(() => {
  id += 1n;
  registry.remove(requestKey(P, CREATE_KEY));
  chain.getTransactionCount.mockReset();
  chain.getTransactionCount.mockResolvedValue(5);
  chain.getBlock.mockReset();
  chain.getBlock.mockResolvedValue({ number: 1_000n, timestamp: 1_000n, transactions: [] });
  chain.getTransactionReceipt.mockReset();
  chain.getTransactionReceipt.mockResolvedValue(null);
  chain.getTransaction.mockReset();
  chain.getTransaction.mockResolvedValue(null);
});

describe("H1: a second tab can never start the same action while the first is checking or waiting", () => {
  it("while another tab holds the action, nothing reaches the wallet and nothing is written to the shared registry", async () => {
    const key = requestKey(P, CREATE_KEY);
    const release = otherTabHolds(lockName(key));
    const w = vi.fn(async () => H);
    await go(createReq(), w as never);
    expect(w).not.toHaveBeenCalled();
    expect(registry.get(key)).toBeUndefined(); // the other tab's stored record can never be overwritten from here
    release();
    await tick();
    await go(createReq(), w as never); // the other tab finished: this tab may now start
    expect(w).toHaveBeenCalledTimes(1);
  });

  it("two tabs (two registries of one browser) racing for the same create: exactly one is admitted", async () => {
    const { locks } = fakeLocks();
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const a = createRegistry(storage, Date.now, "A", locks);
    const b = createRegistry(storage, Date.now, "B", locks);
    const key = requestKey(P, CREATE_KEY);
    const [okA, okB] = await Promise.all([a.claim(key), b.claim(key)]);
    expect([okA, okB].filter(Boolean)).toHaveLength(1);
    const winner = okA ? a : b;
    winner.set({ key, label: "x", action: { fn: "create" }, account: P, startedAt: 1, attempt: 1, state: { phase: "checking" }, live: true, lateHashes: [] });
    expect(await (okA ? b : a).claim(key)).toBe(false); // still checking: still held
    winner.update(key, 1, (e) => ({ ...e, live: false, state: { phase: "rejected" } }));
    await tick();
    expect(await (okA ? b : a).claim(key)).toBe(true); // finished: released
  });

  it("a double click in one tab still sends one request", async () => {
    const w = vi.fn(async () => H);
    await Promise.all([go(createReq(), w as never), go(createReq(), w as never)]);
    expect(w).toHaveBeenCalledTimes(1);
  });
});

describe("a held create is released by proof once a FINALIZED block is past its earliest deadline", () => {
  function heldCreate(deliverBy: bigint) {
    const key = requestKey(P, CREATE_KEY);
    registry.set({ key, label: "x", action: { fn: "create" }, account: P, startedAt: 1, attempt: 1, live: false, lateHashes: [], call: callOf(createReq(deliverBy)), nonceBefore: 5, blockBefore: "990", before: { kind: "count", count: 2 }, state: { phase: "unknown", reason: "reloaded" } });
    return key;
  }
  it("before the deadline (finalized time): held; at the deadline: released, and only then", async () => {
    const key = heldCreate(5_000n);
    chain.getBlock.mockImplementation(async (a: unknown) => ({ number: 1_000n, timestamp: (a as { blockTag?: string }).blockTag === "finalized" ? 4_999n : 9_000n, transactions: [] }));
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("create-held"); // the LATEST block is past it, the finalized one is not
    expect(canStart(registry.get(key))).toBe(false);
    chain.getBlock.mockImplementation(async () => ({ number: 1_000n, timestamp: 5_000n, transactions: [] }));
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.recovery?.verdict.kind).toBe("released");
    expect(canStart(registry.get(key))).toBe(true);
  });
  it("a create agreed on-chain is still FOUND first (the deadline never hides a real agreement)", async () => {
    const key = heldCreate(5_000n);
    chain.getBlock.mockResolvedValue({ number: 1_000n, timestamp: 9_000n, transactions: [{ hash: H, from: P, to: SETTLANE_ADDRESS, input: callOf(createReq(5_000n)).data, value: 1n, nonce: 5 }] });
    chain.getTransactionCount.mockResolvedValue(6);
    chain.getTransactionReceipt.mockImplementation(async () => ({ status: "success", blockNumber: 995n, logs: [], transactionHash: H }));
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.state.phase).toBe("confirmed");
  });
});

describe("H2 (second probe): an identical call at ANOTHER nonce never settles a request whose own transaction is pending", () => {
  it("the own pending transaction is followed, not 'confirmed' on someone else's receipt", async () => {
    const OWN = `0x${"aa".repeat(32)}` as `0x${string}`, OTHER = `0x${"bb".repeat(32)}` as `0x${string}`;
    const call = callOf(createReq(9_999n));
    const key = requestKey(P, CREATE_KEY);
    registry.set({ key, label: "x", action: { fn: "create" }, account: P, startedAt: 1, attempt: 1, live: false, lateHashes: [], call, nonceBefore: 5, blockBefore: "990", before: { kind: "count", count: 2 }, txNonce: 6, state: { phase: "unknown", reason: "reloaded", hash: OWN } });
    chain.getTransaction.mockImplementation(async (a: unknown) => ((a as { hash: string }).hash === OWN ? { hash: OWN, nonce: 6, blockNumber: null } : null));
    chain.getTransactionCount.mockImplementation(async (a: unknown) => ((a as { blockTag?: string }).blockTag === "pending" ? 7 : 6));
    chain.getBlock.mockResolvedValue({ number: 1_000n, timestamp: 1_000n, transactions: [{ hash: OTHER, from: P, to: SETTLANE_ADDRESS, input: call.data, value: 1n, nonce: 5 }] });
    chain.getTransactionReceipt.mockImplementation(async (a: unknown) => ((a as { hash: string }).hash === OTHER ? { status: "success", blockNumber: 995n, logs: [], transactionHash: OTHER } : null));
    chain.waitForTransactionReceipt.mockImplementationOnce(() => new Promise(() => {}));
    await reconcile(key, () => undefined);
    const e = registry.get(key)!;
    expect(e.recovery?.verdict.kind).toBe("pending-tx");
    expect(e.state.phase).toBe("pending");
    expect(canStart(e)).toBe(false);
  });
});

describe("M2a: a receipt for the request's own hash settles it even when the other reads fail", () => {
  it("confirmed, although the nonce reads are down", async () => {
    const key = requestKey(P, milestoneKey(id, 0));
    registry.set({ key, label: "x", action: { fn: "claim", id, m: 0 }, account: P, startedAt: 1, attempt: 1, live: false, lateHashes: [], nonceBefore: 5, before: { kind: "milestone", state: "approved", revision: 1n, rejections: 0n }, state: { phase: "unknown", reason: "receipt-timeout", hash: H } });
    chain.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 77n, logs: [], transactionHash: H });
    chain.getTransactionCount.mockRejectedValue(new Error("rpc down"));
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.state).toMatchObject({ phase: "confirmed", hash: H, blockNumber: 77n });
  });
});

describe("M2b: a review is matched on its revision", () => {
  it("an approval of a LATER revision is not reported as this approval", async () => {
    const key = requestKey(V, milestoneKey(id, 0));
    const call = { data: callOf({ fn: "approve", args: [id, 0, 0xaan, 1n] }).data, value: "0" };
    registry.set({ key, label: "x", action: { fn: "approve", id, m: 0 }, account: V, startedAt: 1, attempt: 1, live: false, lateHashes: [], call, nonceBefore: 5, before: { kind: "milestone", state: "submitted", revision: 1n, rejections: 0n }, state: { phase: "unknown", reason: "reloaded" } });
    chain.readContract.mockResolvedValueOnce([3, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xbbn, 0n, 2n]); // approved at revision 2
    await reconcile(key, () => undefined);
    expect(registry.get(key)!.state.phase).not.toBe("found");
  });
});

describe("M4: a lag-truncated retry of an old gap keeps the unread blocks as a gap", () => {
  it("never complete without them, and a later read that serves them closes the gap", async () => {
    let round = 0;
    const log = { topics: [], data: "0x" as const, blockNumber: 13n, logIndex: 0, transactionHash: H, blockHash: null };
    const reads: string[] = [];
    const source = {
      getBlockNumber: async () => 200n,
      getBlock: async () => ({ timestamp: 1n }),
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        reads.push(`${fromBlock}-${toBlock}`);
        if (fromBlock === 10n && round === 0) throw new Error("node unavailable");
        if (fromBlock === 10n && round === 1 && toBlock > 11n) throw new Error("block range extends beyond current head block");
        return fromBlock <= 13n && toBlock >= 13n ? [log] : [];
      },
    };
    const h = createHistory({ source, deployBlock: 0n, chainId: 1, address: "0x0", snapshotFile: null, chunk: 5n, reorgWindow: 64n });
    await h.refresh();
    round = 1;
    const s2 = await h.refresh();
    expect(s2.status.complete).toBe(false);
    expect(s2.status.gaps.map((g) => `${g.from}-${g.to}`)).toEqual(["12-14"]);
    round = 2;
    const s3 = await h.refresh();
    expect(reads).toContain("12-14");
    expect(s3.status.gaps).toEqual([]);
    expect(s3.status.complete).toBe(true);
  });
});

describe("M5a: an unscanned history is never described as complete", () => {
  it("snapshot-only placeholder: incomplete until the live read", async () => {
    const h = createHistory({ source: { getBlockNumber: async () => 12_200_000n, getBlock: async () => ({ timestamp: 0n }), getLogs: async () => [] }, deployBlock: 12175958n, chainId: 11155111, address: "0xF79d229a039bF5C84ecC7327060F8bBC888D2182" });
    expect(describeHistory(h.peek().status).level).toBe("incomplete");
    const read = await h.refresh();
    expect(read.status.complete).toBe(true);
    expect(describeHistory(read.status).level).toBe("complete");
  });
});

describe("M6: the server cache admits at most MAX_ENTRIES keys, even when every read hangs", () => {
  it("the next key is refused with CacheFullError, and room returns when a read settles", async () => {
    clearCache();
    let finish!: () => void;
    const first = new Promise<number>((r) => (finish = () => r(1)));
    const pending = [cached("k0", 60_000, () => first, 5).catch(() => null)];
    for (let i = 1; i < MAX_ENTRIES; i++) pending.push(cached(`k${i}`, 60_000, () => new Promise<number>(() => {}), 5).catch(() => null));
    await Promise.all(pending);
    await expect(cached("one-too-many", 60_000, async () => 1, 5)).rejects.toBeInstanceOf(CacheFullError);
    expect(cacheSize()).toBe(MAX_ENTRIES);
    finish();
    await tick();
    await expect(cached("now-fits", 60_000, async () => 2, 5)).resolves.toMatchObject({ value: 2 });
    expect(cacheSize()).toBe(MAX_ENTRIES);
    clearCache();
  });
});

describe("M7: the archive holds the draft that was SUBMITTED", () => {
  it("edits made while the wallet answered are kept, and the archive has the submitted terms", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const submitted = { ...emptyForm(), provider: P, verifier: V };
    rememberSubmitted(s, submitted);
    const edited = { ...submitted, provider: "0x00000000000000000000000000000000000000d4" };
    const sent = readSubmitted(s) ?? edited;
    const a = archiveIfCreated(s, { phase: "confirmed", startedAt: 5 }, sent);
    expect(a!.form.provider).toBe(P);
    expect(readArchive(s)!.form.provider).toBe(P);
    expect(sameDraft(edited, sent)).toBe(false); // the editor (edited) is NOT cleared
    expect(sameDraft(submitted, sent)).toBe(true); // an unedited editor is cleared, as before
  });
});

describe("C1: reserved protocol addresses are refused as any party or payee", () => {
  it("precompiles and the system address are refused; ordinary addresses pass", () => {
    for (const a of ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000004", "0x0000000000000000000000000000000000000011", "0x0000000000000000000000000000000000000100", "0xfffffffffffffffffffffffffffffffffffffffe", "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE"]) {
      const c = checkAddress(a, "payee address");
      expect(c.ok, a).toBe(false);
    }
    for (const a of ["0x0000000000000000000000000000000000000012", "0x00000000000000000000000000000000000000a1", "0x4fa3d0b24e0ab063eb099c1d29c65b814af0e6e4"]) expect(checkAddress(a).ok, a).toBe(true);
  });
});

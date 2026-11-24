import { beforeEach, describe, expect, it, vi } from "vitest";

// R2-D: a legacy unresolved request (saved by a version that did not store the call) must never let a DIFFERENT request through. Each starts from the reproduction of the
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

const { startTx, reconcile, confirmNotInWallet, milestoneKey } = await import("@/chain/write");
const { registry, requestKey, deserialize } = await import("@/chain/tx-registry");

const P = "0x00000000000000000000000000000000000000b2" as const;
const PAYEE_A = "0x00000000000000000000000000000000000000a1" as const;
const PAYEE_B = "0x00000000000000000000000000000000000000d4" as const;
const H2 = `0x${"cd".repeat(32)}` as `0x${string}`;
const go = (req: Parameters<typeof startTx>[0]["req"], write: (v: never) => Promise<`0x${string}`>, acceptLateReplace?: boolean) =>
  startTx({ req, label: "x", account: P, walletChainId: 11155111, write, refresh: () => undefined, acceptLateReplace });
const MS_APPROVED = [3, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xaan, 0n, 1n];

let id = 20_000n;
beforeEach(() => {
  id += 1n;
  chain.getTransactionCount.mockReset();
  chain.getTransactionCount.mockResolvedValue(5);
  chain.getBlock.mockReset();
  chain.getBlock.mockResolvedValue({ number: 1_000n, timestamp: 1_000n, transactions: [] });
  chain.getBalance.mockReset();
  chain.getTransactionReceipt.mockReset();
  chain.getTransactionReceipt.mockResolvedValue(null);
  chain.readContract.mockResolvedValue(MS_APPROVED);
});

// What an older version stored for a claim whose wallet request was lost: no `call`, no `blockBefore`, the snapshot and nonce
// from before the wallet was asked (the baseline), and the state it had after a reload.
function legacyClaim(mid: bigint, over: Record<string, unknown> = {}) {
  const key = requestKey(P, milestoneKey(mid, 0));
  const raw = {
    key, label: "Claim", action: { fn: "claim", id: mid, m: 0 }, account: P, startedAt: 1, attempt: 1, live: false, lateHashes: [],
    state: { phase: "unknown", reason: "reloaded" }, nonceBefore: 5,
    before: { kind: "milestone", state: "approved", revision: 1n, rejections: 0n, evidence: 0xaan, deliverBy: 9_999_999_999n, decideBy: 9_999_999_999n },
    ...over,
  };
  const stored = JSON.stringify([raw], (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v));
  const [e] = deserialize(stored);
  expect(e!.call).toBeUndefined(); // the legacy shape: the exact call was never stored
  registry.set(e!);
  return key;
}

async function attest(key: string) {
  await reconcile(key, () => undefined);
  expect(registry.get(key)!.recovery?.verdict.kind).toBe("needs-confirmation");
  await confirmNotInWallet(key, () => undefined);
}

describe("R2-D: a legacy unresolved claim (no stored call)", () => {
  it("after the user's word, a DIFFERENT payee is never sent while the earlier claim might still execute", async () => {
    const key = legacyClaim(id);
    await attest(key);
    const w = vi.fn(async () => H2);
    await go({ fn: "claim", args: [id, 0, PAYEE_B] }, w as never);
    expect(w).not.toHaveBeenCalled();
    expect(registry.get(key)!.state.phase).toBe("failed");
  });

  it("the unknown earlier request survives Dismiss and a reload, and the SAME payee cannot be proven either, so every claim stays blocked", async () => {
    const key = legacyClaim(id);
    await attest(key);
    const w = vi.fn(async () => H2);
    await go({ fn: "claim", args: [id, 0, PAYEE_B] }, w as never);
    const { dismiss } = await import("@/chain/write");
    const { serialize } = await import("@/chain/tx-registry");
    dismiss(key);
    const [back] = deserialize(serialize([registry.get(key)!]));
    expect(back!.ghosts?.length).toBe(1);
    registry.set(back!);
    await go({ fn: "claim", args: [id, 0, PAYEE_A] }, w as never);
    await go({ fn: "claim", args: [id, 0, PAYEE_B] }, w as never);
    expect(w).not.toHaveBeenCalled();
  });

  it("it is released only by proof: the milestone is Paid (the contract can never take another claim)", async () => {
    const key = legacyClaim(id);
    await attest(key);
    await go({ fn: "claim", args: [id, 0, PAYEE_B] }, vi.fn(async () => H2) as never);
    chain.readContract.mockResolvedValue([4, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0xaan, 0n, 1n]); // Paid
    const w = vi.fn(async () => H2);
    await go({ fn: "claim", args: [id, 0, PAYEE_B] }, w as never);
    expect(registry.get(key)!.ghosts?.length ?? 0).toBe(0); // the earlier request can no longer take effect
    expect(w).toHaveBeenCalledTimes(1); // (the contract itself refuses a claim on a Paid milestone; the simulation would too)
  });

  it("a reverted-state or failed chain read keeps it blocked (uncertainty is never permission)", async () => {
    const key = legacyClaim(id);
    await attest(key);
    chain.readContract.mockRejectedValueOnce(new Error("rpc down"));
    const w = vi.fn(async () => H2);
    await go({ fn: "claim", args: [id, 0, PAYEE_B] }, w as never);
    expect(w).not.toHaveBeenCalled();
  });
});

describe("R2-D: a legacy unresolved submit (evidence unknown)", () => {
  it("needs the explicit acknowledgment for ANY evidence, and the unknown earlier request stays remembered", async () => {
    chain.readContract.mockResolvedValue([1, 1n, 9_999_999_999n, 9_999_999_999n, 7n, 0n, 0n, 0n]); // Funded
    const mid = id;
    const key = requestKey(P, milestoneKey(mid, 0));
    const stored = JSON.stringify([{ key, label: "Submit", action: { fn: "submit", id: { $big: mid.toString() }, m: 0 }, account: P, startedAt: 1, attempt: 1, live: false, lateHashes: [], state: { phase: "unknown", reason: "reloaded" }, nonceBefore: 5,
      before: { kind: "milestone", state: "funded", revision: { $big: "0" }, rejections: { $big: "0" } } }]);
    const [e] = deserialize(stored);
    registry.set(e!);
    await reconcile(key, () => undefined);
    await confirmNotInWallet(key, () => undefined);
    const w = vi.fn(async () => H2);
    await go({ fn: "submit", args: [mid, 0, 0x11n] }, w as never);
    expect(w).not.toHaveBeenCalled();
    await go({ fn: "submit", args: [mid, 0, 0x11n] }, w as never, true);
    expect(w).toHaveBeenCalledTimes(1);
    expect(registry.get(key)!.ghosts?.some((g) => g.unknown)).toBe(true);
  });
});

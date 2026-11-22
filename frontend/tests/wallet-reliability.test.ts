import { describe, expect, it } from "vitest";
import { UserRejectedRequestError } from "viem";
import { walletErrorKind } from "@/chain/errors";
import { GAS_MARGIN_PERCENT, TX_GAS_CAP, gasWithMargin } from "@/chain/gas";
import { milestoneEffect, type MilestoneSnap } from "@/chain/tx-effect";
import { baseOf, blockReason, canStart, createRegistry, deserialize, requestKey, serialize, STORAGE_KEY, type TxEntry, type TxPhase } from "@/chain/tx-registry";
import { describeTrace, traceProvider, traceStore, traced } from "@/chain/wallet-trace";
import { milestoneStatusLine } from "@/domain/app-model";

const ACCOUNT = "0x00000000000000000000000000000000000000b2" as const;
const entry = (state: TxPhase, extra: Partial<TxEntry> = {}): TxEntry => ({
  key: requestKey(ACCOUNT, "milestone:1:0"), label: "Claim", action: { fn: "claim", id: 1n, m: 0 }, account: ACCOUNT, startedAt: 1_000, attempt: 1, state, live: true, lateHashes: [], ...extra,
});
const HASH = `0x${"ab".repeat(32)}` as const;

describe("gas margin (F-2)", () => {
  it("adds 25%, rounding up, so the limit is never below estimate × 1.25", () => {
    expect(GAS_MARGIN_PERCENT).toBe(25n);
    expect(gasWithMargin(1_384_483n)).toBe(1_730_604n); // the real create estimate on Sepolia
    expect(gasWithMargin(4n)).toBe(5n);
    expect(gasWithMargin(1n)).toBe(2n); // 1.25 rounds up
  });
  it("never exceeds the protocol cap, and refuses an estimate above it", () => {
    expect(gasWithMargin(15_000_000n)).toBe(TX_GAS_CAP);
    expect(() => gasWithMargin(TX_GAS_CAP + 1n)).toThrow();
    expect(() => gasWithMargin(0n)).toThrow();
  });
});

describe("wallet request trace (diagnostics)", () => {
  it("records method, timing and outcome, never parameters, and forwards the call unchanged", async () => {
    traceStore.clear();
    let seen: unknown;
    const provider = {
      tag: "original",
      request(this: { tag: string }, args: { method: string; params?: unknown }) {
        seen = { self: this.tag, args };
        return Promise.resolve("0x1");
      },
      on(this: { tag: string }) {
        return this.tag;
      },
    };
    const traced1 = traceProvider(provider);
    expect(traceProvider(provider)).toBe(traced1); // one stable wrapper per provider
    await expect(traced1.request({ method: "eth_chainId", params: ["secret-looking"] })).resolves.toBe("0x1");
    expect(seen).toEqual({ self: "original", args: { method: "eth_chainId", params: ["secret-looking"] } });
    expect((traced1 as unknown as { on: () => string }).on()).toBe("original"); // other methods keep `this`
    const [e] = traceStore.snapshot();
    expect(e).toMatchObject({ method: "eth_chainId", outcome: "answered" });
    expect(JSON.stringify(traceStore.snapshot())).not.toContain("secret-looking");
  });
  it("records an error with its code and rethrows it", async () => {
    traceStore.clear();
    await expect(traced("eth_sendTransaction", () => Promise.reject(Object.assign(new Error("no"), { code: 4001 })))).rejects.toThrow("no");
    expect(traceStore.snapshot()[0]).toMatchObject({ method: "eth_sendTransaction", outcome: "error", errorCode: 4001 });
  });
  it("describes an unanswered request as unanswered, with its age", () => {
    const lines = describeTrace(
      [
        { id: 1, method: "eth_chainId", startedAt: 0, endedAt: 120, outcome: "answered" },
        { id: 2, method: "eth_sendTransaction", startedAt: 1_000, endedAt: undefined },
        { id: 3, method: "eth_sendTransaction", startedAt: 0, endedAt: 3_000, outcome: "error", errorCode: 4001 },
      ],
      43_000,
    );
    expect(lines).toEqual([
      "eth_chainId: answered after 0.1 s",
      "eth_sendTransaction: handed to the wallet 42 s ago, no answer yet",
      "eth_sendTransaction: the wallet returned an error (code 4001) after 3 s",
    ]);
  });
});

describe("what a wallet error says about whether anything was sent", () => {
  it("declined is 'rejected'", () => {
    expect(walletErrorKind({ code: 4001 })).toBe("rejected");
    expect(walletErrorKind(new UserRejectedRequestError(new Error("x")))).toBe("rejected");
    expect(walletErrorKind({ message: "wrapped", cause: { code: 4001 } })).toBe("rejected");
  });
  it("refusals before signing are 'not-sent'", () => {
    expect(walletErrorKind({ code: -32002 })).toBe("not-sent"); // request already pending
    expect(walletErrorKind({ code: 4100 })).toBe("not-sent");
    expect(walletErrorKind(Object.assign(new Error("x"), { name: "ConnectorChainMismatchError" }))).toBe("not-sent");
    expect(walletErrorKind({ cause: Object.assign(new Error("x"), { name: "ConnectorAccountNotFoundError" }) })).toBe("not-sent");
  });
  it("anything else is 'ambiguous': the page must not claim either way", () => {
    expect(walletErrorKind(new Error("Internal JSON-RPC error."))).toBe("ambiguous");
    expect(walletErrorKind({ code: -32603 })).toBe("ambiguous");
  });
});

describe("the request registry: one open request per action", () => {
  it("blocks a new request while one is checking, awaiting, pending or unresolved", () => {
    expect(canStart(undefined)).toBe(true);
    for (const s of [{ phase: "checking" }, { phase: "awaiting", since: 1 }, { phase: "pending", hash: HASH, since: 1 }, { phase: "unknown", reason: "stopped" }] as TxPhase[]) {
      expect(canStart(entry(s), 1_000)).toBe(false);
      expect(blockReason(entry(s), 1_000)).toBeTruthy();
    }
  });
  it("allows a new request after a final outcome, or after the chain check cleared an unknown one", () => {
    for (const s of [{ phase: "rejected" }, { phase: "failed", problem: { message: "x", recovery: "y" } }, { phase: "reverted", hash: HASH }, { phase: "confirmed", hash: HASH, blockNumber: 1n }, { phase: "found" }, { phase: "cancelled", hash: HASH }] as TxPhase[]) {
      expect(canStart(entry(s))).toBe(true);
    }
    expect(canStart(entry({ phase: "unknown", reason: "stopped" }, { cleared: true }))).toBe(true);
  });
  it("after a reload, an open request becomes 'unknown (reloaded)', keeping a known hash; finished ones are not kept", () => {
    const raw = serialize([
      entry({ phase: "awaiting", since: 5 }, { key: requestKey(ACCOUNT, "a") }),
      entry({ phase: "pending", hash: HASH, since: 5 }, { key: requestKey(ACCOUNT, "b"), before: { kind: "milestone", state: "approved", revision: 1n, rejections: 0n } }),
      entry({ phase: "confirmed", hash: HASH, blockNumber: 9n }, { key: requestKey(ACCOUNT, "c") }),
      entry({ phase: "unknown", reason: "stopped" }, { key: requestKey(ACCOUNT, "d"), cleared: true, recovery: { verdict: { kind: "released", reason: "proof" }, at: 1 } }),
      entry({ phase: "unknown", reason: "stopped" }, { key: requestKey(ACCOUNT, "e") }),
    ]);
    const back = deserialize(raw, 2_000);
    expect(back.map((e) => baseOf(e.key))).toEqual(["a", "b", "e"]);
    expect(back[0]!.state).toEqual({ phase: "unknown", reason: "reloaded", hash: undefined });
    expect(back[1]!.state).toEqual({ phase: "unknown", reason: "reloaded", hash: HASH });
    expect(back[1]!.before).toEqual({ kind: "milestone", state: "approved", revision: 1n, rejections: 0n }); // bigints survive
    expect(back[2]!.state).toEqual({ phase: "unknown", reason: "stopped" });
    expect(back.every((e) => e.live === false)).toBe(true);
  });
  it("keeps unresolved entries however old they are (R2-C: time is not evidence) and tolerates garbage", () => {
    expect(deserialize(serialize([entry({ phase: "awaiting", since: 1 })]), 1_000 + 25 * 3_600_000)).toHaveLength(1);
    expect(deserialize("not json", 0)).toEqual([]);
    expect(deserialize(null, 0)).toEqual([]);
  });
  it("an answer for a superseded attempt never overwrites the current one; storage failures do not break it", () => {
    const store = new Map<string, string>();
    const reg = createRegistry(() => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }));
    reg.set(entry({ phase: "awaiting", since: 1 }, { attempt: 2 }));
    expect(reg.update(requestKey(ACCOUNT, "milestone:1:0"), 1, (e) => ({ ...e, state: { phase: "rejected" } }))).toBe(false);
    expect(reg.get(requestKey(ACCOUNT, "milestone:1:0"))!.state.phase).toBe("awaiting");
    expect(store.get(STORAGE_KEY)).toContain("awaiting");
    const broken = createRegistry(() => ({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }));
    broken.set(entry({ phase: "checking" }));
    expect(broken.get(requestKey(ACCOUNT, "milestone:1:0"))!.state.phase).toBe("checking");
  });
});

describe("finding out from the chain whether a lost request took effect", () => {
  const snap = (state: MilestoneSnap["state"], revision = 1n, rejections = 0n): MilestoneSnap => ({ kind: "milestone", state, revision, rejections });
  it("recognizes each action's own effect, and nothing else", () => {
    expect(milestoneEffect("submit", snap("funded", 0n), snap("submitted", 1n))).toBe(true);
    expect(milestoneEffect("submit", snap("submitted", 1n), snap("submitted", 1n))).toBe(false);
    expect(milestoneEffect("approve", snap("submitted"), snap("approved"))).toBe(true);
    expect(milestoneEffect("approve", snap("submitted"), snap("paid"))).toBe(true); // approved, then claimed quickly
    expect(milestoneEffect("approve", snap("submitted"), snap("funded", 1n, 1n))).toBe(false); // a rejection instead
    expect(milestoneEffect("reject", snap("submitted", 1n, 0n), snap("funded", 1n, 1n))).toBe(true);
    expect(milestoneEffect("claim", snap("approved"), snap("paid"))).toBe(true);
    expect(milestoneEffect("claim", snap("approved"), snap("approved"))).toBe(false);
    expect(milestoneEffect("refund", snap("funded"), snap("refunded"))).toBe(true);
    expect(milestoneEffect("refund", snap("refunded"), snap("refunded"))).toBe(false);
  });
});

describe("queue labels never suggest an action on a finished milestone", () => {
  it("terminal and expired milestones say who can act, or that nothing is left", () => {
    expect(milestoneStatusLine("paid", "provider", [])).toEqual({ text: "Paid to the provider. Nothing left to do.", act: false });
    expect(milestoneStatusLine("refunded", "verifier", [])).toEqual({ text: "Refunded by the client. Nothing left to do.", act: false });
    expect(milestoneStatusLine("expired", "provider", []).text).toBe("Expired. Only the client can act now: a refund.");
    expect(milestoneStatusLine("approved", "verifier", []).text).toMatch(/Your part is done/);
    for (const s of ["paid", "refunded", "expired", "approved"] as const) expect(milestoneStatusLine(s, "provider", []).text).not.toMatch(/Waiting on/);
  });
  it("an available action is stated as the action", () => {
    expect(milestoneStatusLine("approved", "provider", ["claim"])).toEqual({ text: "Claim payout", act: true });
  });
});

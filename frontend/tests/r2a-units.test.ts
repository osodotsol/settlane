import { describe, expect, it } from "vitest";
import { createRegistry, HEARTBEAT_FRESH_MS, openInAnotherTab, STORAGE_KEY, canStart, requestKey, tabIdentity, type TxEntry } from "@/chain/tx-registry";
import { assessRecovery, releases, type RecoveryFacts } from "@/chain/tx-recovery";
import { checkAddress } from "@/domain/address";

const HASH = `0x${"ab".repeat(32)}` as const;
const facts = (over: Partial<RecoveryFacts> = {}): RecoveryFacts => ({ live: false, liveElsewhere: false, receipt: null, txPending: false, latestNonce: 5, pendingNonce: 5, hasBaseline: true, effectDone: false, attested: false, ...over });

describe("recovery verdicts, rule by rule", () => {
  it("1. a receipt for the known hash is final", () => {
    expect(assessRecovery(facts({ hash: HASH, receipt: { status: "success", blockNumber: 9n } })).kind).toBe("confirmed");
    expect(assessRecovery(facts({ hash: HASH, receipt: { status: "reverted", blockNumber: 9n } })).kind).toBe("reverted");
  });
  it("2. the action's own effect on-chain is final, even if this tab still holds the request", () => {
    expect(assessRecovery(facts({ effectDone: true, live: true, createdId: 7n }))).toEqual({ kind: "found", createdId: 7n });
  });
  it("3-4. an open request in this tab or another tab is never released, even after the user's confirmation", () => {
    expect(assessRecovery(facts({ live: true, attested: true })).kind).toBe("open-here");
    expect(assessRecovery(facts({ liveElsewhere: true, attested: true })).kind).toBe("open-elsewhere");
  });
  it("5-6. anything pending means wait", () => {
    expect(assessRecovery(facts({ hash: HASH, txPending: true })).kind).toBe("pending-tx");
    expect(assessRecovery(facts({ pendingNonce: 6, attested: true })).kind).toBe("pending-account");
  });
  it("7. without a baseline nothing can be proven, whatever else is true", () => {
    const v = assessRecovery(facts({ hasBaseline: false, attested: true, effectDone: true, latestNonce: 9 }));
    expect(v.kind).toBe("cannot-prove");
    expect(releases(v)).toBe(false);
  });
  it("8. a dropped hash is released only when its nonce has been used by another transaction", () => {
    expect(assessRecovery(facts({ hash: HASH, txNonce: 5, latestNonce: 6 })).kind).toBe("released");
    expect(assessRecovery(facts({ hash: HASH, txNonce: 5, latestNonce: 5 })).kind).toBe("dropped-unproven");
    expect(assessRecovery(facts({ hash: HASH, latestNonce: 9 })).kind).toBe("dropped-unproven"); // nonce never seen
    expect(assessRecovery(facts({ hash: HASH, txNonce: 5, latestNonce: 5, attested: true })).kind).toBe("dropped-unproven"); // a confirmation is not proof here
  });
  it("9. no hash: the outcome stays unknown; the user's confirmation is an override for a milestone action, never a release, and never unlocks a create (R2-B)", () => {
    expect(assessRecovery(facts({ latestNonce: 7 })).kind).toBe("needs-confirmation");
    expect(assessRecovery(facts({ attested: true })).kind).toBe("override");
    expect(assessRecovery(facts({ attested: true, isCreate: true })).kind).toBe("create-held");
    expect(assessRecovery(facts({ attested: true, isCreate: true, latestNonce: 9 })).kind).toBe("create-held"); // a moved nonce proves nothing
  });
});

describe("EIP-55 address input", () => {
  it("accepts a checksummed address unchanged, without a warning", () => {
    expect(checkAddress("0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4")).toEqual({ ok: true, address: "0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4", warning: undefined });
  });
  it("rejects a mixed-case address whose checksum fails (a changed character or a changed letter case)", () => {
    expect(checkAddress("0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e5").ok).toBe(false);
    expect(checkAddress("0x4Fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4").ok).toBe(false);
  });
  it("accepts all-lowercase and all-uppercase input, naming the same account, with a warning", () => {
    const lower = checkAddress("0x4fa3d0b24e0ab063eb099c1d29c65b814af0e6e4");
    expect(lower).toMatchObject({ ok: true, address: "0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4", warning: expect.stringMatching(/no checksum/) });
    expect(checkAddress("0x4FA3D0B24E0AB063EB099C1D29C65B814AF0E6E4")).toMatchObject({ ok: true, warning: expect.any(String) });
  });
  it("rejects the zero address, malformed input and surrounding junk", () => {
    expect(checkAddress("0x0000000000000000000000000000000000000000").ok).toBe(false);
    expect(checkAddress("0x1234").ok).toBe(false);
    expect(checkAddress("4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4").ok).toBe(false);
    expect(checkAddress("0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4zz").ok).toBe(false);
    expect(checkAddress("  0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4  ").ok).toBe(true); // surrounding spaces only
  });
});

describe("two tabs share the request registry", () => {
  const ACCOUNT = "0x00000000000000000000000000000000000000c1" as const;
  const entry = (live: boolean): TxEntry => ({ key: requestKey(ACCOUNT, "milestone:1:0"), label: "Claim", action: { fn: "claim", id: 1n, m: 0 }, account: ACCOUNT, startedAt: 1_000, attempt: 1, state: live ? { phase: "awaiting", since: 1_000 } : { phase: "unknown", reason: "stopped" }, live, lateHashes: [] });
  it("a request open in tab A blocks tab B, and B recognizes it as open elsewhere while A's heartbeat is fresh", () => {
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    let now = 10_000;
    const a = createRegistry(storage, () => now, "tab-a");
    const b = createRegistry(storage, () => now, "tab-b");
    a.set(entry(true));
    b.syncFromStorage();
    const seen = b.get(requestKey(ACCOUNT, "milestone:1:0"))!;
    expect(canStart(seen, now)).toBe(false);
    expect(openInAnotherTab(seen, "tab-b", now)).toBe(true);
    expect(store.get(STORAGE_KEY)).toContain("tab-a");
    now += HEARTBEAT_FRESH_MS + 1;
    b.syncFromStorage();
    expect(openInAnotherTab(b.get(requestKey(ACCOUNT, "milestone:1:0"))!, "tab-b", now)).toBe(false); // A went quiet (closed or crashed)
    a.heartbeat();
    b.syncFromStorage();
    expect(openInAnotherTab(b.get(requestKey(ACCOUNT, "milestone:1:0"))!, "tab-b", now)).toBe(true); // A still holds it
  });
});

describe("tab identity across a reload", () => {
  it("the same tab keeps its identity after a reload, so its own earlier request is not 'open in another tab'", () => {
    const session = new Map<string, string>();
    const s = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v) };
    const first = tabIdentity(s);
    expect(tabIdentity(s)).toBe(first); // reload: same sessionStorage
    expect(tabIdentity({ getItem: () => null, setItem: () => undefined })).not.toBe(first); // another tab
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const before = createRegistry(storage, () => 1_000, first);
    before.set({ key: requestKey("0x00000000000000000000000000000000000000c1", "milestone:1:0"), label: "x", action: { fn: "claim", id: 1n, m: 0 }, account: "0x00000000000000000000000000000000000000c1", startedAt: 1, attempt: 1, state: { phase: "awaiting", since: 1 }, live: true, lateHashes: [] });
    const afterReload = createRegistry(storage, () => 2_000, tabIdentity(s));
    const e = afterReload.get(requestKey("0x00000000000000000000000000000000000000c1", "milestone:1:0"))!;
    expect(openInAnotherTab(e, afterReload.tabId, 2_000)).toBe(false);
    expect(e.state).toMatchObject({ phase: "unknown", reason: "reloaded" });
  });
});

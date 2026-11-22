import { describe, expect, it } from "vitest";
import { archiveIfCreated, ARCHIVE_KEY, readArchive } from "@/domain/draft-archive";
import { emptyForm } from "@/domain/create-form";
import { traceProvider, traceStore } from "@/chain/wallet-trace";

// R2-B parts 4 and 5: the Create draft is cleared only after a proven create; the wallet trace is transparent.

const session = () => {
  const m = new Map<string, string>();
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } };
};
const form = () => ({ ...emptyForm(), provider: "0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4" });

describe("the Create draft", () => {
  it("is kept when signing is refused, fails, reverts, is cancelled, is still open or its outcome is unknown", () => {
    const { m, s } = session();
    for (const phase of ["checking", "awaiting", "pending", "rejected", "failed", "reverted", "cancelled", "unknown", undefined]) {
      expect(archiveIfCreated(s, { phase, startedAt: 1 }, form())).toBeNull();
    }
    expect(m.size).toBe(0);
  });

  it("is archived and cleared once the agreement is confirmed (or found on-chain), exactly once per request", () => {
    const { m, s } = session();
    const a = archiveIfCreated(s, { phase: "confirmed", startedAt: 10, createdId: 7n }, form());
    expect(a).toMatchObject({ startedAt: 10, createdId: "7" });
    expect(JSON.parse(m.get(ARCHIVE_KEY)!).form.provider).toBe(form().provider);
    // the same finished request seen again (navigation, remount): a newer draft is never cleared
    expect(archiveIfCreated(s, { phase: "confirmed", startedAt: 10, createdId: 7n }, emptyForm())).toBeNull();
    expect(readArchive(s)!.form.provider).toBe(form().provider);
    // a later create found by checking the chain
    expect(archiveIfCreated(s, { phase: "found", startedAt: 20, createdId: 8n }, form())).toMatchObject({ startedAt: 20, createdId: "8" });
  });

  it("is still cleared in memory when storage is unavailable", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(archiveIfCreated(broken, { phase: "confirmed", startedAt: 1 }, form())).not.toBeNull();
    expect(readArchive(broken)).toBeNull();
  });
});

describe("the wallet trace wrapper is transparent", () => {
  class Provider {
    #account = "0xabc";
    #chain = "0xaa36a7";
    isMetaMask = true;
    get selectedAddress() {
      return this.#account; // throws if `this` is not the real object
    }
    set chainId(v: string) {
      this.#chain = v;
    }
    get chainId() {
      return this.#chain;
    }
    on(...listener: [string, () => void]) {
      void listener;
      return this.#account; // private access inside a method
    }
    async request(args: { method: string }) {
      return `${args.method}:${this.#account}`;
    }
  }

  it("getters, setters and methods that use private fields keep working through the wrapper", async () => {
    const p = new Provider();
    const t = traceProvider(p);
    expect(t.selectedAddress).toBe("0xabc");
    t.chainId = "0x1";
    expect(t.chainId).toBe("0x1");
    expect(p.chainId).toBe("0x1"); // set on the real provider
    expect(t.on("x", () => undefined)).toBe("0xabc");
    expect(t.isMetaMask).toBe(true);
    expect(await t.request({ method: "eth_chainId" })).toBe("eth_chainId:0xabc");
  });

  it("returns the same function on every read and the same wrapper for the same provider", () => {
    const p = new Provider();
    const t = traceProvider(p);
    expect(t.on).toBe(t.on);
    expect(t.request).toBe(t.request);
    expect(traceProvider(p)).toBe(t);
  });

  it("records only the method name and timing of `request`, and never changes the provider itself", async () => {
    const p = new Provider();
    const before = Object.getOwnPropertyNames(p).sort();
    const t = traceProvider(p);
    traceStore.clear();
    await t.request({ method: "eth_accounts" });
    expect(traceStore.snapshot().map((e) => [e.method, e.outcome])).toEqual([["eth_accounts", "answered"]]);
    expect(JSON.stringify(traceStore.snapshot())).not.toContain("0xabc"); // no results recorded
    expect(Object.getOwnPropertyNames(p).sort()).toEqual(before);
    expect(p.request).toBe(Provider.prototype.request);
  });
});

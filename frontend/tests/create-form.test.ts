import { describe, expect, it } from "vitest";
import { commit } from "@/domain/commitment";
import { durationSeconds, emptyForm, toCreateArgs, validateCreate, type FormInput } from "@/domain/create-form";

const CLIENT = "0x00000000000000000000000000000000000000c1" as const;
const PROVIDER = "0x00000000000000000000000000000000000000b2";
const VERIFIER = "0x00000000000000000000000000000000000000a3";
const good = (): FormInput => ({
  provider: PROVIDER, verifier: VERIFIER, review: "1", reviewUnit: "days",
  milestones: [{ amount: "0.001", every: "2", unit: "days", spec: "Design the logo" }],
});

describe("commitments", () => {
  it("commits text as keccak256 and accepts a 32-byte hash as it is", () => {
    const t = commit("hello");
    expect(t).toMatchObject({ ok: true, from: "text", hex: "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8" });
    const h = commit(`0x${"ab".repeat(32)}`);
    expect(h).toMatchObject({ ok: true, from: "hash", value: BigInt(`0x${"ab".repeat(32)}`) });
  });
  it("refuses empty input, an all-zero hash and a malformed hash", () => {
    expect(commit("   ").ok).toBe(false);
    expect(commit(`0x${"0".repeat(64)}`).ok).toBe(false);
    expect(commit("0x1234").ok).toBe(false);
  });
});

describe("durations", () => {
  it("converts units and refuses zero, negatives and junk", () => {
    expect(durationSeconds("2", "days")).toBe(172_800n);
    expect(durationSeconds("1.5", "hours")).toBe(5_400n);
    expect(durationSeconds("0", "hours")).toBeNull();
    expect(durationSeconds("-1", "hours")).toBeNull();
    expect(durationSeconds("abc", "days")).toBeNull();
    expect(durationSeconds("0.0001", "minutes")).toBeNull(); // not a whole number of seconds
  });
});

describe("create form validation (contract stage order: parties, count, amounts, time, spec)", () => {
  it("accepts a valid form and builds the exact contract arguments, unused slots zero", () => {
    const r = validateCreate(good(), CLIENT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { args, value } = toCreateArgs(r.draft, 1_000n);
    expect(args[0]).toBe("0x00000000000000000000000000000000000000b2");
    expect(args[2]).toBe(86_400n);
    expect(args[3]).toBe(1);
    expect(args[4]).toEqual([1_000_000_000_000_000n, 0n, 0n]);
    expect(args[5]).toEqual([1_000n + 172_800n, 0n, 0n]);
    expect(args[6][1]).toBe(0n);
    expect(value).toBe(1_000_000_000_000_000n);
  });
  it("sums up to three milestones into the value to send", () => {
    const f = good();
    f.milestones.push({ amount: "0.5", every: "3", unit: "days", spec: "b" }, { amount: "1.25", every: "4", unit: "days", spec: "c" });
    const r = validateCreate(f, CLIENT);
    expect(r.ok && r.draft.total).toBe(1_751_000_000_000_000_000n);
  });
  it("refuses the roles the contract refuses: zero, equal addresses, the client itself", () => {
    const e = (patch: Partial<FormInput>) => { const r = validateCreate({ ...good(), ...patch }, CLIENT); return r.ok ? null : r.errors; };
    expect(e({ provider: "" })?.provider).toBeTruthy();
    expect(e({ provider: `0x${"0".repeat(40)}` })?.provider).toMatch(/zero/);
    expect(e({ provider: CLIENT })?.provider).toMatch(/different account/);
    expect(e({ verifier: CLIENT })?.verifier).toMatch(/different account/);
    expect(e({ verifier: PROVIDER })?.verifier).toMatch(/different account from the provider/);
  });
  it("refuses zero or malformed amounts, short deadlines and empty specs", () => {
    const f = good();
    f.milestones[0] = { amount: "0", every: "1", unit: "minutes", spec: "" };
    const r = validateCreate(f, CLIENT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.milestones[0]).toMatchObject({ amount: expect.any(String), deadline: expect.stringMatching(/5 minutes/), spec: expect.any(String) });
    const g = good();
    g.milestones[0]!.amount = "0.0000000000000000001"; // 19 decimals
    expect(validateCreate(g, CLIENT).ok).toBe(false);
  });
  it("does not need a connected wallet to validate (the client check applies once one is connected)", () => {
    expect(validateCreate(good(), undefined).ok).toBe(true);
    expect(emptyForm().milestones).toHaveLength(1);
  });
});

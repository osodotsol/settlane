import { parseEther, type Address } from "viem";
import { checkAddress } from "./address";
import { commit } from "./commitment";

// Validation of the Create form, mirroring the contract's stage order (docs/LIFECYCLE.md: parties, count,
// amounts, time, spec). It only decides what the form lets through; `create` is simulated against the
// contract before anything is signed. Deadlines are entered as "how long from confirmation" and turned
// into absolute unix seconds from the latest block time at the moment of signing (`toCreateArgs`).

export const UNIT_SECONDS = { minutes: 60n, hours: 3_600n, days: 86_400n } as const;
export type Unit = keyof typeof UNIT_SECONDS;

export type MilestoneInput = { amount: string; every: string; unit: Unit; spec: string };
export type FormInput = { provider: string; verifier: string; review: string; reviewUnit: Unit; milestones: MilestoneInput[] };
export type FormErrors = {
  provider?: string;
  verifier?: string;
  /** Non-blocking: an address without a checksum (all one case). */
  warnings?: { provider?: string; verifier?: string };
  review?: string;
  milestones: { amount?: string; deadline?: string; spec?: string }[];
};

export type Draft = {
  provider: Address;
  verifier: Address;
  reviewPeriod: bigint;
  items: { amount: bigint; deliverIn: bigint; spec: bigint }[];
  total: bigint;
};

export const MIN_DELIVERY_SECONDS = 300n; // five minutes: room for the wallet prompt and one block
export const MAX_MILESTONES = 3;

export const emptyMilestone = (): MilestoneInput => ({ amount: "", every: "", unit: "days", spec: "" });
export const emptyForm = (): FormInput => ({ provider: "", verifier: "", review: "1", reviewUnit: "days", milestones: [emptyMilestone()] });

const POSITIVE = /^\d+(\.\d+)?$/;

/** Seconds for "n units", or null when `n` is not a positive whole number of seconds. */
export function durationSeconds(every: string, unit: Unit): bigint | null {
  const t = every.trim();
  if (!POSITIVE.test(t)) return null;
  const [w, f = ""] = t.split(".");
  const scale = 10n ** BigInt(f.length);
  const total = (BigInt(w!) * scale + BigInt(f || "0")) * UNIT_SECONDS[unit];
  if (total % scale !== 0n) return null;
  const s = total / scale;
  return s > 0n ? s : null;
}

function parseAmount(text: string): bigint | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const v = parseEther(t);
  return v > 0n ? v : null;
}

export function validateCreate(input: FormInput, client: Address | undefined): { ok: true; draft: Draft; warnings: NonNullable<FormErrors["warnings"]> } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = { milestones: input.milestones.map(() => ({})) };
  const same = (a: string, b: string | undefined) => b !== undefined && a.toLowerCase() === b.toLowerCase();

  const p = checkAddress(input.provider, "provider's address");
  const v = checkAddress(input.verifier, "verifier's address");
  if (!p.ok) errors.provider = p.error;
  else if (same(p.address, client)) errors.provider = "The provider must be a different account from you, the client.";
  if (!v.ok) errors.verifier = v.error;
  else if (same(v.address, client)) errors.verifier = "The verifier must be a different account from you, the client.";
  else if (p.ok && same(v.address, p.address)) errors.verifier = "The verifier must be a different account from the provider.";
  const warnings = { provider: p.ok ? p.warning : undefined, verifier: v.ok ? v.warning : undefined };

  const reviewPeriod = durationSeconds(input.review, input.reviewUnit);
  if (reviewPeriod === null) errors.review = "Enter a review period above zero.";

  const items: Draft["items"] = [];
  input.milestones.forEach((m, i) => {
    const e = errors.milestones[i]!;
    const amount = parseAmount(m.amount);
    if (amount === null) e.amount = "Enter an amount above 0 ETH (up to 18 decimals).";
    const deliverIn = durationSeconds(m.every, m.unit);
    if (deliverIn === null) e.deadline = "Enter how long the provider has to deliver.";
    else if (deliverIn < MIN_DELIVERY_SECONDS) e.deadline = "Allow at least 5 minutes, so the deadline is still ahead when the transaction lands.";
    const spec = commit(m.spec);
    if (!spec.ok) e.spec = spec.error;
    if (amount !== null && deliverIn !== null && spec.ok) items.push({ amount, deliverIn, spec: spec.value });
  });

  const bad = errors.provider || errors.verifier || errors.review || errors.milestones.some((e) => e.amount || e.deadline || e.spec);
  if (bad || !p.ok || !v.ok || input.milestones.length < 1 || input.milestones.length > MAX_MILESTONES || reviewPeriod === null) return { ok: false, errors: { ...errors, warnings } };
  return {
    ok: true,
    draft: { provider: p.address, verifier: v.address, reviewPeriod, items, total: items.reduce((s, x) => s + x.amount, 0n) },
    warnings,
  };
}

const ZERO3 = [0n, 0n, 0n] as const;

/** The exact `create` arguments (see the ABI): three-slot arrays, unused slots zero, deadlines absolute. */
export function toCreateArgs(d: Draft, blockTime: bigint) {
  const slot = (f: (i: Draft["items"][number]) => bigint) => [0, 1, 2].map((i) => (d.items[i] ? f(d.items[i]!) : ZERO3[i]!)) as [bigint, bigint, bigint];
  return {
    args: [d.provider, d.verifier, d.reviewPeriod, d.items.length, slot((x) => x.amount), slot((x) => blockTime + x.deliverIn), slot((x) => x.spec)] as const,
    value: d.total,
  };
}

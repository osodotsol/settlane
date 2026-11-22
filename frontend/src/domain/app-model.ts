import type { Address } from "viem";
import type { Activity } from "@/contract/events";
import type { Agreement, Milestone } from "@/contract/read";
import { buildLedger } from "./ledger";
import { deliveryOpen, displayState, expired, isFinal, reviewOpen, type DisplayState } from "./lifecycle";

// The application's view of "who can do what", derived from the stored roles and the block time. It mirrors
// the contract's guards (docs/LIFECYCLE.md transition table) only to decide what the interface OFFERS. The
// contract decides: every write is simulated against it before signing (src/chain/write.ts).

export type Role = "client" | "provider" | "verifier";
export const ROLE_LABEL: Record<Role, string> = { client: "Client", provider: "Provider", verifier: "Verifier" };

const same = (a: string, b: string | undefined) => b !== undefined && a.toLowerCase() === b.toLowerCase();

/** The roles `who` holds in an agreement (the contract makes the three addresses distinct, so at most one). */
export function rolesOf(a: Pick<Agreement, "client" | "provider" | "verifier">, who: Address | undefined): Role[] {
  const out: Role[] = [];
  if (same(a.client, who)) out.push("client");
  if (same(a.provider, who)) out.push("provider");
  if (same(a.verifier, who)) out.push("verifier");
  return out;
}

export const isParty = (a: Pick<Agreement, "client" | "provider" | "verifier">, who: Address | undefined) => rolesOf(a, who).length > 0;

/** Agreements where `who` has a role; none when no wallet is connected. */
export function agreementsFor(all: readonly Agreement[], who: Address | undefined): Agreement[] {
  return who === undefined ? [] : all.filter((a) => isParty(a, who));
}

export type ActionKind = "submit" | "review" | "claim" | "refund";

export const ACTION_LABEL: Record<ActionKind, string> = {
  submit: "Submit evidence",
  review: "Review submission",
  claim: "Claim payout",
  refund: "Refund to client",
};

/** The role that performs each action (LIFECYCLE: T2 provider, T3/T4 verifier, T5 provider, T6 client). */
export const ACTION_ROLE: Record<ActionKind, Role> = { submit: "provider", review: "verifier", claim: "provider", refund: "client" };

/** Which actions `who` can take on one milestone right now (as the interface judges it at block time). */
export function milestoneActions(a: Agreement, m: Milestone, who: Address | undefined, now: bigint): ActionKind[] {
  const roles = rolesOf(a, who);
  const out: ActionKind[] = [];
  if (roles.includes("provider")) {
    if ((m.state === "funded" || m.state === "submitted") && deliveryOpen(now, m.deliverBy)) out.push("submit");
    if (m.state === "approved") out.push("claim");
  }
  if (roles.includes("verifier") && m.state === "submitted" && reviewOpen(now, m.decideBy)) out.push("review");
  if (roles.includes("client") && expired(m.state, now, m.deliverBy, m.decideBy)) out.push("refund");
  return out;
}

export type AttentionItem = {
  key: string;
  agreementId: bigint;
  m: number;
  action: ActionKind;
  amount: bigint;
  /** The deadline this action must beat (delivery or review), or null when there is none (claim, refund). */
  by: bigint | null;
};

/** Everything waiting on `who`, soonest deadline first, then payouts and refunds. */
export function attentionFor(agreements: readonly Agreement[], who: Address | undefined, now: bigint): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const a of agreements) {
    for (const m of a.milestones) {
      for (const action of milestoneActions(a, m, who, now)) {
        const by = action === "submit" ? m.deliverBy : action === "review" ? m.decideBy : null;
        items.push({ key: `${a.id}:${m.index}:${action}`, agreementId: a.id, m: m.index, action, amount: m.amount, by });
      }
    }
  }
  return items.sort((x, y) => {
    if (x.by !== null && y.by !== null) return x.by < y.by ? -1 : x.by > y.by ? 1 : 0;
    if (x.by !== null) return -1;
    if (y.by !== null) return 1;
    return x.agreementId < y.agreementId ? 1 : -1;
  });
}

export type Totals = { deposited: bigint; paid: bigint; refunded: bigint; outstanding: bigint; agreements: number; open: number; settled: number };

/** Sums over a set of agreements (the contract's own counters, which the milestones re-derive: see ledger.ts). */
export function totalsOf(agreements: readonly Agreement[], now: bigint): Totals {
  const t: Totals = { deposited: 0n, paid: 0n, refunded: 0n, outstanding: 0n, agreements: agreements.length, open: 0, settled: 0 };
  for (const a of agreements) {
    t.deposited += a.deposited;
    t.paid += a.paid;
    t.refunded += a.refunded;
    t.outstanding += a.outstanding;
    if (isOpen(a, now)) t.open++;
    for (const m of a.milestones) if (isFinal(displayState(m.state, now, m.deliverBy, m.decideBy))) t.settled++;
  }
  return t;
}

/** Open while any used milestone is not Paid or Refunded (LIFECYCLE: derived, never stored). */
export const isOpen = (a: Agreement, now: bigint) => a.milestones.some((m) => !isFinal(displayState(m.state, now, m.deliverBy, m.decideBy)));

/** True when the contract's counters agree with the milestones (audit T-2, shown on the agreement page). */
export const accountingHolds = (a: Agreement) => {
  const l = buildLedger(a);
  return l.identityHolds && l.matchesMilestones;
};

/** Amounts that `who` can take out right now: approved milestones as provider, expired ones as client. */
export function payableTo(agreements: readonly Agreement[], who: Address | undefined, now: bigint) {
  const claimable: AttentionItem[] = [];
  const refundable: AttentionItem[] = [];
  for (const item of attentionFor(agreements, who, now)) {
    if (item.action === "claim") claimable.push(item);
    else if (item.action === "refund") refundable.push(item);
  }
  const sum = (xs: AttentionItem[]) => xs.reduce((s, x) => s + x.amount, 0n);
  return { claimable, refundable, claimableTotal: sum(claimable), refundableTotal: sum(refundable) };
}

/** Payout events (claims and refunds) in agreements where `who` has a role, newest first. */
export function payoutsFor(activity: readonly Activity[], agreements: readonly Agreement[], who: Address | undefined): (Activity & { role: Role })[] {
  const roleIn = new Map(agreements.map((a) => [a.id, rolesOf(a, who)[0]] as const));
  const out: (Activity & { role: Role })[] = [];
  for (const e of activity) {
    const role = roleIn.get(e.id);
    if (!role) continue;
    if ((e.kind === "claimed" && role === "provider") || (e.kind === "refunded" && role === "client")) out.push({ ...e, role });
  }
  return out.reverse();
}

/** A short plain-language line for what happens next to `who` in an agreement (or to anyone, when `who` has no role). */
export function nextLine(a: Agreement, who: Address | undefined, now: bigint): { text: string; urgent: boolean } {
  const mine = attentionFor([a], who, now);
  if (mine.length > 0) {
    const first = mine[0]!;
    const more = mine.length > 1 ? ` (+${mine.length - 1} more)` : "";
    return { text: `${ACTION_LABEL[first.action]} · milestone ${first.m + 1}${more}`, urgent: true };
  }
  const open = a.milestones.filter((m) => !isFinal(displayState(m.state, now, m.deliverBy, m.decideBy)));
  if (open.length === 0) return { text: "Settled", urgent: false };
  const m = open[0]!;
  const s = displayState(m.state, now, m.deliverBy, m.decideBy);
  const waiting: Record<string, string> = {
    funded: "Waiting for the provider's evidence",
    submitted: "Waiting for the verifier's decision",
    approved: "Waiting for the provider to claim",
    expired: "Expired: the client can refund",
  };
  return { text: waiting[s] ?? "In progress", urgent: false };
}

export type MilestoneEntry = { a: Agreement; m: Milestone; state: DisplayState; actions: ActionKind[] };

/**
 * Milestones where `who` holds `role`, split into what is theirs to do now, what waits on someone else,
 * and what is finished for them (for a verifier an approval is a finished decision).
 */
export function milestonesAs(agreements: readonly Agreement[], who: Address | undefined, role: Role, now: bigint) {
  const todo: MilestoneEntry[] = [];
  const waiting: MilestoneEntry[] = [];
  const done: MilestoneEntry[] = [];
  for (const a of agreements) {
    if (!rolesOf(a, who).includes(role)) continue;
    for (const m of a.milestones) {
      const state = displayState(m.state, now, m.deliverBy, m.decideBy);
      const actions = milestoneActions(a, m, who, now);
      const entry = { a, m, state, actions };
      if (actions.length > 0) todo.push(entry);
      else if (isFinal(state) || state === "expired" || (role === "verifier" && state === "approved")) done.push(entry);
      else waiting.push(entry);
    }
  }
  const newest = (x: MilestoneEntry, y: MilestoneEntry) => (x.a.id === y.a.id ? x.m.index - y.m.index : x.a.id < y.a.id ? 1 : -1);
  return { todo: todo.sort(newest), waiting: waiting.sort(newest), done: done.sort(newest) };
}

/**
 * One line for a milestone in a role's queue. A finished milestone says so and never suggests that someone still
 * has to act; an expired one says that only the client can act (a refund).
 */
export function milestoneStatusLine(state: DisplayState, role: Role, actions: readonly ActionKind[]): { text: string; act: boolean } {
  if (actions.length > 0) return { text: actions.map((a) => ACTION_LABEL[a]).join(" or "), act: true };
  switch (state) {
    case "paid":
      return { text: "Paid to the provider. Nothing left to do.", act: false };
    case "refunded":
      return { text: "Refunded by the client. Nothing left to do.", act: false };
    case "expired":
      return { text: "Expired. Only the client can act now: a refund.", act: false };
    case "approved":
      return { text: role === "verifier" ? "Approved. Your part is done; the provider can claim." : "Approved. The provider can claim.", act: false };
    case "submitted":
      return { text: "Waiting for the verifier's decision", act: false };
    case "funded":
      return { text: "Waiting for the provider's evidence", act: false };
    default:
      return { text: "", act: false };
  }
}

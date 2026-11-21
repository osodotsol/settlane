// Display-side mirror of the pure predicates in ingots/settlane/src/rules.fe (docs/LIFECYCLE.md,
// "Derived time predicates"). It decides only what the interface OFFERS and how a milestone is
// labelled; the contract decides, and every write is simulated before signing (frontend/PLAN.md §3).

/** Stored state codes returned by getMilestone (rules::state_code). */
export const STATE_CODES = ["none", "funded", "submitted", "approved", "paid", "refunded"] as const;
export type StoredState = (typeof STATE_CODES)[number];

/** What the interface shows: a stored state, or the derived `expired` (never stored). */
export type DisplayState = StoredState | "expired";

export function storedState(code: number): StoredState {
  const s = STATE_CODES[code];
  if (s === undefined) throw new Error(`unknown milestone state code ${code}`);
  return s;
}

/** `now < deliver_by` */
export const deliveryOpen = (now: bigint, deliverBy: bigint) => now < deliverBy;

/** `now < decide_by` */
export const reviewOpen = (now: bigint, decideBy: bigint) => now < decideBy;

/** `(Funded ∧ ¬delivery_open) ∨ (Submitted ∧ ¬review_open)`; false for every other state. */
export function expired(state: StoredState, now: bigint, deliverBy: bigint, decideBy: bigint): boolean {
  if (state === "funded") return !deliveryOpen(now, deliverBy);
  if (state === "submitted") return !reviewOpen(now, decideBy);
  return false;
}

export function displayState(state: StoredState, now: bigint, deliverBy: bigint, decideBy: bigint): DisplayState {
  return expired(state, now, deliverBy, decideBy) ? "expired" : state;
}

export const STATE_LABEL: Record<DisplayState, string> = {
  none: "Unused",
  funded: "Funded",
  submitted: "In review",
  approved: "Approved",
  paid: "Paid",
  refunded: "Refunded",
  expired: "Expired · refundable",
};

/** Outlined chip = open, solid = final (DESIGN.md §2). */
export const isFinal = (s: DisplayState) => s === "paid" || s === "refunded";

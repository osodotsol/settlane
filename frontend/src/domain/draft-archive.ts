import type { FormInput } from "./create-form";

// When the Create draft is cleared (R2-B, audit "accidental duplicate"): ONLY when the chain shows the agreement was created
// (a successful receipt, or "found" by checking the chain). A refused, failed, reverted or unknown request keeps the draft
// exactly as it is. The cleared draft is archived (once per request), so its terms can be reused deliberately; reusing them
// starts a new draft, and creating it funds a new agreement.

export const ARCHIVE_KEY = "settlane:create-draft:archived";

export type ArchivedDraft = { form: FormInput; startedAt: number; createdId?: string };

type Session = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/** The phases after which the agreement provably exists. */
export const createdOnChain = (phase: string | undefined) => phase === "confirmed" || phase === "found";

/**
 * Archives `form` for the create request that started at `startedAt`, if that request is proven on-chain and was not archived
 * already. Returns the archive when the caller should clear the draft now, otherwise null (keep the draft).
 */
export function archiveIfCreated(session: Session | undefined, request: { phase?: string; startedAt?: number; createdId?: bigint }, form: FormInput): ArchivedDraft | null {
  if (!createdOnChain(request.phase) || request.startedAt === undefined) return null;
  const previous = readArchive(session);
  if (previous?.startedAt === request.startedAt) return null; // already cleared for this request: never clear a newer draft
  const archived: ArchivedDraft = { form, startedAt: request.startedAt, createdId: request.createdId?.toString() };
  try {
    session?.setItem(ARCHIVE_KEY, JSON.stringify(archived));
  } catch {
    /* storage unavailable: the draft is still cleared in memory */
  }
  return archived;
}

export function readArchive(session: Session | undefined): ArchivedDraft | null {
  try {
    const raw = session?.getItem(ARCHIVE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as ArchivedDraft;
    return typeof a.startedAt === "number" && a.form && Array.isArray(a.form.milestones) ? a : null;
  } catch {
    return null;
  }
}

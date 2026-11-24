import { UNIT_SECONDS, emptyForm, type FormInput, type Unit } from "./create-form";

// Create-form initialization (the input-loss race). The page is rendered empty on the server and in the first
// browser render; the tab's saved draft is restored once afterwards. Initialization must never replace what the
// user has entered, including text typed into the fields before React could see it (before or during hydration,
// when no change event reaches the form). So the fields themselves are read when initialization runs.

/** The values in the form's fields when the form is first rendered (one milestone, as the empty form has). */
export type FieldValues = { provider: string; verifier: string; review: string; reviewUnit: string; amount: string; every: string; unit: string; spec: string };

const unit = (u: string, fallback: Unit): Unit => (u in UNIT_SECONDS ? (u as Unit) : fallback);

/** The draft the user has already entered in the fields, or null when they still show the empty form. */
export function typedDraft(fields: FieldValues | null): FormInput | null {
  if (!fields) return null;
  const e = emptyForm();
  const m = e.milestones[0]!;
  const typed: FormInput = {
    provider: fields.provider,
    verifier: fields.verifier,
    review: fields.review,
    reviewUnit: unit(fields.reviewUnit, e.reviewUnit),
    milestones: [{ amount: fields.amount, every: fields.every, unit: unit(fields.unit, m.unit), spec: fields.spec }],
  };
  const t = typed.milestones[0]!;
  const changed =
    typed.provider !== e.provider ||
    typed.verifier !== e.verifier ||
    typed.review !== e.review ||
    typed.reviewUnit !== e.reviewUnit ||
    t.amount !== m.amount ||
    t.every !== m.every ||
    t.unit !== m.unit ||
    t.spec !== m.spec;
  return changed ? typed : null;
}

/**
 * What initialization does: keep the user's entry (typed into the fields, or already in state through a change
 * event), or else restore the saved draft. Never both, so two drafts are never mixed field by field.
 */
export function initialDraft(typed: FormInput | null, editedInState: boolean, saved: () => FormInput): { kind: "typed"; form: FormInput } | { kind: "keep" } | { kind: "restore"; form: FormInput } {
  if (typed) return { kind: "typed", form: typed };
  if (editedInState) return { kind: "keep" };
  return { kind: "restore", form: saved() };
}

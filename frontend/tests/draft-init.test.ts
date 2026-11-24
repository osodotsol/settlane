import { describe, expect, it } from "vitest";
import { emptyForm, type FormInput } from "@/domain/create-form";
import { initialDraft, typedDraft, type FieldValues } from "@/domain/draft-init";

// The create form's initialization (input-loss race): typed text is never replaced by a draft loaded later, a saved
// draft is restored only into an untouched form, and two drafts are never mixed field by field.
const untouched: FieldValues = { provider: "", verifier: "", review: "1", reviewUnit: "days", amount: "", every: "", unit: "days", spec: "" };
const saved: FormInput = { provider: "0xsaved", verifier: "0xv", review: "2", reviewUnit: "hours", milestones: [{ amount: "0.07", every: "3", unit: "days", spec: "saved" }] };

describe("create form initialization", () => {
  it("an untouched form (fields equal the empty form) is not a typed draft", () => {
    expect(typedDraft(untouched)).toBeNull();
    expect(typedDraft(null)).toBeNull();
  });

  it("any field typed before React saw it is a typed draft, kept exactly, with the empty form's other values", () => {
    const t = typedDraft({ ...untouched, provider: "0xtyped" });
    expect(t).toEqual({ ...emptyForm(), provider: "0xtyped" });
    expect(typedDraft({ ...untouched, spec: "x" })?.milestones[0]?.spec).toBe("x");
    expect(typedDraft({ ...untouched, review: "" })?.review).toBe(""); // clearing a default is an edit too
    expect(typedDraft({ ...untouched, unit: "hours" })?.milestones[0]?.unit).toBe("hours");
  });

  it("an unknown unit from the page falls back to the default instead of entering the draft", () => {
    expect(typedDraft({ ...untouched, provider: "0x1", reviewUnit: "fortnights" })?.reviewUnit).toBe("days");
  });

  it("typed text wins over the saved draft, which is not even read, and nothing is mixed", () => {
    let reads = 0;
    const d = initialDraft(typedDraft({ ...untouched, provider: "0xtyped" }), false, () => (reads++, saved));
    expect(d).toEqual({ kind: "typed", form: { ...emptyForm(), provider: "0xtyped" } });
    expect(reads).toBe(0);
  });

  it("an edit already in state is kept (no restore)", () => {
    expect(initialDraft(null, true, () => saved)).toEqual({ kind: "keep" });
  });

  it("only an untouched form restores the saved draft", () => {
    expect(initialDraft(null, false, () => saved)).toEqual({ kind: "restore", form: saved });
  });
});

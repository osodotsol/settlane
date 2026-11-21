"use client";

import type { Draft, FormErrors } from "@/domain/create-form";
import { Button } from "../Button";

// Milestone M1 (read-only application): the form validates exactly as the contract will, but signing is
// connected in the next milestone.
export function CreateSubmit({ result }: { result: { ok: true; draft: Draft } | { ok: false; errors: FormErrors }; onAttempt: () => void; total: bigint }) {
  return (
    <div className="space-y-3 border-t border-line pt-5">
      <Button type="submit" className="w-full" disabled={!result.ok} aria-describedby="create-note">Create and fund</Button>
      <p id="create-note" className="text-micro text-ink-3">Signing is switched on in the next milestone. This form already checks every rule the contract checks.</p>
    </div>
  );
}

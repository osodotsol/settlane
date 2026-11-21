"use client";

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { useActivity, useOverview } from "@/chain/queries";
import { useWallet } from "@/chain/use-wallet";
import { formatUtc } from "@/domain/format";
import { MAX_MILESTONES, UNIT_SECONDS, emptyForm, emptyMilestone, validateCreate, type FormInput, type MilestoneInput, type Unit } from "@/domain/create-form";
import { commit } from "@/domain/commitment";
import { Amount } from "../Amount";
import { Button } from "../Button";
import { CreateSubmit } from "./CreateSubmit";
import { PageHeader, WalletGate } from "./parts";

const UNITS = Object.keys(UNIT_SECONDS) as Unit[];
const input = "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[0.9375rem] placeholder:text-ink-3 hover:border-line-control focus-visible:border-cobalt";

function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
      {hint && <p id={`${htmlFor}-hint`} className="text-micro text-ink-3">{hint}</p>}
      <div className="mt-1.5">{children}</div>
      {error && <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

function Duration({ id, value, unit, onChange, invalid }: { id: string; value: string; unit: Unit; onChange: (v: string, u: Unit) => void; invalid: boolean }) {
  return (
    <div className="flex gap-2">
      <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value, unit)} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} className={`${input} min-w-0`} placeholder="2" />
      <select aria-label="Unit" value={unit} onChange={(e) => onChange(value, e.target.value as Unit)} className={`${input} w-32 shrink-0`}>
        {UNITS.map((u) => <option key={u}>{u}</option>)}
      </select>
    </div>
  );
}

export function CreateView() {
  const uid = useId();
  const wallet = useWallet();
  const overview = useOverview();
  useActivity(); // warm the event history while the form is filled in
  const [form, setForm] = useState<FormInput>(emptyForm);
  const [touched, setTouched] = useState(false);
  const result = validateCreate(form, wallet.address);
  const errors = result.ok ? null : result.errors;
  const shown = touched ? errors : null;
  const set = (patch: Partial<FormInput>) => setForm((f) => ({ ...f, ...patch }));
  const setM = (i: number, patch: Partial<MilestoneInput>) => set({ milestones: form.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const blockTime = overview.data?.blockTime;
  const total = form.milestones.reduce((s, m) => {
    const t = m.amount.trim();
    if (!/^\d+(\.\d{1,18})?$/.test(t)) return s;
    const [w, f = ""] = t.split(".");
    return s + BigInt(w!) * 10n ** 18n + BigInt(f.padEnd(18, "0"));
  }, 0n);

  return (
    <>
      <PageHeader title="Create Agreement" lead="Lock test ETH for up to three milestones. Each milestone has its own amount, delivery deadline and specification. You become the client; the provider and the verifier must be two other accounts." />
      <div className="mt-8">
        <WalletGate title="Connect a wallet to create an agreement" needSepolia>
          <form
            noValidate
            onSubmit={(e) => { e.preventDefault(); setTouched(true); }}
            className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]"
          >
            <div className="space-y-6">
              <fieldset className="card space-y-5 p-6">
                <legend className="sr-only">People</legend>
                <h2 className="text-title">People</h2>
                <Field label="Provider" hint="Delivers the work and claims the payout." error={shown?.provider} htmlFor={`${uid}-provider`}>
                  <input id={`${uid}-provider`} value={form.provider} onChange={(e) => set({ provider: e.target.value })} spellCheck={false} autoComplete="off" aria-invalid={!!shown?.provider} aria-describedby={shown?.provider ? `${uid}-provider-error` : `${uid}-provider-hint`} className={`${input} text-data`} placeholder="0x…" />
                </Field>
                <Field label="Verifier" hint="A trusted third party. Decides whether the work is accepted; cannot move funds." error={shown?.verifier} htmlFor={`${uid}-verifier`}>
                  <input id={`${uid}-verifier`} value={form.verifier} onChange={(e) => set({ verifier: e.target.value })} spellCheck={false} autoComplete="off" aria-invalid={!!shown?.verifier} aria-describedby={shown?.verifier ? `${uid}-verifier-error` : `${uid}-verifier-hint`} className={`${input} text-data`} placeholder="0x…" />
                </Field>
                <Field label="Review period" hint="How long the verifier has to decide after each delivery deadline." error={shown?.review} htmlFor={`${uid}-review`}>
                  <Duration id={`${uid}-review`} value={form.review} unit={form.reviewUnit} onChange={(v, u) => set({ review: v, reviewUnit: u })} invalid={!!shown?.review} />
                </Field>
              </fieldset>

              {form.milestones.map((m, i) => {
                const e = shown?.milestones[i];
                const spec = commit(m.spec);
                return (
                  <fieldset key={i} className="card space-y-5 p-6">
                    <legend className="sr-only">Milestone {i + 1}</legend>
                    <div className="flex items-center justify-between">
                      <h2 className="text-title">Milestone {i + 1}</h2>
                      {form.milestones.length > 1 && (
                        <button type="button" onClick={() => set({ milestones: form.milestones.filter((_, j) => j !== i) })} className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-ink-2 hover:bg-sunken hover:text-ink">
                          <X aria-hidden size={15} /> Remove
                        </button>
                      )}
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="Amount (ETH)" error={e?.amount} htmlFor={`${uid}-a${i}`}>
                        <input id={`${uid}-a${i}`} inputMode="decimal" value={m.amount} onChange={(ev) => setM(i, { amount: ev.target.value })} aria-invalid={!!e?.amount} aria-describedby={e?.amount ? `${uid}-a${i}-error` : undefined} className={`${input} text-data`} placeholder="0.01" />
                      </Field>
                      <Field label="Deliver within" hint="From when the agreement is confirmed." error={e?.deadline} htmlFor={`${uid}-d${i}`}>
                        <Duration id={`${uid}-d${i}`} value={m.every} unit={m.unit} onChange={(v, u) => setM(i, { every: v, unit: u })} invalid={!!e?.deadline} />
                      </Field>
                    </div>
                    <Field label="Specification" hint="What must be delivered: plain text, or a 32-byte hash of your own document. Only its hash goes on-chain." error={e?.spec} htmlFor={`${uid}-s${i}`}>
                      <textarea id={`${uid}-s${i}`} rows={3} value={m.spec} onChange={(ev) => setM(i, { spec: ev.target.value })} aria-invalid={!!e?.spec} aria-describedby={e?.spec ? `${uid}-s${i}-error` : undefined} className={`${input} h-auto py-2.5`} placeholder="Landing page design, three concepts, delivered as a Figma link" />
                      {spec.ok && <p className="mt-1.5 text-micro text-ink-3">Committed as <span className="text-data text-[0.75rem]" title={spec.hex}>{spec.hex.slice(0, 18)}…{spec.hex.slice(-6)}</span> ({spec.from === "text" ? "keccak256 of the text" : "your hash"})</p>}
                    </Field>
                  </fieldset>
                );
              })}
              {form.milestones.length < MAX_MILESTONES && (
                <Button variant="secondary" size="sm" onClick={() => set({ milestones: [...form.milestones, emptyMilestone()] })}>
                  <Plus aria-hidden size={16} /> Add milestone
                </Button>
              )}
            </div>

            <aside aria-label="Summary" className="card space-y-5 p-6 lg:sticky lg:top-24">
              <h2 className="text-title">Summary</h2>
              <div>
                <p className="text-sm text-ink-2">You lock now</p>
                <p className="mt-1"><Amount wei={total} variant="numeral" /></p>
                <p className="mt-1 text-micro text-ink-3">The exact sum of the milestone amounts. Nothing more is taken.</p>
              </div>
              <ol className="space-y-3 border-t border-line pt-5 text-sm">
                {form.milestones.map((m, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="text-ink-2">Milestone {i + 1}</span>
                    <span className="text-right">
                      <span className="text-data text-[0.875rem]">{/^\d+(\.\d{1,18})?$/.test(m.amount.trim()) ? m.amount.trim() : "…"} ETH</span>
                    </span>
                  </li>
                ))}
              </ol>
              {blockTime !== undefined && result.ok && (
                <ul className="space-y-2 border-t border-line pt-5 text-micro text-ink-3">
                  {result.draft.items.map((x, i) => (
                    <li key={i}>
                      Milestone {i + 1}: deliver by {formatUtc(blockTime + x.deliverIn)}, review by {formatUtc(blockTime + x.deliverIn + result.draft.reviewPeriod)}
                    </li>
                  ))}
                </ul>
              )}
              <CreateSubmit result={result} onAttempt={() => setTouched(true)} total={total} />
            </aside>
          </form>
        </WalletGate>
      </div>
    </>
  );
}

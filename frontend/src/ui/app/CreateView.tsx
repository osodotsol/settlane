"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useActivity, useOverview } from "@/chain/queries";
import { useMounted, useWallet } from "@/chain/use-wallet";
import { commit } from "@/domain/commitment";
import { MAX_MILESTONES, UNIT_SECONDS, emptyForm, emptyMilestone, validateCreate, type FormErrors, type FormInput, type MilestoneInput, type Unit } from "@/domain/create-form";
import { formatUtc } from "@/domain/format";
import { Amount } from "../Amount";
import { Button } from "../Button";
import { CreateSubmit } from "./CreateSubmit";
import { PageHeader } from "./parts";

const UNITS = Object.keys(UNIT_SECONDS) as Unit[];
const control = "h-11 rounded-xl border border-line bg-surface px-3 text-[0.9375rem] hover:border-line-control focus-visible:border-cobalt";
const input = "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[0.9375rem] placeholder:text-ink-3 hover:border-line-control focus-visible:border-cobalt aria-[invalid=true]:border-danger";
const DRAFT_KEY = "settlane:create-draft";

// The draft lives in this component (it stays mounted when a wallet connects or the network changes) and is
// mirrored to sessionStorage, so a reload in the same tab keeps it too. Storage may be unavailable: every
// access is guarded and the form works without it.
function loadDraft(): FormInput {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyForm();
    const d = JSON.parse(raw) as FormInput;
    if (!Array.isArray(d.milestones) || d.milestones.length < 1 || d.milestones.length > MAX_MILESTONES) return emptyForm();
    return d;
  } catch {
    return emptyForm();
  }
}

function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
      {hint && <p id={`${htmlFor}-hint`} className="text-micro text-ink-3">{hint}</p>}
      <div className="mt-1.5">{children}</div>
      {error && <p id={`${htmlFor}-error`} className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

function Duration({ id, value, unit, onChange, invalid, unitLabel }: { id: string; value: string; unit: Unit; onChange: (v: string, u: Unit) => void; invalid: boolean; unitLabel: string }) {
  return (
    <div className="flex gap-2">
      <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value, unit)} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : `${id}-hint`} className={`${input} min-w-0 flex-1`} placeholder="2" />
      <select aria-label={unitLabel} value={unit} onChange={(e) => onChange(value, e.target.value as Unit)} className={`${control} w-[7.5rem] shrink-0`}>
        {UNITS.map((u) => <option key={u}>{u}</option>)}
      </select>
    </div>
  );
}

/** Every error with the id of the field it belongs to, in form order (for the summary). */
function errorList(e: FormErrors, uid: string): [string, string][] {
  const out: [string, string][] = [];
  if (e.provider) out.push([`${uid}-provider`, `Provider: ${e.provider}`]);
  if (e.verifier) out.push([`${uid}-verifier`, `Verifier: ${e.verifier}`]);
  if (e.review) out.push([`${uid}-review`, `Review period: ${e.review}`]);
  e.milestones.forEach((m, i) => {
    if (m.amount) out.push([`${uid}-a${i}`, `Milestone ${i + 1} amount: ${m.amount}`]);
    if (m.deadline) out.push([`${uid}-d${i}`, `Milestone ${i + 1} deadline: ${m.deadline}`]);
    if (m.spec) out.push([`${uid}-s${i}`, `Milestone ${i + 1} specification: ${m.spec}`]);
  });
  return out;
}

/** Renders the empty form on the server, then remounts once in the browser with the saved draft (no hydration mismatch). */
export function CreateView() {
  const mounted = useMounted();
  return <CreateForm key={mounted ? "browser" : "server"} restore={mounted} />;
}

function CreateForm({ restore }: { restore: boolean }) {
  const uid = useId();
  const wallet = useWallet();
  const overview = useOverview();
  useActivity(); // warm the event history while the form is filled in
  const [form, setForm] = useState<FormInput>(() => (restore ? loadDraft() : emptyForm()));
  const [attempts, setAttempts] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);

  // Keep the saved copy in sync (browser only).
  useEffect(() => {
    if (!restore) return;
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      /* storage unavailable: the in-memory draft still survives connecting a wallet */
    }
  }, [form, restore]);

  // Validated live against the CONNECTED account: connecting as the provider or verifier shows the conflict.
  const result = validateCreate(form, wallet.address);
  const errors = result.ok ? null : result.errors;
  const shown = attempts > 0 ? errors : null;
  const list = shown ? errorList(shown, uid) : [];

  useEffect(() => {
    if (attempts > 0 && !result.ok) summaryRef.current?.focus();
    // focus only after an attempt, never on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts]);

  const set = (patch: Partial<FormInput>) => setForm((f) => ({ ...f, ...patch }));
  const setM = (i: number, patch: Partial<MilestoneInput>) => setForm((f) => ({ ...f, milestones: f.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const blockTime = overview.data?.blockTime;
  const total = form.milestones.reduce((s, m) => {
    const t = m.amount.trim();
    if (!/^\d+(\.\d{1,18})?$/.test(t)) return s;
    const [w, f = ""] = t.split(".");
    return s + BigInt(w!) * 10n ** 18n + BigInt(f.padEnd(18, "0"));
  }, 0n);
  const touchedAny = form.provider || form.verifier || form.milestones.some((m) => m.amount || m.every || m.spec);

  return (
    <>
      <PageHeader title="Create Agreement" lead="Lock test ETH for up to three milestones, each with its own amount, deadline and specification. Draft it without a wallet; you sign as the client." />

      <form noValidate onSubmit={(e) => e.preventDefault()} className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {list.length > 0 && (
            <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby={`${uid}-errs`} className="rounded-2xl border border-danger bg-danger-tint p-4 outline-none focus-visible:ring-2 focus-visible:ring-danger">
              <p id={`${uid}-errs`} className="font-semibold text-ink">Fix {list.length === 1 ? "1 field" : `${list.length} fields`} before signing</p>
              <ul className="mt-2 space-y-1 text-sm">
                {list.map(([id, msg]) => (
                  <li key={id}>
                    <a href={`#${id}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(id)?.focus(); }} className="text-ink underline decoration-danger underline-offset-2 hover:decoration-2">{msg}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <fieldset className="card space-y-5 p-5 sm:p-6">
            <legend className="sr-only">Parties and review period</legend>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-heading">Parties</h2>
              <p className="text-micro text-ink-3">Three different accounts</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Provider" hint="Delivers the work and claims the payout." error={shown?.provider} htmlFor={`${uid}-provider`}>
                <input id={`${uid}-provider`} value={form.provider} onChange={(e) => set({ provider: e.target.value })} spellCheck={false} autoComplete="off" aria-invalid={!!shown?.provider} aria-describedby={shown?.provider ? `${uid}-provider-error` : `${uid}-provider-hint`} className={`${input} text-data`} placeholder="0x…" />
              </Field>
              <Field label="Verifier" hint="Trusted third party. Decides; cannot move funds." error={shown?.verifier} htmlFor={`${uid}-verifier`}>
                <input id={`${uid}-verifier`} value={form.verifier} onChange={(e) => set({ verifier: e.target.value })} spellCheck={false} autoComplete="off" aria-invalid={!!shown?.verifier} aria-describedby={shown?.verifier ? `${uid}-verifier-error` : `${uid}-verifier-hint`} className={`${input} text-data`} placeholder="0x…" />
              </Field>
            </div>
            <div className="md:max-w-[calc(50%-0.625rem)]">
              <Field label="Review period" hint="The verifier can decide until each delivery deadline plus this period, wherever in the window the work arrives." error={shown?.review} htmlFor={`${uid}-review`}>
                <Duration id={`${uid}-review`} unitLabel="Review period unit" value={form.review} unit={form.reviewUnit} onChange={(v, u) => set({ review: v, reviewUnit: u })} invalid={!!shown?.review} />
              </Field>
            </div>
          </fieldset>

          {form.milestones.map((m, i) => {
            const e = shown?.milestones[i];
            const spec = commit(m.spec);
            return (
              <fieldset key={i} className="card space-y-5 p-5 sm:p-6">
                <legend className="sr-only">Milestone {i + 1}</legend>
                <div className="flex items-center justify-between">
                  <h2 className="text-heading">Milestone {i + 1}</h2>
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
                  <Field label="Deliver within" hint="Counted from when you press Create and sign. Time spent approving in MetaMask comes out of it." error={e?.deadline} htmlFor={`${uid}-d${i}`}>
                    <Duration id={`${uid}-d${i}`} unitLabel={`Milestone ${i + 1} deadline unit`} value={m.every} unit={m.unit} onChange={(v, u) => setM(i, { every: v, unit: u })} invalid={!!e?.deadline} />
                  </Field>
                </div>
                <Field label="Specification" hint="Plain text, or a 32-byte hash of your own document. Only its hash goes on-chain." error={e?.spec} htmlFor={`${uid}-s${i}`}>
                  <textarea id={`${uid}-s${i}`} rows={2} value={m.spec} onChange={(ev) => setM(i, { spec: ev.target.value })} aria-invalid={!!e?.spec} aria-describedby={e?.spec ? `${uid}-s${i}-error` : `${uid}-s${i}-hint`} className={`${input} h-auto py-2.5`} placeholder="Three logo concepts, delivered as a Figma link" />
                  {spec.ok && <p className="mt-1.5 text-micro text-ink-3">Committed as <span className="text-data text-[0.75rem]" title={spec.hex}>{spec.hex.slice(0, 18)}…{spec.hex.slice(-6)}</span> ({spec.from === "text" ? "keccak256 of the text" : "your hash"})</p>}
                </Field>
              </fieldset>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            {form.milestones.length < MAX_MILESTONES && (
              <Button variant="secondary" size="sm" onClick={() => set({ milestones: [...form.milestones, emptyMilestone()] })}>
                <Plus aria-hidden size={16} /> Add milestone
              </Button>
            )}
            {touchedAny && (
              <Button variant="quiet" size="sm" onClick={() => { setForm(emptyForm()); setAttempts(0); }}>Clear draft</Button>
            )}
          </div>
        </div>

        <aside aria-label="Summary" className="card space-y-4 p-5 lg:sticky lg:top-24">
          <h2 className="text-heading">Summary</h2>
          <div>
            <p className="text-sm text-ink-2">You lock</p>
            <p className="mt-1"><Amount wei={total} variant="numeral" /></p>
            <p className="mt-1 text-micro text-ink-3">The exact sum of the milestone amounts.</p>
          </div>
          <ol className="space-y-2 border-t border-line pt-4 text-sm">
            {form.milestones.map((m, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-ink-2">Milestone {i + 1}</span>
                <span className="text-data text-[0.875rem]">{/^\d+(\.\d{1,18})?$/.test(m.amount.trim()) ? m.amount.trim() : "…"} ETH</span>
              </li>
            ))}
          </ol>
          {blockTime !== undefined && result.ok && (
            <ul className="space-y-1.5 border-t border-line pt-4 text-micro text-ink-3">
              {result.draft.items.map((x, i) => (
                <li key={i}>Milestone {i + 1}, if you sign now: deliver by ≈ {formatUtc(blockTime + x.deliverIn)}, decision by ≈ {formatUtc(blockTime + x.deliverIn + result.draft.reviewPeriod)}</li>
              ))}
              <li>The exact deadlines are fixed when you press Create and sign, from the latest block&apos;s time. The contract stores them as given and never moves them, even if the transaction lands minutes later.</li>
            </ul>
          )}
          <CreateSubmit result={result} onAttempt={() => setAttempts((n) => n + 1)} total={total} />
        </aside>
      </form>
    </>
  );
}

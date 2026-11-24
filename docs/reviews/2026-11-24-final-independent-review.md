# Settlane final independent review (HEAD `deefab5`, `settlane/dev`, 2026-11-24)

Verdict at that commit: the contract and the read-only frontend were ready; the write frontend had one release blocker (M1) and two confirmed defects that falsified a D-036 guarantee (H3, H4). No defect could lose escrowed funds or pay a milestone twice (the contract pays once in every tested sequence). All four confirmed findings are fixed in the commit that follows (see D-036 and `docs/PROGRESS.md`).

| ID | Severity | Where (at `deefab5`) | Evidence | Fix |
|---|---|---|---|---|
| M1 | High | `tx-registry.ts` serialize, `tx-recovery.ts` rule 8 | A tab reloaded or closed during the pre-wallet "checking" phase stored a record without a baseline; every later check said "cannot prove", even for a Paid milestone, so the action stayed blocked (clearing site data was the only way out). | "checking" is never stored; old stored ones are released on load; ghosts kept. |
| H3 | Medium | `write.ts` dismiss | After a blocked claim to another payee, Dismiss deleted the entry with its earlier unresolved request, and the different payee then reached the wallet. | Dismiss keeps an entry that carries ghosts and only hides its status. |
| H4 | Medium | `write.ts` liveGhosts | An identical submit retry that mined was taken as proof the earlier request mined, so the earlier request and its warning were dropped and different evidence went out without consent. | The search skips hashes the later attempts sent (stored on the entry). Every accepted Submit raises the revision (LIFECYCLE T2), so both can land. |
| M3 | Low | `CreateSubmit.tsx` | The preflight `Promise.all` had no error handling. | `readCreatePreflight` returns a result; the panel shows an actionable message and keeps the draft. |

Downgraded or not reproduced from the 2026-11-23 audit: C1 (precompile payee, Low: needs a deliberately typed address), H1 and H2 (Low: millisecond window, deadlines come from the block time), M2 and M4 to M7 (Low, each needs an unusual node or sequence).

Not verified: real MetaMask after R1; history completeness under real pruning and reorgs; no write kill-switch exists.

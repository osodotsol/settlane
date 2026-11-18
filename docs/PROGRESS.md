# Progress

## Status
| Phase | State | Evidence |
| --- | --- | --- |
| 0 Audit and planning | **done, awaiting approval** | Docs and skills written. Starter `fe check`, `fe fmt --check`, `fe test` 3/3 pass (2026-11-17). |
| 1 Compiler feasibility | not started | — |
| 2–8 | not started | — |

## Milestone plan (times in Africa/Lagos; the internal target is Nov 20)
| Day | Phase | Acceptance criteria | Main risk | Fallback |
| --- | --- | --- | --- | --- |
| **Nov 17 (today)** | **Owner registers** by 00:59 Lagos on Nov 18 (23:59 UTC Nov 17) | Registration confirmation email received | Missed deadline means no entry | None. This deadline is firm. |
| Nov 18 AM | 1 Feasibility | E1–E9 each recorded pass or fail in `FE_NOTES.md`. D-009 decided. CI bumped (D-007). | E2, E3, or E4 fail | Field-per-map storage, `u8` states, raw-call actors |
| Nov 18 PM | 2 Agreement model | `rules.fe` and `Create` with validation. All creation tests from `SECURITY.md` pass. | ABI with many args | Fewer milestone params |
| Nov 19 | 3 Settlement and 4 Safety | T2–T7 implemented. I1–I10 tested. Reentrant and rejecting recipient tests pass. | Frozen-time coverage | Q5 option B |
| **Nov 20** | 5 Review and 6 Demo | Codex review done, confirmed findings fixed or logged. Demo test green. **Feature freeze.** | Review finds a critical issue | Cut scope, never safety |
| Nov 21–22 | 7 Docs | README from the `SUBMISSION.md` template. Diagram, limitations, disclosures. | — | — |
| Nov 23 | 8 Pre-submit | Public repo (owner-created), clean clone builds and tests, SHA recorded | Repo setup | — |
| Nov 24 | Buffer, then submit by 18:00 Lagos | Organizer acceptance email | — | Resubmission allowed before deadline |

## Log
- 2026-11-17: Phase 0. Branch `settlane/dev` created from `f9d9aa9`. Found that the harness has no caller or time cheatcodes, and that CI pins 26.5.0.

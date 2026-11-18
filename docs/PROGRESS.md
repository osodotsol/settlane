# Progress

## Status
| Phase | State | Evidence |
| --- | --- | --- |
| 0 Audit and planning | done, provisionally approved | Docs and skills written. Starter `fe check`, `fe fmt --check`, `fe test` 3/3 pass (2026-11-17). Commit pending a git identity. |
| 1 Compiler feasibility | done and committed (`3e91be5`, `a72bebd`); D-014 layout implemented | `experiments/phase1/run.sh` exit 0: 8 PASS (13 tests), 5 compile-errors as expected, 1 known gap (E7 read-only `call`). Root gate still 3/3. CI bumped to 26.6.0. |
| 2–8 | not started | — |

## Milestone plan (times in Africa/Lagos; the internal target is Nov 20)
| Day | Phase | Acceptance criteria | Main risk | Fallback |
| --- | --- | --- | --- | --- |
| **Nov 17 (today)** | **Owner registers** by 00:59 Lagos on Nov 18 (23:59 UTC Nov 17) | Registration confirmation email received | Missed deadline means no entry | None. This deadline is firm. |
| Nov 18 AM | 1 Feasibility | E1–E9 each recorded pass or fail in `FE_NOTES.md`. D-009 decided. CI bumped (D-007). | E2, E3, or E4 fail | Field-per-map storage, `u8` states, raw-call actors |
| Nov 18 PM | 2 Agreement model | `rules.fe` and `Create` with validation. All creation tests from `SECURITY.md` pass. | ABI with many args | Fewer milestone params |
| Nov 19 | 3 Settlement and 4 Safety | T2–T6 implemented (D-006b table). I1–I13 tested. Reentrant and rejecting recipient tests pass. | Frozen-time coverage | Q5 option B |
| **Nov 20** | 5 Review and 6 Demo | Codex review done, confirmed findings fixed or logged. Demo test green. **Feature freeze.** | Review finds a critical issue | Cut scope, never safety |
| Nov 21–22 | 7 Docs | README from the `SUBMISSION.md` template. Diagram, limitations, disclosures. | — | — |
| Nov 23 | 8 Pre-submit | Public repo (owner-created), clean clone builds and tests, SHA recorded | Repo setup | — |
| Nov 24 | Buffer, then submit by 18:00 Lagos | Organizer acceptance email | — | Resubmission allowed before deadline |

## Log
- 2026-11-17: Phase 0. Branch `settlane/dev` created from `f9d9aa9`. Found that the harness has no caller or time cheatcodes, and that CI pins 26.5.0.
- 2026-11-17: Phase 1. E1–E6, E8, and E9 pass. E7 is partial: a read-only `call` binding can still send ETH, which is a likely compiler bug. Recommendations D-005a, D-006b, D-009 (Clock effect, option A), D-011, D-012, D-013. Failed first attempts kept as comments in E2 and E6.
- 2026-11-17 (later): Owner reports the registration form was submitted. Confirmation email pending. Re-verified: `run.sh` exit 0 (same results), `fe check` and `fe fmt --check` clean, `fe test` 3/3, `fe build` wrote `out/Vault.{bin,runtime.bin,abi.json}` (gitignored). Commits are still blocked: no git identity is configured.
- 2026-11-17 (later still): E7 investigation. Read-only narrowing of built-in effects is enforced for fields, free functions, and user effects, but **not for `recv` arms** (`Call`, `Create`, `Log`). A read-only arm moved 1 ETH (`e7/j_runtime.fe`). Omission is enforced. Added I11, lint requirement, revised D-012, and softened the Fe-highlight claims. Codex is not installed, so the R-001 prompt in HANDOFF.md is ready for the owner. Commits still blocked on the owner's GitHub noreply email (not guessed).
- 2026-11-18: Owner provisionally approved D-005a, D-006b, D-009, D-011 and asked for a failing CI check on `call`/`create` in non-payout handlers. Done: `scripts/settlane_lint.py` (+ policy, 18 fixtures, self-test), wired into CI with the Phase 1 experiments. Negative controls found and fixed a fail-open bug (file or empty path scanned nothing and passed). Found that `fe build` emits test-file contracts, so the test clock shell is built too. LIFECYCLE rewritten to the D-006b semantics, with RA, DE and PC as explicit requirements. Codex not run. Codex not run. Commits still blocked on the noreply email.
- 2026-11-18 (later): Identity set (repo-local). Phase 0 committed as `2d90448`, Phase 1 as `3e91be5`. Fixed a lint bypass that compiles in Fe 26.6.0 (payout arm name reused on a second message type): arms are now qualified `Msg::Arm`, `E-DUP` added, 4 regression fixtures (the committed lint passed 2 of them). E10: a Fe workspace with a dev ingot keeps the test-clock shell out of the production `out/`; added lint rule `C-ARTIFACT`; proposed D-014 (needs owner approval, Phase 2 not started). Codex still not run.
- 2026-11-18 (D-014): Owner approved the workspace layout with 9 conditions. Implemented: `ingots/settlane` (production, starter moved unchanged by `git mv`) and `ingots/settlane-dev` (Actor helper + cross-ingot smoke test), `default-members` production only. Added `scripts/check_tests.py` (fails if any ingot ran no or too few tests; negative control: with the dev tests deleted, bare `fe test` still said `ok. 3 passed`), lint rules `C-LAYOUT`, strict `C-ARTIFACT` allowlist, widened `C-CLOCK`. Found and fixed a CI mistake of mine: a bare `fe fmt --check` at the workspace root errors, so CI uses `fe fmt --check ingots` (and my earlier probe misread that error as coverage). Phase 2 not started.

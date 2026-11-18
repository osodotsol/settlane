---
name: independent-review
description: Use when assigned an independent review of Settlane via docs/HANDOFF.md — spec, Fe code, tests, security invariants, or submission materials.
---

# Independent review (Codex)

1. Read the active assignment in `docs/HANDOFF.md`. Review only its scope at its commit.
2. Read `docs/LIFECYCLE.md` (spec) and `docs/SECURITY.md` (invariants I1–I10) before reading the code.
3. For code reviews, run `fe check`, `fe check ingots/settlane-dev` and `python3 scripts/check_tests.py`. For each transition-table row, find its guard in the code and the test that covers it. List any row with no test.
4. Try to break it: unauthorized callers, deadline boundaries (d-1, d, d+1), repeated calls, the other terminal path, a reverting or reentrant recipient, cross-agreement interference, overflow, zero values.
5. If you doubt a Fe construct, check it with `fe check` before reporting. Note confirmed compiler facts for `docs/FE_NOTES.md`.

## Finding format
`[severity] title — scenario (concrete inputs or sequence) — expected — actual or predicted — suggested fix or test`
Severity: critical (fund loss or lock), high (wrong settlement), medium, low, or note.

## Acceptance
The findings file exists at the path named in the assignment. Every finding is reproducible or explicitly marked as reasoning-only. No edits to `src/` unless allowed. No commits or pushes.

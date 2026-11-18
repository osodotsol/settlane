# Cross-agent handoff

Claude and Codex share no memory. This file plus the repo are the only shared context. Keep exactly one active assignment here, and move finished ones to the log at the bottom.

## Procedure
1. **Claude** finishes a milestone, runs the full gate, commits on `settlane/dev`, and fills in the assignment below (commit SHA, scope, criteria).
2. **Human** starts Codex in the same repo (or a `git worktree` at that SHA) with the prompt below. Codex is not installed in this WSL environment as of 2026-11-17, so the owner runs it wherever it is available.
3. **Codex** writes findings to `docs/reviews/<date>-<topic>.md`. It does not edit `src/` unless the assignment allows it.
4. **Claude** reproduces each finding, fixes the confirmed ones with a test, and marks each finding confirmed, rejected (with reason), or deferred.
5. Only one agent writes at a time. If work must run in parallel, use separate worktrees and branches.

## Ready-to-send Codex prompt
```
Read AGENTS.md, then docs/HANDOFF.md "Active assignment". Use the independent-review skill.
Review only the listed scope at the listed commit. Write findings to the file named there.
Do not modify src/ unless the assignment allows it. Do not commit or push.
```

## Active assignment
- **ID:** R-001 Phase 1 feasibility evidence and semantics proposals (this replaces R-000, which was never run)
- **Commit:** _(Phase 1 commit SHA, filled in once committed)_
- **Scope:** `experiments/phase1/**`, `scripts/settlane_lint.py`, `scripts/lint-policy.json`, `scripts/lint-fixtures/*`, `.github/workflows/ci.yml`, `docs/FE_NOTES.md`, `docs/LIFECYCLE.md`, `docs/SECURITY.md`, `docs/DECISIONS.md` D-005a, D-006b, D-009, D-011, D-012, D-013 (D-005a, D-006b, D-009 and D-011 are provisionally approved)
- **Status: NOT RUN.** Codex is not installed in this environment and has not reviewed anything. Findings files under `docs/reviews/` exist only if the owner runs Codex.
- **Edit permission:** you may add new files under `experiments/review/` and `scripts/lint-fixtures-review/` to reproduce a doubt. Do not edit any other file.
- **Questions:**
  1. Run `bash experiments/phase1/run.sh`. Does every line match FE_NOTES? Does any experiment prove less than FE_NOTES claims?
  2. E7: the Claude-side investigation is in FE_NOTES "E7 investigation" (arm-level read-only is not narrowed for `Call`, `Create`, `Log`; omission is enforced; raw opcodes are `pub(ingot)`). Try to falsify it: find any ETH-moving path reachable from a `recv` arm that omits both `call` and `create` (for example through a `Super` effect, a trait default method, `Address` helpers, or generics), and any case where a read-only listing is rejected that we recorded as accepted.
  3. E9 / D-009: can the test-clock shell's logic diverge from the production shell? What is the minimum shared code that makes divergence impossible?
  4. D-006b: find any (state, action, time) sequence where "reject = revision request" lets either party lose funds or extend the lock past `decide_by`.
  5. D-005a vs a permissionless refund: is there a scenario where R1 harms the provider?
  6. Lint: `python3 scripts/settlane_lint.py --selftest` and the policy. Write a Fe contract that **compiles** (`fe check --standalone`) yet moves ETH from a non-payout arm and passes the lint (try: multi-line or unusual `uses` formatting, `with` blocks, trait default methods, generics, macros, a payout arm name reused in another recv block, non-`Settlane` contract names). Each bypass is at least a high finding.
  7. Production clock (PC): any way for a user to influence `Clock.now` in `Settlane` that the `C-CLOCK` and `C-ABI` rules miss?
  8. Deadline enforcement (DE) and refund authorization (RA): do the tests named in `docs/LIFECYCLE.md` cover every boundary and unauthorized caller?
- **Acceptance:** each finding gives a severity, a concrete sequence, the expected and actual (or predicted) outcome, and a fix or test. Doubts about Fe behavior come with an `fe check` or `fe test` command and its output.
- **Output:** `docs/reviews/2026-11-18-phase1.md`

## Log
_(empty)_

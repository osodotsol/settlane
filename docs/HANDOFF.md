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
- **ID:** R-004 Phase 2B review (evidence submission, approval, evidence-matched rejection; no payouts yet)
- **Commit:** the Phase 2B commit on `settlane/dev` (see `git log -1`).
- **Status: RUN.** The owner requested implementation of the R-004 findings. The fixes bind reviews to submission revisions, add slot-2 coverage, check exact events and full revert reasons, and clarify the delivery boundary. Phase 3 remains out of scope.
- **Scope:** `ingots/settlane/src/*.fe` (`rules.fe` `check_submit` and `check_review`, `handlers.fe`, `settlane.fe`, `types.fe`), `ingots/settlane-dev/src/*.fe`, `scripts/*`, `docs/LIFECYCLE.md` (the T2 to T4 rows and the "Phase 2B" implementation notes), `docs/SECURITY.md` ("Phase 2B" coverage table), `docs/DECISIONS.md` D-015 and D-021.
- **Edit permission:** you may add new files under `experiments/review/` to reproduce a doubt. Do not edit any other file.
- **Questions:**
  1. Does every rule of T2, T3 and T4 in the lifecycle table hold, with no extra and no missing rule? Find a (state, caller, time, evidence) combination that is accepted but should be rejected, or the reverse.
  2. Immutability: can any transition after `Approved` change a stored field, or can any transition change amount, `deliver_by`, `decide_by` or `spec`?
  3. D-015: construct a race (a resubmission just before a `Reject` or `Approve`) in which the verifier acts on evidence it never saw. Is the evidence match complete for both actions?
  4. Role and window ordering: can an unauthorized caller learn the state of a milestone from a revert reason? Is the role-before-state order consistent for all three actions?
  5. Money: can any of the three transitions move, take or create ETH, or change `totalOutstanding` or any accounting? Is every arm non-payable in the ABI?
  6. The `rejections` counter: any way to overflow, reset or desynchronize it? Is its `u256` type a problem for the ABI or storage packing?
  7. Tests: is any assertion vacuous, or any reason assertion too loose (a substring that two different reasons share)? Run `python3 scripts/ci_negative_controls.py` and propose mutations the tests would miss.
  8. Events: do the three events carry enough to reconstruct the state machine? Can `scripts/check_events.py` pass on logs that violate the lifecycle?
- **Acceptance:** each finding gives a severity, a concrete sequence, the expected and actual (or predicted) outcome, and a fix or test. Doubts about Fe behavior come with an `fe check` or `fe test` command and its output.
- **Output:** `docs/reviews/2026-11-18-phase2b.md`

## Previous assignment (R-002 and R-003, done)
- **ID:** R-002 Phase 2A review (agreement creation, funding, queries; no transitions yet)
- **Commit:** the Phase 2A commit on `settlane/dev` (see `git log -1`).
- **Status: R-002 and R-003 were run by the owner with Codex, and their findings are fixed** (`docs/reviews/2026-11-18-phase2a.md`, `docs/reviews/2026-11-18-phase2a-r003.md`). The fixes of R-003 have not been re-reviewed (an R-004 would be that check). Original R-002 status: **RUN by the owner with Codex, findings fixed.** Codex is not installed in this environment, so I did not see the reviewer's own report: the five findings reached me in the owner's request and are recorded, reproduced and resolved in `docs/reviews/2026-11-18-phase2a.md`. The fixes have not been independently re-reviewed (an R-003 would be that check).
- **Scope:** `ingots/settlane/src/*.fe`, `ingots/settlane-dev/src/*.fe`, `scripts/*` (lint, policy, test gate, negative controls), `docs/LIFECYCLE.md` ("Creation validation" and its implementation notes), `docs/SECURITY.md` ("Phase 2A coverage"), `docs/DECISIONS.md` D-016, D-017, D-018.
- **Edit permission:** you may add new files under `experiments/review/` to reproduce a doubt. Do not edit any other file.
- **Questions:**
  1. Does `rules::check_create` implement "Creation validation" exactly: no rule missing, extra, or in a different order? Find an input that should be rejected but is accepted (multi-fault inputs, unusual `n` and slot combinations, equal addresses, zero values).
  2. Funding: can a call succeed with `msg.value != Σ amounts[0..n]`, or can ETH end up held with no agreement? `Settlane` has no `receive` or `fallback`. What do forced ETH (selfdestruct, coinbase) and `evm.balance == outstanding` (I9) imply?
  3. `Settlane` declares no `Call` or `Create`. Find any way for it to send ETH, or to emit anything other than the one event.
  4. Storage: can two agreements or two milestones collide (tuple key `(id, m)`, the 26.6 packed layout of `Agreement` and `Milestone`, id 0)? Can a field of one struct overlap another?
  5. D-016: diff the `SettlaneTestClock` arms against the `Settlane` arms. Is anything other than the `Clock` source different? Can the shell hide a bug the production contract has?
  6. Production clock and deadlines (PC, DE, I12, I13): any way for a user to influence `Clock.now`, or to change a stored deadline after creation? Try to bypass the exact ABI allowlist (lint `C-ABI`).
  7. Tests: is any assertion vacuous, or any negative test missing its positive control? Run `python3 scripts/ci_negative_controls.py` and propose mutations the tests would miss.
  8. Anything in `docs/SECURITY.md` "Phase 2A coverage" that overclaims?
- **Acceptance:** each finding gives a severity, a concrete sequence, the expected and actual (or predicted) outcome, and a fix or test. Doubts about Fe behavior come with an `fe check` or `fe test` command and its output.
- **Output:** `docs/reviews/2026-11-18-phase2a.md`

## Previous assignment (never run)
- **ID:** R-001 Phase 1 feasibility evidence and semantics proposals (this replaces R-000, which was never run)
- **Commit:** the D-014 commit on `settlane/dev` (see `git log -1`); the Phase 1 base is `3e91be5` and the lint fix is `a72bebd`.
- **Scope:** `experiments/phase1/**`, `fe.toml`, `ingots/**`, `scripts/settlane_lint.py`, `scripts/lint-policy.json`, `scripts/lint-fixtures/*`, `scripts/check_tests.py`, `scripts/test-policy.json`, `.github/workflows/ci.yml`, `docs/FE_NOTES.md`, `docs/LIFECYCLE.md`, `docs/SECURITY.md`, `docs/DECISIONS.md` D-005a, D-006b, D-009, D-011, D-012, D-013 (D-005a, D-006b, D-009 and D-011 are provisionally approved)
- **Status: NOT RUN.** Codex is not installed in this environment and has not reviewed anything. Findings files under `docs/reviews/` exist only if the owner runs Codex.
- **Edit permission:** you may add new files under `experiments/review/` and `scripts/lint-fixtures-review/` to reproduce a doubt. Do not edit any other file.
- **Questions:**
  1. Run `bash experiments/phase1/run.sh`. Does every line match FE_NOTES? Does any experiment prove less than FE_NOTES claims?
  2. E7: the Claude-side investigation is in FE_NOTES "E7 investigation" (arm-level read-only is not narrowed for `Call`, `Create`, `Log`; omission is enforced; raw opcodes are `pub(ingot)`). Try to falsify it: find any ETH-moving path reachable from a `recv` arm that omits both `call` and `create` (for example through a `Super` effect, a trait default method, `Address` helpers, or generics), and any case where a read-only listing is rejected that we recorded as accepted.
  3. E9 / D-009: can the test-clock shell's logic diverge from the production shell? What is the minimum shared code that makes divergence impossible?
  4. D-006b: find any (state, action, time) sequence where "reject = revision request" lets either party lose funds or extend the lock past `decide_by`.
  5. D-005a vs a permissionless refund: is there a scenario where R1 harms the provider?
  6. Lint: `python3 scripts/settlane_lint.py --selftest` and the policy. Write a Fe contract that **compiles** (`fe check --standalone`) yet moves ETH from a non-payout arm and passes the lint (try: multi-line or unusual `uses` formatting, `with` blocks, trait default methods, generics, macros, non-`Settlane` contract names, `recv` blocks with unusual headers). The reused-payout-name bypass was found by Claude and fixed on 2026-11-18 (`E-DUP`, qualified `Msg::Arm` names), so find a different shape. Each bypass is at least a high finding.
  7. Production clock (PC): any way for a user to influence `Clock.now` in `Settlane` that the `C-CLOCK` and `C-ABI` rules miss?
  8. Deadline enforcement (DE) and refund authorization (RA): do the tests named in `docs/LIFECYCLE.md` cover every boundary and unauthorized caller?
  9. D-014 is implemented. Can a dev-ingot contract reach the production `out/` (try every `fe build` form, `--emit`, `-i`, the workspace root, a stale `out/` left from an earlier build)? Does `C-ARTIFACT`/`C-LAYOUT` miss any case? Does `scripts/check_tests.py` have a false-green path (a test count that parses but did not run, an ingot renamed in the manifest, a floor that can be lowered silently)? Is any CI step a false green or a false failure on Fe 26.6.0?
- **Acceptance:** each finding gives a severity, a concrete sequence, the expected and actual (or predicted) outcome, and a fix or test. Doubts about Fe behavior come with an `fe check` or `fe test` command and its output.
- **Output:** `docs/reviews/2026-11-18-phase1.md`

## Log
- 2026-11-18: A Claude-side review (not R-001) was run at the owner's request: `docs/reviews/2026-11-18-phase1.md`. H1–H4, M1 and M2 are fixed with regression tests. For R-001 Q6, the bypass shapes already found (qualified or aliased `Call`, lowercase arm, `RawStorage`, shadowed `ctx`, Clock alias) are now fixtures, so look for different ones. R-001 itself is still not run.

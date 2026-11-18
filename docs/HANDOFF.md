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
- **ID:** R-000 Phase 0 architecture review (optional, recommended before Phase 2)
- **Commit:** _(fill in after the owner approves and Phase 0 is committed)_
- **Scope:** `docs/LIFECYCLE.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/FE_NOTES.md`
- **Questions:** Are there missing or ambiguous transitions? Are the race guards truly disjoint? Are the invariants sufficient? Is any Fe assumption unsupported?
- **Acceptance:** Each finding has a severity, a concrete scenario, and a suggested spec change.
- **Output:** `docs/reviews/2026-11-17-architecture.md`

## Log
_(empty)_

# Settlane — Claude Code instructions

Settlane is a Fe 26.6 EVM contract for milestone-based settlement of digital-service agreements. Entry for the Fe Builders Challenge 2026 (submissions close 2026-11-24 23:59 UTC).

## Core rules
- Fe only for the core. No Rust application code, NEAR, mainnet, real funds, or paid infrastructure.
- Verify Fe syntax against the compiler, never Solidity/Rust intuition. Confirmed facts and open questions live in `docs/FE_NOTES.md`; add to it when you learn something.
- The settlement rules in `docs/LIFECYCLE.md` are the spec. Do not add transitions that are not listed there. Change the spec only through `docs/DECISIONS.md` with human approval.
- Do not call code done until the full gate in Commands passes (format, check for both ingots, tests for both ingots, build, policy lint). Report failures as they are.
- **Layout (D-014).** Production code lives only in `ingots/settlane`. Test helpers, Actor contracts and deadline-crossing tests live in `ingots/settlane-dev`. `default-members` stays production-only. Never define a test-only contract in the production ingot, and never add the dev ingot to `default-members`: the lint and CI fail on both.
- Production selectors must be `sol(..)`, the identifier `Clock` has four permitted uses only, and `Create` validates stage by stage in LIFECYCLE order before any write (D-019). The accounting invariant is `balance >= outstanding`, never `==`. The ABI lock covers output types and order. Every event test needs an independent caller (`CallerProbe` or `Acted`). Transitions check agreement, then role, then milestone, state, window, evidence (LIFECYCLE Phase 2B notes), and every negative test asserts its revert reason (`because(..)`), never only that the call failed.
- Only the `Claim` and `Refund` arms may mention `call` or `create` (Fe does not narrow read-only listings, FE_NOTES E7). The production clock is `ctx.timestamp()` only. The test-clock shell is built by `fe build` but is never the deployable. If you add a payout arm, update `scripts/lint-policy.json` in the same change and say so.
- Never claim the system is trustless or secure. The verifier is a trusted party.
- Work on `settlane/dev`. Never push, force-push, rename the workspace, or create remotes without human approval. The `origin` remote is the organizers' starter repo, so do not push to it.
- No secrets, keys, project IDs, or submission links in tracked files.

## Commands
```sh
fe fmt --check ingots                   # both ingots (a bare `fe fmt --check` at the root errors)
fe check && fe check ingots/settlane-dev  # root check sees the production ingot only
python3 scripts/check_tests.py          # fe test for BOTH ingots, fails if too few or no tests ran
python3 scripts/check_events.py         # fe test --show-logs: decodes every AgreementCreated and checks its client against the real caller
rm -rf out && fe build                  # production ingot only; `fe build` never clears out/ (gitignored)
python3 scripts/settlane_lint.py ingots --abi-dir out   # policy lint; fails on any violation
python3 scripts/settlane_lint.py --selftest             # lint self-test (59 fixtures, 45 unit checks)
python3 scripts/check_tests.py --selftest               # test-gate self-test (10 cases)
python3 scripts/check_events.py --selftest              # event-checker self-test (89 cases, each negative asserts its reason); python3 scripts/keccak.py checks Keccak-256
python3 scripts/ci_negative_controls.py # proves CI FAILS for each D-014 mistake, review finding and broken lifecycle rule (local, ~50 min, 92 controls, needs PyYAML); --dry-run checks every mutation still applies
bash experiments/review/run.sh          # review 2026-11-18 repros still reproduce and the lint rejects them
bash experiments/phase1/run.sh          # Phase 1 compiler experiments (remove before submission)
fe test ingots/settlane-dev             # focused run of one ingot
```

## Where things are
- Workspace: `fe.toml` (root), `ingots/settlane` (production), `ingots/settlane-dev` (dev). Policy: `scripts/lint-policy.json`, `scripts/test-policy.json`.
- Product and scope: `docs/PRODUCT.md`. Design: `docs/ARCHITECTURE.md`. States: `docs/LIFECYCLE.md`.
- Security and test acceptance criteria: `docs/SECURITY.md`.
- Status: `docs/PROGRESS.md`. Cross-agent work: `docs/HANDOFF.md`. Decisions: `docs/DECISIONS.md`.
- Skills: `fe-implementation` (writing or testing Fe), `contract-security` (payout, refund, or authorization code), `submission-review` (Phase 7–8).

## Working style
Read only the files the task needs. Keep each milestone small, run focused tests while working and the full gate at milestone boundaries, then update `docs/PROGRESS.md`. Stop for human approval at every phase boundary.

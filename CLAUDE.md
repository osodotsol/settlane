# Settlane — Claude Code instructions

Settlane is a Fe 26.6 EVM contract for milestone-based settlement of digital-service agreements. Entry for the Fe Builders Challenge 2026 (submissions close 2026-11-24 23:59 UTC).

## Core rules
- Fe only for the core. No Rust application code, NEAR, mainnet, real funds, or paid infrastructure.
- Verify Fe syntax against the compiler, never Solidity/Rust intuition. Confirmed facts and open questions live in `docs/FE_NOTES.md`; add to it when you learn something.
- The settlement rules in `docs/LIFECYCLE.md` are the spec. Do not add transitions that are not listed there. Change the spec only through `docs/DECISIONS.md` with human approval.
- Do not call code done until `fe check`, `fe fmt --check`, and `fe test` pass. Report failures as they are.
- Never claim the system is trustless or secure. The verifier is a trusted party.
- Work on `settlane/dev`. Never push, force-push, rename the workspace, or create remotes without human approval. The `origin` remote is the organizers' starter repo, so do not push to it.
- No secrets, keys, project IDs, or submission links in tracked files.

## Commands
```sh
fe check && fe fmt --check && fe test   # gate before every commit
fe test src/<file>.fe                    # focused run
fe build                                 # artifacts go to out/ (gitignored)
```

## Where things are
- Product and scope: `docs/PRODUCT.md`. Design: `docs/ARCHITECTURE.md`. States: `docs/LIFECYCLE.md`.
- Security and test acceptance criteria: `docs/SECURITY.md`.
- Status: `docs/PROGRESS.md`. Cross-agent work: `docs/HANDOFF.md`. Decisions: `docs/DECISIONS.md`.
- Skills: `fe-implementation` (writing or testing Fe), `contract-security` (payout, refund, or authorization code), `submission-review` (Phase 7–8).

## Working style
Read only the files the task needs. Keep each milestone small, run focused tests while working and the full gate at milestone boundaries, then update `docs/PROGRESS.md`. Stop for human approval at every phase boundary.

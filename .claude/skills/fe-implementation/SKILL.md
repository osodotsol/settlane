---
name: fe-implementation
description: Use when writing, modifying, or testing Fe (.fe) code in Settlane, including compiler experiments and fixing Fe compiler errors.
---

# Fe implementation and testing

1. Before writing Fe, check `docs/FE_NOTES.md` for confirmed syntax and APIs. Copy patterns from the existing compiling code in `src/` rather than from memory.
2. If a construct is not in FE_NOTES, write the smallest experiment, run `fe check` on it, and record the pass or fail result in FE_NOTES. Do not guess Solidity or Rust syntax.
3. Keep settlement rules in effect-free functions (`rules.fe`) that take `now` as an argument. Handlers should declare only the effects and fields they need. Only `Claim` and `Refund` may use `mut call`.
4. Every transition you implement must be a row in `docs/LIFECYCLE.md`. If you need a new one, stop and propose it in `docs/DECISIONS.md`.

## Tests
- Pure rules: plain `#[test] fn` with no `uses`. Cover boundary times d-1, d, and d+1.
- Integration: `uses (evm: mut Evm)` with `#[test(balance = ...)]` for funding. The test contract is the client. Provider, verifier, and stranger are Actor contracts, because there is no caller impersonation.
- Negative cases: `assert!(!evm.try_call(...).success())`, then check that state is unchanged. Use `#[test(should_revert)]` or `panic = 0x11` when a single revert is the point.
- Call the accounting invariant helper after every state-changing step.

## Acceptance
`fe check && fe fmt --check && fe test` all pass. New behavior has positive and negative tests. FE_NOTES is updated with anything newly learned.

---
name: fe-implementation
description: Use when writing, modifying, or testing Fe (.fe) code in Settlane, including compiler experiments and fixing Fe compiler errors.
---

# Fe implementation and testing

1. Before writing Fe, check `docs/FE_NOTES.md` for confirmed syntax and APIs. Copy patterns from the existing compiling code in `ingots/*/src/` rather than from memory.
2. If a construct is not in FE_NOTES, write the smallest experiment, run `fe check` on it, and record the pass or fail result in FE_NOTES. Do not guess Solidity or Rust syntax.
3. Keep settlement rules in effect-free functions (`rules.fe`) that take `now` as an argument. Put each arm's body in a shared `pub fn` handler in the production ingot that takes its fields and effects plus `clock: Clock`; arms only provide the Clock and call it (D-016). Handlers should declare only the effects and fields they need. Only `Claim` and `Refund` may list `call` at all. A read-only `uses (call)` still sends ETH (FE_NOTES E7). Never use `unsafe`, raw storage, type aliases of effects or Clock, or a binding named `ctx` other than the Ctx effect in the production ingot (lint).
4. Every transition you implement must be a row in `docs/LIFECYCLE.md`. If you need a new one, stop and propose it in `docs/DECISIONS.md`.

## Tests
- Pure rules: plain `#[test] fn` with no `uses`. Cover boundary times d-1, d, and d+1.
- Integration: `uses (evm: mut Evm)` with `#[test(balance = ...)]` for funding. The test contract is the client. Provider, verifier, and stranger are Actor contracts, because there is no caller impersonation.
- Negative cases: set up with plain `evm.call` (it must succeed), check a positive control, then `assert!(!evm.try_call(...).success())` and check that state is unchanged. A bare `#[test(should_revert)]` passes on any revert, including the setup's (review M2), so the lint rejects it; `should_revert, panic = 0x11` is allowed when a specific panic is the point.
- Call the accounting invariant helper after every state-changing step.

## Acceptance
`fe fmt --check ingots`, `fe check` (root and `ingots/settlane-dev`), `python3 scripts/check_tests.py`, `fe build` and the policy lint all pass. Put tests that need to cross a deadline or use another caller in `ingots/settlane-dev`, everything else in the production ingot. New behavior has positive and negative tests. FE_NOTES is updated with anything newly learned.

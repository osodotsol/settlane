---
name: contract-security
description: Use when adding or changing Settlane code that moves ETH, changes milestone state, checks authorization or deadlines, or updates accounting counters; and before closing Phases 3–5.
---

# Contract security checklist

Check each item against the diff, and cite the test that covers it (`docs/SECURITY.md` invariant IDs).

- [ ] Caller check comes first, and it is the right role (I5).
- [ ] `python3 scripts/settlane_lint.py src --abi-dir out` passes (run `fe build` first). Do not edit `scripts/lint-policy.json` to make it pass without a DECISIONS entry.
- [ ] Only `Claim` and `Refund` list `call` in `uses`. A read-only `uses (call)` **still sends ETH** (FE_NOTES E7), so omission is the only guarantee.
- [ ] The state guard matches the `docs/LIFECYCLE.md` row exactly. Unlisted states revert.
- [ ] Time guards use `rules.fe` predicates: strict `<` for "open", `>=` for "expired" (I10).
- [ ] State and counters are written **before** `send_value`. `assert!(outcome.success())` comes after it (I7).
- [ ] `to != 0`. The amount is read from storage, never from calldata.
- [ ] Conservation is updated symmetrically: `paid` or `refunded` goes up by exactly the amount that `outstanding` goes down (I1, I9).
- [ ] No storage key omits `agreement_id` (I8).
- [ ] A repeat call reverts (I4). The other terminal path reverts (I3).
- [ ] Arithmetic is checked, or the overflow test exists.
- [ ] A reentrant-recipient test exists for any new transfer path.
- [ ] Docs make no "secure" or "trustless" claims.

## Acceptance
Every item is ticked with a test name, or recorded as an open item in `docs/PROGRESS.md`. Never suppress a failing test.

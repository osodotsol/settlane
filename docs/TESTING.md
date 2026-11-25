# Testing and reproducibility

Settlane is tested at seven layers. They answer different questions, so their counts are reported separately and never added together.

All results below were measured on the code at commit `f72f249` (the release-acceptance commit) unless stated otherwise. The documentation release commit after it changes only documentation, two ignore files, and one screen-reader label on the Developers page. Toolchain: `fe 26.6.0 (5b3f96a)`, Node.js 22, Python 3, Foundry/Anvil v1.10.0.

## Summary

| Layer | Command | Result | Kind |
| --- | --- | --- | --- |
| Fe contract tests | `python3 scripts/check_tests.py` | **90 passed, 0 failed** (43 production ingot, 47 test-clock ingot) | Real EVM, Fe test runner |
| Event checker | `python3 scripts/check_events.py` | every `AgreementCreated` decoded and checked against the real caller | Fe test logs |
| Policy lint | `python3 scripts/settlane_lint.py ingots --abi-dir out` | pass; self-test 90 fixtures, 47 unit checks | Static |
| Local chain | `python3 experiments/anvil/run.py --mutations` | 52 checks + 8 wrong-clock mutations caught | Production bytecode on Anvil |
| Frontend unit | `cd frontend && npm test` | **254 passed, 2 skipped** (the 2 are opt-in live Sepolia tests) | Vitest |
| Frontend static | `npm run check-abi && npm run lint && npm run typecheck && npm run build` | all pass | |
| Browser, simulated wallet | `npm run e2e -- app` | 26 tests; run 3 times in one invocation (`E2E_REPEAT=3`): **78/78 runs passed** | Playwright + Anvil |
| Browser, local chain | `npm run e2e -- anvil` | 5/5 | Playwright + Anvil |
| Browser, read-only Sepolia | `npm run e2e -- sepolia` | 34 tests: 33 passed, then the 1 fixed failure 4/4 in its group (see note) | Playwright + live Sepolia |
| Browser, hanging RPC | `npm run e2e -- hang` | 3/3 | Every endpoint is a socket that never answers |
| Browser, partial outage | `npm run e2e -- outage` | 2/2 | A pruning node, a dead node, a healthy node |
| Hosted CI | `.github/workflows/ci.yml` | [run 45513395947](https://github.com/osodotsol/settlane/actions/runs/45513395947): `test`, `anvil`, `frontend`, `release-gate` all green on `main` | GitHub Actions |

**Note on the Sepolia suite.** It was 30/30 at `5343ee7`. The release-acceptance commit `f72f249` added four tests: external links open in a new tab and say so, How It Works scroll position, and 320 px and 390 px layouts. A full run on 2026-11-25 passed 33 of 34. The failure was a genuine defect: the Developers page's deployment-transaction link opened a new tab without saying so. It was fixed in the documentation release commit, and the four acceptance tests then passed 4/4. This suite reads public Sepolia nodes, so a failure can also mean a node is down: check the log for `fetch failed` before treating it as a defect.

The simulated-wallet count is 26 distinct tests. 78 is the number of executions across three repetitions, each starting from the same snapshot of the local chain.

## What the Fe tests establish

The tests use real EVM calls. Separate actor contracts act as client, provider, verifier and strangers, because Fe has no caller impersonation. All test names below are in [`ingots/settlane-dev/src/tests.fe`](../ingots/settlane-dev/src/tests.fe) unless noted.

| Property | Tests |
| --- | --- |
| Only the right role can act | `only_the_provider_submits_and_only_the_verifier_reviews`, `only_the_provider_may_claim_and_only_an_approved_milestone_to_a_nonzero_payee`, `only_the_client_may_refund_and_only_an_expired_unpaid_milestone_to_a_nonzero_payee`, `roles_are_looked_up_per_agreement_when_addresses_swap_roles` |
| Invalid transitions revert; approved is final | `replays_and_invalid_transitions_are_rejected_and_an_approved_milestone_never_changes`, `an_approved_milestone_stays_immutable_through_every_deadline` |
| Approval is tied to the exact evidence and revision | `evidence_must_match_and_stale_evidence_can_neither_be_approved_nor_rejected`, `restored_and_identical_evidence_require_a_fresh_review_revision`, `evidence_and_revision_cannot_be_replayed_across_milestones_or_agreements` |
| Deadlines hold to the second | `the_delivery_window_closes_exactly_at_deliver_by`, `the_review_window_closes_exactly_at_decide_by_and_a_late_submission_keeps_it_whole`, `refund_boundaries_hold_at_d_minus_1_d_and_d_plus_1_in_every_slot_and_state`, `third_slot_revision_lifecycle_at_both_deadlines` |
| Paid and refunded exclude each other; each pays once | `the_client_refunds_expired_milestones_once_and_claim_and_refund_exclude_each_other`, `the_provider_claims_an_approved_milestone_and_is_paid_the_stored_amount_once` |
| Accounting balances | `one_agreement_settled_three_ways_books_every_wei_to_the_right_counter`, `refunds_belong_to_each_agreements_client_and_accounting_holds_across_claims_and_refunds`, `agreements_are_isolated_and_milestones_are_independent` |
| Only payouts move ETH | `verification_steps_never_move_eth_even_when_every_party_can_receive_it`, `transitions_are_not_payable_and_never_move_money`, `claim_is_not_payable`, `refund_is_not_payable_on_production_or_the_shell` |
| Reentrancy and failed transfers | `a_reentrant_provider_is_paid_exactly_once`, `a_provider_that_always_re_enters_is_never_paid_under_the_stipend_and_never_twice`, `a_client_that_always_re_enters_is_never_refunded_under_the_stipend_and_never_twice`, two cross-agreement reentrancy tests, `a_failed_transfer_reverts_the_whole_claim_and_a_retry_to_another_payee_succeeds` |
| The test clock matches production | `shell_and_production_agree_when_their_clocks_agree`, `shell_and_production_agree_on_every_step_of_a_transition_script`, `production_has_no_way_to_set_its_clock` |
| Edge values | `a_wide_n_is_rejected_at_decode_and_never_truncated`, `a_full_lifecycle_works_with_decide_by_at_the_top_of_time` |

Invariant-to-test mapping: [`docs/SECURITY.md`](SECURITY.md).

## What the frontend tests establish

- **Lifecycle display matches the contract.** [`lifecycle.test.ts`](../frontend/tests/lifecycle.test.ts) tests the display predicates at d−1, d and d+1. [`reasons.test.ts`](../frontend/tests/reasons.test.ts) checks that every revert reason in `handlers.fe` has user-facing text.
- **Wallet failure recovery.** A declined signature, a lost or reloaded request, an unknown outcome, a replaced transaction, and a create held until the chain settles it. The simulated-wallet browser suite ([`e2e/app.spec.ts`](../frontend/e2e/app.spec.ts)) and the recovery unit tests ([`r2b-recovery.test.ts`](../frontend/tests/r2b-recovery.test.ts), [`r2c-repro.test.ts`](../frontend/tests/r2c-repro.test.ts), [`residual-fixes.test.ts`](../frontend/tests/residual-fixes.test.ts)) cover these.
- **Duplicate-action safeguards.** The same action cannot be requested twice while a request may be open, across reloads and across browser tabs (Web Locks).
- **History is honest.** The event history is a verified snapshot plus a live scan. It reports "complete" only when the events match the contract's state ([`history-engine.test.ts`](../frontend/tests/history-engine.test.ts), [`snapshot-integrity.test.ts`](../frontend/tests/snapshot-integrity.test.ts)).
- **RPC failure.** [`hang.spec.ts`](../frontend/e2e/hang.spec.ts) checks that pages answer within their time budget when every node hangs. [`outage.spec.ts`](../frontend/e2e/outage.spec.ts) checks that history stays complete, and does not wait on a dead node again, when one node prunes old logs and another hangs. [`adaptive-transport.test.ts`](../frontend/tests/adaptive-transport.test.ts) unit-tests the hedged, health-aware log transport.
- **Accessibility and layout.** Axe (WCAG 2.2 AA) on every page, and no horizontal overflow at 320, 360, 390, 430, 768, 1024 and 1440 px ([`sepolia.spec.ts`](../frontend/e2e/sepolia.spec.ts)).

## Reproduce

```sh
# Fe toolchain: exactly 26.6.0
fe --version                                  # fe 26.6.0 (5b3f96a)

# contract
fe fmt --check ingots
fe check && fe check ingots/settlane-dev
python3 scripts/check_tests.py                # both ingots; fails if fewer tests ran than expected
python3 scripts/check_events.py
rm -rf out && fe build
python3 scripts/settlane_lint.py ingots --abi-dir out
python3 scripts/settlane_lint.py --selftest

# production bytecode on a local chain (installs Anvil v1.10.0 outside the repo, pinned SHA-256)
bash experiments/anvil/install_foundry.sh
python3 experiments/anvil/run.py --mutations

# frontend (Node 22)
cd frontend
npm ci
npm run check                                 # ABI sync, lint, typecheck, unit tests, build
npx playwright install chromium-headless-shell
npm run e2e                                   # sepolia, anvil, app, hang, outage (needs Anvil)
```

`npm run e2e -- <suite>` runs one suite. `E2E_REPEAT=3 npm run e2e -- app` repeats the simulated-wallet suite from a clean chain snapshot each time. Nothing in any test sends to a public network.

Proof that the gates fail when they should: `python3 scripts/ci_negative_controls.py` applies 142 known mistakes, each of which must make CI fail. It takes about 2 hours and needs PyYAML.

# Security model and test acceptance criteria

Settlane is an unaudited hackathon prototype for simulated ETH only. Passing tests does not make it secure.

## Trust assumptions
- **Verifier.** Trusted to approve or reject honestly. It can wrongly reject (the client is refunded) or wrongly approve (the provider is paid). It cannot move funds or change parties. A provider and verifier controlled by one person behind two addresses defeats the system, and Settlane cannot detect this. The same attack is documented against ERC-8183.
- **Timestamp.** Block producers can skew it by a few seconds near a deadline.
- **Off-chain artifacts.** `spec` and `evidence` are commitments. Settlane does not check the content.

## Lost keys lock funds permanently (review S-3)
Settlane has no admin, owner, sweep, or recovery path, by design. The consequences:
- **Approved milestone, provider key lost.** `Approved` never expires and only the stored provider can `Claim`. The amount stays locked in the contract forever. The client cannot recover it, because refunding an approved milestone is forbidden (RA).
- **Expired milestone, client key lost.** Only the stored client can `Refund`. The amount stays locked forever. The provider cannot claim it, because it was never approved.
- **Client is a contract that cannot issue `Refund`.** A factory, a multisig without arbitrary calls, or any contract with no code path to call Settlane locks every refundable milestone it funds. Choosing `to` (RA) helps only if the client can make the call at all.
- **Provider or client is a contract that cannot receive a 2300-gas send.** This does not lock funds, because the caller picks `to` (D-004, D-005a).
These locked amounts stay in `outstanding`, so I1 and I9 still hold. Parties should use keys they control and can back up, and an EOA or a contract able to call `Claim`/`Refund`. The README must state this limitation.

## Invariants (each must have at least one test)
| ID | Invariant |
| --- | --- |
| I1 Conservation | Per agreement, `deposited == paid + refunded + outstanding` after every transition. |
| I2 Allocation | `deposited == Σ amount_i`, and every used milestone has `amount > 0`. |
| I3 Exclusive settlement | A milestone ends in exactly one of `Paid` or `Refunded`. Neither can be reached after the other. |
| I4 No double payment | A second `Claim` or `Refund` on a milestone reverts and leaves balances unchanged. |
| I5 Authorization | Only the provider can Submit or Claim, only the verifier can Approve or Reject, and only the client can Refund. Every other caller is rejected. |
| I6 No premature refund | `Refund` succeeds only when the milestone is `expired` (`docs/LIFECYCLE.md`), by the stored client, with `to != 0` and the amount read from storage (RA). |
| I7 Transfer honesty | A failed send leaves state and counters exactly as they were before the call. |
| I8 Isolation | Actions on agreement A never change agreement B's state, counters, or parties. |
| I9 Solvency | `selfbalance >= total_outstanding == Σ outstanding`. |
| I10 Race exclusivity | At every `now`, at most one of {Approve or Reject, Refund} is permitted for a `Submitted` milestone, and at most one of {Submit, Refund} for a `Funded` one. |
| I11 Balance-neutral verification | `Create`, `Submit`, `Approve`, and `Reject` never change `selfbalance`, except that `Create` adds exactly `msg.value`. Needed because the compiler cannot enforce read-only `call` in contract arms (FE_NOTES E7). Backed by CI lint rules `E-CALL`/`E-BODY`/`E-EFFECT`/`E-UNSAFE`: the privileged effects (`Call`, `Create`, `Super`, `Evm`, `RawStorage`, `RawOps`) may appear only in `Claim` and `Refund`, and `unsafe` not at all. A balance check cannot detect a raw storage write (review H3), so the lint is the guard for that. |
| I12 Production clock | In `Settlane`, time is only `ctx.timestamp()`. No setter, argument, storage, or admin path can alter it (PC). Backed by lint rules `C-CLOCK` and `C-ABI` plus a runtime test. |
| I13 Immutable deadlines | No function changes `deliver_by`, `decide_by`, or the review period after creation (DE). |

## Required test categories
- **Creation.** Zero amounts, n = 0 and n = 4, value ±1 wei, nonzero data in unused slots, sum overflow, zero parties, every pair among client, provider, and verifier equal (D-011), `deliver_by <= now`, zero review period.
- **Every row of the `docs/LIFECYCLE.md` table** with the authorized caller, one unauthorized caller (a third actor), and the boundary times d-1, d, and d+1, through rule tests and integration tests where time allows.
- **Every illegal (state, action) pair** reverts.
- **Repeats:** double claim, double refund, refund after claim, claim after refund.
- **Transfers:** a rejecting recipient (I7), `to == 0`, `to == ctx.address()` (review L-1), and a reentrant recipient that calls back into `Claim` or `Refund`.
- **Evidence binding (D-015):** `Reject` and `Approve` with stale or wrong evidence revert and leave state unchanged.
- **Unset keys (D-017):** every action on an unused slot and on an unknown agreement id reverts.
- **Negative tests** use `evm.try_call(..).success()` after a positive control in the same test, then check state is unchanged. A bare `#[test(should_revert)]` passes on any revert, including one in the setup (review M2), so lint rule `T-REVERT` rejects it unless a `panic = ..` code names the reason.
- **Two agreements** interleaved (I8).
- **Invariant helper** after every step of the integration and demo tests.

## Phase 2A coverage (creation, funding, queries; no transitions yet)
Only T1 exists, so I3 to I7 and I10 have nothing to test yet (no payout, refund or state transition). `Settlane` declares no `Call` effect at all, so the compiler guarantees it cannot send ETH in this phase.
| Invariant | Evidence |
| --- | --- |
| I1 conservation (creation part), I9 solvency | `check_invariants` after every state-changing step: `deposited == paid + refunded + outstanding`, per-agreement outstanding equals the live milestone amounts, `totalOutstanding` equals their sum, no agreement exists beyond the last id, and **`balance >= outstanding`** (I9 in general, R-002). The exact balance is also checked against `outstanding + a known surplus`. `surplus_eth_keeps_balance_at_or_above_outstanding_and_is_never_owed` pre-funds the contract's predicted address, so balance is strictly above outstanding, and shows the surplus is in no agreement, is not in `totalOutstanding`, and is untouched by creations and rejections. |
| I2 allocation | `requires_exact_funding` (value ±1 wei, 0, half, double, funding a different `n`), `rejects_arithmetic_overflow_in_the_amount_sum`, `rules_total_amount_*`, `rejects_zero_amount_or_zero_spec_in_any_used_slot`, `rejects_non_empty_unused_slots`. |
| I8 isolation | `ids_increment_and_agreements_are_isolated`: agreement 1 is byte-for-byte unchanged by creating agreement 2, and every key includes the id. |
| I12 production clock | `production_has_no_way_to_set_its_clock` (the `setTime` selector is absent from production and works on the shell), the boundary tests against the block clock, the differential test, mutation control `mut-production-clock-frozen-at-zero`, lint `C-CLOCK`, and the exact ABI allowlist (lint `C-ABI`). |
| I13 immutable deadlines | Only creation writes `deliver_by` and `decide_by`. The ABI has no other state-changing function, and `the_shell_crosses_creation_deadlines..` checks stored deadlines never change. |
| Deadline boundaries (DE) at creation | d-1, d, d+1 in both ingots: pure `rules_deadline_boundaries_..`, production `enforces_deliver_by_strictly_after_the_production_clock`, and the shell at times 0, 1000, 1001, 5000. `decide_by` overflow boundary (`== 2^256-1` accepted, one more rejected). |
| Distinct parties (D-011) | `rejects_invalid_parties_and_leaves_no_trace` (7 cases) and `the_client_is_the_caller_and_never_a_parameter`: the actor as its own provider is rejected, so distinctness uses the real `msg.sender`. |
| Unknown ids and unused slots (D-017) | `unknown_agreement_ids_revert_or_read_as_none`, `the_none_state_is_first_and_codes_are_stable`, and mutation control `mut-none-not-first-variant`. |
| Events (R-002 f4) | `scripts/check_events.py` (CI step "Events of both ingots") decodes every `AgreementCreated` from `fe test --show-logs` with an independent Keccak-256 and ABI layout: topic hash, 4 topics, 3 data words, `id`, `client`, `provider`, `verifier`, `total`, `milestones`, 15 exact sequences, consecutive ids, rejected creations emit nothing, `client` equals the Actor's own address, and production and the shell emit identical events. Mutation controls: provider/verifier swapped, wrong total, client named as provider, event never emitted. |
| Validation order and deadlines before writes (R-002 f3) | Stage order Parties, Count, Amounts, Time, Spec as in LIFECYCLE, tested pure (`rules_run_stage_by_stage_in_the_lifecycle_order`, `rules_report_the_first_failure_in_a_fixed_order`). All rules, including `DecideByOverflow`, run before any write. |
| ABI and clock (R-002 f1, f2) | Lint `C-ABI` rejects any selector that is not `sol(..)` in the production ingot and any difference between the number of source arms and ABI functions. Lint `C-CLOCK` allows the identifier `Clock` only in its declaration, imports, `uses (name: Clock)` and the one literal `with (Clock = Clock { now: ctx.timestamp() })`. Reproductions in `experiments/review/a1`, `d1`, `d2`. |
| Limits | The dev-ingot copy of `Settlane` that the shell tests exercise cannot be proven byte-identical to the shipped artifact (E10). The lint is textual. Logs are checked by a script from CLI output, not by Fe test code, and only for the listed tests plus structural rules for all of them.

## Provisional-approval conditions (owner, 2026-11-18)
- **Refund authorization (RA), deadline enforcement (DE), and production clock (PC)** are specified in `docs/LIFECYCLE.md`. Each has named tests, and none may be weakened without a `docs/DECISIONS.md` entry.
- **CI must fail** when no tests run in either ingot or an ingot runs fewer tests than its floor (`scripts/check_tests.py`), when a non-payout arm or `init` lists or references a privileged effect (`Call`, `Create`, `Super`, `Evm`, `RawStorage`, `RawOps`, after normalising qualified paths and aliases), when a production contract declares an effect type the lint cannot classify (`E-EFFECT`) or production code contains `unsafe` (`E-UNSAFE`) or reuses a std effect name (`E-SHADOW`), when anything in the production ingot builds a `Clock` from anything but `ctx.timestamp()`, aliases or implements Clock, or binds `ctx` to anything but the Ctx effect (`C-CLOCK`), when the production ABI has a state-changing time or clock function or input (`C-ABI`), when the build output is not exactly the fresh deployable allowlist, counting every file in `out/` (`C-ARTIFACT`), when a test-only contract is defined in the production ingot or a deployable one in the dev ingot (`C-LAYOUT`), or when a test uses a bare `should_revert` (`T-REVERT`). That is `scripts/settlane_lint.py`, wired into `.github/workflows/ci.yml` and covered by 41 fixtures in `scripts/lint-fixtures/` and 23 unit checks. CI also re-runs every review repro (`experiments/review/run.sh`).
- **Proof that CI fails.** `python3 scripts/ci_negative_controls.py` copies the workspace, applies one deliberate mistake at a time (no tests in either ingot, dev ingot in `default-members`, a test shell in the production ingot, a production contract taking its time from a message argument, unformatted code, and since review 2026-11-18 one compiling shape for each of H1–H4 and M2), runs the real CI steps, and checks each fails at the expected step while an unmodified copy passes (14 mutations and 1 control). Run it after any change to CI, the lint, or the policy.
- **Limits of the lint.** It is a textual check, not a Fe parser. It cannot prove that the bytecode tested equals the bytecode shipped. It fails closed on empty or unparsable scans and on unclassifiable effect types, but a syntactic construct it does not recognise could slip through. Bypasses found and fixed so far: a payout arm name reused on another message type (fixed with `Msg::Arm` and `E-DUP`); a qualified or aliased `Call` type, a lowercase arm name, raw storage, and two `C-CLOCK` shapes (review 2026-11-18, `docs/reviews/2026-11-18-phase1.md`, each with a fixture and a negative control). Codex review (R-001), the I11 balance-neutral tests and the PC runtime test therefore remain necessary. Passing the lint does not make a contract secure.

## Reentrancy policy
Write state and counters before `send_value`, and assert success after it. Phase 4 adds a reentrant-recipient test. The `std::evm::Mutex` guard is added only if that test, or review, shows the ordering is not enough.

## Phase gate
A phase that touches payout, refund, or authorization is done only when the related invariants have passing tests and the `contract-security` checklist is clean, or its open items are recorded in `docs/PROGRESS.md`.

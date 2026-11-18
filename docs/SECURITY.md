# Security model and test acceptance criteria

Settlane is an unaudited hackathon prototype for simulated ETH only. Passing tests does not make it secure.

## Trust assumptions
- **Verifier.** Trusted to approve or reject honestly. It can wrongly reject (the client is refunded) or wrongly approve (the provider is paid). It cannot move funds or change parties. A provider and verifier controlled by one person behind two addresses defeats the system, and Settlane cannot detect this. The same attack is documented against ERC-8183.
- **Timestamp.** Block producers can skew it by a few seconds near a deadline.
- **Off-chain artifacts.** `spec` and `evidence` are commitments. Settlane does not check the content.

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
| I11 Balance-neutral verification | `Create`, `Submit`, `Approve`, and `Reject` never change `selfbalance`, except that `Create` adds exactly `msg.value`. Needed because the compiler cannot enforce read-only `call` in contract arms (FE_NOTES E7). Backed by CI lint rule `E-CALL`/`E-BODY`: `call` and `create` may appear only in `Claim` and `Refund`. |
| I12 Production clock | In `Settlane`, time is only `ctx.timestamp()`. No setter, argument, storage, or admin path can alter it (PC). Backed by lint rules `C-CLOCK` and `C-ABI` plus a runtime test. |
| I13 Immutable deadlines | No function changes `deliver_by`, `decide_by`, or the review period after creation (DE). |

## Required test categories
- **Creation.** Zero amounts, n = 0 and n = 4, value ±1 wei, nonzero data in unused slots, sum overflow, zero parties, every pair among client, provider, and verifier equal (D-011), `deliver_by <= now`, zero review period.
- **Every row of the `docs/LIFECYCLE.md` table** with the authorized caller, one unauthorized caller (a third actor), and the boundary times d-1, d, and d+1, through rule tests and integration tests where time allows.
- **Every illegal (state, action) pair** reverts.
- **Repeats:** double claim, double refund, refund after claim, claim after refund.
- **Transfers:** a rejecting recipient (I7), `to == 0`, and a reentrant recipient that calls back into `Claim` or `Refund`.
- **Two agreements** interleaved (I8).
- **Invariant helper** after every step of the integration and demo tests.

## Provisional-approval conditions (owner, 2026-11-18)
- **Refund authorization (RA), deadline enforcement (DE), and production clock (PC)** are specified in `docs/LIFECYCLE.md`. Each has named tests, and none may be weakened without a `docs/DECISIONS.md` entry.
- **CI must fail** when no tests run in either ingot or an ingot runs fewer tests than its floor (`scripts/check_tests.py`), when a non-payout arm or `init` lists or references `call`, `create`, `Super`, or `Evm`, when anything in the production ingot builds a `Clock` from anything but `ctx.timestamp()`, when the production ABI has a state-changing time or clock function, or when the build output is not exactly the deployable allowlist (`C-ARTIFACT`), or a test-only contract is defined in the production ingot or a deployable one in the dev ingot (`C-LAYOUT`). That is `scripts/settlane_lint.py`, wired into `.github/workflows/ci.yml` and covered by 27 fixtures and 13 unit checks in `scripts/lint-fixtures/`.
- **Proof that CI fails.** `python3 scripts/ci_negative_controls.py` copies the workspace, applies one deliberate mistake at a time (no tests in either ingot, dev ingot in `default-members`, a test shell in the production ingot, a production contract taking its time from a message argument, unformatted code), runs the real CI steps, and checks each fails at the expected step while an unmodified copy passes. Run it after any change to CI, the lint, or the policy.
- **Limits of the lint.** It is a textual check, not a Fe parser. It cannot prove that the bytecode tested equals the bytecode shipped. It fails closed on empty or unparsable scans, but a syntactic construct it does not recognise could slip through (a bypass was found and fixed on 2026-11-18: payout arms were matched by bare name, so a second `Claim` arm on another message type that sent ETH compiled and passed the lint; they are now qualified as `Msg::Arm`, `E-DUP` rejects reuse, and regression fixtures cover it), so Codex review (R-001) and the I11 balance-neutral tests remain necessary. Passing the lint does not make a contract secure.

## Reentrancy policy
Write state and counters before `send_value`, and assert success after it. Phase 4 adds a reentrant-recipient test. The `std::evm::Mutex` guard is added only if that test, or review, shows the ordering is not enough.

## Phase gate
A phase that touches payout, refund, or authorization is done only when the related invariants have passing tests and the `contract-security` checklist is clean, or its open items are recorded in `docs/PROGRESS.md`.

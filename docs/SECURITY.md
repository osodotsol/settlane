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
| I6 No premature refund | `Refund` succeeds only when the milestone is `Rejected` or `expired`. |
| I7 Transfer honesty | A failed send leaves state and counters exactly as they were before the call. |
| I8 Isolation | Actions on agreement A never change agreement B's state, counters, or parties. |
| I9 Solvency | `selfbalance >= total_outstanding == Σ outstanding`. |
| I10 Race exclusivity | At every `now`, at most one of {Approve, Refund} is permitted for a `Submitted` milestone, and at most one of {Submit, Refund} for a `Funded` one. |

## Required test categories
- **Creation.** Zero amounts, n = 0 and n = 4, value ±1 wei, nonzero data in unused slots, sum overflow, zero or duplicate parties, `deliver_by <= now`, zero review period.
- **Every row of the `docs/LIFECYCLE.md` table** with the authorized caller, one unauthorized caller (a third actor), and the boundary times d-1, d, and d+1, through rule tests and integration tests where time allows.
- **Every illegal (state, action) pair** reverts.
- **Repeats:** double claim, double refund, refund after claim, claim after refund.
- **Transfers:** a rejecting recipient (I7), `to == 0`, and a reentrant recipient that calls back into `Claim` or `Refund`.
- **Two agreements** interleaved (I8).
- **Invariant helper** after every step of the integration and demo tests.

## Reentrancy policy
Write state and counters before `send_value`, and assert success after it. Phase 4 adds a reentrant-recipient test. The `std::evm::Mutex` guard is added only if that test, or review, shows the ordering is not enough.

## Phase gate
A phase that touches payout, refund, or authorization is done only when the related invariants have passing tests and the `contract-security` checklist is clean, or its open items are recorded in `docs/PROGRESS.md`.

# Lifecycle specification (proposed, pending human approval)

This document is authoritative for settlement behavior. Any transition not listed here **must revert**.

## Agreement
- Creation and funding are one payable call, so an unfunded or partially funded agreement cannot exist on-chain (D-003).
- The agreement status is derived, never stored. It is **Open** while any milestone is non-terminal and **Closed** when every milestone is `Paid` or `Refunded`.
- Parties are immutable after creation. Agreements are isolated: every storage key includes `agreement_id`.

### Creation validation (all must hold, otherwise the call reverts)
| Rule | Check |
| --- | --- |
| Parties | `provider != 0`, `verifier != 0`, `provider != client`, `verifier != provider` (`verifier == client` is allowed, as self-verification). |
| Count | `1 <= n <= 3`. Unused slots must have `amount == 0`, `deliver_by == 0`, `spec == 0`. |
| Amounts | Every used milestone has `amount > 0`. The sum uses checked arithmetic. `msg.value == Σ amount_i` exactly. |
| Time | Every used milestone has `deliver_by > now`. `review_period > 0`. The overflow-checked `deliver_by + review_period` is the milestone's `decide_by`. |
| Spec | `spec_i != 0`, a hash commitment to the off-chain milestone specification. |

The `deliver_by > now` rule interacts with test time being frozen within each test (see `docs/FE_NOTES.md` Q5). Phase 1 decides the testing approach. The rule itself stays.

## Milestone stored states
`Funded`, `Submitted`, `Approved`, `Rejected`, `Paid`, `Refunded`. Unused slots are `None`.

## Derived time predicates (evaluated at `now = block.timestamp`)
- `delivery_open := now < deliver_by`
- `review_open := now < decide_by`, where `decide_by = deliver_by + review_period`
- `expired := (Funded ∧ ¬delivery_open) ∨ (Submitted ∧ ¬review_open)`
- `refundable := Rejected ∨ expired`

Expiry is derived, not stored, so it needs no keeper transaction and cannot fall out of sync.

## Transition table
| # | From | Action | Caller | Time guard | Other guards | To | Funds effect |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | — | `Create` | client (any) | `deliver_by_i > now` | creation validation | each used slot → `Funded` | `deposited += value`, `outstanding += value` |
| T2 | Funded | `Submit(e)` | provider | `delivery_open` | `e != 0` | Submitted(e) | none |
| T3 | Submitted | `Submit(e')` (resubmit) | provider | `delivery_open` | `e' != 0` | Submitted(e') | none |
| T4 | Submitted | `Approve(e)` | verifier | `review_open` | `e == stored evidence` | Approved | none (creates an entitlement) |
| T5 | Submitted | `Reject` | verifier | `review_open` | — | Rejected | none (becomes refundable) |
| T6 | Approved | `Claim(to)` | provider | none | `to != 0` | Paid | `paid += amount`, `outstanding -= amount`, send `amount` to `to` |
| T7 | Rejected, or Funded/Submitted when `expired` | `Refund(to)` | client | (by `expired`) | `to != 0` | Refunded | `refunded += amount`, `outstanding -= amount`, send `amount` to `to` |

Every other (state, action, caller, time) combination reverts. `Paid` and `Refunded` are terminal.

## Proposed resolutions (D-005 and D-006 are not yet approved)
- **Approval vs expiry race.** Approval requires `now < decide_by`. A refund of a `Submitted` milestone requires `now >= decide_by`. The two conditions are disjoint at every timestamp, so contradictory outcomes are impossible. The same holds for delivery (`now < deliver_by`) against expiry of a `Funded` milestone.
- **Late but valid delivery.** A submission made before `deliver_by` gets the full review window, even when `decide_by` falls after `deliver_by`.
- **Retry.** `Rejected` is final for that milestone. A retry before a decision is a resubmission (T3), allowed only while `delivery_open`.
- **Evidence swap race.** `Approve` must restate the evidence hash, so a resubmission landing in the same block cannot be approved by mistake.
- **Inactive verifier.** After `decide_by` the client can refund. The provider is not protected against a dishonest verifier (trust assumption, see `docs/SECURITY.md`).
- **Unclaimed entitlement.** `Approved` never expires. The client can never refund an approved milestone.
- **Who triggers a refund.** Only the client, because the client chooses `to`. ERC-8183 recommends permissionless refunds. We prefer client-only because the client picks the destination. This is open to review (D-005).

## Accounting identity
For each agreement: `deposited == paid + refunded + outstanding`, and `outstanding == Σ amount_i` over milestones in {Funded, Submitted, Approved, Rejected}.
Globally: `total_outstanding == Σ outstanding` and `selfbalance >= total_outstanding`. Equality holds unless ETH is forced in, for example through selfdestruct or a coinbase reward.

# Lifecycle specification

**Status:** provisionally approved by the owner on 2026-11-18 (D-005a refund, D-006b revision-request rejection, D-009 Clock effect, D-011 distinct verifier). Final approval is at the Phase 2 review. This document is authoritative for settlement behavior, and any transition not listed here **must revert**.

## Agreement
- Creation and funding are one payable call (D-003), so an unfunded or partially funded agreement cannot exist on-chain.
- Agreement status is derived, never stored. It is **Open** while any milestone is not terminal and **Closed** when every used milestone is `Paid` or `Refunded`.
- Parties and deadlines are immutable after creation. Every storage key includes `agreement_id`, so agreements are isolated.

### Creation validation (every rule must hold, otherwise the call reverts)
| Rule | Check |
| --- | --- |
| Parties (D-011) | `provider != 0`, `verifier != 0`, and the three addresses `client`, `provider`, `verifier` are pairwise distinct. |
| Count | `1 <= n <= 3`. Unused slots must have `amount == 0`, `deliver_by == 0`, `spec == 0`. |
| Amounts | Every used milestone has `amount > 0`. The sum is checked. `msg.value == Σ amount_i` exactly. |
| Time | Every used milestone has `deliver_by > now`. `review_period > 0`. `decide_by = deliver_by + review_period` is overflow-checked and stored. |
| Spec | `spec_i != 0`, a hash commitment to the off-chain milestone specification. |

## Milestone stored states
`Funded`, `Submitted`, `Approved`, `Paid`, `Refunded`. Unused slots are `None`. There is no stored `Rejected` state (D-006b): a rejection returns the milestone to `Funded`.

## Derived time predicates (`now` = the production clock, see PC below)
- `delivery_open := now < deliver_by`
- `review_open := now < decide_by`
- `expired := (Funded ∧ ¬delivery_open) ∨ (Submitted ∧ ¬review_open)`

Expiry is derived rather than stored, so it needs no keeper transaction and cannot fall out of sync.

## Transition table
| # | From | Action | Caller | Guards | To | Funds effect |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | — | `Create` | any (becomes the client) | creation validation | each used slot → `Funded` | `deposited += value`, `outstanding += value` |
| T2 | Funded, Submitted | `Submit(e)` | provider | `delivery_open`, `e != 0` | Submitted(e) | none |
| T3 | Submitted | `Approve(e)` | verifier | `review_open`, `e == stored evidence` | Approved | none (creates an entitlement) |
| T4 | Submitted | `Reject` | verifier | `review_open` | Funded (evidence cleared, `rejections += 1`) | none |
| T5 | Approved | `Claim(to)` | provider | `to != 0` | Paid | `paid += amount`, `outstanding -= amount`, send `amount` to `to` |
| T6 | Funded or Submitted | `Refund(to)` | client | `expired`, `to != 0` | Refunded | `refunded += amount`, `outstanding -= amount`, send `amount` to `to` |

Every other (state, action, caller, time) combination reverts. `Paid` and `Refunded` are terminal. Only T5 and T6 move ETH, and only they may mention `call` (D-012, enforced by `scripts/settlane_lint.py`).

## Required safety properties (conditions of the provisional approvals)
**RA — Refund authorization.**
- Only the stored client can call `Refund`, and `Claim` is provider-only. Both parties are immutable after creation.
- The refunded amount is read from storage, never from the caller. `to != 0`.
- Refund requires `expired`. It reverts for `Approved`, `Paid`, `Refunded`, and for any `Funded` or `Submitted` milestone that is not expired.
- The client picks `to`, so a client that is a contract unable to receive a 2300-gas send cannot lock its own funds (FE_NOTES E6).
- Tests: wrong caller (provider, verifier, stranger), `to == 0`, each non-refundable state, the boundaries d-1, d, d+1 on both clocks, repeated refund, and refund after claim.

**DE — Deadline enforcement.**
- `deliver_by` and `decide_by` are absolute, fixed at creation, and no function changes them. No party can extend a deadline.
- Comparisons are strict as written above: open means `now < limit` and expired means `now >= limit`. The Submit and Approve/Reject guards are therefore disjoint from the Refund guard at every `now` (I10).
- Every deadline-guarded transition is tested at d-1, d, and d+1.

**PC — Production clock that users cannot change.**
- In `Settlane`, `Clock.now` is only ever `ctx.timestamp()`. It is never stored, never read from a message argument, and there is no setter, owner, or admin path.
- Enforced by (a) lint rule `C-CLOCK` (the only permitted construction is `Clock { now: ctx.timestamp() }`, and no Clock field), (b) lint rule `C-ABI` (the built `Settlane.abi.json` has no state-changing function whose name mentions time or clock), and (c) a test that calls `SetTime` on the production contract and expects a revert or an absent selector.
- The test-only shell (`SettlaneTestClock`) has a settable clock. **`fe build` emits every contract in the ingot, including ones defined in test files** (verified 2026-11-18), so the shell is built too. It is never the deployable. Only `Settlane.*` artifacts are deployable, the shell is named so it cannot be mistaken for it, and the README and submission state this. Phase 2 first checks whether a separate test ingot can keep the shell out of `out/`.

## Rejection and retry (D-006b)
`Reject` is a revision request. Scenarios:
| # | Scenario | Outcome |
| --- | --- | --- |
| F1 | The provider uploaded the wrong artifact, time remains | Provider resubmits before `deliver_by` (T2). |
| F2 | The work is fixably deficient | Same: revision until `deliver_by`. |
| F3 | Rejection arrives after `deliver_by` (inside the review window) | The milestone is `Funded` with delivery closed, so it is immediately `expired` and refundable. |
| F4 | The verifier rejects wrongly or dishonestly | No on-chain remedy. Trust assumption, and appeal is out of MVP scope. |
| F5 | Endless reject and resubmit cycle | Bounded by the absolute `deliver_by`, so the client's maximum lock is unchanged. |
| F6 | Rejection one second before `deliver_by` | Effectively final, because the provider has no time to resubmit. Documented. |
| F7 | The provider abandons the work | Expiry, then refund. |
| F8 | The verifier key is compromised | The attacker can approve or reject anything. Trust assumption. |

## Race resolution
- `Approve` and `Reject` require `now < decide_by`, and refunding a `Submitted` milestone requires `now >= decide_by`.
- `Submit` requires `now < deliver_by`, and refunding a `Funded` milestone requires `now >= deliver_by`.
- Both pairs are disjoint at every timestamp, so contradictory outcomes are impossible.
- A submission made before `deliver_by` always gets the full review window, even when `decide_by` falls after `deliver_by`.
- `Approve` restates the evidence hash, so a resubmission landing in the same block cannot be approved by mistake.
- `Approved` never expires, and the client can never refund an approved milestone.
- Inactive verifier: after `decide_by` the client can refund. A dishonest verifier is a trust assumption (`docs/SECURITY.md`).

## Accounting identity
Per agreement: `deposited == paid + refunded + outstanding`, where `outstanding == Σ amount_i` over milestones in {Funded, Submitted, Approved}.
Globally: `total_outstanding == Σ outstanding` and `selfbalance >= total_outstanding`. Equality holds unless ETH is forced in, for example through selfdestruct or a coinbase reward.

# Lifecycle specification

**Status:** Phase 2B implements T1 to T4 and the queries. T5 and T6 (the payouts, the only transitions that move ETH) are Phase 3. Provisionally approved by the owner on 2026-11-18 (D-005a refund, D-006b revision-request rejection, D-009 Clock effect, D-011 distinct verifier). Final approval is at the Phase 2 review. This document is authoritative for settlement behavior, and any transition not listed here **must revert**.

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

### Implementation notes (Phase 2A, T1 only)
- Rules are checked **stage by stage in the order of the table above** (Parties, Count, Amounts, Time, Spec), and within a stage in slot order. The first failure is reported. A fault of an earlier stage wins even when it sits in a later slot (tested: a zero amount in slot 2 is reported before a zero spec in slot 0).
- Every rule, including every deadline and the `decide_by` window, is evaluated **before the first storage write**, so a rejected creation leaves no trace (tested) and nothing depends on a revert undoing a partial write.
- The two overflow cases are explicit rules and never panic: `AmountSumOverflow` (the sum of the used amounts would exceed 2^256 - 1) and `DecideByOverflow` (`deliver_by + review_period` would). Sum and window use `<= 2^256 - 1` exactly.
- Agreement ids start at 1 and `0` is never valid. `getAgreement` and `getAccounting` revert for an unknown id. `getMilestone` does not revert: an unknown id or an unused slot reads as state `None` (code 0) with every field zero (D-017).
- `decide_by = deliver_by + review_period` is validated first (`DecideByOverflow`), so a window that would wrap past 2^256 - 1 reverts and `decide_by == 2^256 - 1` is accepted exactly (boundary tested). The stored value is then computed with checked arithmetic that cannot fail.
- Deadlines are stored once and no function can change them (DE, I13). Only creation writes `deliver_by` and `decide_by`.
- `n` is a `u8`. A wider value is rejected by the ABI decoder, so `n = 256` can never wrap to 0 (tested).
- Deadlines need not be ordered across milestones, and are stored as given. Every used slot is judged against the same `now` (tested in every slot, with the boundary at d-1, d and d+1).
- The funding check uses the amounts of the first `n` slots only, and unused slots must be completely empty.

### Implementation notes (Phase 2B, T2 to T4)
**Check order.** Each action runs one pure check (`rules::check_submit`, `rules::check_review`) that returns the first failed rule, and every rule is evaluated before anything is written. The revert reason names the failed rule, and the tests assert it.
| Action | Order of the rules, with the revert reason |
| --- | --- |
| `Submit(id, m, e)` | the agreement exists (`unknown agreement`), the caller is the provider (`caller is not the provider`), the milestone exists (`no such milestone`), its state is `Funded` or `Submitted` (`milestone cannot take evidence in this state`), the delivery window is open (`delivery window is closed`), `e != 0` (`evidence is zero`) |
| `Approve(id, m, e)` and `Reject(id, m, e)` (one shared check, so their guards cannot drift apart) | the agreement exists, the caller is the verifier (`caller is not the verifier`), the milestone exists, its state is `Submitted` (`milestone is not submitted`), the review window is open (`review window is closed`), `e` equals the stored evidence (`evidence does not match the submitted evidence`) |

- **Role before state.** A caller without the role always gets the role reason, so it learns nothing about the state of a milestone. A caller with the role gets the state reason.
- **Resubmission.** A `Submit` from `Submitted` replaces the stored evidence, while the delivery window is open. An identical resubmission is accepted (idempotent) and emits the event again. `Submit` from `Approved`, `Paid` or `Refunded` always reverts.
- **Immutability.** The only fields a transition writes are `state`, `evidence` and `rejections`. Amount, both deadlines and the spec are never rewritten (tested after every transition). `Approved` accepts no transition at all, at any time, and approval never expires (tested at every deadline).
- **`Reject`** returns the milestone to `Funded`, clears the evidence and adds one to `rejections` (a `u256`, so a long reject and resubmit cycle can never overflow and block a rejection). `Approve` keeps the evidence and the count.
- **Windows.** `Submit` needs `now < deliver_by`. `Approve` and `Reject` need `now < decide_by`. A submission made at `deliver_by - 1` still gets the whole review window (tested). After the delivery window closes a rejected milestone stays `Funded` and can take no new evidence, so only a refund (Phase 3) can settle it.
- **Money.** None of the three moves ETH, takes ETH (all are non-payable, tested with a zero-value control) or changes any total. `Settlane` still declares no `Call` effect, so the compiler guarantees it cannot send ETH.
- **Views.** `getMilestone` returns `rejections` as a 7th output. Unknown ids and unused slots still read as state `None`, all zero.
- **Events.** `MilestoneSubmitted(id, m, evidence)`, `MilestoneApproved(id, m, evidence)` (all three indexed) and `MilestoneRejected(id, m, evidence, rejections)` (the first three indexed, `rejections` is the new total).

## Milestone stored states
`Funded`, `Submitted`, `Approved`, `Paid`, `Refunded`. Unused slots are `None`. There is no stored `Rejected` state (D-006b): a rejection returns the milestone to `Funded`.

`None` is the **first** variant of the stored enum (D-017), because an unset storage key reads as the first variant (FE_NOTES E3). Unused slots and unknown agreement ids therefore read as `None`, and every action on them reverts (tested).

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
| T4 | Submitted | `Reject(e)` | verifier | `review_open`, `e == stored evidence` (D-015) | Funded (evidence cleared, `rejections += 1`) | none |
| T5 | Approved | `Claim(to)` | provider | `to != 0` | Paid | `paid += amount`, `outstanding -= amount`, send `amount` to `to` |
| T6 | Funded or Submitted | `Refund(to)` | client | `expired`, `to != 0` | Refunded | `refunded += amount`, `outstanding -= amount`, send `amount` to `to` |

Every other (state, action, caller, time) combination reverts. `Paid` and `Refunded` are terminal. Only T5 and T6 move ETH, and only they may mention `call` (D-012, enforced by `scripts/settlane_lint.py`).

## Required safety properties (conditions of the provisional approvals)
**RA — Refund authorization.**
- Only the stored client can call `Refund`, and `Claim` is provider-only. Both parties are immutable after creation.
- The refunded amount is read from storage, never from the caller. `to != 0`.
- Refund requires `expired`. It reverts for `Approved`, `Paid`, `Refunded`, and for any `Funded` or `Submitted` milestone that is not expired.
- The client picks `to`, so a client that is a contract unable to receive a 2300-gas send cannot lock its own funds (FE_NOTES E6).
- Tests: wrong caller (provider, verifier, stranger), `to == 0`, each non-refundable state, the boundaries d-1, d, d+1 on both clocks, repeated refund, refund after claim, and refund on an unused slot or unknown id (D-017). Negative tests use `try_call` after a positive control, never a bare `should_revert` (lint `T-REVERT`, review M2).

**DE — Deadline enforcement.**
- `deliver_by` and `decide_by` are absolute, fixed at creation, and no function changes them. No party can extend a deadline.
- Comparisons are strict as written above: open means `now < limit` and expired means `now >= limit`. The Submit and Approve/Reject guards are therefore disjoint from the Refund guard at every `now` (I10).
- Every deadline-guarded transition is tested at d-1, d, and d+1.

**PC — Production clock that users cannot change.**
- In `Settlane`, `Clock.now` is only ever `ctx.timestamp()`. It is never stored, never read from a message argument, and there is no setter, owner, or admin path.
- Enforced by (a) lint rule `C-CLOCK` (the only permitted construction is `Clock { now: ctx.timestamp() }`, and no Clock field), (b) lint rule `C-ABI` (the built `Settlane.abi.json` has no state-changing function whose name mentions time or clock), and (c) a test that calls `SetTime` on the production contract and expects a revert or an absent selector.
- The test-only shell (`SettlaneTestClock`) has a settable clock. **`fe build` emits every contract in the ingot, including ones defined in test files** (verified 2026-11-18), so a shell placed in the production ingot would be built too. D-014 therefore puts it in a separate dev ingot, which keeps the production `out/` to deployable contracts only. Lint rule `C-ARTIFACT` fails CI if a test-only or unlisted contract appears in the build output, and the README and submission state which artifacts are deployable.

## Rejection and retry (D-006b)
`Reject` is a revision request. Scenarios:
| # | Scenario | Outcome |
| --- | --- | --- |
| F1 | The provider uploaded the wrong artifact, time remains | Provider resubmits before `deliver_by` (T2). |
| F2 | The work is fixably deficient | Same: revision until `deliver_by`. |
| F3 | Rejection arrives after `deliver_by` (inside the review window) | The milestone is `Funded` with delivery closed, so it is immediately `expired` and refundable. |
| F4 | The verifier rejects wrongly or dishonestly | No on-chain remedy. Trust assumption, and appeal is out of MVP scope. |
| F5a | The provider resubmits just before the verifier's `Reject` lands | `Reject(e)` names the evidence it reviewed, so it reverts against the new evidence and the verifier reviews the fix (D-015). |
| F5 | Endless reject and resubmit cycle | Bounded by the absolute `deliver_by`, so the client's maximum lock is unchanged. |
| F6 | Rejection one second before `deliver_by` | Effectively final, because the provider has no time to resubmit. Documented. |
| F7 | The provider abandons the work | Expiry, then refund. |
| F8 | The verifier key is compromised | The attacker can approve or reject anything. Trust assumption. |

## Race resolution
- `Approve` and `Reject` require `now < decide_by`, and refunding a `Submitted` milestone requires `now >= decide_by`.
- `Submit` requires `now < deliver_by`, and refunding a `Funded` milestone requires `now >= deliver_by`.
- Both pairs are disjoint at every timestamp, so contradictory outcomes are impossible.
- A submission made before `deliver_by` always gets the full review window, even when `decide_by` falls after `deliver_by`.
- `Approve` and `Reject` both restate the evidence hash (D-015), so a resubmission landing just before them can be neither approved nor rejected by mistake. Without this, a `Reject` meant for earlier evidence could reject a fix submitted shortly before `deliver_by`, which the verifier never saw, making the milestone immediately refundable (review S-1).
- `Approved` never expires, and the client can never refund an approved milestone.
- Inactive verifier: after `decide_by` the client can refund. A dishonest verifier is a trust assumption (`docs/SECURITY.md`).

## Accounting identity
Per agreement: `deposited == paid + refunded + outstanding`, where `outstanding == Σ amount_i` over milestones in {Funded, Submitted, Approved}.
Globally: `total_outstanding == Σ outstanding` and `selfbalance >= total_outstanding`. Equality holds unless ETH is forced in, for example through selfdestruct or a coinbase reward.

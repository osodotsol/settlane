# Lifecycle specification

**Status:** Phase 3B implements T1 to T6 and the queries. `Claim` (T5) and `Refund` (T6) are the only transitions that move ETH. Provisionally approved by the owner on 2026-11-18 (D-005a refund, D-006b revision-request rejection, D-009 Clock effect, D-011 distinct verifier). Final approval is at the Phase 2 review. This document is authoritative for settlement behavior, and any transition not listed here **must revert**.

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
| `Approve(id, m, e, revision)` and `Reject(id, m, e, revision)` (one shared check, so their guards cannot drift apart) | the agreement exists, the caller is the verifier (`caller is not the verifier`), the milestone exists, its state is `Submitted` (`milestone is not submitted`), the review window is open (`review window is closed`), `e` equals the stored evidence (`evidence does not match the submitted evidence`), the revision equals the stored revision (`submission revision does not match`) |

- **Role before state.** For an existing agreement, the role check precedes the milestone and state checks. Unknown agreements are reported first.
- **Resubmission.** A `Submit` from `Submitted` replaces the stored evidence while the delivery window is open. Every accepted submission increments that milestone’s checked `u256` revision from its initial value of zero and emits the new revision, including when the evidence hash is identical. `Submit` from `Approved`, `Paid` or `Refunded` always reverts.
- **Immutability.** Transitions can change `state`, `evidence`, `rejections` and `revision`. Amount, both deadlines and the spec are never rewritten (tested after every transition). `Approved` accepts no transition at all, at any time, and approval never expires (tested at every deadline).
- **`Reject`** returns the milestone to `Funded`, clears the evidence and adds one to the checked `u256` rejection counter. It preserves the submission revision. `Approve` keeps the evidence and both counters.
- **Windows.** `Submit` needs `now < deliver_by`. `Approve` and `Reject` need `now < decide_by`. A submission made at `deliver_by - 1` still gets the whole review window (tested). After the delivery window closes a rejected milestone stays `Funded` and can take no new evidence, so only a refund (Phase 3) can settle it.
- **Money.** None of the three moves ETH, takes ETH (all are non-payable, tested with a zero-value control) or changes any total. None of these handlers lists `call`, and the compiler rejects a handler that omits an effect it needs, so they cannot send ETH. Since Phase 3A `Settlane` does declare `Call`, but only the `Claim` arm lists it, and since Phase 3B also the `Refund` arm (lint `E-CALL`, `E-BODY`; an arm listing it read-only would still compile, FE_NOTES E7).
- **Views.** `getMilestone` returns `rejections` as output 7 and the submission `revision` as output 8. Unknown ids and unused slots still read as state `None`, all zero.
- **Events.** `MilestoneSubmitted(id, m, evidence, revision)`, `MilestoneApproved(id, m, evidence, revision)` and `MilestoneRejected(id, m, evidence, revision, rejections)`. All three index `id`, `m` and `evidence`. The data contains the submission revision and, for rejection, the new rejection count.

### Implementation notes (Phase 3A, T5 Claim)
| Action | Order of the rules, with the revert reason |
| --- | --- |
| `Claim(id, m, to)` | the agreement exists (`unknown agreement`), the caller is the provider (`caller is not the provider`), the milestone exists (`no such milestone`), its state is `Approved` (`milestone is not approved`), `to != 0` (`payee is zero`); then the transfer must succeed (`transfer failed`) |

- **One pure check.** `rules::check_claim` returns the first failed rule, before anything is written. Role precedes state, as for T2 to T4, so a caller with no role learns nothing about the milestone.
- **No time guard.** An approval never expires, so `Claim` takes no Clock and works at any time after approval (tested far past both deadlines on the shell).
- **Amount from storage.** The amount sent is the stored milestone amount. Nothing in calldata affects it. `Claim` returns the amount sent.
- **Order: checks, effects, interaction.** The handler writes `Paid`, `paid += amount`, `outstanding -= amount` and emits `MilestoneClaimed`, and only then calls `send_value(to, gas: 0, amount)` and asserts success. `gas: 0` means only the 2300-gas stipend reaches the payee. A failed transfer reverts the whole call, including the event, so state, counters and logs stay as they were, and the provider can retry with another `to`. Paying Settlane itself fails the same way (it has no fallback).
- **Paid is final.** After `Paid`, `Claim` reports `milestone is not approved`, `Submit` reports `milestone cannot take evidence in this state` and `Approve` and `Reject` report `milestone is not submitted`. All other milestone fields are kept.
- **Non-payable.** `Claim` rejects attached value (tested with a zero-value control).
- **Event.** `MilestoneClaimed(id, m, to, amount)` with `id`, `m` and `to` indexed and the amount as data.

### Implementation notes (Phase 3B, T6 Refund)
| Action | Order of the rules, with the revert reason |
| --- | --- |
| `Refund(id, m, to)` | the agreement exists (`unknown agreement`), the caller is the client (`caller is not the client`), the milestone exists (`no such milestone`), its state is `Funded` or `Submitted` (`milestone cannot be refunded in this state`), it has expired (`milestone has not expired`), `to != 0` (`payee is zero`); then the transfer must succeed (`transfer failed`) |

- **Same order as every transition (D-024).** Agreement, role, milestone, state, window, then the argument. Role precedes state, so a caller with no role learns nothing about the milestone. State precedes the window, so an `Approved`, `Paid` or `Refunded` milestone always reports its state, at any time. The window precedes `to`, as the window precedes the evidence in T2 to T4.
- **`expired` exactly as defined above.** `rules::expired(state, now, deliver_by, decide_by)` is `¬delivery_open` for `Funded`, `¬review_open` for `Submitted` and false for every other state. It reads the deadlines of the milestone being refunded, from storage. A `Submitted` milestone is not expired at `deliver_by`, only at `decide_by` (tested in every slot).
- **Production clock.** The `Refund` arm provides `Clock { now: ctx.timestamp() }` like T1 to T4. The test block never advances and creation requires future deadlines, so on the production contract a refund is never expired (tested: every attempt reports `milestone has not expired`). The expired path is tested on the dev shell, which runs the same `refund_handler`.
- **Amount from storage, payee from the client.** The amount sent is the stored milestone amount, and `Refund` returns it. The client chooses `to` (D-005a), and only `to != 0` is required. A client whose own address cannot take a 2300-gas send refunds to another address.
- **Order: checks, effects, interaction.** The handler writes `Refunded`, `refunded += amount`, `outstanding -= amount` and emits `MilestoneRefunded`, and only then calls `send_value(to, gas: 0, amount)` and asserts success. A failed transfer reverts the whole call, including the event, and the client can retry with another `to`.
- **Exclusive settlement (I3, I4).** After `Refunded`, `Refund` reports `milestone cannot be refunded in this state`, `Claim` reports `milestone is not approved`, `Submit` reports `milestone cannot take evidence in this state`, and `Approve` and `Reject` report `milestone is not submitted`. After `Paid`, `Refund` reports `milestone cannot be refunded in this state`. `Approved` is never refundable.
- **Non-payable.** `Refund` rejects attached value before any rule, with empty revert data (tested on production and the shell).
- **Event.** `MilestoneRefunded(id, m, to, amount)` with `id`, `m` and `to` indexed and the amount as data.

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
| T2 | Funded, Submitted | `Submit(e)` | provider | `delivery_open`, `e != 0` | Submitted(e), revision += 1 | none |
| T3 | Submitted | `Approve(e, revision)` | verifier | `review_open`, `e == stored evidence`, `revision == stored revision` | Approved | none (creates an entitlement) |
| T4 | Submitted | `Reject(e, revision)` | verifier | `review_open`, `e == stored evidence`, `revision == stored revision` (D-015, D-021) | Funded (evidence cleared, `rejections += 1`) | none |
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
| F5a | The provider resubmits just before the verifier's `Reject` lands | `Reject(e, revision)` names the evidence and submission revision it reviewed. It reverts after any newer submission, including one with the same hash (D-015, D-021). |
| F5 | Endless reject and resubmit cycle | Bounded by the absolute `deliver_by`, so the client's maximum lock is unchanged. |
| F6 | Rejection one second before `deliver_by` | A later transaction in the same block can still resubmit if the block timestamp is below `deliver_by`. At `deliver_by` and later, submission is closed. |
| F7 | The provider abandons the work | Expiry, then refund. |
| F8 | The verifier key is compromised | The attacker can approve or reject anything. Trust assumption. |

## Race resolution
- `Approve` and `Reject` require `now < decide_by`, and refunding a `Submitted` milestone requires `now >= decide_by`.
- `Submit` requires `now < deliver_by`, and refunding a `Funded` milestone requires `now >= deliver_by`.
- Both pairs are disjoint at every timestamp, so contradictory outcomes are impossible.
- A submission made before `deliver_by` always gets the full review window, even when `decide_by` falls after `deliver_by`.
- `Approve` and `Reject` both name the evidence hash and its submission revision (D-015, D-021). A verifier decision for an earlier submission reverts after any later submission, including `A → B → A` and `A → A`. The verifier can read the current revision from `getMilestone` or the submission event.
- `Approved` never expires, and the client can never refund an approved milestone.
- Inactive verifier: after `decide_by` the client can refund. A dishonest verifier is a trust assumption (`docs/SECURITY.md`).

## Accounting identity
Per agreement: `deposited == paid + refunded + outstanding`, where `outstanding == Σ amount_i` over milestones in {Funded, Submitted, Approved}.
Globally: `total_outstanding == Σ outstanding` and `selfbalance >= total_outstanding`. Equality holds unless ETH is forced in, for example through selfdestruct or a coinbase reward.

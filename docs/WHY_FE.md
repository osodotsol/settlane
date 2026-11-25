# Why Fe

Settlane is an escrow, so the question that matters most is: *which code can move the money, and when?* Fe let us make the answer visible in the source and check it at several levels. This document separates four kinds of guarantee, because they are easy to blur:

| Kind | Who enforces it | Example |
| --- | --- | --- |
| **Compiler** | Fe 26.6.0 rejects the program | A handler that omits `call` cannot send ETH |
| **Contract logic** | Settlane reverts the transaction | Only the provider may claim |
| **Policy lint** | `scripts/settlane_lint.py` fails CI | Only `Claim` and `Refund` may mention `call` |
| **Tests** | `fe test`, Anvil, browser suites | A refund at `deliver_by − 1` reverts, at `deliver_by` succeeds |

Nothing here is formally verified, and Fe does not make a contract secure on its own. Toolchain: **`fe 26.6.0 (5b3f96a)`**, pinned in CI by SHA-256.

---

## 1. Effects make the money path explicit

**What Fe provides.** A contract declares the effects it holds (`uses (ctx: Ctx, call: mut Call, log: mut Log)`), and each message arm declares which of them, and which storage fields, it uses. A free function that needs an effect must list it, and a caller that does not hold it cannot call that function.

**How Settlane uses it.** Each arm lists exactly what it touches. Only the two payout arms hold `mut call`:

```fe
// ingots/settlane/src/settlane.fe (lines 53, 79, 100–108)
pub contract Settlane uses (ctx: Ctx, call: mut Call, log: mut Log) {
    …
    Submit { id, m, evidence } uses (ctx, mut log, agreements, mut milestones) { … }

    Claim { id, m, to } -> Wei uses (
        ctx, mut call, mut log, mut totals, mut agreements, mut milestones,
    ) {
        handlers::claim_handler(id, m, to)
    }
```

`Submit` reads `agreements` but cannot write it, and cannot touch `totals` at all. The shared handlers repeat the declaration, so `submit_handler` ([`handlers.fe:219`](../ingots/settlane/src/handlers.fe#L219)) has no `Call` in scope and cannot send value.

**Why it matters.** A reviewer can find every route by which ETH leaves the contract by reading the `uses` lists: two arms and two handlers.

**Evidence.** `verification_steps_never_move_eth_even_when_every_party_can_receive_it` and `transitions_are_not_payable_and_never_move_money` ([`settlane-dev/src/tests.fe`](../ingots/settlane-dev/src/tests.fe)) check that Create, Submit, Approve and Reject never change the contract balance except by Create's own deposit (invariant I11).

**Limitation we found (E7).** In Fe 26.6.0, at the contract-arm level, the compiler enforces that an effect is *listed*, not that it is listed `mut`. An arm declaring `uses (call)` read-only can still hand `call` to a function that sends ETH, and the transfer happens. We reproduced it on a running EVM ([`FE_NOTES.md`, E7](FE_NOTES.md#e7-investigation-2026-11-17-fe-2660-5b3f96a), `experiments/phase1/`). The same rule *is* enforced for storage fields, free functions and user-defined effects, so this looks like a compiler gap specific to built-in contract effects.

**How we closed it.** The only compile-time guarantee we rely on is *omission*: arms that must not move money do not list `call` or `create` at all. The lint (rule `E-CALL`, and the `C-XFER*` family below) fails if `call` appears anywhere except `Claim` and `Refund`, and the balance-neutral test above backs it at runtime. Other Fe builders can reuse the same pattern.

## 2. Time is an effect, so deadlines are testable

**What Fe provides.** A user-defined struct can be used as an effect and supplied to a scope with `with`. Code inside sees it like any other effect.

**How Settlane uses it.** All rules are pure functions that take `now`:

```fe
// ingots/settlane/src/rules.fe (lines 86–96, 287–300)
pub fn delivery_open(now: Timestamp, deliver_by: Timestamp) -> bool { now < deliver_by }
pub fn review_open(now: Timestamp, decide_by: Timestamp) -> bool { now < decide_by }

pub fn expired(_ state: MilestoneState, _ now: Timestamp, _ deliver_by: Timestamp, _ decide_by: Timestamp) -> bool {
    match state {
        MilestoneState::Funded => !delivery_open(now, deliver_by),
        MilestoneState::Submitted => !review_open(now, decide_by),
        …                                   // Approved, Paid, Refunded: never expired
    }
}
```

The production contract supplies the clock from the block, and only from the block:

```fe
// ingots/settlane/src/settlane.fe (line 80)
with (Clock = Clock { now: ctx.timestamp() }) {
    handlers::submit_handler(id, m, evidence)
}
```

A second contract, in a separate test-only ingot, serves **the same message set through the same handlers** but supplies the clock from a field the tests can set:

```fe
// ingots/settlane-dev/src/lib.fe (lines 18–19, 113)
pub contract SettlaneTestClock uses (ctx: Ctx, call: mut Call, log: mut Log) {
    mut now: Timestamp,
    …
    SetTime { now: t } uses (mut now) { now = t }
```

**Why it matters.** The Fe test block's timestamp never advances, so without this no test could cross a deadline on real contract code. With it, every deadline is tested at `d − 1`, `d` and `d + 1`.

**Evidence.** `refund_boundaries_hold_at_d_minus_1_d_and_d_plus_1_in_every_slot_and_state`, `the_delivery_window_closes_exactly_at_deliver_by`, `the_review_window_closes_exactly_at_decide_by_and_a_late_submission_keeps_it_whole`, and `shell_and_production_agree_on_every_step_of_a_transition_script`, which drives both contracts through the same script and compares results. `production_has_no_way_to_set_its_clock` proves the production contract rejects `SetTime`.

**Keeping the test clock out of production.** `fe build` emits every `pub contract` in an ingot, and Fe 26.6 has no test-only `cfg`. So the shell lives in its own ingot (`ingots/settlane-dev`), the workspace's `default-members` lists only the production ingot ([`fe.toml`](../fe.toml)), and lint rule `C-CLOCK` checks that `ctx.timestamp()` is the production contract's only time source. The Anvil job adds 8 wrong-clock mutations that must all be caught.

**Limitation.** The production wiring (`ctx.timestamp()`) is checked by the lint and by the production bytecode on Anvil, not by a Fe test, because no Fe test can advance the block.

## 3. A standard Ethereum interface

**What Fe provides.** `#[selector = sol("…")]` assigns Solidity-compatible selectors to message variants.

```fe
// ingots/settlane/src/settlane.fe (line 37)
#[selector = sol("claim(uint256,uint8,address)")]
Claim { id: u256, m: u8, to: Address } -> Wei,
```

**Why it matters.** MetaMask, Etherscan and viem decode Settlane without a custom ABI layer. The frontend's ABI is generated from `fe build` and checked against it (`npm run check-abi`), and the lint locks the ABI, including output types and order.

## 4. Checks, effects, one transfer

**How Settlane uses it.** Each handler checks every rule through one pure function, writes all state, emits the event, and only then sends ETH, as its last statement, with the 2,300-gas stipend, and asserts the result:

```fe
// ingots/settlane/src/handlers.fe (lines 397–445, condensed)
require_claim(rules::check_claim(
    agreement_exists: a.n != 0, caller: ctx.caller(), provider: a.provider, state: x.state, to,
))
let amount = x.amount
// --- effects: every write happens before the transfer ---
milestones.set(… state: MilestoneState::Paid …)
totals.outstanding = totals.outstanding - amount
log.emit(MilestoneClaimed { id, m, to, amount })
// --- interaction: the last step, stipend only, result asserted ---
assert!(call.send_value(addr: to, gas: 0, value: amount).success(), "transfer failed")
```

**What the lint adds.** The `C-XFER` rules require this exact form: one `send_value` with literal `gas: 0`, last statement, only in `claim_handler` and `refund_handler`, amount read from storage, payee the `to` parameter. Each payout arm must be exactly its handler call (`C-XFER-ARM`), so nothing runs after the transfer.

**Evidence.** `a_reentrant_provider_is_paid_exactly_once`, `a_provider_that_always_re_enters_is_never_paid_under_the_stipend_and_never_twice`, the matching client-side refund tests, `a_failed_transfer_reverts_the_whole_claim_and_a_retry_to_another_payee_succeeds`, and two cross-agreement reentrancy tests. The attacker contracts (`Reentrant`, `Greedy`, `Once`, `Cross`, `GasCap`) are in the dev ingot.

## 5. Authorization and lifecycle in one ordered check

Every action has one pure check in `rules.fe` that returns the first failed rule, always in the same order: agreement, role, milestone, state, window, then the argument. Every failure reverts with a named reason, and the frontend has a test that every reason string in `handlers.fe` has user-facing copy.

**Evidence.** `only_the_provider_submits_and_only_the_verifier_reviews`, `only_the_provider_may_claim_and_only_an_approved_milestone_to_a_nonzero_payee`, `only_the_client_may_refund_and_only_an_expired_unpaid_milestone_to_a_nonzero_payee`, `roles_are_looked_up_per_agreement_when_addresses_swap_roles`, `evidence_must_match_and_stale_evidence_can_neither_be_approved_nor_rejected`, `replays_and_invalid_transitions_are_rejected_and_an_approved_milestone_never_changes`.

## Findings useful to other Fe builders

| Finding | Where |
| --- | --- |
| Arm-level `mut` on built-in contract effects (`Call`, `Create`, `Log`) is not enforced in 26.6.0; omission is. | [`FE_NOTES.md` E7](FE_NOTES.md#e7-investigation-2026-11-17-fe-2660-5b3f96a), `experiments/phase1/` |
| `fe build` emits test-file contracts; keep test shells in a separate ingot and out of `default-members`. | [`FE_NOTES.md`, Build finding](FE_NOTES.md#build-finding-2026-11-18) |
| A `Clock` effect plus a settable test shell makes deadline logic testable against the real handlers. | [`FE_NOTES.md` E9](FE_NOTES.md), this document §2 |
| Backend panic in 26.6.0 when a contract calls a `#[test]` helper; minimal reproduction included. | [`FE_NOTES.md` b6](FE_NOTES.md#b6-fe-2660-backend-panic-on-a-test-helper-that-a-contract-calls-r-005-recorded-separately), `experiments/review/r005/` |
| `Wei` arithmetic is checked: overflow and underflow give `Panic(0x11)`. | [`FE_NOTES.md` E8](FE_NOTES.md) |

These are observations on Fe 26.6.0 from this project, not statements by the Fe team.

# Architecture (Phase 2A implemented: creation, funding, queries)

## Shape
A Fe **workspace** with two ingots (D-014, approved with conditions on 2026-11-18). There is no backend, database, frontend, or off-chain service.

```
fe.toml                  workspace manifest; default-members = ["ingots/settlane"] ONLY
ingots/settlane/         PRODUCTION ingot: the only thing `fe build` emits
  fe.toml                [ingot] name = "settlane"
  src/lib.fe             module overview (comment only)
  src/types.fe           Clock effect, Totals, MilestoneState, Agreement, Milestone, AgreementCreated
  src/rules.fe           pure rules: check_create, total_amount, decide_by, delivery_open, state_code
  src/handlers.fe        shared handler bodies (D-016): create_handler and the query handlers
  src/settlane.fe        pub msg SettleMsg and the contract Settlane (arms are glue only)
  src/tests.fe           tests that do not need to cross a deadline or use another caller
ingots/settlane-dev/     DEV ingot: never built by default
  fe.toml                [ingot] name = "settlane_dev", depends on `settlane`
  src/lib.fe             SettlaneTestClock (settable clock, same handlers), DevMsg, Actor, ActorMsg
  src/tests.fe           deadline-crossing, differential and multi-caller tests
```

Rules of the layout, each enforced by `scripts/settlane_lint.py` or `scripts/check_tests.py` in CI:
- Test-only contracts exist only in the dev ingot (`C-LAYOUT`). Deployable and production contracts exist only in the production ingot (`C-LAYOUT`).
- `fe build` at the root emits only the production ingot, and `out/` must equal the deployable allowlist in `scripts/lint-policy.json` (`C-ARTIFACT`). Adding the dev ingot to `default-members` makes the real build emit the dev contracts and fails CI (verified).
- Both ingots' tests run explicitly, and CI fails if either ingot runs fewer tests than its floor in `scripts/test-policy.json`.
- The dev ingot depends on the production ingot, never the reverse. Production code needs no change to be tested: the dev ingot mirrors message selectors where the production message type is not `pub`.

## Layers and what enforces them
| Concern | Mechanism | Enforced by |
| --- | --- | --- |
| Rules cannot read storage, time, or move ETH | `rules.fe` functions declare no `uses` and take `now` as an argument | **Compiler** (effects) |
| Approve, Reject, and Submit cannot transfer ETH | Their handlers do not list `call` in `uses` at all. Only `Claim` and `Refund` do. | **Compiler, for omission only** (E7: omitting `call` or `create` gives `error[8-0012]`; a read-only `uses (call)` in an arm is not narrowed and still sends). Backed by a lint (D-012) and test invariant I11. |
| Query handlers cannot write storage | Handlers declare only read access to fields | **Compiler** |
| Wei, Timestamp, and Duration cannot be mixed up | Typed std units | **Compiler** |
| All states are handled | `match` on the `MilestoneState` enum | **Compiler** (exhaustiveness) |
| Caller is client, provider, or verifier | `ctx.caller()` compared with stored parties | **Runtime** `assert!` |
| Deadlines | `rules.fe` predicates on `ctx.timestamp()` | **Runtime** |
| Exact funding and allocation | Checked sum against `ctx.value()` | **Runtime** |
| Overflow | Checked arithmetic (Panic 0x11) | **Runtime**, default to be confirmed (E8) |
| Reentrancy | State written before the external call. Optional `std::evm::Mutex` guard. | **Runtime** plus code structure |
| Verifier honesty | None | **Trust assumption** |

Fe effects give *capability* guarantees, meaning which code can touch which state. They do **not** give caller authorization, which is a runtime check.

## Storage (implemented in Phase 2A)
```
totals:     Totals                                   // next_id (last id issued; ids start at 1), outstanding (sum owed)
agreements: StorageMap<u256, Agreement>              // client, provider, verifier, review_period, n, deposited, paid, refunded
milestones: StorageMap<(u256, u8), Milestone>        // state, amount, deliver_by, decide_by, spec, evidence
```
`Totals` is one struct so the two counters are not bare `u256`/`Wei` effects, which Fe would resolve by type (FE_NOTES). Every key includes the agreement id, so agreements are isolated (I8). An unknown agreement id or an unused slot reads as all zeros, which decodes as `MilestoneState::None` because `None` is the **first** variant (D-017, verified by test).

`enum MilestoneState { None, Funded, Submitted, Approved, Paid, Refunded }`. Structs and the enum need `impl Copy` to be stored in a `StorageMap` (E2, E3).

## Handlers (D-016)
Every `recv` arm body is a shared `pub fn` in the production ingot (for example `refund_handler(id, m, to) uses (clock: Clock, ctx: Ctx, call: mut Call, milestones: mut .., ..)`). Arms in `Settlane` are one line, `with (Clock = Clock { now: ctx.timestamp() }) { refund_handler(..) }`. `SettlaneTestClock` (dev ingot) calls the same handlers with a settable Clock. Pure predicates stay in `rules.fe` and take `clock.now`. Only the `Claim` and `Refund` arms, and the handlers they call, may require `call`. An arm that **omits** `call` cannot call a handler requiring it (`error[8-0036]`, `experiments/review/s2_handler_omit_call.fe`), but an arm listing `call` read-only still can (E7), so the lint remains the guard. Evidence: `experiments/review/s1_shared_arm.fe`.

## Interface (`pub msg SettleMsg`; selectors via `sol("...")`)
Implemented in Phase 2A (the production ABI contains exactly these five functions and one event, locked by the lint):
| Message | Payable | Returns |
| --- | --- | --- |
| `Create { provider, verifier, review_period, n: u8, amounts: [Wei;3], deliver_by: [Timestamp;3], specs: [u256;3] }` | yes | agreement id (the first is 1) |
| `GetAgreement { id }` (reverts for an unknown id) | no | `(client, provider, verifier, review_period, n)` |
| `GetMilestone { id, m: u8 }` (unknown id or unused slot reads as state 0, all zero) | no | `(state, amount, deliver_by, decide_by, spec, evidence)` |
| `GetAccounting { id }` (reverts for an unknown id) | no | `(deposited, paid, refunded, outstanding)` |
| `TotalOutstanding` | no | `Wei` |

State codes: `None` 0, `Funded` 1, `Submitted` 2, `Approved` 3, `Paid` 4, `Refunded` 5. `n` is a `u8`, and the ABI decoder rejects a wider value rather than truncating it (tested, `experiments/review/u1_u8_abi.fe`).

Planned for Phase 3 and later, **not implemented**:
| Message | Payable | Returns |
| --- | --- | --- |
| `Submit { id, m, evidence }`, `Approve { id, m, evidence }`, `Reject { id, m, evidence }` (must match stored evidence, D-015; returns the milestone to `Funded`, D-006b) | no | none |
| `Claim { id, m, to }`, `Refund { id, m, to }` | no | amount sent |

Events: `AgreementCreated` (implemented: `id`, `client` and `provider` indexed, plus `verifier`, `total`, `milestones`). Later phases add `MilestoneSubmitted`, `MilestoneApproved`, `MilestoneRejected` (revision requested), `MilestoneClaimed`, `MilestoneRefunded`, with `id` indexed. **Emitted events cannot be asserted from `fe test`:** the Rust harness records logs, but the Fe `Evm` effect exposes no accessor (FE_NOTES). The event's presence and shape are locked by the ABI check instead.

## Payments
None yet: Phase 2A has no outgoing transfer, and `Settlane` declares no `Call` effect, so the compiler guarantees it cannot send ETH. The design below is for Phase 3.

- Pull only. Verification creates an entitlement, and `Claim` or `Refund` moves the ETH.
- Checks, then effects (state and counters), then the interaction (`call.send_value`), then `assert!(success)`. A failed send reverts the whole call, so no counter or state change can record a transfer that did not happen.
- Payouts go to a caller-chosen `to`, as in the starter's `Withdraw { to }`. A reverting recipient can only block its own claim, and the caller can retry with another `to`.
- `gas: 0` stipend semantics in `send_value` are to be confirmed (E6).

## Time
`ctx.timestamp()` with seconds granularity. Validators can skew it by a few seconds, which matters only at exact deadline boundaries. This is documented, not mitigated.

## Privacy
Only hash commitments (`spec`, `evidence`) go on-chain. Party addresses and amounts are public.

## Time and the test shell (D-009, provisionally approved)
Transition rules use `uses (clock: Clock)`. The production contract `Settlane` provides `Clock { now: ctx.timestamp() }` and nothing else. The dev ingot's `SettlaneTestClock` provides a settable clock from storage so integration tests can cross deadlines. It serves the identical `SettleMsg`, and every arm calls the same shared handler as `Settlane`, so the two differ only in where `Clock.now` comes from. A differential test runs both side by side. Verified 2026-11-18: **`fe build` emits every contract in the ingot, including those defined in test files**, so a shell in the production ingot would be built alongside `Settlane`. It must never be the deployable. Safeguards: the shell lives in a separate **dev ingot** of a Fe workspace so the production build does not emit it (E10, D-014 approved with conditions), lint rules `C-CLOCK`, `C-ABI` and `C-ARTIFACT`, its name, and an explicit README statement. D-014 is implemented: the dev ingot exists and the production build output is clean. `SettlaneTestClock` exists (Phase 2A).

## Testing architecture
- **Rule tests.** Plain `#[test]` functions over `rules.fe` with no EVM, in the production ingot. They cover the full matrix of (state × action × role × {t < d, t = d, t > d}).
- **Integration tests.** `uses (evm: mut Evm)`. The test contract acts as the client. Provider and verifier are small **Actor** contracts that forward calls, because the harness has no caller impersonation (Q4).
- **Negative tests.** `evm.try_call(...).success() == false`, followed by a state-unchanged check in the same test. `#[test(should_revert)]` is used where a whole-test revert is clearer.
- **Invariant helper.** Called after every step to check the accounting identity and contract balance.
- **Time-dependent integration paths** depend on Q5 (frozen test time). See `docs/FE_NOTES.md`.

## Demo
A dedicated `fe test` scenario (`demo_three_milestones`) runs the Phase 6 story and asserts balances at each step. It lives in the dev ingot (it needs the clock shell and actors) and runs with `fe test ingots/settlane-dev` or `python3 scripts/check_tests.py`.

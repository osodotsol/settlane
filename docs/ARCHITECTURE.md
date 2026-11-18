# Architecture (proposed, pending human approval)

## Shape
A single ingot holding one production contract. There is no backend, database, frontend, or off-chain service.

```
src/
  rules.fe      pure settlement rules: (state, role, now, deadlines) -> decision. No effects.
  settlane.fe   msg SettlaneMsg, events, contract Settlane (storage + transfers)
  lib.fe        module wiring (starter Vault removed in Phase 2, with approval)
  tests/…       rule tests (plain #[test]) and integration tests (uses Evm)
```

The module layout is confirmed in Phase 1. Fe maps `src/<name>.fe` to `ingot::<name>`, which the starter's `use ingot::{Vault}` shows working.

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

## Storage (sketch; Fe syntax unverified until Phase 1)
```
next_id: u256
agreements: StorageMap<u256, Agreement>            // client, provider, verifier, review_period, n, deposited, paid, refunded
milestones: StorageMap<(u256, u8), Milestone>      // amount, deliver_by, spec, evidence, state
total_outstanding: Wei
```
Fallback if struct or enum map values fail (E2/E3): one `StorageMap` per field, keyed the same way.

## Interface (msg SettlaneMsg; selectors via `sol("...")`)
| Message | Payable | Returns |
| --- | --- | --- |
| `Create { provider, verifier, review_period, n, amount0..2, deliver_by0..2, spec0..2 }` | yes | agreement id |
| `Submit { id, m, evidence }`, `Approve { id, m, evidence }`, `Reject { id, m }` (returns the milestone to `Funded`, D-006b) | no | — |
| `Claim { id, m, to }`, `Refund { id, m, to }` | no | amount sent |
| `GetAgreement { id }`, `GetMilestone { id, m }`, `GetAccounting { id }`, `TotalOutstanding` | no | views |

Events: `AgreementCreated`, `MilestoneSubmitted`, `MilestoneApproved`, `MilestoneRejected` (revision requested), `MilestoneClaimed`, `MilestoneRefunded`, with `id` indexed. Their use follows the starter's `#[event]` and `log.emit`.

## Payments
- Pull only. Verification creates an entitlement, and `Claim` or `Refund` moves the ETH.
- Checks, then effects (state and counters), then the interaction (`call.send_value`), then `assert!(success)`. A failed send reverts the whole call, so no counter or state change can record a transfer that did not happen.
- Payouts go to a caller-chosen `to`, as in the starter's `Withdraw { to }`. A reverting recipient can only block its own claim, and the caller can retry with another `to`.
- `gas: 0` stipend semantics in `send_value` are to be confirmed (E6).

## Time
`ctx.timestamp()` with seconds granularity. Validators can skew it by a few seconds, which matters only at exact deadline boundaries. This is documented, not mitigated.

## Privacy
Only hash commitments (`spec`, `evidence`) go on-chain. Party addresses and amounts are public.

## Time and the test shell (D-009, provisionally approved)
Transition rules use `uses (clock: Clock)`. The production contract `Settlane` provides `Clock { now: ctx.timestamp() }` and nothing else. A test-only contract `SettlaneTestClock` provides a settable clock from storage so integration tests can cross deadlines. Verified 2026-11-18: **`fe build` emits every contract in the ingot, including those defined in test files**, so the shell is built alongside `Settlane`. It must never be the deployable. Safeguards: the shell lives in a separate **dev ingot** of a Fe workspace so the production build does not emit it (E10, proposed as D-014, awaiting approval), lint rules `C-CLOCK`, `C-ABI` and `C-ARTIFACT`, its name, and an explicit README statement. Until D-014 is approved the single-ingot layout above remains, and the shell would be built with the production contract.

## Testing architecture
- **Rule tests.** Plain `#[test]` functions over `rules.fe` with no EVM. They cover the full matrix of (state × action × role × {t < d, t = d, t > d}).
- **Integration tests.** `uses (evm: mut Evm)`. The test contract acts as the client. Provider and verifier are small **Actor** contracts that forward calls, because the harness has no caller impersonation (Q4).
- **Negative tests.** `evm.try_call(...).success() == false`, followed by a state-unchanged check in the same test. `#[test(should_revert)]` is used where a whole-test revert is clearer.
- **Invariant helper.** Called after every step to check the accounting identity and contract balance.
- **Time-dependent integration paths** depend on Q5 (frozen test time). See `docs/FE_NOTES.md`.

## Demo
A dedicated `fe test` scenario (`demo_three_milestones`) runs the Phase 6 story and asserts balances at each step. It is reproducible with `fe test src/tests/demo.fe`.

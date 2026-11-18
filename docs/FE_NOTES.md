# Fe 26.6.0 notes — confirmed facts, open questions, experiments

Sources: the installed `fe 26.6.0 (5b3f96a)`, this repo's starter, the `argotorg/fe` tag `v26.6.0` (`ingots/std/src`, `crates/fe/tests/fixtures/fe_test`), and the 26.6 release notes. "Confirmed" means seen in compiling, tested code or std source. It does not mean tested by us unless marked **[ran]**.

## Confirmed
- CLI: `build check dev doc tree fmt test bench new …`. `fe test [PATH]` has `--backend sonatina|native`.
- **[ran]** `fe check`, `fe fmt --check`, and `fe test` (3/3) pass on the starter (2026-11-17).
- Manifest: `[ingot] name = "starter", version = "0.1.0"`, with no target set, so the default is EVM.
- Contracts: `pub contract C uses (ctx: Ctx, call: mut Call, log: mut Log) { fields; init(..) uses (mut f) {..}; recv Msg { Arm {..} -> T uses (..) {..} } }`. Handlers narrow the effects and fields they use.
- Messages: `msg M { #[selector = sol("f(address)")] Arm { x: Address } -> T }`. Payable arms use `#[payable]`.
- Events: `#[event] struct E { #[indexed] a: Address, .. }`, emitted with `log.emit(E { .. })`.
- `Ctx`: `caller() value() timestamp() block_number() balance(addr) selfbalance() address()`.
- `Call`: `send_value(addr:, gas:, value:) -> RawCallOutcome` with `.success()`. Also `call`, `try_call`, `static`, and `call_with_default`.
- `StorageMap<K, V>`: `get(key:)`, `set(key:, value:)`, `remove`. Tuple keys up to 6-ary implement `StorageKey`.
- `std::evm::Mutex<T>`: a transient-storage reentrancy lock (`lock`, `try_lock`, `unlock`).
- Units: `Wei::zero()`, `ether(n)`, `days(n)`, `Duration::zero()`, `Timestamp + Duration`, `ts.as_seconds()`.
- Storage packing changed in 26.6 (fields under 32 bytes share slots).
- Panics: 0x11 overflow, 0x21 invalid enum tag, 0x32 index out of range.
- User-defined effects exist: a struct type is used as an effect, `fn f() uses (s: Store)`, provided with `with (Store = value) { .. }`.
- Plain `#[test] fn` without `Evm` works, which allows pure-logic tests.
- **Test harness.** `#[test]` accepts only `balance = N`, `should_revert`, `panic = 0x..`, and `selector = 0x..`. The harness deploys and runs tests from `Address::ZERO` with `TxEnv`, and there are **no cheatcodes** for caller impersonation, time warping, or balance dealing. In tests, `evm.address()` is the test contract.
- Tests can use `evm.try_call(..).success()` to assert a revert without failing the test.

## Mismatches to fix
- CI pins `FE_VERSION: v26.5.0`, but we develop on 26.6.0, which changed the storage layout and Copy semantics. **Proposal:** bump CI to `v26.6.0` in Phase 1 (D-007).

## Open questions → Phase 1 experiments
Each experiment is the smallest compiling file under `experiments/` (or `src/experiments/`, depending on how the compiler discovers modules). Each gets a pass or fail line here. Experiments are deleted or excluded before submission.

| ID | Question | Pass criterion | Fallback |
| --- | --- | --- | --- |
| E1 | Can a payable handler compare `ctx.value()` to a sum of `Wei` arguments? | Exact match accepted, ±1 wei reverts | — (blocking) |
| E2 | Can a `StorageMap<(u256,u8), Struct>` round-trip? | get after set equals original | One map per field |
| E3 | Can an enum be a storage value, and can `match` on it be exhaustive? | Round-trip works, and a missing arm is a compile error | `u8` state codes and constants |
| E4 | **Actor pattern.** Can a deployed helper contract forward a typed message so `ctx.caller()` is the actor? | Settlane sees the actor's address | Raw calldata forwarding via `raw_call` |
| E5 | **Frozen time.** Is `ctx.timestamp()` constant across calls within one test? | Confirmed either way | — (determines Q5) |
| E6 | Does `send_value(gas: 0)` to a contract with no receive handler fail, and does `assert!` roll back state? | A rejecting recipient reverts the claim and leaves the state `Approved` | Recipient-chosen `to`, documented |
| E7 | Does calling `call.send_value` in a handler that does not declare `mut call` fail to compile? | Compile error | Drop that claim from the Fe highlight |
| E8 | Does `Wei` addition panic with 0x11 on overflow by default? | `should_revert, panic = 0x11` passes | Explicit checks |
| E9 | Can the `Clock` effect be provided in a handler via `with (Clock = Clock { now: ctx.timestamp() })`? | Compiles and runs | Pass `now` explicitly |

### Q4 — caller impersonation
There are no cheatcodes, so integration tests use Actor contracts (E4), with the test contract acting as the client.

### Q5 — testing expiry when time is frozen
If E5 confirms time is frozen, integration tests cannot cross a deadline. Options, chosen after Phase 1 with human approval:
- **A (recommended if E9 passes).** All transition logic lives in functions that `uses (clock: Clock)`. The ingot ships `Settlane`, where Clock comes from `ctx.timestamp()`, and a test-only `SettlaneTestClock` with an owner-settable time, both as thin `recv` shells over the same logic. The integration suite runs against both, and the expiry paths run against the test variant. Only `Settlane` is the deployable artifact.
- **B.** Expiry is covered by exhaustive pure rule tests at `t = d-1, d, d+1`. Integration tests cover rejection-refunds only. This is the weakest option, because the demo cannot show an expired milestone end to end.
- **C.** Relax creation to `deliver_by >= now`, so a milestone created with `deliver_by == now` is born expired. Rejected: it weakens production validation to suit the test harness.

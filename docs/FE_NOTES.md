# Fe 26.6.0 notes — confirmed facts, limitations, workarounds

Sources: the installed `fe 26.6.0 (5b3f96a)`, this repo, std source at `argotorg/fe` tag `v26.6.0`, and the 26.6 release notes.
**[ran]** means we executed it here. **[src]** means it was read in std or compiler source and is not yet exercised by us.

Reproduce every Phase 1 result with `bash experiments/phase1/run.sh` (exit 0 means every expectation holds, including the known gap).

## Phase 1 results (2026-11-17)
| ID | Question | Result | Evidence |
| --- | --- | --- | --- |
| E1 | Exact `msg.value` against a sum of `Wei` args | **PASS [ran].** Exact value accepted, ±1 wei rejected, reverted calls leave storage and balance unchanged. A non-`#[payable]` handler rejects value. | `e1_payable_exact.fe` (2 tests) |
| E2 | `StorageMap<(u256,u8), Struct>` | **PASS [ran]** after one fix. The first attempt failed with `error[6-0003]` because `StorageMap::get` requires `V: Copy`, so the struct needs `impl Copy for Milestone {}`. A field write through a projection, `ms[(id, m)].evidence = x`, works. Unset keys read as zero. Distinct ids are isolated. | `e2_struct_tuple_map.fe` |
| E3 | Enum as a storage value, exhaustive `match` | **PASS [ran].** It round-trips, an unset key reads as the first variant, and a missing arm is a compile error, `error[8-0034] non-exhaustive patterns`. The enum needs `impl Copy`. | `e3_enum_storage.fe`, `e3_fail_nonexhaustive.fe` |
| E4 | Actor contract forwards a typed message, so `ctx.caller()` is the actor | **PASS [ran].** A direct call from the test has `caller == evm.address()`. Two actors are seen as two distinct callers. | `e4_actor_caller.fe` |
| E5 | Is time frozen within a test? | **CONFIRMED frozen [ran].** `timestamp` and `block_number` are identical across deployment and 20 or more calls. The timestamp is nonzero. | `e5_frozen_time.fe` |
| E6 | `send_value(gas: 0)` failure and rollback | **PASS [ran].** A code-less address receives. A contract with no empty-calldata handler rejects the send, `assert!(success)` reverts the call, and the counter written *before* the send is rolled back (I7 holds by construction). | `e6_send_value_failure.fe` |
| E7 | Compiler blocks ETH transfer from a handler without `mut call` | **PARTIAL: omission is enforced, read-only narrowing is not.** See "E7 investigation" below. Summary: a `recv` arm that *omits* `call`/`create` cannot use them (`error[8-0012]`) [ran]. An arm that lists them **read-only is not narrowed, and really sends ETH** [ran]. | `e7_*.fe`, `e7/*.fe` |

### E7 investigation (2026-11-17, `fe 26.6.0 (5b3f96a)`)
Where the rule *is* and *is not* enforced:
| Context | Read-only binding + `mut self` method | Evidence |
| --- | --- | --- |
| Contract **field** (`uses (count)`) | rejected `8-0018` | `e7_fail_readonly_field.fe` |
| Free fn, built-in `Call` | rejected `8-0066` | `e7/f` |
| Free fn, built-in `Log` | rejected `8-0066` | `e7/g` |
| User trait effect (also with a seal supertrait like std's) | rejected `8-0066` | `e7/a`, `e7/e`, `e7_fail_user_effect_mut.fe` |
| Contract-level `call: Call`, arm asks `mut call` (upgrade) | rejected `8-0066` | `e7/h` |
| **Contract arm `uses (call)` read-only → `send_value`** | **accepted, sends ETH** [ran] | `e7_fail_readonly_call.fe`, `e7_readonly_call_runtime.fe` |
| **Contract arm `uses (call)` read-only → typed `call.call(value: 1 ETH)`** | **accepted** | `e7/b` |
| **Contract arm `uses (create)` read-only → value `create2_raw`** | **accepted** | `e7/c_create_readonly.fe` |
| **Contract arm `uses (log)` read-only → `log.emit`** | **accepted** | `e7/i` |
| **Read-only arm hands `call` to a free fn that requires `mut Call`** | **accepted; 1 ETH moved** [ran] | `e7/j_contract_arm_calls_free_fn.fe`, `e7/j_runtime.fe` |
| Arm that **omits** `call` / `create` | rejected `8-0012` | `e7_fail_undeclared_call.fe`, `e7/c_create_omitted.fe`, `e7/d` |

**Reading:** the contract-level declaration (`uses (call: mut Call)`) is the upper bound and cannot be exceeded by an arm. Inside that bound, the arm-level `mut` keyword on a built-in *contract* effect does not narrow anything: the arm effectively gets the contract's access. The same shape is enforced for fields, free functions, and user effects, so this is most likely a compiler bug in contract-arm effect narrowing, not intended design.

**Other ETH-moving routes:** the raw opcodes (`call`, `create`, `create2`, `selfdestruct`) are `pub(ingot)` in std and not reachable from user code [src]. The `Address::call` helper sends no value and itself needs `mut Call`. So within user code, value moves only through the `Call` and `Create` effects.

**Consequence for Settlane.** An arm that omits `call` and `create` cannot move ETH. That is the **only** compile-time guarantee. It does not catch an arm that lists `call` read-only. We therefore claim exactly this and back it with (a) a mechanical lint that `call` appears only in the `Claim` and `Refund` arms (D-012), and (b) a behavioral invariant, I11, that every non-payout transition leaves `selfbalance` unchanged.
| E8 | Checked `Wei` arithmetic | **PASS [ran].** Overflow and underflow both give `Panic(0x11)`, and `MAX-1 + 1` succeeds. | `e8_wei_overflow.fe` (3 tests) |
| E9 | Custom `Clock` effect provided via `with` | **PASS [ran].** `struct Clock { now: Timestamp }` is used as an effect. A production shell provides it with `with (Clock = Clock { now: ctx.timestamp() }) { .. }`, and a test shell provides it from a settable storage field. Both serve the same `msg`, so one test helper drives either. Pure tests run boundary times (999, 1000, 1001) with no EVM. Calling a Clock-using function without providing Clock is rejected with `error[8-0036] missing effect`. | `e9_clock_effect.fe`, `e9_fail_missing_clock.fe` |

## Confirmed syntax and behavior
- Contract: `pub contract C uses (ctx: Ctx, call: mut Call, log: mut Log) { mut f: T, init(..) uses (mut f) {..}, recv Msg { Arm {..} -> R uses (ctx, mut f) {..} } }`. **A handler sees only what its own `uses` lists** [ran, E7].
- Msg: `msg M { #[selector = sol("f(uint256,uint8)")] Arm { a: Wei, m: u8 } -> T }`. `Wei` and `Timestamp` ABI-encode as `uint256`. `#[payable]` marks value-accepting arms [ran].
- A contract with no payable init rejects value at `create2`, which surfaced as `Test reverted: 0x` (E6 first attempt) [ran].
- Calls: named arguments are required (`f(deliver_by: d)`). A variable with the same name as the label may be passed bare. The wrong label gives `error[8-0024]` [ran].
- `match` arms with blocks: `_ => { assert!(false, "..") ; Value }` [ran].
- `with (Effect = value) { .. }` is a statement block. Return values by assigning to an outer `var` [ran, E9].
- Units: `wei(n)`, `ether(n)`, `days(n)`, `Timestamp::from_seconds(n)`, `ts.as_seconds()`, `Timestamp + Duration`, `Timestamp < Timestamp` [ran].
- `Address::new(0x1234)` creates a code-less address that accepts `send_value` [ran].
- `std::evm::Mutex<T>` is a transient reentrancy lock [src].
- Storage packing changed in 26.6 [src, release notes].

## Test harness
- `#[test]` options: `balance = N`, `should_revert`, `panic = 0x..`, `selector = 0x..` [src]. `should_revert, panic = 0x11` works [ran].
- **A bare `should_revert` passes on any revert, including one in the setup** [ran, review M2]: starving the setup call of gas made the old Vault negative test pass without reaching the call under test. Write negative tests as a plain `evm.call` setup, a positive control, then `assert!(!evm.try_call(..).success())` and unchanged state. Lint rule `T-REVERT` rejects `should_revert` without `panic = ..`.
- There are no cheatcodes. All calls run from the test contract (`evm.address()`) within **one frozen block** [ran, E4/E5].
- `evm.try_call(..).success()` asserts a revert without ending the test, and the reverted call's effects are discarded [ran, E1/E6].
- Plain `#[test] fn` with no `Evm` runs pure logic [ran, E9].
- `fe test <file>.fe` and `fe check --standalone <file>.fe` work on files outside the ingot. Root-level `fe check`, `fe test` and `fe build` do **not** pick up `experiments/` [ran].

## Limitations and workarounds
| Limitation | Workaround | Security impact |
| --- | --- | --- |
| No caller impersonation | Actor contracts (E4) | None. Tests stay real EVM calls. |
| Time frozen per test | `Clock` effect with prod and test shells (E9) | The test shell must never ship as the product. The prod shell has no setter (E9 test). |
| Arm-level read-only is not enforced for built-in contract effects `Call`, `Create`, `Log` (E7) | Handlers that must not move ETH **omit `call` and `create` entirely**. Add a lint for it (D-012) and the I11 balance-unchanged invariant. | The compile-time guarantee holds only for omission. We claim exactly that and nothing stronger. |
| `gas: 0` gives a 2300 stipend, and Fe contracts without an empty-calldata handler reject ETH | The payee chooses `to`, for example an EOA [E6] | Contract wallets may need a different `to`. Documented limitation. |
| Struct and enum map values need `impl Copy` | Add it | None |

## Build finding (2026-11-18)
**`fe build` emits every `pub contract` in the ingot, including ones defined in `src/tests.fe`.** Verified on a scratch copy: a `TestOnlyShell` contract in the test file produced `out/TestOnlyShell.{bin,runtime.bin,abi.json}`. There is no test-only `cfg` in 26.6 (`#[cfg]` supports `target`, `target_os`, `target_family`). So a test shell for the clock cannot be hidden from the build, and the safeguards are lint rules `C-CLOCK` and `C-ABI`, naming, and documentation (`docs/LIFECYCLE.md` PC). E10 below shows a workspace layout that keeps it out of the production `out/`.

## E10: separating the test-clock shell from production artifacts (2026-11-18)
Workspace `experiments/phase1/e10_separate_ingots/` with `members = { main = ["ingots/prod"], dev = ["ingots/devkit"] }` and `default-members = ["ingots/prod"]`. `prod` has the `Clock` effect, the rule and the contract `Prod`. `devkit` (`[dependencies] prod = true`) has `ProdTestClock`, which reuses `prod::delivery_open` with a settable clock, plus the integration test.
| Question | Result | Evidence |
| --- | --- | --- |
| Does a dev ingot compile against the production ingot, reusing `pub struct Clock`, a `pub fn ... uses (clock: Clock)` and `pub msg`? | **Yes** (fields need `pub`). | `fe check` exit 0 [ran] |
| Does `fe build` at the root emit the shell? | **No.** Only `Prod.{bin,runtime.bin,abi.json}`. | [ran] |
| Can the shell still be built on purpose? | **Yes**: `fe build ingots/devkit --out-dir <dir>` emits `ProdTestClock.*`. | [ran] |
| Do dev-ingot tests run? | **Yes**, by path: `fe test ingots/devkit`, or both suites: `fe test ingots/prod ingots/devkit`. | [ran] |
| Does `fe test` at the root run them? | **No.** It runs default members only, and prints `Warning: No tests found` with **exit 0** when `prod` has none (a false green). `fe test -i devkit` fails with "No workspace member named devkit": `dev`-group members are not selectable with `-i`. | [ran] |
| Alternative: both members as `default-members` | `fe test` then runs the dev tests, but plain `fe build` emits the shell as well. `fe build -i prod` emits `Prod.*` only. | [ran] on a scratch copy |
| Is the production bytecode that the dev tests deploy identical to the shipped artifact? | **Not verifiable.** `fe build ingots/devkit --contract Prod` fails ("Prod not found, available: ProdTestClock"), so a dependency's contract cannot be built through the dev ingot for a byte comparison. | [ran] |
Result: separation works. Recommendation is `default-members = [production only]`, because the dangerous command (`fe build`, used to produce deliverables) is then safe by default, and the explicit test command is documented and run in CI (D-014). Lint rule `C-ARTIFACT` fails CI if a test-only or unlisted contract appears in the build output.

### D-014 implementation notes (2026-11-18)
Verified while building the real workspace (`ingots/settlane`, `ingots/settlane-dev`):
| Fact | Evidence |
| --- | --- |
| A member directory name may differ from the ingot name: `{ path = "ingots/settlane-dev", name = "settlane_dev" }` works, and a hyphenated directory is fine. | [ran] |
| `[dependencies] settlane = true` in the dev manifest resolves the sibling member, and `use settlane::Vault` works because the contract is `pub`. | [ran] |
| A `msg` must be `pub` to be used from another ingot (`error[2-0003] VaultMsg is not visible`). Not changing production code for tests, the dev ingot mirrors the selectors in its own `pub msg`. | [ran] |
| `fe build` at the root emits only the default member (`Vault.*`). With the dev ingot added to `default-members` it also emits `Actor.*`, which `C-ARTIFACT` catches. | [ran], real build |
| **Root `fe check` does not cover the dev ingot**: a type error planted in it exits 0. Check it by path: `fe check ingots/settlane-dev`. | [ran] |
| **A bare `fe fmt --check` at the workspace root fails** with `Error: No .fe files found` (exit 1), and `fe fmt --check .` also exits 1. `fe fmt --check ingots` works and fails correctly for a formatting error in either ingot (checked separately). `fe fmt` takes one path only. | [ran] |
| `fe test <ingot path> <ingot path>` prints per-ingot lines `READY [..]  <ingot> running N test(s)` (`test` is singular for 1) and a summary `test result: ok. P passed; F failed`. `scripts/check_tests.py` parses these. | [ran] |
| With the dev tests deleted, `fe test` still reported `ok. 3 passed` and exit 0, with only a `Warning: No tests found`. The gate catches it. | [ran] negative control |
**Correction:** an earlier note (E10 probe) read `exit=1` from the root `fe fmt --check` as proof that it covers the dev ingot. That exit code was the "No .fe files found" error, so the conclusion was wrong and has been replaced by the rows above.

## Review 2026-11-18 facts
Evidence in `experiments/review/` (all re-run by `bash experiments/review/run.sh`). Context: `docs/reviews/2026-11-18-phase1.md`.
| Fact | Evidence |
| --- | --- |
| A contract effect type may be written fully qualified (`call: mut std::evm::Call`) or through an import alias (`use std::evm::Call as Pay`). Both compile and send ETH. | `b1_qualified_type.fe`, `b2_alias.fe` [ran] |
| `msg` variants and `recv` arms may be lowercase (`approve { to: Address }`). | `b3_lowercase.fe` [ran] |
| A contract may declare `raw: mut RawStorage` (needs `use std::evm::RawStorage`; without the import the arm's `raw` is `error[8-0012] undefined variable`). `unsafe { raw.sstore(slot: 0, value: 7) }` overwrites a compiler-allocated field from any arm listing `mut raw`. | `r2_rawstorage.fe` [ran] |
| `let ctx = Fake { t }` shadows the `ctx` effect inside an arm, and a user struct can be an effect bound to the name `ctx` (`uses (ctx: Fake)`, provided by `with (Fake = ..)`). A user `struct Ctx` also compiles. So the text `ctx.timestamp()` does not prove the time comes from the block. | `c2_clock_shadow.fe`, lint fixtures `bad_clock_ctx_lookalike_effect.fe`, `bad_shadow_std_effect_name.fe` [ran] |
| `type Tick = Clock` works, and `Tick { now: t }` builds a Clock. | `c3_clock_alias.fe` [ran] |
| `#[selector = sol("f(uint8)")]` is type-checked against the fields (`error[9-0006]` on a mismatch). A numeric `#[selector = 0x12345678]` is not, so two messages can share a selector with different field types. | `u1_u8_abi.fe` [ran] |
| **A `u8` argument out of range is rejected at ABI decode** (300 reverts, 2 succeeds through the same wide message). | `u1_u8_abi.fe` [ran] |
| A whole handler can be one shared `pub fn` taking contract fields as effects (`owed: mut StorageMap<u256, Wei>`) plus `clock: Clock`, `ctx: Ctx`, `call: mut Call`. Two contracts call it with different Clock sources (D-016). | `s1_shared_arm.fe` [ran] |
| An arm that **omits** `call` cannot call such a handler (`error[8-0036] missing effect Call`). An arm listing `call` read-only can (E7). | `s2_handler_omit_call.fe` [ran] |
| **`fe build` never clears `out/`**: a file placed there survives a rebuild. `--emit bytecode,runtime-bytecode` writes `.bin` and `.runtime.bin` with no `.abi.json`. CI therefore runs `rm -rf out` first, and `C-ARTIFACT` checks every file. | review M1 [ran] |

### Phase 2A facts (2026-11-18, all [ran])
| Fact | Evidence |
| --- | --- |
| Every `.fe` file in a `src/` directory is a module: `use ingot::types::{..}`, `use ingot::handlers`, and from another ingot `use settlane::handlers` and `use settlane::settlane::SettleMsg` (an ingot and a module may share the name). `lib.fe` needs no `mod` lines. | `ingots/settlane*/src` |
| A shared handler is a `pub fn` whose contract fields arrive as `uses` parameters (`milestones: mut StorageMap<(u256, u8), Milestone>`, `totals: mut Totals`), resolved **by type**. A struct-typed field works as an effect, which is why the two counters live in one `Totals` struct. | `handlers.fe` |
| Arrays work as message fields and parameters (`[Wei; 3]`, `[Timestamp; 3]`, `[u256; 3]`) and encode as `uint256[3]`. A 6-tuple return works. Array indices must be `usize` (`error[8-0000]` for `u8`): `amounts[i as usize]`, a lossless widening. | `settlane.fe`, ABI |
| Argument labels are required unless the variable has the parameter's name (`error[8-0024]`): `rules::decide_by(deliver_by: x, review_period: y)`. | compiler |
| **`own` is a reserved word** (`let own = ..` fails with `expected pattern`). | compiler |
| **`Timestamp + Duration` and `Wei` arithmetic are checked** by default: overflow reverts with `Panic(0x11)`, so no extra check is needed for `decide_by`. `Duration` is built with the free function `seconds(n)`, not `Duration::from_seconds`. | `rules_decide_by_overflow_panics` |
| `sol("..")` is **checked against the field types** (`error[9-0006]: selector declares uint8 but field n has ABI type uint256`). A message that mirrors a function with a wider field type must use the raw 4-byte selector, computed with Keccak-256: `create(...)` is `0x75ac1b9d`. | `a_wide_n_is_rejected_at_decode_and_never_truncated` |
| A `u8` message field is range-checked at ABI decode: `n = 256` and `259` are rejected instead of wrapping. | same test |
| An unset storage key reads as the first enum variant, so `MilestoneState::None` first makes unknown ids and unused slots read as `None` (D-017). Swapping the order makes the tests fail. | mutation `mut-none-not-first-variant` |
| `with (Clock = ..) { .. }` is a statement block: a returned value goes through an outer `var`. | `settlane.fe` |
| **Events are observable from the command line, not from Fe test code.** `fe test --show-logs` prints every log of every test (topics and data); the Fe `Evm` effect still has no accessor, so a test cannot assert on them itself. `scripts/check_events.py` runs `fe test --show-logs --jobs 1` and decodes them. **Correction:** this note and ARCHITECTURE/SECURITY said events could not be tested at all, which was wrong, found by R-002 finding 4. | `fe test --help`, `scripts/check_events.py` |
| Production `Settlane` with `uses (ctx: Ctx, log: mut Log)`: runtime 2124 bytes (limit 24576), five functions and one event in the ABI, no constructor arguments. | `fe build` |
| `rm -rf out` before every `fe build`: it never clears `out/` (review M1). | CLAUDE.md |

### R-002 facts (2026-11-18, all [ran])
| Fact | Evidence |
| --- | --- |
| **A `recv` arm with a numeric selector (`#[selector = 0x..]`) is callable but missing from the ABI JSON.** The compiler only warns (`skipping recv arm `Hidden`: selector signature is unknown`), so an ABI allowlist alone cannot see it. The lint now rejects every selector that is not `sol("..")` in the production ingot, and compares the number of source arms with the number of ABI functions. | `experiments/review/a1_numeric_selector.fe` |
| **A Clock that is constructed correctly can still be changed before the handler runs**: `var c = Clock { now: ctx.timestamp() }; c.now = x; with (Clock = c)` and `with (Clock = mut c)` with a `uses (clock: mut Clock)` handler both compile and work. The lint now allows the identifier `Clock` only in its declaration, imports, `uses (name: Clock)` and the one literal `with (Clock = Clock { now: ctx.timestamp() })`. | `d1_clock_var_mutation.fe`, `d2_clock_mut_effect.fe` |
| `fe fmt` wraps a long header so that `uses (..)` starts its own line. The arm splitter treated that as a new arm named `uses` (a latent bug since the H2 fix allowed lowercase arm names), which would have flagged a wrapped payout arm as a non-payout arm. Fixed, with `ok_wrapped_payout_arm` and `bad_wrapped_nonpayout_arm` fixtures. | found by the arm/ABI count check |
| `std::evm::predict_create2<C>(deployer, args, salt)` gives a contract's future address, and an address with no code accepts ETH. So a test can send ETH to the address before deploying there, which is how a surplus is created in a test (the contract has no `receive`). `evm.send_value(addr:, gas:, value:)` sends it. | `surplus_eth_keeps_balance_at_or_above_outstanding_and_is_never_owed` |
| A regex with `\s*` followed by a negative lookahead backtracks: `=\s*(?!sol\()` matched `= sol(` by giving a space back. Use `(?=\S)` before the lookahead. | lint self-test |

### R-003 facts (2026-11-18, all [ran])
| Fact | Evidence |
| --- | --- |
| **A Fe test can emit an event from the test contract itself**: `evm.emit(CallerProbe { who: evm.address() })`. The log's address is the test contract, so the test contract's own address becomes an independent fact that `fe test --show-logs` exposes. A test-only `#[event]` struct in `tests.fe` needs nothing else. | `ingots/*/src/tests.fe`, `scripts/check_events.py` |
| The compiled ABI JSON has **empty output names**, so an ABI check can lock output types and their order but not what each position means. | built `Settlane.abi.json` |
| A cast from `u256` to `usize` is not lossless (`error[8-0055]`). Index with a `u8` loop variable (`i as usize`). | compiler |
| `ctx.selfbalance()` and `ctx.origin()` are `Ctx` methods, usable in a handler without any extra effect (used by the surplus and `tx.origin` mutation controls). | controls |

### Phase 2B facts (2026-11-18, all [ran])
| Fact | Evidence |
| --- | --- |
| **A Fe test can assert the revert reason**: `let out = evm.try_call(..)`, then `out.returndata().index_of("reason text").is_some()`. The `assert!` message is in the revert data. `CallOutcome` is imported with `use std::evm::CallOutcome`. | probe, `because()` in both test files |
| **The reason survives being forwarded through a contract** (the dev Actor): a typed `call.call(..)` re-raises the callee's revert data. | `only_the_provider_submits_and_only_the_verifier_reviews` |
| An arm with a unit return and no `uses` clause parses its body as a record pattern (`Boom {` then `assert!` is an error). Give it a return type or a `uses` clause. | probe |
| A `Milestone { .. }` literal must list every field (`error[8-0011] missing fields`), and there is no struct update syntax, so a transition rebuilds the struct from the old value. | `handlers.fe` |
| `u8` is valid as an indexed event field (`uint8 indexed` in the ABI), and an event can have three indexed fields plus data. | built ABI |
| `fe fmt` wraps a long expression into a multi-line form, so a text mutation must target the formatted text. The control runner reformats after mutating. | controls |

### Phase 3A facts (2026-11-19, all [ran])
| Fact | Evidence |
| --- | --- |
| An untyped `recv { .. }` block can end with a **payable fallback** `#[payable] _ uses (..) { .. }`, which runs for empty calldata, so a Fe contract can receive plain ETH from `send_value`. A typed `recv Msg { .. }` block without it rejects plain ETH. | `Reentrant` in `ingots/settlane-dev/src/lib.fe`; `a_failed_transfer_..` (the Actor rejects) |
| `ctx.gas()` reports the remaining gas. Inside a fallback reached by `send_value(gas: 0)` it is at most the 2300-gas stipend. **Caveat found by R-005 (F-2):** the first attacker (`Reentrant`) returned early below 60,000 gas, so its `stats == (0, 0)` showed its own threshold, not the stipend; the claim that it "cannot even attempt" a nested call was not measured. The tests that measure the stipend are the two attackers without a threshold (`Greedy`, `Once`) and `GasCap`. | `a_provider_that_always_re_enters_..`, `a_provider_that_re_enters_once_..`, `a_payee_is_given_no_more_than_the_2300_gas_stipend` |
| A reverted call's events are discarded: `fe test --show-logs` does not print the `MilestoneClaimed` of a claim whose transfer failed. | the exact claim sequence of `a_failed_transfer_..` in `check_events.py` |
| `send_value` returns a `#[must_use]` outcome: an unused result is `error[8-0082]`, so ignoring it needs an explicit `let _ =` (which lint `C-XFER` rejects in production). | `fe check` |
| A test function cannot fund an `Actor` with `send_value` (it has no fallback), but a payable message arm forwards `ctx.value()`. | `claim_is_not_payable` |
| `fe fmt` puts each item of a long arm `uses (..)` list on its own line. The lint's arm splitter now counts parentheses as well as braces, or it reads the wrapped list as extra arms. | fixtures `ok_multiline_uses_payout_arm.fe`, `bad_multiline_uses_nonpayout_arm.fe` |

### R-005 facts (2026-11-19, all [ran])
| Fact | Evidence |
| --- | --- |
| `Call` exposes `raw_call`, `try_call_raw`, `call`, `try_call`, `raw_delegatecall` and `delegate`, not only `send_value`. Any code holding `mut call` can use them, so a rule that looks for `send_value` alone sees nothing. The lint now rejects every method but `send_value` on the Call binding, and any Call binding not named `call`. | `experiments/review/r005/patches/b2*`, fixtures `bad_xfer_*` |
| `gas: 0 + 57000` compiles and forwards 57,000 gas. A check that searches the argument text for `gas: 0` accepts it. | patch b1, b7 |
| A **write after the send is invisible to every test** while the stipend is intact (a stipend send cannot re-enter, and a failed send reverts the writes). Only the code shape can enforce checks, effects, interaction. | patches b2b, b3, b4 (all green before R-005) |
| `fe fmt` reflows a long call, so a text mutation must target the formatted text; the controls run `fe fmt` after mutating, and the saved patches are applied with `-F3`. | `scripts/ci_negative_controls.py` |
| A stipend send to the `Once` attacker succeeds when the callee only reads a storage slot that the same transaction already wrote (warm, about 100 gas), and fails when the fallback must write it (an SSTORE needs more than 2300 gas). | `a_provider_that_re_enters_once_..` (control and attack) |

### b6: Fe 26.6.0 backend panic on a `#[test]` helper that a contract calls (R-005, recorded separately)
**Not a Settlane bug, and not caused by the lint.** A function carrying `#[test]` in the production ingot's `handlers.fe`, called from the handler `claim_handler` (`uses (call: mut Call)`, body `let _ = call.send_value(..)`), is accepted by `fe check` and by `fe build` (the build emits `Settlane.runtime.bin`), but `fe test ingots/settlane` panics while emitting the test module:
```
thread '<unnamed>' panicked at crates/mir/src/runtime/synthetic.rs:945:9:
assertion `left == right` failed: synthetic owner-effect arg count mismatch for RuntimeInstance(..)
  left: 0
 right: 2
Sonatina backend panicked while emitting test module: assertion `left == right` failed: synthetic owner-effect arg count mismatch ...
test result: FAILED. 0 passed; 1 failed
    settlane::codegen
```
fe 26.6.0 (5b3f96a). Reproduction: `experiments/review/r005/patches/b6_test_attribute_on_helper.patch` applied to `ingots/settlane/src/handlers.fe` at `b3a12f1`, then `fe fmt ingots && fe check && fe build && fe test ingots/settlane`. `bash experiments/review/r005/run.sh` asserts this behavior, so an upstream fix shows up as a changed result. What matters for Settlane: before R-005 the old lint exempted every `#[test]` function from the transfer rules, so this shape also passed the lint; now `C-TEST` rejects `#[test]` outside `tests.fe` and `C-XFER` rejects the send. The crash was only the incidental reason the tests failed. Draft upstream report: a `#[test]` function that is also reachable from a contract entry point with an owner effect should be rejected with a diagnostic, not crash codegen.

## Still unverified (Phase 2–4 checks)
- Is the production contract deployed by the dev-ingot tests byte-identical to the shipped `Prod` artifact? It is the same source and compiler, but `fe` offers no way to compare. Mitigation: all tests that do not need time travel live in the production ingot.
- A reentrant recipient under the 2300 stipend: **tested for Claim** (Phase 3A, strengthened by R-005). Measured: an attacker that always re-enters cannot finish its fallback under the stipend (the send fails and the claim reverts with `transfer failed`), and the same attacker given 500k gas re-enters and claims. EIP-2200's SSTORE rule is not probed separately. Refund needs the same tests in Phase 3B.
- `#[event]` with `Wei` and `u8` fields, and the event ABI.
- Gas and code size of the full contract (`fe build --emit sizes`).

## Draft upstream report (owner decides whether to file it)
> **`recv` arms are not narrowed to a read-only built-in effect binding.** In a contract declaring `uses (call: mut Call)`, an arm written `uses (call)` (no `mut`) can call `call.send_value(..)` (declared `fn send_value(mut self, ..)`), and ETH is transferred. The same applies to `Create` and `Log`, and the arm can pass the binding to a free function requiring `mut Call`. The identical pattern is rejected with `error[8-0066]` for free functions, user-defined effects, and contract fields, and an arm cannot upgrade a read-only *contract-level* binding. Minimal repro: `experiments/phase1/e7_fail_readonly_call.fe` (compiles) and `experiments/phase1/e7/j_runtime.fe` (1 ETH moves). fe 26.6.0 (5b3f96a).

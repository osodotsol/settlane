# Settlane

**Pitch:** Settlane is a Fe contract that settles each milestone of a digital-service agreement on its own: approved work becomes the provider's to claim, expired work becomes the client's to refund, and the accounting identity `deposited = paid + refunded + outstanding` holds after every transition.

> **Prototype for test ETH only.** Settlane is unaudited and has run only on a local chain and on the Sepolia testnet. The verifier is a trusted party. Do not use it with real funds. See [Limitations](#limitations).

## The problem

A client paying for digital work risks paying for work that never arrives; a provider risks delivering and not being paid. All-or-nothing escrow treats a partly delivered agreement as entirely paid or entirely refunded. Settlane fixes the settlement rules in advance, per milestone: every milestone has its own amount, delivery deadline and review window, and ends in exactly one of `Paid` or `Refunded`. Milestone escrow is not a new idea (`docs/MARKET.md`); the contribution here is a small, fully specified state machine written in Fe, with every rule tested at its boundaries.

## Approach

- **One payable call creates and funds an agreement** (D-003): 1 to 3 milestones, `msg.value` exactly equal to their sum, three pairwise-distinct parties (client = caller, provider, verifier), deadlines in the future. There is no unfunded agreement state.
- **The provider submits** an evidence hash before `deliver_by`, and may resubmit; every accepted submission increments a revision number.
- **The verifier approves or rejects** before `decide_by = deliver_by + review_period`, naming the exact evidence hash *and* revision it reviewed, so a decision about an earlier submission can never land on a newer one. A rejection is a revision request: the milestone goes back to `Funded`.
- **Pull payments:** the provider claims an approved milestone (no deadline; approval never expires), and the client refunds a milestone that expired unapproved. Each side chooses the payee address `to`.
- **Every rule reverts with a named reason**, checked in one fixed order: agreement, role, milestone, state, window, then the argument.

The full transition table, with every guard and revert reason, is [`docs/LIFECYCLE.md`](docs/LIFECYCLE.md). Any (state, action, caller, time) combination not listed there reverts.

| # | From | Action | Caller | Guard | To | ETH |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | — | `create` | anyone (becomes client) | creation rules | each slot `Funded` | in: exactly the total |
| T2 | Funded, Submitted | `submit(e)` | provider | `now < deliver_by`, `e != 0` | Submitted, revision + 1 | none |
| T3 | Submitted | `approve(e, rev)` | verifier | `now < decide_by`, `e` and `rev` match | Approved | none |
| T4 | Submitted | `reject(e, rev)` | verifier | `now < decide_by`, `e` and `rev` match | Funded, evidence cleared | none |
| T5 | Approved | `claim(to)` | provider | `to != 0` | Paid | out: the stored amount |
| T6 | Funded or Submitted | `refund(to)` | client | expired, `to != 0` | Refunded | out: the stored amount |

Expired means `now >= deliver_by` for a `Funded` milestone and `now >= decide_by` for a `Submitted` one, so at every timestamp submission and refund, and review and refund, are mutually exclusive.

## Fe highlight

**Time is an effect, so the same handler runs under two clocks.** Every settlement rule is a pure function in `rules.fe` that takes `now` as an argument. Every handler in `handlers.fe` reads time only through a `Clock` effect. The production contract provides that effect from the block, and nothing else:

```fe
// ingots/settlane/src/settlane.fe — the production Submit arm
Submit { id, m, evidence } uses (ctx, mut log, agreements, mut milestones) {
    with (Clock = Clock { now: ctx.timestamp() }) {
        handlers::submit_handler(id, m, evidence)
    }
}
```

A test-only contract in a separate dev ingot (`SettlaneTestClock`) serves the identical message set and calls the identical handlers, but provides `Clock { now }` from a settable field. Tests can therefore cross every deadline (d-1, d, d+1) against the shipped handler code, while the production contract has no time setter at all. The two contracts differ only in where `Clock.now` comes from (D-009, D-016).

**Effects restrict who can send ETH.** A handler sees only the effects its `uses` clause lists. `submit_handler`, `approve_handler` and `reject_handler` do not list `Call`, and the compiler rejects any call that would need it (`error[8-0036] missing effect Call`). Only `claim_handler` and `refund_handler` require `call: mut Call`.

What the compiler does **not** guarantee, and how the gap is closed: a `recv` arm that lists `call` *read-only* can still pass it to a handler that needs `mut Call`, and that compiles and sends ETH (`docs/FE_NOTES.md` E7, reproduced independently). The project therefore claims only omission-based enforcement. The rest is held by a policy lint (`scripts/settlane_lint.py`: only the Claim and Refund arms may mention `call`, and ETH leaves only through one approved statement form), and by tests whose parties can receive ETH, so any send from a verification step changes a balance.

## Architecture

| Path | Contents |
| --- | --- |
| `fe.toml` | Workspace. `default-members` is the production ingot only, so `fe build` never emits a test contract (D-014). |
| `ingots/settlane/src/types.fe` | Storage types, the `Clock` effect, the six events. |
| `ingots/settlane/src/rules.fe` | Pure rules: one ordered check per action returning the first failed rule; the time predicates. No effects. |
| `ingots/settlane/src/handlers.fe` | Shared handler bodies. Each checks every rule first, then writes, and Claim/Refund send last (checks, effects, interaction). |
| `ingots/settlane/src/settlane.fe` | The `SettleMsg` ABI (`sol(..)` selectors) and the `Settlane` contract. Each arm only provides the clock and calls its handler. |
| `ingots/settlane/src/tests.fe` | Production-ingot tests (pure rules and the real contract under the frozen test block). |
| `ingots/settlane-dev/` | Test-only: the settable-clock shell, actor contracts (separate callers, receive-capable or not), reentrancy attackers (`Reentrant`, `Greedy`, `Once`, `Cross`, `GasCap`) and the deadline-crossing tests. Never built by default and never deployable. |
| `scripts/` | Policy lint, test gate (fails if too few tests ran), event checker (decodes every event from `fe test --show-logs`), CI negative controls. |
| `experiments/anvil/` | Production bytecode on a local Anvil with controlled block timestamps. |
| `experiments/sepolia/` | The Sepolia plan runner, a read-only deployment verifier and a local rehearsal. |
| `docs/` | Specification (`LIFECYCLE.md`), security model (`SECURITY.md`), decisions, Fe notes, progress. |

Storage: `totals` (last id, global outstanding), `agreements: StorageMap<u256, Agreement>`, `milestones: StorageMap<(u256, u8), Milestone>`. Every key includes the agreement id, so agreements are isolated. Agreement status is derived, never stored.

Public functions: `create`, `submit`, `approve`, `reject`, `claim`, `refund`, and the views `getAgreement`, `getMilestone`, `getAccounting`, `totalOutstanding`. The ABI is locked by the lint (`scripts/lint-policy.json`).

## Build and test

Requirements: Fe **26.6.0** exactly (`fe --version` prints `fe 26.6.0 (5b3f96a)`), Python 3. Anvil is needed only for the optional local-chain checks.

```sh
fe fmt --check ingots                       # format, both ingots
fe check && fe check ingots/settlane-dev    # the root check sees the production ingot only
python3 scripts/check_tests.py              # fe test for BOTH ingots; fails if too few tests ran
python3 scripts/check_events.py             # decodes every event and replays it as the state machine
rm -rf out && fe build                      # production ingot only: out/Settlane.{bin,runtime.bin,abi.json}
python3 scripts/settlane_lint.py ingots --abi-dir out   # policy lint
```

A bare `fe test` at the root runs only the production ingot; use `scripts/check_tests.py`. The suite has 90 tests (43 production ingot, 47 dev ingot).

Optional, production bytecode on a local chain (installs Anvil v1.10.0 with a pinned SHA-256, outside the repository):

```sh
bash experiments/anvil/install_foundry.sh
python3 experiments/anvil/run.py --mutations   # 52 checks at fixed block timestamps, plus 8 wrong-clock mutations
```

Optional, proof that the gate fails for each known mistake (about 2 hours, needs PyYAML): `python3 scripts/ci_negative_controls.py`.

## Demo: deployment on Sepolia (test ETH)

The pinned production build is deployed on Ethereum Sepolia (chain id 11155111), and one agreement was settled each way. You can check every row read-only, without a key:

| Step | Block | Transaction | Result |
| --- | --- | --- | --- |
| Deploy | 12175958 | `0x4309d7c7fc7b4f68820efe6da17d50381a822e1d656c607a31a58d4384598537` | contract `0xf79d229a039bf5c84ecc7327060f8bbc888d2182` |
| A1 create | 12176008 | `0x661752e47fe7076b7f54f4bb33c6ec32bd0e1222e80f4d8c93e4131a55f470b3` | 1 milestone, 0.001 ETH |
| A1 submit | 12176039 | `0xe01e80607d67f72ae9374bde613afc0d3fcc1a25b5fc50dc6ee696e548f78c04` | evidence `0xE1`, revision 1 |
| A1 approve | 12176144 | `0x234075c6df23ba987c0fa68dc66e0d9652c68dd9bc45423d2da142034696fdf3` | Approved |
| A1 claim | 12176195 | `0xf1a40207a9f407f5f1d9994b213e4980dd6d8083593b9e68dd70734a60f771cc` | 0.001 ETH paid to the provider |
| A2 create | 12176230 | `0xdb4d4d75e2d2aa2d505696ced033032e74c322b175267cb41079b28e12c0c4f2` | 1 milestone, 0.001 ETH |
| A2 refund | 12176299 | `0xa9a25f2197a906340c285afb908959cc0952b6c1f2c019c23419a36862df398d` | after `deliver_by`, 0.001 ETH back to the client |

Afterwards A1 is `Paid`, A2 is `Refunded`, `totalOutstanding` is 0 and the contract holds 0 ETH. The deployed runtime code (6,056 bytes, SHA-256 `f0965efd4e9d2a0fcfd0eae88d5e6e9c0a938b22c03949b54f015b2600f4b3a8`) is byte-identical to a clean local `fe build` with Fe 26.6.0. The hashes are pinned in `experiments/sepolia/artifact.json`.

```sh
python3 experiments/sepolia/testnet.py artifact     # the local build equals the pinned artifact
python3 experiments/sepolia/verify_deployment.py \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --address 0xf79d229a039bf5c84ecc7327060f8bbc888d2182 --from-block 12175958
```

The verifier only reads from the node. It checks the bytecode against a fresh build, decodes and replays every event, and checks the accounting. Gas on Sepolia's current rules was 9,572,316 to deploy, about 1.4 to 1.5 M per `create`, 266,257 for `submit`, 50,832 for `approve` and about 182,000 per payout. A local pre-Glamsterdam chain charges much less (deploy 1,362,096, create about 327,000), because Sepolia's current fork prices new state far higher. The step-by-step record is in `docs/PROGRESS.md` and `docs/TESTNET.md`.

## Limitations

- **Unaudited prototype; testnet only.** It is built with a pre-1.0 compiler (Fe 26.6.0), and its correctness also depends on that compiler. Passing tests does not make it secure.
- **The verifier is trusted.** It can wrongly approve (the provider is paid) or wrongly reject (the client can be refunded once the milestone expires), but it can never move funds or change parties. A provider and a verifier controlled by one person defeat the system, and Settlane cannot detect that. There is no dispute or appeal path.
- **Lost keys lock funds permanently.** There is no owner, admin, sweep or recovery path, by design. An `Approved` milestone whose provider loses its key stays locked forever (approval never expires, and approved work cannot be refunded). An expired milestone whose client loses its key stays locked forever. A client contract that cannot call `refund` locks its refundable milestones. Use keys you control and can back up.
- **Payouts forward only the 2300-gas stipend.** A payee that needs more gas to receive ETH (many smart-contract wallets) cannot be paid directly. The caller chooses `to`, so it can retry with an address that accepts a plain transfer. A precompile address accepts the ETH and strands it, which is the caller's choice.
- **The client alone sets the terms.** Deadlines and `review_period` (any value above 0) are fixed at creation, and the provider does not accept them on-chain. Parties must check the terms before working.
- **ETH sent outside `create` is stranded.** ETH forced in (for example by `SELFDESTRUCT`) raises the balance above what is owed, and nothing can move it. The invariant is `balance >= outstanding`.
- **Off-chain content is not checked.** `spec` and `evidence` are hash commitments; the contract does not inspect the work. Block producers can skew timestamps slightly near a deadline.
- **Production clock wiring is guarded by the lint and the Anvil job, not by Fe tests.** The Fe test block never advances, so no Fe test can cross a deadline on the production contract. Deadline behaviour is tested on the shell, which runs the same handlers.
- **CI has not yet run on GitHub.** The workflow (`.github/workflows/ci.yml`) has been exercised locally only, step by step.
- Security model, invariants and their tests: [`docs/SECURITY.md`](docs/SECURITY.md).

## Declaration

- **Pre-existing work:** the project started from the Fe Builders Challenge starter repository (`fe-lang/builders-challenge-starter`), whose example contract was replaced. Everything under `ingots/`, `scripts/`, `experiments/` and `docs/` was written during the contest. *(Owner to confirm, and to link the starting commit.)*
- **Third-party code:** none in the contract. Development and test tools: Fe, Foundry (Anvil and cast, local and CI only) and Python 3 with PyYAML for the negative controls.
- **AI assistance:** written with AI coding assistants (Claude Code), with the human owner approving every specification decision and every testnet transaction (`docs/DECISIONS.md`). *(Owner to confirm the wording.)*

## Team

*(Owner to fill in.)*

## License

Apache-2.0, see [`LICENSE`](LICENSE).

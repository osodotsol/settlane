# Production-bytecode tests on a local Anvil (Phase 4B)

Why: the Fe test harness has a frozen block clock, so no Fe test can reach a deadline on the
**production** contract, and a wrong production clock in `Submit`, `Approve`, `Reject` or `Refund`
passes every Fe test (R-006 L-1; only the lint rule `C-CLOCK` sees it). This directory deploys the
real `Settlane.bin` built by Fe 26.6.0 to a throw-away local Anvil and fixes the timestamp of
each block (`evm_setNextBlockTimestamp`), so every deadline can be crossed on the shipped bytecode.

Local only: Anvil binds 127.0.0.1, chain id 31337, simulated ETH. No public network, no key (it uses
the unlocked accounts of the throw-away node), no change to any contract.

```sh
bash experiments/anvil/install_foundry.sh                # anvil + cast v1.10.0, pinned SHA-256, into ~/tools/foundry/bin
python3 experiments/anvil/run.py                         # 52 checks, about 1 minute
python3 experiments/anvil/run.py --mutations             # + 8 wrong-clock mutations, about 6 minutes
python3 experiments/anvil/run.py --root <checkout>       # the suite on another tree
```

What the suite checks: the deployed code equals `Settlane.runtime.bin`; creation (event, views,
balance) and its boundary; Submit, Approve, Reject, Refund of a Funded and of a Submitted milestone
at deadline - 1, deadline and deadline + 1; a refund of an Approved milestone; Claim right after an
approval, after `decide_by` and 100,000 s after it, with a wrong caller, a zero payee and a replay.
Every transition is checked for its exact state, event, balances, accounting and revert reason
(decoded from a transaction trace), and every block has the timestamp that was requested, far in the
future of the wall clock.

What `--mutations` checks: it rebuilds the contract in a temporary copy with the clock of one arm
(Create, Submit, Approve, Reject, Refund) frozen at 0 or a day ahead, and requires the checks that
guard that arm's boundary to fail **and** the checks of the other arms to keep passing, so each
mutation fails for its intended reason.

**Not in CI.** The installer and the suite are verified here on Linux x86_64 only; nothing has run on
a GitHub runner (the workflow has never run). To add it later, two steps after "Review regressions":
`bash experiments/anvil/install_foundry.sh` then `python3 experiments/anvil/run.py` (and
`--mutations`), with `~/tools/foundry/bin` on the path. The negative-control runner skips any step that
mentions `experiments`, so it is unaffected.

Limits: Anvil's timestamp rules are not a real chain's validator rules; this covers the clock of the
five arms, not the whole contract (the Fe suite does that); Claim has no clock.

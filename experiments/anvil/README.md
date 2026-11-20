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

**In CI (job `anvil`, D-027), unverified on GitHub.** `.github/workflows/ci.yml` has three jobs: `test` (the existing Fe steps, unchanged), `anvil` (installs Fe, then `bash experiments/anvil/install_foundry.sh`, then `python3 experiments/anvil/run.py` and `python3 experiments/anvil/run.py --mutations`) and `release-gate`, which passes only when BOTH `test` and `anvil` succeeded (a failed, cancelled or skipped job fails it). The `anvil` job was emulated locally from a clean `HOME` with only `fe` on the PATH: the installer verified the pinned SHA-256 and installed Foundry, then the suite (52 of 52) and the mutations (8 of 8) passed. **The download itself was replaced by a stand-in for `curl` serving the already verified tarball**, because the live download timed out in this environment (the installer's 600 s cap was hit at 109 of 130 MB, on a slow connection that had fetched the same file in seconds earlier), so the live fetch is not verified here either. Also, the workflow has never run on a GitHub runner, so the runner-side behaviour (download speed, Anvil on the runner image, the 30-minute timeout) is unverified. The negative-control runner skips any step that mentions `experiments`, so it is unaffected.

**Making both jobs required for a release** is a repository setting that a workflow file cannot create: in GitHub, Settings > Branches > branch protection rule for the release branch > "Require status checks to pass" > select **`release-gate (test and anvil)`** (one check that stands for both jobs; selecting `test` and `anvil (production bytecode)` separately also works but a renamed job would silently stop being required). Until that rule exists the workflow only reports, it cannot block.

Limits: the install is pinned for Linux x86_64 and its sigstore attestation is not verified (the SHA-256 proves the bytes, not the builder); Anvil's timestamp rules are not a real chain's validator rules; this covers the clock of the
five arms, not the whole contract (the Fe suite does that); Claim has no clock.

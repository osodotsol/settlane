# Sepolia testnet verification: preparation (nothing has been broadcast)

**Status: prepared and rehearsed locally. No transaction has been sent to Sepolia, no contract is deployed on any public network, and no wallet exists yet.** Every step that sends a transaction needs your explicit approval, a funded dedicated test wallet and the flags described below. Only Sepolia **test ETH** (no value) is ever used.

Code: `experiments/sepolia/` (`lib.py` guards and helpers, `testnet.py` plan and runner, `verify_deployment.py` read-only verifier, `rehearse.py` local rehearsal). The contract, the Fe tests, the lint and the existing CI are unchanged.

## 1. The artifact (Fe 26.6.0 build of this checkout)
| Item | Value |
| --- | --- |
| Compiler | `fe 26.6.0 (5b3f96a)` |
| Contract | `Settlane` (production ingot only; `fe build --out-dir` emits exactly `Settlane.bin`, `.runtime.bin`, `.abi.json`, no test shell) |
| Init code | 6,076 bytes, SHA-256 `62ac0e9f537c0e8c22b230b86bb4c3569bafd7a85dc380b3a71b1805cd05e9d6` |
| Runtime code | 6,056 bytes, SHA-256 `f0965efd4e9d2a0fcfd0eae88d5e6e9c0a938b22c03949b54f015b2600f4b3a8` |
| ABI JSON | SHA-256 `abb232adda8dd130a619ea8d9c1e18032c949ef0d3ea262ec37f907b02b4d1a7`; equals the ABI lock of `scripts/lint-policy.json` (10 functions, 6 events; checked by `verify_deployment.py`) |
| Constructor | none (no arguments) |
The hashes are of the production sources at the commit that adds this file (the contract has not changed since Phase 3B). They are reproducible (two builds gave the same bytes). `verify_deployment.py` rebuilds from the checkout, so a changed contract changes these values and it compares against the rebuilt code, not against this table; pass `--expect-runtime-sha256` to pin the value above.

## 2. What you must provide (prerequisites)
1. **Tools** (free, local): `bash experiments/anvil/install_foundry.sh` installs `anvil` and `cast` v1.10.0 with a pinned SHA-256 into `~/tools/foundry/bin`; `fe` 26.6.0.
2. **Three dedicated test wallets, freshly generated** (never import an existing key, never reuse a mainnet key): **client**, **provider**, **verifier**. They must be three different addresses (D-011). Create each as an encrypted keystore **outside the repository**, entering the password at the hidden prompt:
   ```sh
   mkdir -p ~/.settlane-sepolia/keystores ~/.settlane-sepolia/passwords && chmod 700 ~/.settlane-sepolia ~/.settlane-sepolia/passwords
   cast wallet new ~/.settlane-sepolia/keystores client      # prompts for a password; prints the address
   cast wallet new ~/.settlane-sepolia/keystores provider
   cast wallet new ~/.settlane-sepolia/keystores verifier
   # a password FILE per wallet (the runner reads the file; the password is never an argument or a variable):
   for r in client provider verifier; do ( umask 077; read -rsp "password for $r: " p; echo; printf %s "$p" > ~/.settlane-sepolia/passwords/$r.pw ); done
   ```
   Record only the three **addresses**. Back up the keystores and passwords outside the repository if you want to keep the wallets. Test wallets hold test ETH only.
3. **Test ETH.** Roughly 0.01 to 0.03 Sepolia ETH on the client and about 0.004 each on the provider and verifier (the preflight prints the exact need at the current gas price). Get it from a Sepolia faucet to the **client** address; `fund` then moves gas money to the other two, or fund each address from the faucet.
4. **A Sepolia RPC URL** (a public endpoint or your own; no key is needed for a public one). It sees your addresses and transactions. A keyed endpoint's URL is a credential: keep it out of the repository and logs (pass it from your shell, never commit it).
5. **Your approval** of the broadcast (this document ends with the questions).

## 3. Safety guards (all exercised by the rehearsal)
| Guard | Where |
| --- | --- |
| Nothing is sent without `--broadcast`; sending commands refuse otherwise | `lib.require_send_allowed` |
| The node's chain id must be 11155111 before anything else (mainnet, other testnets and a wrong URL are refused) | `lib.require_chain` |
| A non-local node also needs `SETTLANE_TESTNET_CONFIRM=sepolia-test-eth-only` in the environment (your explicit "test ETH only") | `lib.require_send_allowed` |
| Signing only from an encrypted keystore plus a password **file**, both outside the repository; the password file must be mode 600; there is no code path for a raw private key, mnemonic, `--password` argument or key variable | `lib.check_secret_paths`, `lib.send` |
| The three roles must be three different addresses | `lib.load_wallets` |
| Value cap: at most 0.005 ETH per transaction (`MAX_AGREEMENT_WEI`), 0.001 ETH per test agreement by default; a wallet holding more than 5 ETH is refused as "not a dedicated test wallet" | `lib`, `testnet.preflight` |
| Gas price cap 60 gwei; gas limit = the node's estimate + 30%, never above a cap; a transaction mined with status 0 aborts the run | `lib.send` |
| Every state-changing step is simulated with `eth_call` first and aborts without sending if it would revert | `Runner.tx` |
| Preflight scans the repository for key material and requires the secret paths to be git-ignored (`.gitignore` now ignores `.env*`, `keystores/`, `*.pw`, `*.keystore`, `mnemonic*`) | `testnet.preflight` |
| Logs show addresses and transaction hashes only; the rehearsal asserts that no private key and no password appears in any output | `rehearse.py` |

## 4. Exact commands (run only after approval; replace `$RPC`)
```sh
cd /home/user/hackathons/feguard
export RPC='https://...'                    # your Sepolia RPC URL (do not commit it)
export SETTLANE_TESTNET_CONFIRM=sepolia-test-eth-only
T="python3 experiments/sepolia/testnet.py"

$T plan                                      # 0. print the plan and cost; sends nothing
$T preflight --rpc-url $RPC --with-submitted-refund     # 1. read-only: chain, wallets, balances, gas price, deploy estimate, repo scan
$T fund   --rpc-url $RPC --broadcast         # 2. (optional) client -> provider and verifier, 0.004 ETH each   [2 tx]
$T deploy --rpc-url $RPC --broadcast         # 3. build with Fe 26.6.0, deploy, check the code == runtime.bin   [1 tx]
$T run    --rpc-url $RPC --broadcast --with-submitted-refund   # 4. A1, A2, A3, then the read-only verification   [9 tx]
python3 experiments/sepolia/verify_deployment.py --rpc-url $RPC --address 0x<deployed> --from-block <deploy block>   # 5. re-verify any time; needs no key
```
State (deployed address, deploy block, gas used) is saved in `~/.settlane-sepolia/state-11155111.json`, outside the repository. The local rehearsal (nothing public): `python3 experiments/sepolia/rehearse.py --hardfork osaka` (also `prague`), about 1 minute.

## 5. The transaction plan and expected results
`deliver_by` values are chosen from the **chain's** clock (`latest` block timestamp), and waits are on the chain's clock, not the wall clock. Sepolia blocks are about 12 s apart; the windows leave several blocks of slack.
| # | Sender | Action | Deadline | Expected result (checked by the runner) | Gas measured in the rehearsal |
| --- | --- | --- | --- | --- | --- |
| 0 | client | deploy | | code at the address equals `Settlane.runtime.bin` | 1,362,096 |
| 1 | client | `create` 0.001 ETH, 1 milestone, review 3600 s | `deliver_by` = chain time + 900 s | exactly one `AgreementCreated` (id 1), state Funded, contract holds 0.001 ETH | 327,311 |
| 2 | provider | `submit(1,0,0xE1)` | before `deliver_by` | `MilestoneSubmitted`, state Submitted | 89,117 |
| 3 | verifier | `approve(1,0,0xE1,1)` | before `decide_by` | `MilestoneApproved`, state Approved | 49,632 |
| 4 | provider | `claim(1,0,provider)` | none (approval never expires) | `MilestoneClaimed` 0.001 ETH, state Paid, contract balance falls by exactly 0.001 ETH, accounting (deposited, paid, refunded, outstanding) = (0.001, 0.001, 0, 0) | 90,248 |
| 5 | client | `create` 0.001 ETH | `deliver_by` = chain time + 180 s | `AgreementCreated` (id 2) | 310,211 |
| - | (`eth_call`) | `refund` before the deadline | | **reverts** `milestone has not expired`; no transaction, no gas | 0 |
| 6 | client | `refund(2,0,client)` after the chain clock reaches `deliver_by` | `now >= deliver_by` | `MilestoneRefunded` 0.001 ETH, state Refunded, balance falls by exactly 0.001 ETH, accounting (0.001, 0, 0.001, 0) | 90,347 |
| 7-9 | (optional A3, `--with-submitted-refund`) | create (review 120 s, `deliver_by` +300 s), `submit`, wait until `decide_by`, `refund` of a **Submitted** milestone | `now >= decide_by` | a Submitted milestone is NOT refundable before `decide_by` (simulated revert), refundable after; `MilestoneRefunded` | 310,199 + 89,117 + 90,424 |
After the run, `verify_deployment.py` (24 checks) must pass: chain id, code equals the rebuilt runtime, ABI lock, every entry point live (own revert reason or value), an unknown selector and a bare ETH transfer revert, all logs decode with the independent decoder, ids consecutive, the events replay as the milestone state machine, and per-agreement and total accounting (balance >= `totalOutstanding`; here both end at 0 because every test agreement is settled).
Expected duration: about 10 minutes (A1 about 2 min, A2 about 4 min including the 180 s wait, A3 about 6 min).
**Not exercised on the testnet:** `reject` and the rejection-after-deadline refund, wrong-caller and replay reverts, boundary-second behavior (the chain's clock cannot be set), reentrancy. Those are covered by the Fe suite and the Anvil suite (52 checks, 8 mutations).

## 6. Cost
Total gas measured on a local node: 2,318,962 for deploy + A1 + A2, and 2,808,702 with A3. In test ETH: about 0.0012 ETH at 0.5 gwei, 0.0046 ETH at 2 gwei, 0.023 ETH at 10 gwei (plus A3: +0.0002, +0.0010, +0.0049 ETH). The 0.001 ETH values return to the wallets (claim to provider, refunds to client). Balance checks use 2x the current gas price as headroom.

## 7. Risks and limits (read before approving)
1. **The hardfork matters, and I could not check Sepolia's.** Anvil's newest fork (EIP-8037-style state gas) priced the same deployment at an estimated **9.57 million gas** instead of 1.36 million, and a plain transfer to a new account at 204,600 gas. The rehearsal passes on `osaka` and `prague` with the numbers above. If Sepolia has activated a fork that prices contract creation that way, the runner **aborts before sending** ("the gas estimate ... exceeds the cap") instead of overpaying, and `preflight` shows the node's own estimate and its cost first. Check that line before running `deploy`.
2. **Deadlines are relative to the chain's clock and block times vary.** A2's 180 s window assumes `create` is mined within about 3 minutes; if it is not, `create` reverts (`deliver_by not in the future`) and only gas is lost. Raise the windows with `--a1-window` and `--a2-window` if the network is slow.
3. **Public RPC limits.** Public nodes may rate-limit, drop a transaction, or cap `eth_getLogs` ranges (the verifier halves the range on error). A transaction not mined in 10 minutes aborts the run; rerun `verify` and inspect the state file before retrying. The run is not idempotent (each run creates new agreements), so check `getAgreement` before re-running.
4. **Testnet is not a security proof.** The contract has had Claude reviews (R-005, R-006) and no independent Codex review; the verifier is a trusted party; nothing here says the system is secure or trustless.
5. **Privacy.** The RPC provider and the public chain see the addresses, amounts and hashes; the repository will be public, so do not put addresses of real accounts into docs. Test addresses are not secrets but are linkable to you if you reuse them.
6. **Irreversible.** The deployed contract has no upgrade or destroy path and stays on Sepolia. There is nothing to roll back; unspent test ETH stays in the wallets, and the contract holds 0 ETH at the end of the run if every step succeeds. If a step fails midway, the agreements already created hold at most 0.001 ETH each, recoverable with `refund` after their deadlines (client) or `claim` after approval (provider).
7. **The runner has never run against a public network.** Public-node behavior (error formats, `debug_*` absence, estimate differences) is unverified; the rehearsal uses Anvil. The verifier avoids `debug_*` and uses only standard calls plus one state-override `eth_call` for the bare-transfer probe, which a node that does not support overrides would fail visibly rather than pass.

## 8. Approval needed
Please confirm before anything is broadcast: (a) that the three test wallets are freshly generated and hold only Sepolia test ETH; (b) which RPC endpoint to use; (c) whether to include A3 (`--with-submitted-refund`) in the first run; (d) that I may run `fund`, `deploy` and `run` against Sepolia with the confirmation variable set.

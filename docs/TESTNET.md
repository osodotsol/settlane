# Sepolia testnet verification: preparation and read-only preflight (nothing has been broadcast)

**Status: prepared and rehearsed locally. No transaction has been sent to Sepolia, no contract is deployed on any public network, and no wallet exists yet.** Every step that sends a transaction needs your explicit approval, a funded dedicated test wallet and the flags described below. Only Sepolia **test ETH** (no value) is ever used.

Code: `experiments/sepolia/` (`lib.py` guards and helpers, `testnet.py` plan and runner, `verify_deployment.py` read-only verifier, `rehearse.py` local rehearsal). The contract, the Fe tests, the lint and the existing CI are unchanged.

## 0. Read-only preflight against the real Sepolia (2026-11-20)
Only read calls were made (`eth_chainId`, `eth_getBlockByNumber`, `eth_feeHistory`, `eth_estimateGas`, `eth_call`, `eth_getLogs`, `eth_config`); no transaction, no wallet, no key. Command: `python3 experiments/sepolia/testnet.py node-preflight --rpc-url <endpoint> --with-submitted-refund`.

**Network and hardfork.** Chain id 11155111; block 0 is the Sepolia genesis block (`0x25a5cc10...e6dd9`); head 12,174,761, 14 s old; not syncing. `eth_config` reports forkId `0x6c1d9423`, **active since 2026-10-06 13:53:36 UTC** (timestamp 1791294816), **no next fork scheduled**. The block headers carry `blockAccessListHash` and `slotNumber`, and the system contracts include builder deposit and exit contracts: Sepolia runs the **post-Osaka, Glamsterdam-generation rules**, the same generation as Anvil's newest fork (which is why the earlier `osaka` and `prague` rehearsals under-estimated the gas). Block gas limit 199,804,689; base fee 13 to 16 wei (Sepolia is nearly free); blocks about 34% full; median tip paid in the last 20 blocks about 1 gwei (many wallets over-tip); the node's own suggested tip is 2 wei.

**Endpoints (public, no API key, no account).**
| Endpoint | Result |
| --- | --- |
| `https://ethereum-sepolia-rpc.publicnode.com` | **Selected (primary).** reth; 15 of 15 checks; `eth_config`; `eth_getLogs` accepts 10,000 blocks (50,000 refused); about 1 s per call; 20 calls in a row without a rate limit |
| `https://sepolia.gateway.tenderly.co` | **Fallback.** 15 of 15 checks; `eth_getLogs` accepts 100,000 blocks; no `eth_config`; about 1.7 s per call |
| `https://sepolia.rpc.thirdweb.com` | Not recommended: `eth_getLogs` with an address filter failed (the verifier needs it) |
| `sepolia.drpc.org` (HTTP 400), `rpc.sepolia.org` (404), `rpc2.sepolia.org` (522), `1rpc.io/sepolia` (429), `rpc.ankr.com/eth_sepolia` (needs an API key), `eth-sepolia.public.blastapi.io` (403) | Unusable without an account or key |
All three working endpoints agree on chain, genesis, fork, base fee and every gas estimate below. Public endpoints have no service guarantee. `eth_sendRawTransaction` was **not** tested (that would be a broadcast), so it is the one method every send depends on that is unverified.

**Gas on the real node.** `eth_estimateGas` (identical on publicnode, thirdweb and Tenderly): **deploy 9,649,454**; `create` 1,482,393 (the runtime code placed at an address with a state override); a transfer to a new account 207,391 (21,000 to an existing one). Submit, approve, claim and refund need contract state that cannot be built on a public node without sending transactions, so they come from the same plan run on a **local fork of Sepolia** (real fork rules and fee level, every transaction local, `rehearse.py --fork-url`): submit 266,257, approve 50,864, claim 196,037, refund 196,138 to 196,215. Where the two sources overlap they agree to within 1% (deploy 9,572,316 and create 1,469,971 on the fork), and on the fork gas used equals the estimate. These replace the numbers of the earlier osaka and prague rehearsals (deploy 1,362,096, create 327,311), which do not apply to Sepolia.

**Compatibility with the runner's caps (fixed in this change).** The previous caps (deploy 3,000,000) would have **refused the real deployment**. The runner now uses the node's estimate + 30% as the limit under caps deploy 14,000,000, create 2,600,000, other 1,200,000, fund 400,000, all below the 16,777,216 protocol cap (EIP-7825): deploy needs 12,545,290, create 1,928,110, fund 270,608. `node-preflight` checks each against the real node.

**Fees (changed in this change).** The runner now sets the fee explicitly: tip **0.01 gwei** (`--tip-wei`, default 10,000,000), max fee = 2 x base fee + tip, refused above 60 gwei. Before, `cast` would have chosen its own tip from recent blocks (about 1 gwei, 100 times more), and the old gas-price guard looked only at `eth_gasPrice` (18 wei). With a 0.01 gwei tip the whole run costs about 0.00013 ETH in fees. If a transaction stays pending (a tip too low for the builders), rerun with a higher `--tip-wei`.

**Cost and the minimum test ETH** (gas from the table above; value locked 0.001 ETH per agreement, returned by refund or paid to the provider):
| Scenario (plan A1+A2, plus A3 in brackets) | Total fees | Client must hold | Provider | Verifier |
| --- | --- | --- | --- | --- |
| Expected now, our 0.01 gwei tip | 0.00013 (0.00015) ETH | 0.0023 (0.0033) ETH | 0.00001 | 0.000001 |
| Stress: wallets' usual 1 gwei tip | 0.0133 (0.0153) ETH | 0.027 (0.030) ETH | 0.0008 (0.0011) | 0.0001 |
| Spike: 10 gwei tip | 0.133 (0.153) ETH | 0.26 (0.27) ETH | 0.008 (0.011) | 0.001 |
"Hold" is fees + the largest upfront gas reservation + the value locked. **Bare minimum at our tip, with a 50% margin (plan with A3): client 0.0049 ETH, provider 0.00002, verifier about 0. Recommended minimum (stress scenario with a 50% margin): client 0.045 ETH, provider 0.0016 ETH, verifier 0.0002 ETH, total 0.047 ETH.** One faucet drip (0.05 ETH is typical) to the client covers the recommended minimum; `fund` then sends the provider and the verifier 0.004 ETH each. The preflight prints the exact need at the live fee before anything is sent.

**Wallet setup instructions verified** (throwaway directory, nothing real): the directory commands, the interactive `cast wallet new` prompt (driven through a pseudo-terminal), the password-file snippet and `check-wallets` all work; `check-wallets` prints only addresses, paths and modes, and a mistyped password file is rejected ("cannot open the provider keystore"). The keystore files are created world-readable (encrypted, but) so section 2 now says `chmod 600` and `check-wallets` warns.

## 0b. Final preparation (2026-11-20, nothing broadcast, no wallet created)
**Exact production bytecode (pinned in `experiments/sepolia/artifact.json`, reproduced by an independent build in a fresh directory):** Fe `26.6.0 (5b3f96a)`; init code 6,076 bytes `62ac0e9f537c0e8c22b230b86bb4c3569bafd7a85dc380b3a71b1805cd05e9d6`; runtime code 6,056 bytes `f0965efd4e9d2a0fcfd0eae88d5e6e9c0a938b22c03949b54f015b2600f4b3a8`; ABI JSON `abb232adda8dd130a619ea8d9c1e18032c949ef0d3ea262ec37f907b02b4d1a7`; git tree of the production ingot `a83c9b9fbd7dc87d7dfbc1a1e94193fd97a1c936`. If the contract ever changes, `deploy` refuses until the new build is reviewed and re-pinned with `testnet.py artifact --write`.

**Sepolia re-checked read-only** on publicnode and Tenderly: the same fork (id `0x6c1d9423`, none scheduled), base fee 18 wei, and the same real-node estimates (deploy 9,649,454, create 1,482,393, transfer to a new account 207,391); the limits (estimate x 1.3 = 12,545,290 / 1,928,110 / 270,608) fit the caps (14,000,000 / 2,600,000 / 400,000) and the 16,777,216 protocol cap; our max fee 10,000,036 wei is far below the 60 gwei refusal. Both endpoints pass 16 of 16 checks, now including the pin.

**Funding, each wallet separately** (plan with the optional submitted-refund run; includes a 50% margin; fees computed from the real estimates):
| Wallet | Bare minimum (our 0.01 gwei tip) | Recommended (wallets' usual 1 gwei tip) | Notes |
| --- | --- | --- | --- |
| client | 0.0049 ETH | **0.045 ETH** | pays the deployment (9.65 M gas, the big cost), three creates, two refunds, and locks 0.001 ETH per agreement |
| provider | 0.00002 ETH | **0.0016 ETH** | submit (twice), claim; receives 0.001 ETH from the claim |
| verifier | about 0 | **0.0002 ETH** | one approve |
| **Total** | 0.0049 ETH | **0.047 ETH** | |
If you fund only the client and let `fund` send 0.004 ETH to each of the other two (two more transactions of 207,391 gas each), the client needs **0.017 ETH (bare) or 0.058 ETH (recommended)**; ask the faucet for about 0.06 ETH.

**What stops the workflow, tested in the rehearsal:** a transaction mined with status 0; a step that would revert (simulated first, nothing sent); a transaction with no receipt in time (hash named, "do NOT resend", pending marker, every later send refused until `resolve-pending`, which keeps refusing while it is pending and clears it once mined); a failure after the first transaction of a run (the steps done are recorded and the next `run` refuses without `--abandon-previous`); a build that is not the pinned artifact; a chain id other than 11155111; a missing `--broadcast`; an owner-only violation.

**Rehearsal:** 50 of 50 checks on a local fork of Sepolia and on `osaka`; read-only verification 24 checks; none of the commands wrote anything into the repository or printed a key or password.

**Remaining prerequisites (yours):** (1) run `make_wallets.sh` and send me only the three addresses; (2) fund the client (about 0.06 ETH; or each wallet per the table); (3) answer the approval questions in section 8. Still unverified until a real run: `eth_sendRawTransaction` on the endpoint, inclusion with a 0.01 gwei tip, gas used vs estimate on the real chain, and the public node's behavior under a real send.

## 0d. Deployment authorization package (2026-11-20, read-only, nothing sent)
**Parameters (the owner's):** Sepolia only (chain id 11155111, refused otherwise); total spending budget **0.06 ETH**; publicnode primary RPC, Tenderly fallback; tip **0.01 gwei**; receipt timeout **600 s**; `fund` provider and verifier with **0.004 ETH** each from the client; the optional submitted-refund run (A3) **skipped**; **no automatic fee escalation** (there is no resend, retry or fee-bump code anywhere: the tip is the fixed `--tip-wei`, the max fee is 2 x the base fee at send time + the tip, and a transaction without a receipt stops the workflow).

**The budget guard, checked against internal transfers and refundable deposits** (rehearsal-tested with scripted balances and end to end):
- *Internal transfers*: `spent` is the three wallets' combined balance at the first send minus now, so a transfer between our own wallets (`fund`) costs only its fee. The pre-send reservation used to include the value of such a transfer; it no longer does (`at_risk_value`). Two internal transfers of 0.004 ETH are allowed under a 0.0035 ETH budget.
- *Refundable deposits*: a deposit in the contract counts as spent while it is locked (three 0.001 ETH deposits fit in 0.0035 ETH, a fourth is refused) and stops counting when a refund or a claim to one of our wallets brings it back.
- *Unexpected inflows*: an increase of the combined balance above the baseline (a faucet drip) now stops the workflow instead of silently hiding losses.
- End to end: the nine-step run completes under a 0.0035 ETH budget (fees lost 0.000135 ETH in the rehearsal), which a mis-count of either internal transfers or deposits would have refused.

**The first run, one transaction at a time** (`testnet.py step`, dry run without `--broadcast`): each call executes exactly ONE transaction, verifies its receipt, status, events, the milestone state and the balances, records it, prints the spent total, and stops. It never continues by itself and never resends; any unexpected result (a wrong recipient balance, a wrong deployed code or address, a wrong agreement id or state) aborts. The refund step does not send before the chain's clock passes the Funded deadline; it reports the seconds left and the simulated revert instead.
| # | Step | From | To | Value | Gas estimate | Limit | Max fee (worst case) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | fund provider | client | provider wallet | 0.004 ETH (internal) | 207,391 | 270,608 | 0.0000027 ETH |
| 2 | fund verifier | client | verifier wallet | 0.004 ETH (internal) | 207,391 | 270,608 | 0.0000027 ETH |
| 3 | deploy Settlane (pinned init code) | client | contract creation, the address from the client's nonce 2 | 0 | 9,649,454 | 12,545,290 | 0.0001255 ETH |
| 4 | A1 create | client | Settlane | 0.001 ETH deposit | 1,482,393 | 1,928,110 | 0.0000193 ETH |
| 5 | A1 submit | provider | Settlane | 0 | 266,257 | 347,134 | 0.0000035 ETH |
| 6 | A1 approve | verifier | Settlane | 0 | 50,864 | 67,123 | 0.0000007 ETH |
| 7 | A1 claim, to the provider | provider | Settlane | 0 (the 0.001 ETH deposit returns to the provider wallet) | 196,037 | 255,848 | 0.0000026 ETH |
| 8 | A2 create | client | Settlane | 0.001 ETH deposit | 1,482,393 | 1,928,110 | 0.0000193 ETH |
| 9 | A2 refund, to the client (after its 180 s Funded deadline) | client | Settlane | 0 (the 0.001 ETH deposit returns to the client) | 196,215 | 256,079 | 0.0000026 ETH |
Totals at the live fee (base 15 wei, max fee 10,000,030 wei/gas): 13,738,395 gas; **expected loss 0.000137 ETH of fees**; worst-case fees 0.000179 ETH; plus 0.002 ETH of deposits that are expected to come back; **total exposure 0.00218 ETH = 3.6% of the 0.06 ETH budget**. The base fee would have to reach about 1.6 gwei (a hundred million times today's) before the worst case reached the budget, and the guard refuses a send long before that.

**Final read-only preflight:** artifact equals the pin; both endpoints 16 of 16; the real-wallet `preflight` passes everything except the two expected items (the provider and the verifier hold 0 ETH until steps 1 and 2); the first step's dry run on the real network describes exactly transaction 1 and sends nothing. Rehearsal 70 of 70 on a Sepolia fork, on `osaka` and on Anvil's default fork.

**Stop conditions (the workflow stops, nothing continues):** a status-0 receipt; a receipt missing after 600 s (pending marker, every later send refused until `resolve-pending`, never resent); a result that differs from the expected (balance, code, address, id, state, event count); a step whose simulation reverts; a chain id other than 11155111; the budget; an unexpected inflow; a build that is not the pinned artifact; a changed fee above 60 gwei.

## 0c. Final preflight with the funded client (2026-11-20, read-only, nothing sent)
**Funding verified on two independent endpoints (publicnode and Tenderly agree):** the faucet transfer of **2.08 ETH** to the client address is mined with status 1 (a plain transfer to a new account, gas used 204,600), 26 confirmations when checked, **not yet finalized** (finalization takes about two epochs, roughly 13 minutes; finality is not needed for the testnet run but wait if you want certainty). The client's balance is 2.08 ETH, its nonce 0, no code at the address, and the address equals the client keystore's address. Provider and verifier hold 0 ETH. The gas used by that transfer on the REAL chain (204,600) matches the cost of a transfer to a new account that the estimates and the local rehearsals show (our estimate for it is 207,391, within 1.4%), which is the first real-chain evidence that the receipt's gas used includes the same state costs as the estimate.

**Wallets:** `~/.settlane-sepolia` and its `keystores` and `passwords` directories are 0700 and owned by you; the three keystores and three password files are 0600; the three addresses are different; every password file opens its keystore; no state file exists yet (nothing has ever been sent). `preflight` (read-only, with the real wallets) passes its node, fee, repository, pinned-artifact and deployment-estimate checks and reports exactly two expected failures: the provider and verifier hold 0 ETH (the optional `fund` step, 0.004 ETH each, fixes that) and the confirmation variable `SETTLANE_TESTNET_CONFIRM` is deliberately not set yet (it is only exported for a send you approved).

**Pinned bytecode and estimates (unchanged):** the build equals the pin (Fe 26.6.0; init `62ac0e9f...`, runtime `f0965efd...`, ABI `abb232ad...`; clean tree). Real-node estimates: deploy 9,649,454, create 1,482,393, transfer to a new account 207,391; limits 12,545,290 / 1,928,110 / 270,608 fit the caps. Fork `0x6c1d9423`, no next fork; base fee 16 wei; our max fee 10,000,032 wei.

**Maximum cost and the 0.06 ETH budget** (`testnet.py budget`, live fee, plan A1+A2+A3 with `fund`; 15,683,260 gas in 12 transactions):
| | ETH |
| --- | --- |
| Expected fees (gas x base fee + our tip) | **0.000157** |
| Worst case of the fees (every gas limit fully used, at the max fee) | 0.000204 |
| Value in the contract at the peak (A1's goes to the provider wallet, A2 and A3 return to the client) | 0.003 |
| Worst case in total | **0.0032 = 5.3% of the 0.06 ETH budget** |
| Deployment alone: expected / worst case | 0.0000965 / 0.000125 |
| `fund` moves between our own wallets | 0.008 |
The base fee would have to rise to about **1.39 gwei, some 87 million times today's**, before the worst case reached 0.06 ETH. **The 0.06 ETH budget is ample; nothing technically justifies a higher one.** It is now a hard guard: the runner records the three wallets' combined balance at the first send and refuses any send whose worst case (gas limit x max fee + value) added to what has been spent so far would exceed the budget (`--budget-wei`, default 0.06 ETH; rehearsal-tested: refused before signing, nothing sent). The client holds 2.08 ETH, far more than the budget, so the budget, not the balance, is the limit; the rest of the faucet ETH is never touched.

**Not sent / unverified:** no transaction, no transfer, no deployment. Still unverified until a real send: `eth_sendRawTransaction` on the endpoint, inclusion with a 0.01 gwei tip, and the public node under a real send.

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
2. **Three dedicated test wallets, freshly generated** (never import an existing key, never reuse a mainnet key): **client**, **provider**, **verifier**, three different addresses (D-011). One command, run by you in a terminal (nothing of it has been run for real):
   ```sh
   bash experiments/sepolia/make_wallets.sh
   ```
   It asks for each wallet's password twice (hidden, at least 12 characters; keep terminal echo off even for type-ahead), writes the 0600 password file and the encrypted keystore into `~/.settlane-sepolia/` (directories 0700, files 0600), refuses to overwrite an existing wallet, refuses a directory inside the repository and a session without a terminal, never puts a password on a command line, and prints only the three addresses by calling `check-wallets`. Tested in a throwaway directory through a pseudo-terminal: three different wallets, exact modes, zero echoes of the typed password, no password in any process's arguments (sampled every 5 ms), a second run refused. Afterwards `python3 experiments/sepolia/testnet.py check-wallets` re-checks the layout offline at any time.
   Record only the three **addresses**; back up the keystores and passwords outside the repository if you want to keep the wallets. They hold test ETH only.
3. **Test ETH, per wallet** (plan with the optional submitted-refund run, 50% margin included; section 0b has the table): **client at least 0.045 ETH** (bare minimum 0.0049 ETH at our tip), **provider at least 0.0016 ETH** (bare 0.00002), **verifier at least 0.0002 ETH** (bare about 0). The simplest way: ask the faucet for **about 0.06 ETH to the client only**, then `fund` sends 0.004 ETH to each of the other two. Get it from a Sepolia faucet to the **client** address; `fund` then moves gas money to the other two, or fund each address from the faucet.
4. **A Sepolia RPC URL**: `https://ethereum-sepolia-rpc.publicnode.com` (selected; fallback `https://sepolia.gateway.tenderly.co`). No key is needed. It sees your addresses and transactions. A keyed endpoint's URL is a credential: keep it out of the repository and logs (pass it from your shell, never commit it).
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
| **Owner-only secrets, enforced, never fixed silently**: every keystore and password file must be mode 0600 with its directory and the wallet directory 0700, owned by you, not a symbolic link, and outside the repository; anything looser is refused with the exact `chmod` to run (rehearsal refuses a 0644 keystore, a 0640 password file, 0755 and 0750 directories, a symlink) | `lib.check_secret_paths`, `lib.load_wallets` |
| **Pinned artifact**: `experiments/sepolia/artifact.json` pins the Fe version and the SHA-256 of the init code, the runtime code and the ABI; `deploy` and the preflights refuse any other build, and the verifier requires the DEPLOYED code to hash to the pinned runtime hash | `lib.check_artifact`, `testnet.py artifact` |
| **A failed or delayed transaction stops the workflow**: mined with status 0 aborts; no receipt within `--receipt-timeout` (default 600 s) stops with the hash and "do NOT resend", writes a pending marker, and **every later send is refused** until `resolve-pending` sees a receipt; a run that stops midway records its steps and the next `run` refuses unless `--abandon-previous` (it would create duplicate agreements); a step that would revert is simulated and refused before anything is sent | `lib.send`, `testnet.ensure_no_pending`, `Runner.tx` |
| Preflight scans the repository for key material and requires the secret paths to be git-ignored (`.gitignore` now ignores `.env*`, `keystores/`, `*.pw`, `*.keystore`, `mnemonic*`) | `testnet.preflight` |
| Logs show addresses and transaction hashes only; the rehearsal asserts that no private key and no password appears in any output | `rehearse.py` |

## 4. Exact commands (run only after approval; replace `$RPC`)
```sh
cd /home/user/hackathons/feguard
export RPC='https://...'                    # your Sepolia RPC URL (do not commit it)
export SETTLANE_TESTNET_CONFIRM=sepolia-test-eth-only
T="python3 experiments/sepolia/testnet.py"

$T plan                                      # 0. print the plan and cost; sends nothing
$T node-preflight --rpc-url $RPC --with-submitted-refund   # 1a. read-only, no wallet: chain, genesis, fork, fees, real gas estimates, limits, cost (done: section 0)
$T budget --rpc-url $RPC --with-submitted-refund   # 1a'. read-only: the cost of every transaction at the live fee against the 0.06 ETH budget
$T artifact                                  # 1b. the build equals the pinned artifact (hashes below)
$T check-wallets                             # 1c. offline: the wallet layout (after you create the wallets)
$T preflight --rpc-url $RPC --with-submitted-refund     # 1d. read-only with the wallets: balances at the live fee, deploy estimate, repo scan
$T fund   --rpc-url $RPC --broadcast         # 2. (optional) client -> provider and verifier, 0.004 ETH each   [2 tx, 207,391 gas each]
$T deploy --rpc-url $RPC --broadcast         # 3. build with Fe 26.6.0, require the pinned hashes, deploy, check the code == runtime.bin   [1 tx]
$T run    --rpc-url $RPC --broadcast --with-submitted-refund   # 4. A1, A2, A3, then the read-only verification   [9 tx]
$T resolve-pending --rpc-url $RPC            # only if a step stopped with 'no receipt': never resend before this says it is resolved
python3 experiments/sepolia/verify_deployment.py --rpc-url $RPC --address 0x<deployed> --from-block <deploy block>   # 5. re-verify any time; needs no key (checks the pinned runtime hash)
```
State (deployed address, deploy block, gas used) is saved in `~/.settlane-sepolia/state-11155111.json`, outside the repository. The local rehearsal (nothing public): `python3 experiments/sepolia/rehearse.py --hardfork osaka` (also `prague`), about 1 minute.

## 5. The transaction plan and expected results
`deliver_by` values are chosen from the **chain's** clock (`latest` block timestamp), and waits are on the chain's clock, not the wall clock. Sepolia blocks are about 12 s apart; the windows leave several blocks of slack.
| # | Sender | Action | Deadline | Expected result (checked by the runner) | Gas (real-node estimate, or Sepolia-fork run for submit/approve/claim/refund) |
| --- | --- | --- | --- | --- | --- |
| 0 | client | deploy | | code at the address equals `Settlane.runtime.bin` | 9,649,454 |
| 1 | client | `create` 0.001 ETH, 1 milestone, review 3600 s | `deliver_by` = chain time + 900 s | exactly one `AgreementCreated` (id 1), state Funded, contract holds 0.001 ETH | 1,482,393 |
| 2 | provider | `submit(1,0,0xE1)` | before `deliver_by` | `MilestoneSubmitted`, state Submitted | 266,257 |
| 3 | verifier | `approve(1,0,0xE1,1)` | before `decide_by` | `MilestoneApproved`, state Approved | 50,864 |
| 4 | provider | `claim(1,0,provider)` | none (approval never expires) | `MilestoneClaimed` 0.001 ETH, state Paid, contract balance falls by exactly 0.001 ETH, accounting (deposited, paid, refunded, outstanding) = (0.001, 0.001, 0, 0) | 196,037 |
| 5 | client | `create` 0.001 ETH | `deliver_by` = chain time + 180 s | `AgreementCreated` (id 2) | 1,482,393 |
| - | (`eth_call`) | `refund` before the deadline | | **reverts** `milestone has not expired`; no transaction, no gas | 0 |
| 6 | client | `refund(2,0,client)` after the chain clock reaches `deliver_by` | `now >= deliver_by` | `MilestoneRefunded` 0.001 ETH, state Refunded, balance falls by exactly 0.001 ETH, accounting (0.001, 0, 0.001, 0) | 196,138 |
| 7-9 | (optional A3, `--with-submitted-refund`) | create (review 120 s, `deliver_by` +300 s), `submit`, wait until `decide_by`, `refund` of a **Submitted** milestone | `now >= decide_by` | a Submitted milestone is NOT refundable before `decide_by` (simulated revert), refundable after; `MilestoneRefunded` | 1,482,393 + 266,257 + 196,215 |
After the run, `verify_deployment.py` (24 checks) must pass: chain id, code equals the rebuilt runtime, ABI lock, every entry point live (own revert reason or value), an unknown selector and a bare ETH transfer revert, all logs decode with the independent decoder, ids consecutive, the events replay as the milestone state machine, and per-agreement and total accounting (balance >= `totalOutstanding`; here both end at 0 because every test agreement is settled).
Expected duration: about 10 minutes (A1 about 2 min, A2 about 4 min including the 180 s wait, A3 about 6 min).
**Not exercised on the testnet:** `reject` and the rejection-after-deadline refund, wrong-caller and replay reverts, boundary-second behavior (the chain's clock cannot be set), reentrancy. Those are covered by the Fe suite and the Anvil suite (52 checks, 8 mutations).

## 6. Cost
See section 0: about 0.00013 ETH in fees at our 0.01 gwei tip (0.00015 with A3), 0.013 ETH if the tip has to be 1 gwei, 0.13 ETH at 10 gwei; the 0.001 ETH values return to the wallets (the claim goes to the provider, the refunds to the client). The runner refuses to send above a 60 gwei max fee. The gas of the earlier local `osaka`/`prague` rehearsals (deploy 1,362,096) does **not** apply to Sepolia.

## 7. Risks and limits (read before approving)
1. **The hardfork is now known, and it is the expensive one.** Sepolia runs the post-Osaka, Glamsterdam-generation rules (fork id `0x6c1d9423`, active since 2026-10-06, none scheduled). On them the real node estimates the deployment at **9,649,454 gas**, `create` at 1,482,393 and a transfer to a new account at 207,391. At a base fee of about 15 wei this is almost free, but it is why the runner's gas caps were raised. A future fork could change the numbers: `node-preflight` re-measures against the node and fails if an estimate leaves the table by more than 5% or exceeds a cap.
2. **Deadlines are relative to the chain's clock and block times vary.** A2's 180 s window assumes `create` is mined within about 3 minutes; if it is not, `create` reverts (`deliver_by not in the future`) and only gas is lost. Raise the windows with `--a1-window` and `--a2-window` if the network is slow.
3. **Public RPC limits.** Public nodes may rate-limit, drop a transaction, or cap `eth_getLogs` ranges (the verifier halves the range on error). A transaction not mined in 10 minutes aborts the run; rerun `verify` and inspect the state file before retrying. The run is not idempotent (each run creates new agreements), so check `getAgreement` before re-running.
4. **Testnet is not a security proof.** The contract has had Claude reviews (R-005, R-006) and no independent Codex review; the verifier is a trusted party; nothing here says the system is secure or trustless.
5. **Privacy.** The RPC provider and the public chain see the addresses, amounts and hashes; the repository will be public, so do not put addresses of real accounts into docs. Test addresses are not secrets but are linkable to you if you reuse them.
6. **Irreversible.** The deployed contract has no upgrade or destroy path and stays on Sepolia. There is nothing to roll back; unspent test ETH stays in the wallets, and the contract holds 0 ETH at the end of the run if every step succeeds. If a step fails midway, the agreements already created hold at most 0.001 ETH each, recoverable with `refund` after their deadlines (client) or `claim` after approval (provider).
7. **The runner has never sent a transaction to a public network**, and `eth_sendRawTransaction` on the selected endpoint is untested. Whether a 0.01 gwei tip is included promptly on Sepolia is expected (blocks are about a third full) but unproven; if a transaction stays pending, rerun with a higher `--tip-wei`. Whether the receipt's gas used equals the estimate on the real chain (it does on the local fork) is unconfirmed, so costs are computed on the estimate.
   Earlier note: **the runner has never run against a public network.** Public-node behavior (error formats, `debug_*` absence, estimate differences) is unverified; the rehearsal uses Anvil. The verifier avoids `debug_*` and uses only standard calls plus one state-override `eth_call` for the bare-transfer probe, which a node that does not support overrides would fail visibly rather than pass.

## 8. Exact next actions (nothing below has been done)
1. **You** (no assistant needed): run `bash experiments/sepolia/make_wallets.sh` (section 2; it creates, tightens and checks the three wallets), tell me only the three addresses, and fund the **client** from a Sepolia faucet with about **0.06 ETH** (0.045 if you fund each wallet from the faucet; the per-wallet table is in section 0b; bare minimum 0.017 with `fund`). Do not send me keys, passwords or the RPC URL if it contains a key (the selected one does not).
2. **Approve** (reply with the answers): (a) the wallets are freshly generated and hold only Sepolia test ETH; (b) the endpoint `https://ethereum-sepolia-rpc.publicnode.com` (fallback Tenderly); (c) include A3 (`--with-submitted-refund`) in the first run; (d) the tip policy (0.01 gwei, raised only if a transaction stalls) and the 600 s receipt timeout; (e) permission to run `preflight`, `fund`, `deploy`, `run` with `SETTLANE_TESTNET_CONFIRM=sepolia-test-eth-only`.
3. **Then** (assistant): `preflight` with the wallets (read-only), and on your word `fund`, `deploy`, `run`, and `verify`; report the transaction hashes and the verification.

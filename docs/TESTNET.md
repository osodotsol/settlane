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
   ```sh
   chmod 600 ~/.settlane-sepolia/keystores/*     # the keystores are created world-readable; they are encrypted, but tighten them
   python3 experiments/sepolia/testnet.py check-wallets   # offline: layout, modes, three distinct addresses, password files open the keystores; prints addresses only
   ```
   Record only the three **addresses**. Back up the keystores and passwords outside the repository if you want to keep the wallets. Test wallets hold test ETH only.
3. **Test ETH.** **Recommended minimum 0.045 ETH on the client** (bare minimum about 0.005 ETH at our tip; see section 0), and 0.0016 ETH on the provider and 0.0002 ETH on the verifier (or let `fund` send 0.004 ETH to each). Get it from a Sepolia faucet to the **client** address; `fund` then moves gas money to the other two, or fund each address from the faucet.
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
$T check-wallets                             # 1b. offline: the wallet layout (after you create the wallets)
$T preflight --rpc-url $RPC --with-submitted-refund     # 1c. read-only with the wallets: balances at the live fee, deploy estimate, repo scan
$T fund   --rpc-url $RPC --broadcast         # 2. (optional) client -> provider and verifier, 0.004 ETH each   [2 tx, 207,391 gas each]
$T deploy --rpc-url $RPC --broadcast         # 3. build with Fe 26.6.0, deploy, check the code == runtime.bin   [1 tx]
$T run    --rpc-url $RPC --broadcast --with-submitted-refund   # 4. A1, A2, A3, then the read-only verification   [9 tx]
python3 experiments/sepolia/verify_deployment.py --rpc-url $RPC --address 0x<deployed> --from-block <deploy block>   # 5. re-verify any time; needs no key
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
1. **You** (no assistant needed): create the three wallets and tighten them (section 2), run `check-wallets`, and fund the **client** from a Sepolia faucet with at least 0.045 ETH (bare minimum 0.005). Do not send me keys, passwords or the RPC URL if it contains a key (the selected one does not).
2. **Approve** (reply with the answers): (a) the wallets are freshly generated and hold only Sepolia test ETH; (b) the endpoint `https://ethereum-sepolia-rpc.publicnode.com` (fallback Tenderly); (c) include A3 (`--with-submitted-refund`) in the first run; (d) the tip policy (0.01 gwei, raised only if a transaction stalls); (e) permission to run `preflight`, `fund`, `deploy`, `run` with `SETTLANE_TESTNET_CONFIRM=sepolia-test-eth-only`.
3. **Then** (assistant): `preflight` with the wallets (read-only), and on your word `fund`, `deploy`, `run`, and `verify`; report the transaction hashes and the verification.

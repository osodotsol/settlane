# Settlane real-wallet acceptance (Sepolia, browser wallet)

**Recorded 2026-11-22. Test ETH on the Sepolia testnet only.** The owner operated the application in Chrome with MetaMask and approved every transaction; the assistant prepared, guided and verified, and never signed, broadcast or held a key. The contract, ABI and deployment are unchanged. This is an acceptance record, not a security audit: the verifier is a trusted party (docs/SECURITY.md).

## 1. Verdict

| Question | Result |
| --- | --- |
| Does the full lifecycle work through the real application and a real browser wallet on Sepolia? | **PASS.** Six of six intended transactions succeeded: create and refund (Agreement #3), create, submit, approve and claim (Agreement #4) |
| Are accounting and balances exact? | **PASS.** Every ETH movement matches to the wei; the contract ends with 0 ETH and `totalOutstanding` 0 |
| Are duplicate and conflicting actions refused? | **PASS** (read-only simulation against both final states, section 6) |
| Is the wallet interaction reliable? | **NOT ESTABLISHED. OPEN.** Three of seven signing requests produced no confirmation prompt (section 8); none is classified as resolved |

Overall: **the contract and the application's transaction logic passed; the browser-wallet connection did not show reliable behavior, and the cause is not determined.**

## 2. Environment

- Contract `0xf79d229a039bf5c84ecc7327060f8bbc888d2182` on Sepolia (chain 11155111), runtime SHA-256 `f0965efd4e9d2a0fcfd0eae88d5e6e9c0a938b22c03949b54f015b2600f4b3a8` (unchanged since the first run).
- Application: production build of commit `0367d6e` (branch `settlane/dev`), served at `http://localhost:3000`, injected wallet only.
- Wallet: MetaMask in Chrome on Windows with the three dedicated test accounts imported by the owner. Public addresses: Client `0xBf267532e755a1C002B4749dC3fdedAffB154706`, Provider `0x4fa3D0b24E0ab063eb099c1d29c65B814Af0e6e4`, Verifier `0x1F812Da990e91ECaeE455bA6AF815Cf43d3531c9`. No key, keystore or password was read or stored by the assistant.
- Plan as approved: Agreement #3 (0.0002 ETH, 30 min delivery, 30 min review) and Agreement #4 (0.0002 ETH, 120 min delivery, 60 min review), one milestone each. Agreement #3's submission could not be signed in time (section 8), so its milestone expired and was refunded, which served as the refund test.

## 3. The six transactions

| Step | Transaction hash |
| --- | --- |
| A1 | `0x48c9ddc9c628ff81079d554360ef99aa8c8388235365d7624322feae1b84fe10` |
| A2 | `0xf8dfb824accf25d64be41e7d688cb77631f0b87593da387a841b6347e1d90569` |
| B1 | `0xd5ec3e77ecfea1880f34b2d60dfe31d5ce4d23eee7d139d37c44218bc82fa721` |
| B2 | `0x115005cd0390e0b555441dfe6900453589a43e1bd8e562ace5a38be57df55c29` |
| B3 | `0x59e0470975aaa630b3f8d417bd1e32bf6c7332da01dc9bf21d43b2b1595b5589` |
| B4 | `0xf8a54e2aa7e155d3e0b130bb208665713a8c31e37e63dc396068adc83bd7dca4` |

| Step | Method | Sender | Value | Block | Time (UTC) | Nonce | Event | Gas used / limit | Fee (wei) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | `create` | Client | 200000000000000 wei | 12185976 | 2026-11-22 02:51:00 | 6 | `AgreementCreated`: id 3, total 0.0002 ETH, 1 milestone | 1372423 / 1384483 | 2058634521958768 |
| A2 | `refund` | Client | 0 wei | 12186149 | 2026-11-22 03:27:48 | 7 | `MilestoneRefunded`: id 3, m 0, to Client (Client), 0.0002 ETH | 182251 / 197151 | 273376502551514 |
| B1 | `create` | Client | 200000000000000 wei | 12186214 | 2026-11-22 03:40:48 | 8 | `AgreementCreated`: id 4, total 0.0002 ETH, 1 milestone | 1372423 / 1384483 | 2058634519213922 |
| B2 | `submit` | Provider | 0 wei | 12186229 | 2026-11-22 03:44:12 | 2 | `MilestoneSubmitted`: id 4, m 0, revision 1 | 266629 / 269912 | 399943503732806 |
| B3 | `approve` | Verifier | 0 wei | 12186296 | 2026-11-22 03:58:00 | 1 | `MilestoneApproved`: id 4, m 0, revision 1 | 51204 / 51596 | 76806000665652 |
| B4 | `claim` | Provider | 0 wei | 12186326 | 2026-11-22 04:04:12 | 3 | `MilestoneClaimed`: id 4, m 0, to Provider, 0.0002 ETH | 182152 / 295576 | 273228002367976 |

Every transaction: status success, chain 11155111, EIP-1559, sent to the Settlane contract, exactly one Settlane event. A1 and B1 sent 200,000,000,000,000 wei (0.0002 ETH); the other four sent no value.

## 4. State after the run

- **Agreement #3** (Client, Provider, Verifier as above, review period 1,800 s): milestone 1 is **Refunded**; deposited 0.0002, paid 0, refunded 0.0002, outstanding 0 ETH; spec `0x7894d784bd5ce6bc3a14033aa579cf8eba99f9f08b89579fb3471cfe1e5584ed` (keccak256 of "Settlane acceptance A: design brief v1"); delivery deadline 2026-11-22 03:18:48 UTC (it passed before any submission).
- **Agreement #4** (same parties, review period 3,600 s): milestone 1 is **Paid**; deposited 0.0002, paid 0.0002, refunded 0, outstanding 0 ETH; spec `0xdc055dbd19a9b6181b92ee25ea951f4d66057f79d72ceb9b2ab36ff9bbfa9b30` (keccak256 of "Settlane acceptance #4: design brief v2"); evidence `0x916f9678cbeaa6fe5e7f51be5717a3772498237003ab709e3c6c63a5d9efdee1` (keccak256 of "Settlane acceptance #4: delivered design brief v2"), revision 1, 0 rejections.
- Contract ETH balance **0**; `totalOutstanding` **0**; the identity deposited = paid + refunded + outstanding holds for both agreements.
- Recipients: the refund of #3 went to the Client address; the claim of #4 went to the Provider address, each event naming the recipient and 0.0002 ETH.

## 5. Exact ETH accounting

| Wallet | Before A1 (wei) | Now (wei) | Change (wei) | Explained by |
| --- | --- | --- | --- | --- |
| Client | 2,070,869,941,917,528,238 | 2,066,279,296,373,804,034 | -4,590,645,543,724,204 | fees 4,390,645,543,724,204 plus the 0.0002 ETH of #4 that went to the Provider (#3's deposit came back in full) |
| Provider | 4,995,515,903,988,531 | 4,522,344,397,887,749 | -473,171,506,100,782 | +0.0002 ETH claim minus fees 673,171,506,100,782 |
| Verifier | 3,999,491,679,288,352 | 3,922,685,678,622,700 | -76,806,000,665,652 | fee of the approval only |

The three changes sum to exactly minus the total fees (-5,140,623,050,490,638 wei): no ETH was created or lost anywhere. In the block of each transaction, the sender's balance change equals exactly minus the value sent minus the fee, plus the payout the sender received in that same transaction (the refund and the claim paid the sender's own address) (publicnode historical balances).

## 6. Duplicate and conflicting actions (read-only simulation, nothing sent)

Simulated with `eth_call` as the role that would attempt each, against the final state of each agreement. Every attempt reverts with the specified reason:

| Attempt | Agreement #3 (Refunded) | Agreement #4 (Paid) |
| --- | --- | --- |
| Second claim (Provider) | milestone is not approved | milestone is not approved |
| Second refund (Client) | milestone cannot be refunded in this state | milestone cannot be refunded in this state |
| Submit (Provider) | milestone cannot take evidence in this state | milestone cannot take evidence in this state |
| Approve (Verifier) | milestone is not submitted | milestone is not submitted |
| Reject / request revision (Verifier) | milestone is not submitted | milestone is not submitted |

So a refunded milestone cannot be claimed, and a paid milestone cannot be refunded, submitted to or decided. The application's own wallet tests (frontend/e2e/app.spec.ts, local chain) cover the same conflicts through the interface.

## 7. Gas expenditure (six successful transactions)

Total gas used **3,427,082**; total fees **5,140,623,050,490,638 wei = 0.005140623050490638 ETH** (Client 4,390,645,543,724,204, Provider 673,171,506,100,782, Verifier 76,806,000,665,652 wei). MetaMask chose a 1.5 gwei tip, so a transaction cost about 1.5 gwei per gas where the network's base fee was a few wei. Share of the gas limit used: create 99.1% (both creates), refund 92.4%, submit 98.8%, approve 99.2%, claim 61.6% (limit 295,576, 1.5 times the app's estimate: MetaMask built that one with its own margin).

## 8. Wallet observations (OBSERVED, NOT RESOLVED)

None of the following is classified as resolved. The cause of each is undetermined; they may recur.

**8.1 Connection step (before the six transactions), reported by the owner.** An application "waiting for wallet" state and an error in the MetaMask interface; both cleared on their own. The exact text of the MetaMask error was not captured.

**8.2 Signing requests with no confirmation prompt (3 of 7 requests).** The application passed its contract simulation, entered its "waiting for wallet" state, and MetaMask showed no approval request.

| Request | What read-only checks showed | Outcome |
| --- | --- | --- |
| Provider submit, Agreement #3 (the Provider account's first transaction through MetaMask) | Provider nonce 2 latest and pending, milestone still Funded, nothing broadcast; 180 s of the delivery window left at 03:15:48 UTC | Never signed. The window closed at 03:18:48 UTC; the milestone expired and was refunded (A2) |
| Verifier approve, Agreement #4 (the Verifier account's first transaction through MetaMask) | Verifier nonce 1 latest and pending at 03:52 UTC, milestone Submitted, nothing broadcast, 10,100 s of the review window left | The approval was mined at 03:58:00 UTC (B3) after recovery steps |
| Provider claim, Agreement #4 | Provider nonce 3 latest and pending at 04:03:36 UTC, milestone Approved, nothing broadcast | The claim was mined at 04:04:12 UTC, 36 s after that check (B4) |

The requests that worked: create #3, refund #3, create #4 (Client) and submit #4 (Provider). **Observed pattern, not established:** the first two stalls were each account's first transaction through MetaMask (both accounts had sent transactions before, from their keystores, in the first run: nonces 2 and 1); the Client's first (create #3) worked, and the third stall was not a first.

**8.3 "reading origin" error, reported by the owner.** A recurring MetaMask error mentioning reading an origin was reported alongside the stalls. Its exact text, location (pop-up, page or extension error log) and stack trace were not captured, so it cannot be tied to a specific cause.

**8.4 Recovery procedures.** What the assistant recommended, in order: do not click again; open the MetaMask pop-up and reject any queued or unapproved request; confirm the account is connected to the site; lock and unlock MetaMask; reload the page; open the pop-up before clicking; if it stalls again, stop and check the chain before anything else; as a last resort reload the extension. **Which of these the owner performed before approve (B3) and claim (B4) confirmed, and whether the confirmation prompts appeared late or on their own, was not recorded.** The owner should add that here. The submission of Agreement #3 had no successful recovery before its deadline. No procedure is classified as a reliable fix; the evidence shows only that two requests later completed.

## 9. Findings

### 9.1 Confirmed frontend defects and hardening items (Settlane)

| ID | Finding | Evidence | Recommended fix |
| --- | --- | --- | --- |
| F-1 | **The signing step has no timeout, no cancel and no guidance.** If the wallet never answers, the page shows "waiting for wallet" indefinitely; `reset` is refused while a request is in flight, so Dismiss cannot clear it and the only way out is a page reload | `frontend/src/chain/write.ts` (the awaited `mutateAsync` and the `busy` guard); observed three times in section 8.2 | After about 20 s with no answer, show that MetaMask has not responded and what to check (open the pop-up, reject queued requests), a Check chain button that reports the nonce and whether anything was broadcast, and a Cancel that releases the in-flight guard; never resend automatically |
| F-2 | **No gas margin is set by the application.** The wallet's gas limit equalled the simulation's estimate for create (99.1% used), refund and approve | Section 7 | Apply a margin of about 20 to 30% to the estimate (the earlier testnet plan used 1.3) |
| F-3 | **The deadline is counted from the moment "Create and sign" is pressed, not from confirmation.** Agreement #3's delivery window came out 1,668 s, not the 1,800 s entered, because wallet approval took about 132 s | Section 3 (A1) and the stored `deliver_by` | State it next to the field and in the confirmation ("the clock starts when you sign"), or add the expected approval delay |

F-4 (test design, not a code defect): Agreement #3's 30-minute deadline was too short for a first real-wallet run; use at least 60 minutes (done for #4).

These are findings only; no code was changed.

### 9.2 Suspected extension defects (MetaMask, not confirmed)

| ID | Suspicion | Why it is only suspected |
| --- | --- | --- |
| E-1 | MetaMask accepts the page's request (the page reaches its signing state, the simulation having passed) but shows no approval prompt; the request is answered later or never | The Provider's and Verifier's nonces never moved while stalled, so nothing was sent; but whether the request left the page or reached MetaMask was not captured. A web search found no report of this exact behavior; MetaMask's own tracker describes related Manifest V3 service-worker problems (indirect evidence only) |
| E-2 | The "reading origin" error is raised inside the extension when it handles a request | Text and stack not captured (8.3) |
| E-3 | The first transaction from an account imported into MetaMask stalls | Two of the three accounts' first transactions through MetaMask stalled (the Client's, create #3, did not), and the third stall was not a first; sample too small |

A page-side cause for E-1 is not ruled out until the request is traced in the browser.

## 10. Acceptance criteria

| Criterion | Result |
| --- | --- |
| Create and fund an agreement through the wallet | PASS (A1, B1) |
| Provider submits evidence through the wallet | PASS (B2) |
| Verifier approves the exact evidence and revision | PASS (B3) |
| Provider claims to the chosen address, exact amount | PASS (B4) |
| Client refunds after expiry to the chosen address, exact amount | PASS (A2) |
| Exact accounting, `totalOutstanding` 0, contract balance 0 | PASS |
| Duplicate and conflicting terminal actions revert | PASS (simulation) |
| Transactions pinned to Sepolia, no mainnet path | PASS (the application refuses another network; the wallet was on Sepolia for every transaction) |
| Reliable wallet confirmation prompts | **OPEN, NOT PASSED** (section 8) |
| Clear in-page handling of an unresponsive wallet | **FAIL** (F-1) |

## 11. Remaining release items

1. **F-1** (unresponsive-wallet handling) before presenting the application as usable with a real wallet, or an explicit limitation in the README.
2. Decide on F-2 and F-3 (a small change each).
3. The wallet observations stay open: reproduce with the browser's developer tools open (page console, MetaMask service-worker console) and record the exact error text and stack before changing anything.
4. The application runs only on the owner's machine; a hosted copy needs a separate approval. Judges can otherwise run it locally (frontend/README.md).
5. D-031 (design pass) is still proposed and needs approval; nothing is pushed.

## 12. How this was verified

All six transactions were read by hash from publicnode (transactions, receipts, blocks, historical balances at the block before and the block of each transaction, contract reads, simulations). A second endpoint, 1rpc, returned receipts that match publicnode on all six (status, block, gas used, gas price, event names) and, at 04:05 to 04:06 UTC, the same final balances, nonces, milestone states and a zero contract balance. **Tenderly, the usual second endpoint, was unreachable for the whole final verification**, so it did not take part in this check; it did confirm A1, A2 (the refund), B1 and B2 in earlier verification during the run. Historical balances, simulations and the contract reads rest on publicnode alone for the final check. Nothing was signed, broadcast or simulated through a wallet by the assistant.

## 13. Follow-up (R1, 2026-11-22, D-032)

Owner-reported detail added after the run: the MetaMask error text was `TypeError: Cannot read properties of undefined (reading 'origin')`; it appeared inside the extension after account or network switching; Settlane still recognized the new account; MetaMask's "Try again" cleared the error. MetaMask 13.57.0 (Manifest V3) on Chrome 158.

F-1, F-2 and F-3 were fixed in the application (D-032): an unanswered request now shows elapsed time and recovery steps, can be left with "Stop waiting" without being treated as cancelled, cannot be duplicated, and is resolved after a reload by "Check the chain"; gas limits carry a 25% margin; the deadline wording states that the clock starts when "Create and sign" is pressed. These were verified with the stand-in wallet against the production bytecode on a local chain (frontend/e2e/app.spec.ts), **not yet with MetaMask**. E-1 to E-3 remain open and unexplained; the page now records which wallet request was made and whether it was answered, so the next occurrence can be pinned to a specific call.

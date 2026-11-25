# Evidence index

For each claim: where it is implemented, what tests it, and what you can check yourself. Links are relative to this repository. Line numbers refer to the code at the time of writing.

## A five-minute walkthrough (no wallet needed)

1. **Open the live app.** https://settlane.vercel.app. Every figure is read from Sepolia in your browser.
2. **See a payment.** Open [agreement #4](https://settlane.vercel.app/agreements/4). Its settlement progress shows Funded → Evidence submitted (rev 1) → Approved (rev 1) → Paid to the provider, each with a block time and a transaction link.
3. **See a refund.** Open [agreement #3](https://settlane.vercel.app/agreements/3). It shows Funded → Refunded to the client, with no submission or approval, because none happened.
4. **Check the accounting.** On either page, the ledger shows `deposited = paid + refunded + outstanding` with exact wei. The [dashboard](https://settlane.vercel.app/app) shows network totals: 0.0024 ETH deposited, 0.0012 claimed, 0.0012 refunded, 0 held.
5. **Check the bytecode.** Open the [Developers page](https://settlane.vercel.app/contract). It hashes the deployed runtime code live and compares it with the pinned build (`f0965efd…b3a8`).
6. **Check it without the app.** Follow any transaction link to Etherscan, or run the read-only verifier below.

```sh
python3 experiments/sepolia/testnet.py artifact          # a fresh `fe build` equals the pinned artifact
python3 experiments/sepolia/verify_deployment.py \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --address 0xf79d229a039bf5c84ecc7327060f8bbc888d2182 --from-block 12175958
```

The verifier reads only from the node. It compares the deployed bytecode with a fresh build, decodes and replays every event, and checks the accounting.

## Deployment

| Item | Value |
| --- | --- |
| Network | Ethereum Sepolia, chain id 11155111 |
| Contract | [`0xf79d229a039bf5c84ecc7327060f8bbc888d2182`](https://sepolia.etherscan.io/address/0xf79d229a039bf5c84ecc7327060f8bbc888d2182) |
| Deployment | [`0x4309d7c7…84598537`](https://sepolia.etherscan.io/tx/0x4309d7c7fc7b4f68820efe6da17d50381a822e1d656c607a31a58d4384598537), block 12175958 |
| Compiler | `fe 26.6.0 (5b3f96a)` |
| Runtime code | 6,056 bytes, SHA-256 `f0965efd4e9d2a0fcfd0eae88d5e6e9c0a938b22c03949b54f015b2600f4b3a8`, pinned in [`experiments/sepolia/artifact.json`](../experiments/sepolia/artifact.json) |

## Settlement transactions

| Step | Agreement #1 (paid, script) | Agreement #2 (refunded, script) | Agreement #3 (refunded, app + MetaMask) | Agreement #4 (paid, app + MetaMask) |
| --- | --- | --- | --- | --- |
| Fund | [`0x6617…70b3`](https://sepolia.etherscan.io/tx/0x661752e47fe7076b7f54f4bb33c6ec32bd0e1222e80f4d8c93e4131a55f470b3) | [`0xdb4d…c4f2`](https://sepolia.etherscan.io/tx/0xdb4d4d75e2d2aa2d505696ced033032e74c322b175267cb41079b28e12c0c4f2) | [`0x48c9…fe10`](https://sepolia.etherscan.io/tx/0x48c9ddc9c628ff81079d554360ef99aa8c8388235365d7624322feae1b84fe10) | [`0xd5ec…a721`](https://sepolia.etherscan.io/tx/0xd5ec3e77ecfea1880f34b2d60dfe31d5ce4d23eee7d139d37c44218bc82fa721) |
| Submit | [`0xe01e…8c04`](https://sepolia.etherscan.io/tx/0xe01e80607d67f72ae9374bde613afc0d3fcc1a25b5fc50dc6ee696e548f78c04) | | | [`0x1150…5c29`](https://sepolia.etherscan.io/tx/0x115005cd0390e0b555441dfe6900453589a43e1bd8e562ace5a38be57df55c29) |
| Approve | [`0x2340…fdf3`](https://sepolia.etherscan.io/tx/0x234075c6df23ba987c0fa68dc66e0d9652c68dd9bc45423d2da142034696fdf3) | | | [`0x59e0…5589`](https://sepolia.etherscan.io/tx/0x59e0470975aaa630b3f8d417bd1e32bf6c7332da01dc9bf21d43b2b1595b5589) |
| Claim | [`0xf1a4…71cc`](https://sepolia.etherscan.io/tx/0xf1a40207a9f407f5f1d9994b213e4980dd6d8083593b9e68dd70734a60f771cc) | | | [`0xf8a5…dca4`](https://sepolia.etherscan.io/tx/0xf8a54e2aa7e155d3e0b130bb208665713a8c31e37e63dc396068adc83bd7dca4) |
| Refund | | [`0xa9a2…398d`](https://sepolia.etherscan.io/tx/0xa9a25f2197a906340c285afb908959cc0952b6c1f2c019c23419a36862df398d) | [`0xf8df…0569`](https://sepolia.etherscan.io/tx/0xf8dfb824accf25d64be41e7d688cb77631f0b87593da387a841b6347e1d90569) | |
| Amount | 0.001 ETH | 0.001 ETH | 0.0002 ETH | 0.0002 ETH |

Agreements #3 and #4 were signed by the owner through the application and MetaMask, with gas and fees recorded per transaction: [`ACCEPTANCE_REAL_WALLET.md`](ACCEPTANCE_REAL_WALLET.md). After all four, `totalOutstanding` is 0. The full deployment record is in [`TESTNET.md`](TESTNET.md).

## Claims and their evidence

| Claim | Implementation | Test or check | Limitation |
| --- | --- | --- | --- |
| Only `Claim` and `Refund` can send ETH | `uses` lists in [`settlane.fe:79–125`](../ingots/settlane/src/settlane.fe#L79-L125) | lint `E-CALL`, `C-XFER*`; `verification_steps_never_move_eth_even_when_every_party_can_receive_it` | The compiler enforces omission only; a read-only `call` in an arm is not rejected (FE_NOTES E7). |
| One transfer, after every write, stipend only | [`handlers.fe:436–444`](../ingots/settlane/src/handlers.fe#L436-L444) | lint `C-XFER-ORDER`, `C-XFER-ARM`; reentrancy tests | Smart-contract wallets needing more than 2,300 gas cannot receive directly. |
| Production time comes only from the block | [`settlane.fe:65`](../ingots/settlane/src/settlane.fe#L65) and every arm | lint `C-CLOCK`; `production_has_no_way_to_set_its_clock`; Anvil wrong-clock mutations | Proven by lint and Anvil, not by a Fe test (the Fe test block cannot advance). |
| Deadlines hold at d−1/d/d+1 | [`rules.fe:86–96, 287–300`](../ingots/settlane/src/rules.fe#L86-L96) | `refund_boundaries_hold_at_d_minus_1_d_and_d_plus_1_in_every_slot_and_state` | Block producers can skew timestamps slightly. |
| Role checks in a fixed order | `check_*` in [`rules.fe`](../ingots/settlane/src/rules.fe) | the `only_the_*` tests | The verifier is trusted. |
| Approval names exact evidence and revision | `check_review` in [`rules.fe:196`](../ingots/settlane/src/rules.fe#L196) | `evidence_must_match_and_stale_evidence_can_neither_be_approved_nor_rejected` | The contract does not inspect the work. |
| Paid or refunded, never both | `expired` excludes Approved/Paid/Refunded | `the_client_refunds_expired_milestones_once_and_claim_and_refund_exclude_each_other` | |
| Accounting conserved | counters in [`handlers.fe`](../ingots/settlane/src/handlers.fe) | `one_agreement_settled_three_ways_books_every_wei_to_the_right_counter`; Sepolia ledger | ETH forced in outside `create` is stranded (`balance >= outstanding`). |
| Ethereum-compatible ABI | `sol("…")` selectors, [`settlane.fe:15–50`](../ingots/settlane/src/settlane.fe#L15-L50) | `npm run check-abi`; lint ABI lock; real MetaMask and Etherscan use | |
| Writes are simulated before the wallet is asked | [`frontend/src/chain/write.ts`](../frontend/src/chain/write.ts) | `tx-runner.test.ts`, `e2e/app.spec.ts` | |
| Lost wallet requests are recovered, never guessed | [`tx-recovery.ts`](../frontend/src/chain/tx-recovery.ts), [`write.ts`](../frontend/src/chain/write.ts) | `r2b-recovery`, `r2c-repro`, `residual-fixes` unit tests; `app.spec.ts` | A request rejected in MetaMask after a reload cannot be seen by the page. |
| History survives failing nodes | [`adaptive-transport.ts`](../frontend/src/chain/adaptive-transport.ts), [`history.ts`](../frontend/src/contract/history.ts) | `adaptive-transport.test.ts`, `e2e/outage.spec.ts`, `e2e/hang.spec.ts` | Contract-state reads still use a fixed-order fallback. |
| Hosted CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | [run 45513395947](https://github.com/osodotsol/settlane/actions/runs/45513395947), all jobs green | |

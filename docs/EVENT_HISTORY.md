# Event history: why it needs a snapshot, and how it is verified

Written 2026-11-22 (R1.5). Applies to the frontend only; the Fe contract, ABI and deployment are unchanged.

## 1. The failure (reproduced, not assumed)

The application shows agreement histories, Activity, payout history and the landing replay from the contract's events. It read them with `eth_getLogs` from public Sepolia nodes. On 2026-11-22 those nodes stopped returning old logs.

| Probe | Result |
| --- | --- |
| publicnode `eth_getLogs` over blocks 12,176,008 to 12,176,299 (the first run's six events, 13,000 blocks old) | `4444 pruned history unavailable`, for a single block and for every range containing one of them |
| publicnode, a range of the same age with NO Settlane logs | answered (`0 logs`): empty ranges are served from an index, so a pruned range fails loudly only when it holds logs |
| publicnode, blocks 12,185,976 to 12,186,326 (the real-wallet run, about 3,000 blocks old) | still served when probed; they age out next |
| publicnode `eth_getTransactionReceipt` of the first run's creation | `null` (the receipt is gone too) |
| Tenderly | the same ranges return their logs; historical `eth_getBalance` and `eth_getLogs` at blocks 5,000,000, 9,000,000 and 12,000,000 all answer; CORS `allow-origin: *` |
| `rpc.sepolia.ethpandaops.io` (Ethereum Foundation devops) | the same: logs, receipt, historical state at old blocks, CORS `*` |
| 1rpc | `eth_getLogs is limited to 0 - 50 blocks range`; no old receipts |
| drpc, blastapi, zan, thirdweb, rpc.sepolia.org, ankr, omniatech, pokt | key or paid plan required, retired, unreachable, or no usable answer |

The pruning window is not a fixed age (some ranges of the same age answer, some do not); what is certain is that a range holding logs older than a few thousand blocks fails. Tenderly was unreachable for hours earlier the same day, so no single endpoint can be relied on.

**Affected routes before the fix** (every one that reads events): the public agreement page (`/agreements/[id]`), Contract evidence (`/contract` transaction list), the Explorer's creation times, the landing replay and proof, and in the application the dashboard's recent activity, Activity, Payments history and the agreement workspace. Server pages took 71 to 85 s and showed "history could not be read". Contract state, balances and eligibility use `eth_call` and were not affected.

## 2. The design

```
verified snapshot (committed, up to a FINALIZED block)  +  live scan of newer blocks  =  history
```

- `src/contract/history-snapshot.json`: raw logs (block hash, transaction hash, log index, topics, data, block timestamp) for every Settlane event from the deployment block to a finalized block, with provenance and a content hash.
- `src/contract/snapshot.ts` re-verifies the file at load (chain, contract address, deployment block, content hash, order, no duplicates, every log decodes). A file that fails, or is for another deployment (the local test chain), is not used.
- `src/contract/history.ts` serves the snapshot at once and scans only newer blocks, restarting a bounded 64-block overlap behind the last block read. Re-scanned blocks replace what was held for them (reorg-safe); events are deduplicated by block hash, transaction hash and log index; where the overlap touches the snapshot the two must agree, and a difference is reported as a conflict.
- A range that cannot be read becomes a **gap** carrying the node's error, is retried on every refresh, and keeps the history "incomplete" until it closes. Nothing is invented to fill it.
- `src/domain/history-coverage.ts` compares each agreement's events with what its **live state** requires (1 created; 1 submitted per revision; 1 rejected per revision request; 1 approved if Approved or Paid; 1 claimed if Paid; 1 refunded if Refunded). Pages say "History complete" only when there are no gaps, conflicts or errors and the counts match; otherwise they name what is missing and why.
- Log reads go to `historyClient` (publicnode, Tenderly, ethpandaops, in that order, falling to the next on any error; configurable with `NEXT_PUBLIC_HISTORY_RPC_URLS`). All keyless. They only ever supply the blocks after the snapshot.
- **The history never authorizes anything.** Agreement state, balances, deadlines and every action's eligibility are read from the live contract and simulated before signing, exactly as before. If history is unreadable the explorer, agreement state and all actions still work; the landing replay falls back to its labelled illustration rather than showing a partial real one.

## 3. The committed snapshot

- Contract `0xF79d229a039bF5C84ecC7327060F8bBC888D2182`, chain 11155111, deployment block 12175958.
- **Last verified block 12189222** (the chain's finalized block when built), hash `0x3e82c850a08b11574f563ad130a21b037ea491177d3a655fc68c344344e4ddd4`.
- Generated 2026-11-22T14:25:07.397Z; content hash `keccak256:0x5ccf3fe84e9c80381ffc549d4a20ec09b4afc420fb509cdec9b171b1d43c42c0`.
- 12 events, 4 agreements.
- Sources: https://sepolia.gateway.tenderly.co, https://rpc.sepolia.ethpandaops.io.

| # | Block | Transaction | Log index | Block hash |
| --- | --- | --- | --- | --- |
| 1 | 12176008 | `0x661752e47fe7076b7f54f4bb33c6ec32bd0e1222e80f4d8c93e4131a55f470b3` | 53 | `0x43f984841c1471ac…` |
| 2 | 12176039 | `0xe01e80607d67f72ae9374bde613afc0d3fcc1a25b5fc50dc6ee696e548f78c04` | 53 | `0x9c0868644a00b336…` |
| 3 | 12176144 | `0x234075c6df23ba987c0fa68dc66e0d9652c68dd9bc45423d2da142034696fdf3` | 16 | `0x1d4e843adb056290…` |
| 4 | 12176195 | `0xf1a40207a9f407f5f1d9994b213e4980dd6d8083593b9e68dd70734a60f771cc` | 33 | `0x5de3ddc6bae71249…` |
| 5 | 12176230 | `0xdb4d4d75e2d2aa2d505696ced033032e74c322b175267cb41079b28e12c0c4f2` | 195 | `0xa1022272af817f19…` |
| 6 | 12176299 | `0xa9a25f2197a906340c285afb908959cc0952b6c1f2c019c23419a36862df398d` | 85 | `0x49fe3ba45801f019…` |
| 7 | 12185976 | `0x48c9ddc9c628ff81079d554360ef99aa8c8388235365d7624322feae1b84fe10` | 34 | `0xfa7004d3a821fc1c…` |
| 8 | 12186149 | `0xf8dfb824accf25d64be41e7d688cb77631f0b87593da387a841b6347e1d90569` | 232 | `0xd4500b3e0a4bc3ec…` |
| 9 | 12186214 | `0xd5ec3e77ecfea1880f34b2d60dfe31d5ce4d23eee7d139d37c44218bc82fa721` | 3 | `0xe37a36b555b47eb2…` |
| 10 | 12186229 | `0x115005cd0390e0b555441dfe6900453589a43e1bd8e562ace5a38be57df55c29` | 15 | `0x610a2496c1d8b9cb…` |
| 11 | 12186296 | `0x59e0470975aaa630b3f8d417bd1e32bf6c7332da01dc9bf21d43b2b1595b5589` | 47 | `0x9291175e23219db3…` |
| 12 | 12186326 | `0xf8a54e2aa7e155d3e0b130bb208665713a8c31e37e63dc396068adc83bd7dca4` | 27 | `0x088d5f7f24f6224e…` |

**How each step was verified** (`scripts/build-event-snapshot.mjs` refuses to write on any failure):

1. Two independent archival nodes returned identical logs for the whole range: same count, and the same address, topics, data, block number, block hash, transaction hash and log index for every log.
2. Every log is present at the same index in its transaction's receipt on both nodes; the receipt succeeded; the transaction was sent to the Settlane contract on chain 11155111.
3. The block hash of every event block equals the one `getBlock` returns on both nodes.
4. Every log decodes with the production ABI as one of the six events; there is no other log from the contract.
5. **Completeness:** the contract's own state at the boundary block, read with `eth_call` at that block on both nodes, requires exactly these event counts per agreement (and the accounting identity holds). A missing or extra event would break an equality.
6. The boundary is the finalized block, so these events cannot be reorganized.

The unit tests (`frontend/tests/history-engine.test.ts`) pin the twelve transaction hashes, blocks, recipients and amounts above.

## 4. Keeping it current (a maintainer task; the owner approves committing it)

The snapshot ends at a fixed block. Newer events come from the live scan, which works while a node still serves the blocks since the boundary. Because publicnode prunes logs after a few thousand blocks, **advance the snapshot at least once a day while the deployment is in use, and before any judge-facing window**. The procedure is section 7 (R2-B); the full rebuild from the deployment block needs two archival sources and is the fallback, not the routine.

## 5. Remaining risks

- The live part still depends on public, keyless nodes. They can fail together; the application then shows what the snapshot holds, labels the rest incomplete, and keeps every contract-state view and action working.
- Tenderly and ethpandaops were verified archival on 2026-11-22; that can change. On the same day, during R2-B, Tenderly stopped answering (connection timeout), so the full independent re-verification from the deployment block is not possible until it returns or another keyless archival source appears (section 7).
- The snapshot is a point in time. A deployment with new agreements needs it rolled forward (section 4), or a nightly job and an archive-capable endpoint, which is a separate decision.
- Event timestamps in the snapshot are block timestamps read from the same two nodes; the application does not re-verify them.

## 6. R2-A changes (2026-11-22)

- A node that serves logs a few blocks behind the head it reported no longer deletes events: only the blocks actually read are replaced, and the newest blocks it did not serve are read again on the next refresh (the coverage head, `scannedTo`, only advances over blocks that were read).
- Blocks up to the snapshot's finalized boundary are never changed by a rescan. A rescan that disagrees with the snapshot is recorded as a conflict and stays visible until a later rescan of the same blocks agrees.
- Every read the pages wait for is time-bounded (10 s on the server, 12 s per attempt in the browser). Past the budget the history shows what it holds (at least the snapshot) as "not refreshed", never "complete".

## 7. R2-B: two kinds of verification, and the operator procedure (2026-11-22)

**Two separate checks.**

| Check | Command (in `frontend/`) | Network | Where it runs | Proves |
|---|---|---|---|---|
| Local integrity | `npm run snapshot:verify-local` | none | CI step "Snapshot integrity", and the app on every load | The file is for this deployment, unchanged since it was hashed (content hash), every log decodes, events are in chain order without duplicates, the agreement count matches, and the sequence obeys the contract's rules (ids consecutive from 1; submission revisions and rejection counts consecutive; approve and reject name the latest revision; claim only after approval; no refund after approval; nothing after a payout). |
| Independent verification | `npm run snapshot:check` | two independent sources | an operator, by hand | The committed events equal the chain's on every source (logs, receipts, block hashes), and the event counts equal what the contract's state at the boundary requires on every source. |

Local integrity cannot prove completeness: only the contract's state can. The independent check never passes with fewer than two sources on different hosts. Exit codes: 0 verified, 1 a source contradicts the snapshot, 2 cannot verify (fewer than two sources answered, or `--partial`). Nothing is written unless the exit code is 0.

**Which sources work (tested 2026-11-22, not assumed from their descriptions).**
- **ethpandaops** served logs from the deployment block, receipts, and state at old blocks.
- **publicnode** served state at the boundary (about 1,200 blocks old), but its old logs and receipts are pruned.
- **Tenderly** did not answer (connection timeout).
- The others were unusable: 1rpc returned only a single-block log query; onfinality and zan returned partial results; drpc and blockpi need a paid plan or a key; blastapi rejected every request; omniatech (521), rpc.sepolia.org (404), subquery and rockx (DNS gone) are retired.

So today:
- the full re-verification from the deployment block (`--check` with the default sources) exits 2, "1 of 2 sources answered";
- `--check --partial` re-ran every step on ethpandaops alone and found the committed snapshot consistent with the chain, but it is reported as NOT independent and exits 2;
- `--advance` works with two independent operators, because the new segment is recent enough for publicnode.

**Advancing the snapshot (routine, no archival node needed while it is done often).**

```
cd frontend
SNAPSHOT_SOURCES=https://rpc.sepolia.ethpandaops.io,https://ethereum-sepolia-rpc.publicnode.com \
  node scripts/build-event-snapshot.mjs --advance --dry-run    # verify only; writes nothing
SNAPSHOT_SOURCES=... node scripts/build-event-snapshot.mjs --advance   # writes the file (exit 0 only)
npm run snapshot:verify-local && npm run test               # offline integrity and the pinned tests
git diff src/contract/history-snapshot.json                  # review: new events, new boundary, a new provenance segment
```

`--advance` keeps the committed events and does the following:
1. checks that their content hash is intact and that the old boundary block still has the committed hash on every source (continuity);
2. reads only the new blocks up to the current finalized block, comparing logs, receipts and block hashes across the sources;
3. checks ALL events since deployment against the contract's state at the new boundary on every source;
4. records the segment, its sources and the time in `provenance.segments`.

The dry run on 2026-11-22 found 0 new events between block 12,189,223 and the finalized block 12,190,410 on both sources. The contract's state at 12,190,410 required exactly the 12 committed events, on both. The committed file was not changed; the owner decides when to advance it (just before the judging window is best).

**Rules for the operator.**
- Use two sources run by different operators. A URL that contains an API key goes only in the environment, never in a tracked file.
- Never commit a file that `--advance` did not write with exit 0. Never edit the snapshot by hand: the content hash and the lifecycle rules reject it.
- If `--check` or `--advance` exits 1, a source contradicts the snapshot. Stop and investigate; do not retry with other sources until one agrees.
- If the snapshot falls further behind than publicnode keeps logs, only an archival pair can advance it (the default sources, once Tenderly answers). Until then the pages say the history may be incomplete. They never call it complete.
- There is no scheduler and no paid service; advancing stays a deliberate, reviewed commit.

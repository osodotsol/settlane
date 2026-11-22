#!/usr/bin/env node
// Builds src/contract/history-snapshot.json: every Settlane event from the deployment block to a FINALIZED block,
// verified before it is written. Run by a maintainer (public, keyless endpoints only; nothing is signed or sent):
//
//   node scripts/build-event-snapshot.mjs            write the snapshot
//   node scripts/build-event-snapshot.mjs --check    verify the committed snapshot against the chain, write nothing
//
// Why a snapshot: public Sepolia nodes prune old logs (docs/EVENT_HISTORY.md). The events up to a finalized block never
// change, so they are recorded once, with their provenance, and the application only scans newer blocks.
//
// What is verified (the script refuses to write anything that fails a step):
//  1. TWO independent archival sources return the same logs for [deploy block, boundary]: same count, and identical
//     address, topics, data, block number, block hash, transaction hash and log index for every log.
//  2. Each log is present, at the same position, in its transaction's receipt (fetched from both sources); the
//     receipt status is success and the transaction was sent to the Settlane contract on this chain.
//  3. The block hash of every event block equals the block hash returned by getBlock on both sources.
//  4. Every log decodes as one of the six Settlane events; no other log from the contract exists.
//  5. COMPLETENESS against the contract's own state at the boundary block (read with eth_call at that block, on both
//     sources): for every agreement, created = 1, submitted = revision, rejected = rejections, approved = 1 if the
//     milestone is Approved or Paid else 0, claimed = 1 if Paid, refunded = 1 if Refunded. A missing or extra event
//     would break an equality.
//  6. The boundary block is the chain's `finalized` block (or older), and its hash is recorded.

import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, getAddress, http, keccak256, stringToBytes } from "viem";
import { sepolia } from "viem/chains";
import { settlaneAbiJson } from "./abi-json.mjs";

const abi = settlaneAbiJson();
const OUT = new URL("../src/contract/history-snapshot.json", import.meta.url);
const ADDRESS = getAddress(process.env.NEXT_PUBLIC_SETTLANE_ADDRESS ?? "0xf79d229a039bf5c84ecc7327060f8bbc888d2182");
const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "12175958");
const CHUNK = 5_000n;
const SOURCES = [
  { name: "tenderly", url: "https://sepolia.gateway.tenderly.co" },
  { name: "ethpandaops", url: "https://rpc.sepolia.ethpandaops.io" },
];
const clients = SOURCES.map((s) => ({ ...s, c: createPublicClient({ chain: sepolia, transport: http(s.url, { timeout: 30_000, retryCount: 3, retryDelay: 800 }) }) }));
const fail = (msg) => {
  console.error("FAILED: " + msg);
  process.exit(1);
};
const check = process.argv.includes("--check");
const ok = (msg) => console.log("  ok  " + msg);

/** The six event kinds and the milestone-state facts they must add up to (see 5 above). */
const STATE = ["none", "funded", "submitted", "approved", "paid", "refunded"];

async function logsFrom(c, from, to) {
  const out = [];
  for (let start = from; start <= to; start += CHUNK) {
    const end = start + CHUNK - 1n < to ? start + CHUNK - 1n : to;
    const logs = await c.getLogs({ address: ADDRESS, fromBlock: start, toBlock: end });
    out.push(...logs);
  }
  return out;
}

/** The identifying content of a log, nothing else, in a fixed order. */
const raw = (l) => ({
  blockNumber: l.blockNumber.toString(),
  blockHash: l.blockHash,
  transactionHash: l.transactionHash,
  logIndex: l.logIndex,
  topics: [...l.topics],
  data: l.data,
});
const keyOf = (l) => `${l.blockHash}:${l.transactionHash}:${l.logIndex}`;
const contentHash = (events) =>
  "keccak256:" +
  keccak256(
    stringToBytes(
      JSON.stringify(events.map((e) => ({ blockNumber: e.blockNumber, blockHash: e.blockHash, transactionHash: e.transactionHash, logIndex: e.logIndex, topics: e.topics, data: e.data, timestamp: e.timestamp }))),
    ),
  );

async function main() {
  console.log(`Settlane event snapshot ${check ? "(check only)" : ""}: ${ADDRESS} on chain ${sepolia.id}, deployed at block ${DEPLOY_BLOCK}`);
  for (const s of clients) if ((await s.c.getChainId()) !== sepolia.id) fail(`${s.name} is not chain ${sepolia.id}`);
  ok("both sources report chain 11155111");

  // 6. the boundary: the finalized block, or the committed snapshot's own boundary when checking
  let boundary;
  if (check) {
    const snap = JSON.parse(readFileSync(OUT, "utf8"));
    boundary = BigInt(snap.lastVerifiedBlock);
  } else {
    const fin = await Promise.all(clients.map((s) => s.c.getBlock({ blockTag: "finalized" })));
    boundary = fin.map((b) => b.number).reduce((a, b) => (a < b ? a : b));
  }
  const boundaryBlocks = await Promise.all(clients.map((s) => s.c.getBlock({ blockNumber: boundary })));
  if (boundaryBlocks[0].hash !== boundaryBlocks[1].hash) fail("the two sources disagree about the boundary block hash");
  const boundaryHash = boundaryBlocks[0].hash;
  ok(`boundary block ${boundary} (${boundaryHash.slice(0, 12)}…), identical on both sources`);

  // 1. independent logs, identical
  const [a, b] = await Promise.all(clients.map((s) => logsFrom(s.c, DEPLOY_BLOCK, boundary)));
  if (a.length !== b.length) fail(`the sources return different numbers of logs: ${clients[0].name} ${a.length}, ${clients[1].name} ${b.length}`);
  for (let i = 0; i < a.length; i++) if (JSON.stringify(raw(a[i])) !== JSON.stringify(raw(b[i]))) fail(`log ${i} differs between the sources`);
  ok(`${a.length} logs, identical on both sources (address, topics, data, block, block hash, transaction, log index)`);
  if (a.some((l) => l.removed)) fail("a log is marked removed");
  const keys = new Set(a.map(keyOf));
  if (keys.size !== a.length) fail("duplicate log keys");

  // 3 + 2. block hashes, receipts, success, destination
  const events = [];
  for (const l of a) {
    const blocks = await Promise.all(clients.map((s) => s.c.getBlock({ blockNumber: l.blockNumber })));
    if (blocks[0].hash !== l.blockHash || blocks[1].hash !== l.blockHash) fail(`block hash of ${l.blockNumber} does not match the log's`);
    for (const s of clients) {
      const [r, tx] = await Promise.all([s.c.getTransactionReceipt({ hash: l.transactionHash }), s.c.getTransaction({ hash: l.transactionHash })]);
      if (r.status !== "success") fail(`${l.transactionHash} did not succeed`);
      if (tx.chainId !== sepolia.id) fail(`${l.transactionHash} has chain id ${tx.chainId}`);
      if (!tx.to || getAddress(tx.to) !== ADDRESS) fail(`${l.transactionHash} was not sent to the Settlane contract`);
      const inReceipt = r.logs.find((x) => x.logIndex === l.logIndex);
      if (!inReceipt || inReceipt.data !== l.data || JSON.stringify(inReceipt.topics) !== JSON.stringify(l.topics) || getAddress(inReceipt.address) !== ADDRESS) fail(`log ${keyOf(l)} is not in its receipt from ${s.name}`);
      if (r.blockHash !== l.blockHash) fail(`receipt block hash differs for ${l.transactionHash}`);
    }
    events.push({ ...raw(l), timestamp: blocks[0].timestamp.toString() });
  }
  ok("every log is in its successful receipt, on the right chain and contract, in a block whose hash matches, on both sources");

  // 4. decodes
  const decoded = events.map((e) => {
    try {
      const d = decodeEventLog({ abi, topics: e.topics, data: e.data });
      return { e, name: d.eventName, args: d.args };
    } catch {
      return fail(`log ${keyOf({ ...e, blockNumber: 0n })} is not a Settlane event`);
    }
  });
  ok("every log decodes as a Settlane event");

  // 5. completeness against the contract's state at the boundary, on both sources
  const read = (c, fn, args) => c.readContract({ address: ADDRESS, abi, functionName: fn, args, blockNumber: boundary });
  let agreements = 0;
  for (;;) {
    try {
      await read(clients[0].c, "getAgreement", [BigInt(agreements + 1)]);
      agreements++;
    } catch {
      break;
    }
  }
  if (agreements === 0) fail("no agreement exists at the boundary");
  const count = (name, id, m) => decoded.filter((d) => d.name === name && d.args.id === id && (m === undefined || Number(d.args.m) === m)).length;
  for (let id = 1n; id <= BigInt(agreements); id++) {
    for (const s of clients) {
      const head = await read(s.c, "getAgreement", [id]);
      const acc = await read(s.c, "getAccounting", [id]);
      if (acc[0] !== acc[1] + acc[2] + acc[3]) fail(`agreement ${id}: accounting identity broken at the boundary`);
      if (count("AgreementCreated", id) !== 1) fail(`agreement ${id}: expected exactly one AgreementCreated`);
      for (let m = 0; m < head[4]; m++) {
        const ms = await read(s.c, "getMilestone", [id, m]);
        const st = STATE[ms[0]];
        const want = {
          MilestoneSubmitted: Number(ms[7]),
          MilestoneRejected: Number(ms[6]),
          MilestoneApproved: st === "approved" || st === "paid" ? 1 : 0,
          MilestoneClaimed: st === "paid" ? 1 : 0,
          MilestoneRefunded: st === "refunded" ? 1 : 0,
        };
        for (const [name, n] of Object.entries(want)) {
          const got = count(name, id, m);
          if (got !== n) fail(`agreement ${id} milestone ${m + 1}: ${name} expected ${n} from the contract's state (${s.name}), found ${got}`);
        }
      }
    }
  }
  ok(`${agreements} agreements: the event counts equal what the contract's own state at block ${boundary} requires (created, submitted = revision, rejected = rejections, approved, claimed, refunded), checked on both sources`);
  if (decoded.length !== events.length) fail("internal: decode count");
  const allAccounted = decoded.every((d) => d.args.id >= 1n && d.args.id <= BigInt(agreements));
  if (!allAccounted) fail("an event names an agreement the contract does not have");
  ok("every event belongs to an existing agreement; there are no unexplained events");

  const snapshot = {
    description: "Settlane contract events from the deployment block to a finalized block, verified (scripts/build-event-snapshot.mjs, docs/EVENT_HISTORY.md). Raw logs; the application decodes them with the ABI.",
    chainId: sepolia.id,
    address: ADDRESS,
    deployBlock: DEPLOY_BLOCK.toString(),
    lastVerifiedBlock: boundary.toString(),
    lastVerifiedBlockHash: boundaryHash,
    agreements,
    generatedAt: new Date().toISOString(),
    provenance: {
      sources: SOURCES.map((s) => s.url),
      method: "eth_getLogs in 5,000-block chunks from two independent archival nodes, compared for exact equality; receipts, block hashes and the contract's state at the boundary block cross-checked on both",
      finality: "boundary = the finalized block at generation time",
    },
    contentHash: contentHash(events),
    events,
  };
  if (check) {
    const committed = JSON.parse(readFileSync(OUT, "utf8"));
    if (committed.contentHash !== snapshot.contentHash) fail("the committed snapshot's events differ from the chain's");
    if (committed.lastVerifiedBlockHash !== snapshot.lastVerifiedBlockHash) fail("the committed boundary hash differs from the chain's");
    ok("the committed snapshot matches the chain exactly");
    return;
  }
  writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + "\n");
  console.log(`\nwrote ${events.length} events up to block ${boundary} to src/contract/history-snapshot.json`);
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));

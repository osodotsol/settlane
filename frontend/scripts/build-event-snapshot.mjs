#!/usr/bin/env node
// Builds and verifies src/contract/history-snapshot.json: every Settlane event from the deployment block to a FINALIZED
// block, verified against INDEPENDENT sources before anything is written. Run by a maintainer (public, keyless endpoints by
// default; nothing is signed or sent). docs/EVENT_HISTORY.md section 7 is the operator procedure.
//
//   node scripts/build-event-snapshot.mjs --check              independent re-verification of the committed snapshot
//   node scripts/build-event-snapshot.mjs --check --partial    the same against whatever sources answer; NEVER a pass
//   node scripts/build-event-snapshot.mjs --advance [--dry-run] extend the committed snapshot to the finalized block
//   node scripts/build-event-snapshot.mjs                      rebuild from the deployment block (needs archival sources)
//
// Offline integrity (structure, content hash, decoding, lifecycle consistency) is a separate, deterministic check run in
// CI: `npm run snapshot:verify-local` (tests/snapshot-integrity.test.ts). This script is the NETWORK half.
//
// Sources: SNAPSHOT_SOURCES (comma-separated URLs), default Tenderly + ethpandaops. At least TWO, on different hosts
// (independent operators), must answer every step; there is no single-source pass. A URL that contains an API key must be
// given only through the environment and never committed.
//
// Exit codes: 0 verified (and written, unless --check or --dry-run); 1 a source contradicts the snapshot or the chain;
// 2 cannot verify independently (fewer than two sources answered, or --partial). Nothing is written unless exit is 0.
//
// What is verified, on EVERY source (the script refuses to write anything that fails a step):
//  1. Identical logs for the range: same count, identical address, topics, data, block number, block hash, transaction
//     hash and log index for every log.
//  2. Each log is present, at the same position, in its transaction's receipt; the receipt succeeded; the transaction
//     was sent to the Settlane contract on this chain.
//  3. The block hash of every event block equals getBlock's on every source.
//  4. Every log decodes as one of the six Settlane events.
//  5. COMPLETENESS against the contract's own state at the boundary block (eth_call at that block): for every
//     agreement, created = 1, submitted = revision, rejected = rejections, approved = 1 if Approved or Paid, claimed = 1
//     if Paid, refunded = 1 if Refunded. A missing or extra event anywhere since deployment breaks an equality.
//  6. The boundary block is the `finalized` block (or older) on every source, and its hash is recorded.
//  7. --advance only: the committed snapshot's content hash matches its events, and its boundary block hash is still
//     the chain's on every source (continuity); only the new segment is read as logs, step 5 covers everything.

import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, getAddress, http, keccak256, stringToBytes } from "viem";
import { sepolia } from "viem/chains";
import { settlaneAbiJson } from "./abi-json.mjs";

const abi = settlaneAbiJson();
const OUT = new URL("../src/contract/history-snapshot.json", import.meta.url);
const ADDRESS = getAddress(process.env.NEXT_PUBLIC_SETTLANE_ADDRESS ?? "0xf79d229a039bf5c84ecc7327060f8bbc888d2182");
const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "12175958");
const CHUNK = 5_000n;
const args = process.argv.slice(2);
const mode = args.includes("--check") ? "check" : args.includes("--advance") ? "advance" : "build";
const partial = args.includes("--partial");
const dryRun = args.includes("--dry-run");

const fail = (msg) => {
  console.error("FAILED: " + msg);
  process.exit(1);
};
const cannot = (msg) => {
  console.error("NOT VERIFIED: " + msg);
  process.exit(2);
};
const ok = (msg) => console.log("  ok  " + msg);

if (partial && mode !== "check") cannot("--partial is only for --check; nothing is ever written from fewer than two sources");

const SOURCES = (process.env.SNAPSHOT_SOURCES ?? "https://sepolia.gateway.tenderly.co,https://rpc.sepolia.ethpandaops.io")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean)
  .map((url) => ({ url, name: new URL(url).hostname }));
if (SOURCES.length < 2) cannot("SNAPSHOT_SOURCES must name at least two independent sources");
if (new Set(SOURCES.map((s) => s.name)).size !== SOURCES.length) cannot("the sources must be on different hosts (independent operators)");

/** The identifying content of a log, nothing else, in a fixed order. */
const raw = (l) => ({ blockNumber: l.blockNumber.toString(), blockHash: l.blockHash, transactionHash: l.transactionHash, logIndex: l.logIndex, topics: [...l.topics], data: l.data });
const keyOf = (l) => `${l.blockHash}:${l.transactionHash}:${l.logIndex}`;
const contentHash = (events) =>
  "keccak256:" +
  keccak256(stringToBytes(JSON.stringify(events.map((e) => ({ blockNumber: e.blockNumber, blockHash: e.blockHash, transactionHash: e.transactionHash, logIndex: e.logIndex, topics: e.topics, data: e.data, timestamp: e.timestamp })))));
const STATE = ["none", "funded", "submitted", "approved", "paid", "refunded"];

async function logsFrom(c, from, to) {
  const out = [];
  for (let start = from; start <= to; start += CHUNK) {
    const end = start + CHUNK - 1n < to ? start + CHUNK - 1n : to;
    out.push(...(await c.getLogs({ address: ADDRESS, fromBlock: start, toBlock: end })));
  }
  return out;
}

/** Which sources answer at all (chain id within 15 s). */
async function reachable() {
  const all = SOURCES.map((s) => ({ ...s, c: createPublicClient({ chain: sepolia, transport: http(s.url, { timeout: 30_000, retryCount: 3, retryDelay: 800 }) }) }));
  const probe = await Promise.all(
    all.map(async (s) => {
      try {
        const id = await Promise.race([s.c.getChainId(), new Promise((_, r) => setTimeout(() => r(new Error("no answer in 15 s")), 15_000))]);
        if (id !== sepolia.id) fail(`${s.name} is chain ${id}, not ${sepolia.id}`);
        return { s, error: null };
      } catch (e) {
        return { s, error: (e.shortMessage ?? e.message ?? String(e)).split("\n")[0] };
      }
    }),
  );
  for (const p of probe) console.log(`  ${p.error ? "--" : "ok"}  source ${p.s.name}${p.error ? `: ${p.error}` : ""}`);
  return probe.filter((p) => !p.error).map((p) => p.s);
}

/** Steps 1 to 4 for [from, to] on every client; returns the events (raw logs + block timestamp), in chain order. */
async function verifySegment(clients, from, to) {
  if (to < from) return [];
  const all = await Promise.all(clients.map((s) => logsFrom(s.c, from, to)));
  const a = all[0];
  for (let k = 1; k < all.length; k++) {
    if (all[k].length !== a.length) fail(`the sources return different numbers of logs for ${from}..${to}: ${clients[0].name} ${a.length}, ${clients[k].name} ${all[k].length}`);
    for (let i = 0; i < a.length; i++) if (JSON.stringify(raw(a[i])) !== JSON.stringify(raw(all[k][i]))) fail(`log ${i} differs between ${clients[0].name} and ${clients[k].name}`);
  }
  ok(`${a.length} logs in ${from}..${to}, identical on ${clients.length} sources (address, topics, data, block, block hash, transaction, log index)`);
  if (a.some((l) => l.removed)) fail("a log is marked removed");
  if (new Set(a.map(keyOf)).size !== a.length) fail("duplicate log keys");
  const events = [];
  for (const l of a) {
    const blocks = await Promise.all(clients.map((s) => s.c.getBlock({ blockNumber: l.blockNumber })));
    if (blocks.some((b) => b.hash !== l.blockHash)) fail(`block hash of ${l.blockNumber} does not match the log's`);
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
  if (a.length) ok(`every new log is in its successful receipt, on the right chain and contract, in a block whose hash matches, on ${clients.length} sources`);
  return events;
}

function decodeAll(events) {
  return events.map((e) => {
    try {
      const d = decodeEventLog({ abi, topics: e.topics, data: e.data });
      return { e, name: d.eventName, args: d.args };
    } catch {
      return fail(`log at block ${e.blockNumber} index ${e.logIndex} is not a Settlane event`);
    }
  });
}

/** Step 5 on every client, at `boundary`. Returns the number of agreements. */
async function completeness(clients, decoded, boundary) {
  const read = (c, fn, a) => c.readContract({ address: ADDRESS, abi, functionName: fn, args: a, blockNumber: boundary });
  const counts = [];
  for (const s of clients) {
    let n = 0;
    for (;;) {
      try {
        await read(s.c, "getAgreement", [BigInt(n + 1)]);
        n++;
      } catch (e) {
        if (!/unknown agreement/.test(e.shortMessage ?? e.message ?? "")) fail(`${s.name} could not read the contract's state at block ${boundary}: ${(e.shortMessage ?? e.message).split("\n")[0]}`);
        break;
      }
    }
    counts.push(n);
  }
  if (new Set(counts).size !== 1) fail(`the sources disagree about the number of agreements at block ${boundary}: ${counts.join(", ")}`);
  const agreements = counts[0];
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
        const want = { MilestoneSubmitted: Number(ms[7]), MilestoneRejected: Number(ms[6]), MilestoneApproved: st === "approved" || st === "paid" ? 1 : 0, MilestoneClaimed: st === "paid" ? 1 : 0, MilestoneRefunded: st === "refunded" ? 1 : 0 };
        for (const [name, n] of Object.entries(want)) {
          const got = count(name, id, m);
          if (got !== n) fail(`agreement ${id} milestone ${m + 1}: ${name} expected ${n} from the contract's state (${s.name}), found ${got}`);
        }
      }
    }
  }
  ok(`${agreements} agreements: the event counts equal what the contract's state at block ${boundary} requires, on ${clients.length} sources`);
  if (!decoded.every((d) => d.args.id >= 1n && d.args.id <= BigInt(agreements))) fail("an event names an agreement the contract does not have");
  ok("every event belongs to an existing agreement; there are no unexplained events");
  return agreements;
}

async function boundaryOf(clients, number) {
  const blocks = await Promise.all(clients.map((s) => s.c.getBlock({ blockNumber: number })));
  if (new Set(blocks.map((b) => b.hash)).size !== 1) fail(`the sources disagree about block ${number}'s hash`);
  return blocks[0].hash;
}

async function finalized(clients) {
  const fin = await Promise.all(clients.map((s) => s.c.getBlock({ blockTag: "finalized" })));
  return fin.map((b) => b.number).reduce((a, b) => (a < b ? a : b));
}

async function main() {
  console.log(`Settlane event snapshot (${mode}${partial ? ", partial" : ""}${dryRun ? ", dry run" : ""}): ${ADDRESS} on chain ${sepolia.id}, deployed at block ${DEPLOY_BLOCK}`);
  const clients = await reachable();
  if (clients.length < 2 && !(partial && clients.length >= 1)) {
    cannot(`${clients.length} of the ${SOURCES.length} configured sources answered; at least two independent sources are required. Nothing was verified or written. Retry later, or set SNAPSHOT_SOURCES to include another independent source (docs/EVENT_HISTORY.md section 7).`);
  }

  const committed = mode === "build" ? null : JSON.parse(readFileSync(OUT, "utf8"));
  if (committed && committed.contentHash !== contentHash(committed.events)) fail("the committed snapshot's content hash does not match its events (run npm run snapshot:verify-local)");

  if (mode === "check") {
    const boundary = BigInt(committed.lastVerifiedBlock);
    const hash = await boundaryOf(clients, boundary);
    if (hash !== committed.lastVerifiedBlockHash) fail("the committed boundary hash differs from the chain's");
    ok(`boundary block ${boundary} (${hash.slice(0, 12)}…), identical on ${clients.length} sources and equal to the committed hash`);
    const events = await verifySegment(clients, DEPLOY_BLOCK, boundary);
    if (contentHash(events) !== committed.contentHash) fail("the committed snapshot's events differ from the chain's");
    ok("the committed events equal the chain's exactly");
    await completeness(clients, decodeAll(events), boundary);
    if (clients.length < 2) cannot(`consistent with ${clients[0].name} ONLY. This is not an independent verification (two sources are required).`);
    ok(`the committed snapshot is independently verified by ${clients.map((s) => s.name).join(" and ")}`);
    return;
  }

  let from = DEPLOY_BLOCK;
  let prior = [];
  let segments = [];
  if (mode === "advance") {
    const b0 = BigInt(committed.lastVerifiedBlock);
    const hash = await boundaryOf(clients, b0);
    if (hash !== committed.lastVerifiedBlockHash) fail(`the committed boundary block ${b0} no longer has the committed hash on these sources`);
    ok(`continuity: the committed boundary block ${b0} still has the committed hash on ${clients.length} sources`);
    from = b0 + 1n;
    prior = committed.events;
    segments = committed.provenance.segments ?? [{ from: committed.deployBlock, to: committed.lastVerifiedBlock, sources: committed.provenance.sources, verifiedAt: committed.generatedAt }];
  }
  const boundary = await finalized(clients);
  if (boundary < from) cannot(`the finalized block ${boundary} is not past the committed boundary ${from - 1n}; nothing to advance`);
  const boundaryHash = await boundaryOf(clients, boundary);
  ok(`new boundary: finalized block ${boundary} (${boundaryHash.slice(0, 12)}…), identical on ${clients.length} sources`);
  const fresh = await verifySegment(clients, from, boundary);
  const events = [...prior, ...fresh];
  const agreements = await completeness(clients, decodeAll(events), boundary);
  const now = new Date().toISOString();
  const allSegments = [...segments, { from: from.toString(), to: boundary.toString(), sources: clients.map((s) => s.url), verifiedAt: now }];
  const snapshot = {
    description: "Settlane contract events from the deployment block to a finalized block, verified (scripts/build-event-snapshot.mjs, docs/EVENT_HISTORY.md). Raw logs; the application decodes them with the ABI.",
    chainId: sepolia.id,
    address: ADDRESS,
    deployBlock: DEPLOY_BLOCK.toString(),
    lastVerifiedBlock: boundary.toString(),
    lastVerifiedBlockHash: boundaryHash,
    agreements,
    generatedAt: now,
    provenance: {
      sources: [...new Set(allSegments.flatMap((s) => s.sources))],
      method: "each segment: eth_getLogs in 5,000-block chunks from at least two independent sources, compared for exact equality, receipts and block hashes cross-checked on every source; the contract's state at the final boundary checked against ALL events on every source",
      finality: "each boundary = the finalized block at the time it was verified",
      segments: allSegments,
    },
    contentHash: contentHash(events),
    events,
  };
  if (dryRun) {
    console.log(`\ndry run: would write ${events.length} events (${fresh.length} new) up to block ${boundary}; nothing written`);
    return;
  }
  writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + "\n");
  console.log(`\nwrote ${events.length} events (${fresh.length} new) up to block ${boundary} to src/contract/history-snapshot.json; run npm run snapshot:verify-local and the unit tests, then commit`);
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));

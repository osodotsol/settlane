#!/usr/bin/env node
// Records the Sepolia state of agreements 1 and 2 and every Settlane log up to a fixed block into
// tests/fixtures/sepolia-a1-a2.json (read-only RPC; nothing is sent). A1 is Paid and A2 is Refunded,
// both terminal, so these values never change on-chain: the unit tests use them as permanent truth,
// and `npm run test:live` re-reads the chain and compares.
//
//   node scripts/record-fixtures.mjs [rpc-url]
import { writeFileSync } from "node:fs";
import { createPublicClient, http, getAddress } from "viem";
import { sepolia } from "viem/chains";
import { settlaneAbiJson } from "./abi-json.mjs";

const RPC = process.argv[2] ?? "https://ethereum-sepolia-rpc.publicnode.com";
const ADDRESS = getAddress("0xf79d229a039bf5c84ecc7327060f8bbc888d2182");
const FROM = 12175958n; // deployment block
const TO = 12176400n; // after the A2 refund (block 12176299): the first-run plan is complete
const client = createPublicClient({ chain: sepolia, transport: http(RPC, { retryCount: 4, timeout: 30_000 }) });
const s = (v) => (typeof v === "bigint" ? v.toString() : v);

const abi = settlaneAbiJson();
const read = (functionName, args) => client.readContract({ address: ADDRESS, abi, functionName, args, blockNumber: TO });

const agreements = {};
for (const id of [1n, 2n]) {
  const [client_, provider, verifier, reviewPeriod, n] = await read("getAgreement", [id]);
  const accounting = await read("getAccounting", [id]);
  const milestones = [];
  for (let m = 0; m < n; m++) milestones.push((await read("getMilestone", [id, m])).map(s));
  agreements[id] = { client: client_, provider, verifier, reviewPeriod: s(reviewPeriod), n, accounting: accounting.map(s), milestones };
}
const totalOutstanding = s(await read("totalOutstanding", []));
const logs = await client.getLogs({ address: ADDRESS, fromBlock: FROM, toBlock: TO });
const timestamps = {};
for (const b of new Set(logs.map((l) => l.blockNumber))) timestamps[b.toString()] = s((await client.getBlock({ blockNumber: b })).timestamp);

const fixture = {
  _note: "Recorded from Ethereum Sepolia (chain 11155111) by frontend/scripts/record-fixtures.mjs; read-only. Agreement 1 is Paid and agreement 2 is Refunded (terminal, immutable).",
  chainId: 11155111,
  address: ADDRESS,
  fromBlock: s(FROM),
  toBlock: s(TO),
  agreements,
  totalOutstanding,
  logs: logs.map((l) => ({ topics: l.topics, data: l.data, blockNumber: s(l.blockNumber), logIndex: l.logIndex, transactionHash: l.transactionHash })),
  timestamps,
};
writeFileSync(new URL("../tests/fixtures/sepolia-a1-a2.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
console.log(`recorded ${logs.length} logs and agreements 1, 2 at block ${TO}`);

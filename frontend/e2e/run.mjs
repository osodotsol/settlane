#!/usr/bin/env node
// End-to-end runner: builds and starts the app per backend, then runs the Playwright specs.
//   1. Sepolia (read-only): e2e/sepolia.spec.ts against the real deployment.
//   2. Local Anvil (chain id 11155111, simulated ETH): deploys the production bytecode, creates two
//      agreements, then e2e/anvil.spec.ts creates more, advances time and finally stops the node.
//   3. The same, on a fresh node: e2e/app.spec.ts drives the application with a stand-in wallet (e2e/wallet.ts):
//      create, submit, approve, request a revision, claim, refund, with role, deadline and error checks.
//   4. A node that never answers (a local socket that accepts and stays silent): e2e/hang.spec.ts.
//   5. A partial log-node outage like Sepolia's on 2026-11-24 (one node prunes, one hangs, one works): e2e/outage.spec.ts.
// Nothing is ever sent to a public network. Usage: npm run e2e [-- sepolia|anvil|app|hang|outage]  (E2E_SKIP_BUILD=1 reuses .next-e2e-anvil)
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { sepolia } from "viem/chains";
import { settlaneAbiJson } from "../scripts/abi-json.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const repo = path.resolve(app, "..");
const only = process.argv[2];
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const libs = path.join(homedir(), "tools/chromium-libs/root/usr/lib/x86_64-linux-gnu");
if (existsSync(libs)) env.LD_LIBRARY_PATH = [libs, env.LD_LIBRARY_PATH].filter(Boolean).join(":"); // WSL without system Chromium libraries
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd: app, env: { ...env, ...extraEnv }, stdio: "inherit" });
  return r.status ?? 1;
}

/**
 * A port must be free before a server or node is started on it. A leftover server from an earlier run would otherwise
 * answer in its place, and the tests would silently run against the wrong build or the wrong chain (seen 2026-11-24).
 */
async function assertFree(port, what) {
  const isFree = () =>
    new Promise((r) => {
      const probe = net.createServer().once("error", () => r(false)).once("listening", () => probe.close(() => r(true)));
      probe.listen(port);
    });
  let free = false;
  for (let i = 0; i < 10 && !(free = await isFree()); i++) await sleep(500); // a node this run just stopped may still be closing
  if (!free) throw new Error(`${what}: port ${port} is already in use, probably by a server left from an earlier run. Stop it first.`);
}

async function serve(port, extraEnv) {
  await assertFree(port, "app server");
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { cwd: app, env: { ...env, ...extraEnv }, stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`server on ${port} exited with code ${child.exitCode}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return child;
    } catch {}
    await sleep(500);
  }
  throw new Error(`server on ${port} did not start`);
}

function stop(child) {
  if (child && child.exitCode === null) child.kill("SIGTERM");
}

// e2e builds point Next at a generated copy of tsconfig.json (next.config.ts), which Next may extend
// with its own output directory; the committed tsconfig.json stays untouched.
writeFileSync(path.join(app, "tsconfig.e2e.json"), readFileSync(path.join(app, "tsconfig.json"), "utf8"));

let failures = 0;

if (!only || only === "sepolia") {
  const dist = { SETTLANE_DIST_DIR: ".next-e2e-sepolia" };
  if (run("npx", ["next", "build"], dist) !== 0) process.exit(1);
  const server = await serve(3921, dist);
  failures += run("npx", ["playwright", "test", "e2e/sepolia.spec.ts"], { E2E_BASE_URL: "http://127.0.0.1:3921" }) === 0 ? 0 : 1;
  stop(server);
}

// A fresh Anvil with the production bytecode deployed and the same two agreements every time (the first one
// paid, the second one funded), so the address and the deploy block are identical on every start and one
// build serves both Anvil specs.
async function startAnvil() {
  const anvilBin = [path.join(homedir(), "tools/foundry/bin/anvil"), "anvil"].find((p) => p === "anvil" || existsSync(p));
  const ANVIL = "http://127.0.0.1:8645";
  await assertFree(8645, "Anvil");
  const node = spawn(anvilBin, ["--host", "127.0.0.1", "--port", "8645", "--chain-id", "11155111", "--silent"], { stdio: "ignore" });
  const chain = { ...sepolia, rpcUrls: { default: { http: [ANVIL] } } };
  const pub = createPublicClient({ chain, transport: http(ANVIL) });
  for (let i = 0; i < 60; i++) {
    try {
      await pub.getChainId();
      break;
    } catch {
      await sleep(250);
    }
  }
  const rpc = (method, params = []) =>
    fetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
  // Multicall3 at its canonical address (viem batches reads through it). Its public runtime code is bundled
  // (e2e/multicall3.hex, copied from Sepolia), so the local suites never depend on a network connection.
  const mc = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const code = { result: readFileSync(path.join(here, "multicall3.hex"), "utf8").trim() };
  await rpc("anvil_setCode", [mc, code.result]);
  const accounts = (await rpc("eth_accounts")).result.slice(0, 6);
  const [CLIENT, PROVIDER, VERIFIER] = accounts;
  const abi = settlaneAbiJson();
  const wallet = (account) => createWalletClient({ account, chain, transport: http(ANVIL) });
  const init = readFileSync(path.join(repo, "out/Settlane.bin"), "utf8").trim();
  const deployHash = await wallet(CLIENT).sendTransaction({ data: `0x${init}`, gas: 16_000_000n });
  const deployed = await pub.waitForTransactionReceipt({ hash: deployHash });
  const SETTLANE = deployed.contractAddress;
  const send = async (account, functionName, args, value = 0n) =>
    pub.waitForTransactionReceipt({ hash: await wallet(account).writeContract({ address: SETTLANE, abi, functionName, args, value }) });
  const t = (await pub.getBlock()).timestamp;
  await send(CLIENT, "create", [PROVIDER, VERIFIER, 3600n, 1, [parseEther("1"), 0n, 0n], [t + 900n, 0n, 0n], [0x51n, 0n, 0n]], parseEther("1"));
  await send(PROVIDER, "submit", [1n, 0, 0xe1n]);
  await send(VERIFIER, "approve", [1n, 0, 0xe1n, 1n]);
  await send(PROVIDER, "claim", [1n, 0, PROVIDER]);
  await send(CLIENT, "create", [PROVIDER, VERIFIER, 3600n, 1, [parseEther("0.5"), 0n, 0n], [t + 1800n, 0n, 0n], [0x52n, 0n, 0n]], parseEther("0.5"));
  return { ANVIL, node, accounts, SETTLANE, deployed };
}

if (!only || only === "anvil" || only === "app") {
  const first = await startAnvil();
  const dist = {
    SETTLANE_DIST_DIR: ".next-e2e-anvil",
    NEXT_PUBLIC_RPC_URLS: first.ANVIL,
    NEXT_PUBLIC_SETTLANE_ADDRESS: first.SETTLANE,
    NEXT_PUBLIC_DEPLOY_BLOCK: String(first.deployed.blockNumber),
  };
  let node = first.node;
  let server;
  try {
    if (!process.env.E2E_SKIP_BUILD && run("npx", ["next", "build"], dist) !== 0) throw new Error("build failed");
    const specEnv = (a) => ({
      E2E_BASE_URL: "http://127.0.0.1:3922",
      ANVIL_URL: a.ANVIL,
      ANVIL_PID: String(a.node.pid),
      SETTLANE: a.SETTLANE,
      ANVIL_ACCOUNTS: JSON.stringify(a.accounts),
    });
    if (!only || only === "anvil") {
      // 2. Read-only pages against a changing chain; its last test stops the node.
      server = await serve(3922, dist);
      failures += run("npx", ["playwright", "test", "e2e/anvil.spec.ts"], specEnv(first)) === 0 ? 0 : 1;
      stop(server);
      stop(node);
      await sleep(1500);
    }
    if (!only || only === "app") {
      // 3. The application with a stand-in wallet (e2e/wallet.ts) against a fresh node, same address and block.
      const second = only === "app" ? first : await startAnvil();
      node = second.node;
      if (second.SETTLANE !== first.SETTLANE || second.deployed.blockNumber !== first.deployed.blockNumber) throw new Error("the second node did not reproduce the deployment");
      server = await serve(3922, dist);
      // The seeded chain is the suite's baseline: each repetition of the serial suite reverts to it (e2e/app.spec.ts), so
      // every full run starts from the same two agreements, block height and clock (Anvil's revert restores all three).
      const snap = await fetch(second.ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_snapshot", params: [] }) }).then((r) => r.json());
      // outside test-results/, which Playwright empties when it starts
      const baselineFile = path.join(tmpdir(), `settlane-e2e-baseline-${process.pid}.txt`);
      writeFileSync(baselineFile, snap.result);
      // E2E_GREP, E2E_REPEAT (and E2E_TRACE=1 in playwright.config.ts) narrow and repeat this suite to investigate a flaky test
      const narrow = [...(process.env.E2E_GREP ? ["-g", process.env.E2E_GREP] : []), ...(process.env.E2E_REPEAT ? ["--repeat-each", process.env.E2E_REPEAT] : [])];
      failures += run("npx", ["playwright", "test", "e2e/app.spec.ts", ...narrow], { ...specEnv(second), ANVIL_BASELINE_FILE: baselineFile }) === 0 ? 0 : 1;
    }
  } finally {
    stop(server);
    stop(node);
  }
}

if (!only || only === "hang") {
  // 4. A node that accepts connections and never answers (R2 H1/H2): the production build must still finish quickly,
  //    server pages must answer within their time budget, and browser pages must reach a clear state.
  const BLACKHOLE = "http://127.0.0.1:8699";
  const sockets = new Set();
  const hole = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
  });
  await new Promise((r) => hole.listen(8699, "127.0.0.1", r));
  const dist = { SETTLANE_DIST_DIR: ".next-e2e-hang", NEXT_PUBLIC_RPC_URLS: BLACKHOLE, NEXT_PUBLIC_HISTORY_RPC_URLS: BLACKHOLE };
  let server;
  try {
    const t0 = Date.now();
    const b = spawnSync("npx", ["next", "build"], { cwd: app, env: { ...env, ...dist }, encoding: "utf8" });
    const seconds = (Date.now() - t0) / 1000;
    const out = `${b.stdout}\n${b.stderr}`;
    console.log(`hang build: exit ${b.status} in ${seconds.toFixed(0)} s`);
    if (b.status !== 0) throw new Error("build failed with a hanging RPC:\n" + out.slice(-2000));
    if (/took more than 60 seconds/.test(out)) throw new Error("a page's static generation waited on the hanging RPC for more than 60 s");
    server = await serve(3923, dist);
    failures += run("npx", ["playwright", "test", "e2e/hang.spec.ts"], { E2E_BASE_URL: "http://127.0.0.1:3923" }) === 0 ? 0 : 1;
  } catch (error) {
    console.error(String(error));
    failures += 1;
  } finally {
    stop(server);
    for (const s of sockets) s.destroy();
    hole.close();
  }
}

if (!only || only === "outage") {
  // 5. The history's log nodes, in order: one that refuses every log range ("pruned history unavailable", like publicnode),
  //    one that accepts connections and never answers (like Tenderly that day), then the healthy node. Contract state is
  //    read from the healthy node. The hanging node counts the requests that reach it, so the spec can prove a dead node is
  //    not walked again on every refresh.
  const a = await startAnvil();
  let holeHits = 0;
  const holeSockets = new Set();
  const hole = net.createServer((sock) => {
    holeSockets.add(sock);
    sock.on("data", (d) => (holeHits += (d.toString().match(/^POST /gm) ?? []).length));
    sock.on("close", () => holeSockets.delete(sock));
    sock.on("error", () => {});
  });
  await assertFree(8702, "hanging log node");
  await new Promise((r) => hole.listen(8702, "127.0.0.1", r));
  const prune = createServer(async (req, res) => {
    // like the public nodes, it allows browser reads (CORS), so the browser pages really talk to it
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
    if (req.method === "OPTIONS") return res.end();
    if (req.method === "GET" && req.url === "/__hits") return res.end(JSON.stringify({ hole: holeHits }));
    let body = "";
    for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    if (msg.method === "eth_getLogs") {
      await sleep(200);
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: 4444, message: "pruned history unavailable" } }));
    }
    res.end(await fetch(a.ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body }).then((r) => r.text()));
  });
  await assertFree(8701, "pruning log node");
  await new Promise((r) => prune.listen(8701, "127.0.0.1", r));
  const dist = {
    SETTLANE_DIST_DIR: ".next-e2e-outage",
    NEXT_PUBLIC_RPC_URLS: a.ANVIL,
    NEXT_PUBLIC_HISTORY_RPC_URLS: ["http://127.0.0.1:8701", "http://127.0.0.1:8702", a.ANVIL].join(","),
    NEXT_PUBLIC_SETTLANE_ADDRESS: a.SETTLANE,
    NEXT_PUBLIC_DEPLOY_BLOCK: String(a.deployed.blockNumber),
  };
  let server;
  try {
    if (!process.env.E2E_SKIP_BUILD && run("npx", ["next", "build"], dist) !== 0) throw new Error("build failed");
    server = await serve(3924, dist);
    // spawned asynchronously: the mock nodes live in this process and must keep answering while the spec runs
    const child = spawn("npx", ["playwright", "test", "e2e/outage.spec.ts"], { cwd: app, env: { ...env, E2E_BASE_URL: "http://127.0.0.1:3924", OUTAGE_STATS: "http://127.0.0.1:8701/__hits", ANVIL_URL: a.ANVIL }, stdio: "inherit" });
    const code = await new Promise((r) => child.on("exit", r));
    failures += code === 0 ? 0 : 1;
  } catch (error) {
    console.error(String(error));
    failures += 1;
  } finally {
    stop(server);
    stop(a.node);
    for (const s of holeSockets) s.destroy();
    hole.close();
    prune.close();
  }
}

console.log(failures === 0 ? "e2e: all specs passed" : `e2e: ${failures} spec file(s) failed`);
process.exit(failures === 0 ? 0 : 1);

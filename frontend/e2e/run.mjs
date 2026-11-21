#!/usr/bin/env node
// End-to-end runner: builds and starts the app per backend, then runs the Playwright specs.
//   1. Sepolia (read-only): e2e/sepolia.spec.ts against the real deployment.
//   2. Local Anvil (chain id 11155111, simulated ETH): deploys the production bytecode, creates two
//      agreements, then e2e/anvil.spec.ts creates more, advances time and finally stops the node.
// Nothing is ever sent to a public network. Usage: npm run e2e [-- sepolia|anvil]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

async function serve(port, extraEnv) {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { cwd: app, env: { ...env, ...extraEnv }, stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
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

if (!only || only === "anvil") {
  const anvilBin = [path.join(homedir(), "tools/foundry/bin/anvil"), "anvil"].find((p) => p === "anvil" || existsSync(p));
  const ANVIL = "http://127.0.0.1:8645";
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
  // Multicall3 at its canonical address (viem batches reads through it); its code is copied from Sepolia.
  const mc = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const code = await fetch("https://ethereum-sepolia-rpc.publicnode.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [mc, "latest"] }),
  }).then((r) => r.json());
  await rpc("anvil_setCode", [mc, code.result]);
  const accounts = (await rpc("eth_accounts")).result.slice(0, 3);
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

  const dist = {
    SETTLANE_DIST_DIR: ".next-e2e-anvil",
    NEXT_PUBLIC_RPC_URLS: ANVIL,
    NEXT_PUBLIC_SETTLANE_ADDRESS: SETTLANE,
    NEXT_PUBLIC_DEPLOY_BLOCK: String(deployed.blockNumber),
  };
  let server;
  try {
    if (run("npx", ["next", "build"], dist) !== 0) throw new Error("build failed");
    server = await serve(3922, dist);
    failures +=
      run("npx", ["playwright", "test", "e2e/anvil.spec.ts"], {
        E2E_BASE_URL: "http://127.0.0.1:3922",
        ANVIL_URL: ANVIL,
        ANVIL_PID: String(node.pid),
        SETTLANE,
        ANVIL_ACCOUNTS: JSON.stringify(accounts),
      }) === 0
        ? 0
        : 1;
  } finally {
    stop(server);
    stop(node);
  }
}

console.log(failures === 0 ? "e2e: all specs passed" : `e2e: ${failures} spec file(s) failed`);
process.exit(failures === 0 ? 0 : 1);

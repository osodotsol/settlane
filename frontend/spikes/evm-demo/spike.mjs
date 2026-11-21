// F0 spike: run the pinned production Settlane bytecode on an in-process EVM (@ethereumjs/vm),
// the same code path a browser bundle would use. Isolated: not part of the repository.
import { createVM } from "@ethereumjs/vm";
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { createBlock } from "@ethereumjs/block";
import { Account, createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { encodeFunctionData, decodeFunctionResult, decodeErrorResult, parseEther } from "viem";

export async function runSpike({ initHex, abi, log = console.log }) {
  const t = () => performance.now();
  const t0 = t();
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Prague });
  const vm = await createVM({ common });
  const tVm = t() - t0;

  const acct = (n) => createAddressFromString("0x" + n.toString(16).padStart(40, "0"));
  const CLIENT = acct(0xc1), PROVIDER = acct(0xb2), VERIFIER = acct(0xa3);
  for (const a of [CLIENT, PROVIDER, VERIFIER]) await vm.stateManager.putAccount(a, new Account(0n, parseEther("100")));
  let now = 1_800_000_000n, number = 1n;
  const block = () => createBlock({ header: { timestamp: now, number: number++, gasLimit: 30_000_000n } }, { common });

  const call = async (from, to, fn, args = [], value = 0n) => {
    const data = fn ? encodeFunctionData({ abi, functionName: fn, args }) : null;
    const r = await vm.evm.runCall({ caller: from, to, data: data ? hexToBytes(data) : undefined, value, gasLimit: 16_000_000n, block: block() });
    const ex = r.execResult;
    if (ex.exceptionError) {
      let reason = "(no data)";
      try { reason = decodeErrorResult({ abi: [], data: bytesToHex(ex.returnValue) }).args[0]; } catch {}
      return { ok: false, reason, gas: ex.executionGasUsed };
    }
    const out = fn ? decodeFunctionResult({ abi, functionName: fn, data: bytesToHex(ex.returnValue) }) : undefined;
    return { ok: true, out, gas: ex.executionGasUsed, logs: ex.logs?.length ?? 0, created: r.createdAddress };
  };
  const bal = async (a) => (await vm.stateManager.getAccount(a))?.balance ?? 0n;

  const tD = t();
  const dep = await vm.evm.runCall({ caller: CLIENT, data: hexToBytes("0x" + initHex), gasLimit: 16_000_000n, block: block() });
  if (dep.execResult.exceptionError) throw new Error("deploy failed: " + dep.execResult.exceptionError.error);
  const S = dep.createdAddress;
  const tDeploy = t() - tD;
  const code = await vm.stateManager.getCode(S);

  const results = [];
  const check = (label, cond, detail = "") => { results.push([label, !!cond]); log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? "  [" + detail + "]" : ""}`); };
  check("deployed runtime size", code.length === 6056, `${code.length} bytes, deploy gas ${dep.execResult.executionGasUsed}`);

  const tS = t();
  const ONE = parseEther("1");
  const zero3 = [0n, 0n, 0n];
  // A1: create -> submit -> approve -> claim
  let r = await call(CLIENT, S, "create", [PROVIDER.toString(), VERIFIER.toString(), 3600n, 1, [ONE, 0n, 0n], [now + 1000n, 0n, 0n], [0x51n, 0n, 0n]], ONE);
  check("create A1 returns id 1", r.ok && r.out === 1n, r.ok ? `gas ${r.gas}, logs ${r.logs}` : r.reason);
  r = await call(CLIENT, S, "create", [PROVIDER.toString(), VERIFIER.toString(), 3600n, 1, [ONE, 0n, 0n], [now + 1000n, 0n, 0n], [0x51n, 0n, 0n]], ONE - 1n);
  check("underfunded create reverts with the exact reason", !r.ok && r.reason === "value does not equal the milestone total", r.reason);
  r = await call(PROVIDER, S, "submit", [1n, 0, 0xe1n]); check("provider submits", r.ok, `gas ${r.gas}`);
  r = await call(VERIFIER, S, "approve", [1n, 0, 0xe1n, 0n]); check("stale revision reverts", !r.ok && r.reason === "submission revision does not match", r.reason);
  r = await call(VERIFIER, S, "approve", [1n, 0, 0xe1n, 1n]); check("verifier approves revision 1", r.ok);
  const p0 = await bal(PROVIDER);
  r = await call(PROVIDER, S, "claim", [1n, 0, PROVIDER.toString()]); check("provider claims 1 ETH", r.ok && r.out === ONE, `gas ${r.gas}`);
  check("provider balance +1 ETH (runCall charges no gas)", (await bal(PROVIDER)) - p0 === ONE);
  // A2: create -> early refund reverts -> time passes deliver_by -> refund
  const due = now + 500n;
  r = await call(CLIENT, S, "create", [PROVIDER.toString(), VERIFIER.toString(), 3600n, 1, [ONE, 0n, 0n], [due, 0n, 0n], [0x52n, 0n, 0n]], ONE);
  check("create A2 returns id 2", r.ok && r.out === 2n);
  r = await call(CLIENT, S, "refund", [2n, 0, CLIENT.toString()]); check("early refund reverts", !r.ok && r.reason === "milestone has not expired", r.reason);
  now = due; // the time control: the next block's timestamp
  r = await call(CLIENT, S, "refund", [2n, 0, CLIENT.toString()]); check("refund at deliver_by succeeds", r.ok && r.out === ONE);
  r = await call(CLIENT, S, "getAccounting", [2n]); check("A2 accounting [1,0,1,0] ETH", r.ok && r.out.join() === [ONE, 0n, ONE, 0n].join(), r.ok ? r.out.join(",") : r.reason);
  r = await call(CLIENT, S, "getMilestone", [1n, 0]); check("A1 m0 state Paid (4), revision 1", r.ok && r.out[0] === 4 && r.out[7] === 1n);
  r = await call(CLIENT, S, "totalOutstanding"); check("totalOutstanding 0 and contract balance 0", r.ok && r.out === 0n && (await bal(S)) === 0n);
  const tScript = t() - tS;
  log(`timing: createVM ${tVm.toFixed(0)} ms, deploy ${tDeploy.toFixed(0)} ms, 12-step script ${tScript.toFixed(0)} ms`);
  return { ok: results.every(([, ok]) => ok), tVm, tDeploy, tScript };
}

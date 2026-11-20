#!/usr/bin/env python3
"""Read-only verification of a deployed Settlane: bytecode, ABI, events and accounting.

It sends NO transaction and needs NO key. It only calls a node (eth_call, eth_getCode, eth_getLogs,
eth_getBalance), so it can also be pointed at a deployment somebody else made.

Checks:
  1. the node is the expected chain (default: Ethereum Sepolia, 11155111);
  2. the production ingot is rebuilt with Fe 26.6.0 and the DEPLOYED runtime code equals
     `Settlane.runtime.bin` byte for byte (and its SHA-256 is printed);
  3. the built ABI equals the ABI lock of scripts/lint-policy.json (the same check as the lint), and
     every entry point of that ABI is live on the deployed contract (each answers with its own
     revert reason or value, an unknown selector and a bare ETH transfer revert);
  4. every log of the contract is decoded with the independent decoder of scripts/check_events.py,
     the events are replayed as the milestone state machine of docs/LIFECYCLE.md, and ids are
     consecutive;
  5. accounting: per agreement deposited == paid + refunded + outstanding, outstanding equals the
     milestones still owed, paid and refunded equal the sums of the Claimed and Refunded events, the
     view state of every milestone equals the state the events lead to; and globally
     totalOutstanding == the sum, balance >= totalOutstanding (surplus is reported, not an error).

Usage:
  python3 experiments/sepolia/verify_deployment.py --rpc-url URL --address 0x... [--from-block N]
        [--expect-chain 11155111] [--expect-runtime-sha256 HEX]
Exit 0 = every check passed.
"""
import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
import lib  # noqa: E402
import check_events  # noqa: E402
import settlane_lint  # noqa: E402

STATE_OF_EVENT = {"Created": 1, "Submitted": 2, "Approved": 3, "Rejected": 1, "Claimed": 4, "Refunded": 5}
LIVE = 1 | 2 | 3  # Funded, Submitted, Approved: still owed


def get_logs(rpc, address, from_block, to_block):
    """eth_getLogs in ranges the node accepts (public nodes limit the range): halves on error."""
    out, lo = [], from_block
    step = max(to_block - from_block + 1, 1)
    while lo <= to_block:
        hi = min(lo + step - 1, to_block)
        try:
            out += rpc.call("eth_getLogs", {"address": address, "fromBlock": hex(lo), "toBlock": hex(hi)})
            lo = hi + 1
        except lib.RpcError:
            if step == 1:
                raise
            step = max(step // 2, 1)
    return out


def verify(rpc, address, expect_chain=lib.SEPOLIA, from_block=0, expect_runtime_sha=None, say=print):
    results = []

    def check(label, ok, detail=""):
        results.append(bool(ok))
        say(("ok    " if ok else "FAIL  ") + label + (f"  [{detail}]" if detail else ""))
        return bool(ok)

    address = address.lower()
    check("the node is the expected chain", rpc.chain_id() == expect_chain, f"chain id {rpc.chain_id()}, expected {expect_chain}")
    out, init, runtime, abi = lib.build_artifacts()
    rt_sha = lib.sha256_hex(runtime)
    say(f"      runtime.bin sha256 {rt_sha}  init sha256 {lib.sha256_hex(init)}  ({len(runtime) // 2} bytes)")
    code = rpc.call("eth_getCode", address, "latest")
    check("the address holds code", code not in ("0x", "0x0", None), f"{(len(code) - 2) // 2} bytes")
    check("the deployed runtime code equals Settlane.runtime.bin built from this checkout, byte for byte", code == "0x" + runtime)
    if expect_runtime_sha:
        check("the runtime code hash is the expected one", rt_sha == expect_runtime_sha.lower(), rt_sha)

    # ---- ABI: the built ABI equals the lock, and every entry point is live
    policy = json.loads((HERE.parents[1] / "scripts" / "lint-policy.json").read_text())
    viol = settlane_lint.check_abi(abi, "Settlane", policy["contracts"]["Settlane"]["abi"])
    check("the built ABI equals the ABI lock of scripts/lint-policy.json (functions, mutability, outputs, events)", not viol, "; ".join(m for _, m in viol)[:200])
    stranger = "0x000000000000000000000000000000000000dEaD"

    def call(data, value=0, frm=stranger):
        tx = {"from": frm, "to": address, "data": data}
        params = [tx, "latest"]
        if value:
            tx["value"] = hex(value)
            params.append({frm: {"balance": hex(10**18)}})  # state override: the probe sender can pay, so a revert is the CONTRACT's
        try:
            return "ok", rpc.call("eth_call", *params)
        except lib.RpcError as e:
            return "revert", lib.revert_reason(e)

    zero, one = "0x" + "00" * 20, "0x" + "00" * 19 + "01"
    probes = [
        ("totalOutstanding()", [], "ok"),
        ("getMilestone(uint256,uint8)", [0, 0], "ok"),
        ("getAgreement(uint256)", [0], "unknown agreement"),
        ("getAccounting(uint256)", [0], "unknown agreement"),
        ("submit(uint256,uint8,uint256)", [0, 0, 1], "unknown agreement"),
        ("approve(uint256,uint8,uint256,uint256)", [0, 0, 1, 1], "unknown agreement"),
        ("reject(uint256,uint8,uint256,uint256)", [0, 0, 1, 1], "unknown agreement"),
        ("claim(uint256,uint8,address)", [0, 0, one], "unknown agreement"),
        ("refund(uint256,uint8,address)", [0, 0, one], "unknown agreement"),
        ("create(address,address,uint256,uint8,uint256[3],uint256[3],uint256[3])", [zero, one, 3600, 1, "[1,0,0]", "[2,0,0]", "[1,0,0]"], "provider is zero"),
    ]
    functions = {i["name"] for i in abi if i.get("type") == "function"}
    check("the probes cover every function of the ABI", {p[0].split("(")[0] for p in probes} == functions, sorted(functions))
    for sig, args, want in probes:
        kind, val = call(lib.calldata(sig, *args))
        got = "ok" if kind == "ok" else val
        check(f"entry point {sig.split('(')[0]} is live and answers as expected", got == want, got if got != want else want)
    kind, val = call("0xdeadbeef")
    check("an unknown selector reverts", kind == "revert", val)
    kind, val = call("0x", value=1)
    check("a bare ETH transfer reverts for a funded sender (no receive or fallback), not for lack of funds", kind == "revert" and "insufficient funds" not in val.lower(), val)

    # ---- events
    head = int(rpc.call("eth_blockNumber"), 16)
    logs = get_logs(rpc, address, from_block, head)
    evs, problems = [], []
    for lg in logs:
        ev, probs = check_events.decode({"address": lg["address"].lower(), "topics": lg["topics"], "data": lg["data"]})
        problems += probs
        if ev:
            evs.append(ev)
    check(f"all {len(logs)} logs decode as Settlane events with the independent decoder", not problems, "; ".join(problems)[:200])
    ids = [e["id"] for e in evs if e["kind"] == "Created"]
    check("agreement ids are consecutive from 1", ids == list(range(1, len(ids) + 1)), ids)
    mp = check_events.check_machine(("verify", "deployment"), evs)
    check("the events replay as the milestone state machine of docs/LIFECYCLE.md", not mp, "; ".join(mp)[:200])

    # ---- accounting
    n = len(ids)
    check("agreement n exists and n + 1 does not", call(lib.calldata("getAgreement(uint256)", n + 1))[0] == "revert" and (n == 0 or call(lib.calldata("getAgreement(uint256)", n))[0] == "ok"), f"{n} agreements")
    final = {}
    paid_ev, refunded_ev = {}, {}
    for e in evs:
        if e["kind"] == "Created":
            for m in range(e["n"]):
                final[(e["id"], m)] = 1
        elif e["kind"] in STATE_OF_EVENT:
            final[(e["id"], e["m"])] = STATE_OF_EVENT[e["kind"]]
            if e["kind"] == "Claimed":
                paid_ev[e["id"]] = paid_ev.get(e["id"], 0) + e["amount"]
            if e["kind"] == "Refunded":
                refunded_ev[e["id"]] = refunded_ev.get(e["id"], 0) + e["amount"]
    sum_out, ok_all, why = 0, True, []

    def view(sig, *args):
        kind, val = call(lib.calldata(sig, *args))
        return lib.words(val) if kind == "ok" else None

    for i in range(1, n + 1):
        ag, acc = view("getAgreement(uint256)", i), view("getAccounting(uint256)", i)
        if ag is None or acc is None:
            ok_all = False; why.append(f"agreement {i} unreadable"); continue
        k = ag[4]
        ms = [view("getMilestone(uint256,uint8)", i, m) for m in range(k)]
        dep, paid, ref, out_ = acc
        amounts = [m[1] for m in ms]
        owed = sum(m[1] for m in ms if m[0] in (1, 2, 3))
        checks = {
            "deposited == sum of the milestone amounts": dep == sum(amounts),
            "deposited == paid + refunded + outstanding": dep == paid + ref + out_,
            "outstanding == the milestones still owed": out_ == owed,
            "paid == the Paid milestones == the Claimed events": paid == sum(m[1] for m in ms if m[0] == 4) == paid_ev.get(i, 0),
            "refunded == the Refunded milestones == the Refunded events": ref == sum(m[1] for m in ms if m[0] == 5) == refunded_ev.get(i, 0),
            "every milestone's state equals the state its events lead to": all(m[0] == final.get((i, j), 0) for j, m in enumerate(ms)),
        }
        for label, good in checks.items():
            if not good:
                ok_all = False; why.append(f"agreement {i}: {label}")
        sum_out += out_
    check("per-agreement accounting holds for every agreement (I1, I2, events agree with the views)", ok_all, "; ".join(why)[:300] or f"{n} agreements")
    tot = (view("totalOutstanding()") or [None])[0]
    bal = rpc.balance(address)
    check("totalOutstanding equals the sum of the agreements' outstanding", tot == sum_out, f"{tot} wei")
    check("the contract balance is at least totalOutstanding (I9)", tot is not None and bal >= tot, f"balance {bal} wei, surplus {bal - (tot or 0)} wei")
    failed = results.count(False)
    say(f"\nverify_deployment: {len(results) - failed} ok, {failed} failed ({len(results)} checks)")
    return failed == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--rpc-url", required=True)
    ap.add_argument("--address", required=True)
    ap.add_argument("--from-block", type=int, default=0)
    ap.add_argument("--expect-chain", type=int, default=lib.SEPOLIA)
    ap.add_argument("--expect-runtime-sha256")
    a = ap.parse_args()
    try:
        return 0 if verify(lib.Rpc(a.rpc_url), a.address, a.expect_chain, a.from_block, a.expect_runtime_sha256) else 1
    except lib.Abort as e:
        print(f"ABORT: {e}")
        return 2
    except (OSError, lib.RpcError) as e:
        print(f"ABORT: the node did not answer as expected ({type(e).__name__}: {str(e)[:150]})")
        return 2


if __name__ == "__main__":
    sys.exit(main())

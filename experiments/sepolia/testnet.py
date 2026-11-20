#!/usr/bin/env python3
"""Plan and (later, with explicit approval) run the Settlane public-testnet transactions.

NOTHING HERE HAS BEEN BROADCAST TO SEPOLIA. Every sending subcommand refuses unless `--broadcast` is
given, the node reports chain id 11155111, and (for a non-local node) the confirmation variable is
set. Keys: an encrypted keystore plus a password FILE, both outside the repository, read by
`cast --keystore --password-file`; no private key, mnemonic or password is ever an argument, an
environment variable or a log line.

Subcommands
  plan                      print the transaction plan and its cost estimate (no node, no key)
  preflight                 read-only checks of the node, the wallets, the balances and the repo
  fund                      client sends gas money to provider and verifier        (sends 2 tx)
  deploy                    build with Fe 26.6.0 and deploy Settlane                (sends 1 tx)
  run                       Create, Submit, Approve, Claim; Create and Refund; [Submitted refund]
  verify                    read-only verification of the deployment (bytecode, ABI, events, accounting)

Common options: --rpc-url URL  [--broadcast]  [--address 0x..]  [--amount-wei N]
                [--a1-window S] [--a2-window S] [--with-submitted-refund] [--rehearsal-warp]
See docs/TESTNET.md for the exact commands and the expected results.
"""
import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lib  # noqa: E402
import verify_deployment  # noqa: E402

L = lib
AMOUNT_DEFAULT = 10**15  # 0.001 ETH per test agreement
GAS = {"deploy": 3_000_000, "create": 1_000_000, "other": 600_000}  # CAPS: the real limit is the node's estimate + 30%
MAX_WALLET_WEI = 5 * L.ETH  # a Sepolia test wallet holding more than this is not a dedicated one
SECRET_PATTERNS = [
    r"-----BEGIN [A-Z ]*PR" + r"IVATE KEY",
    r"\"cip" + r"hertext\"",
    r"(?i)(priv(ate)?[_-]?key|secret|mnemonic|seed[_ ]phrase)\s*[:=]\s*['\"]?(0x)?[0-9a-fA-F]{64}",
    r"(?i)mnemonic\s*[:=]\s*['\"]?(\w+\s+){11,}",
    r"gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}",
]


def log(msg=""):
    print(msg, flush=True)


# ------------------------------------------------------------------ state
def state_path(chain):
    return L.STATE_DIR / f"state-{chain}.json"


def load_state(chain):
    p = state_path(chain)
    return json.loads(p.read_text()) if p.exists() else {}


def save_state(chain, st):
    L.STATE_DIR.mkdir(parents=True, exist_ok=True)
    state_path(chain).write_text(json.dumps(st, indent=2))


# ------------------------------------------------------------------ repo hygiene
def scan_repo_for_secrets():
    """No key material in tracked or untracked-but-not-ignored files. Returns the offending paths."""
    files = L.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=L.REPO).stdout.splitlines()
    bad = []
    for f in files:
        p = L.REPO / f
        if f == "experiments/sepolia/testnet.py" or not p.is_file() or p.stat().st_size > 2_000_000:
            continue
        try:
            text = p.read_text(errors="ignore")
        except OSError:
            continue
        if any(re.search(pat, text) for pat in SECRET_PATTERNS):
            bad.append(f)
    return bad


def ignored(path):
    return L.run(["git", "check-ignore", "-q", path], cwd=L.REPO).returncode == 0


# ------------------------------------------------------------------ checks
BUDGET = {"deploy": 2_000_000, "create": 500_000, "other": 250_000}  # realistic gas per transaction, for balance planning


def needs(gas_price_wei, amount, with_a3, deploy=True):
    """Balance each wallet needs: the budgeted gas at 2 x the current price (headroom for a price
    rise), plus, for the client, the value it locks."""
    k = 3 if with_a3 else 2
    gas = {"client": (BUDGET["deploy"] if deploy else 0) + k * BUDGET["create"] + k * BUDGET["other"], "provider": (3 if with_a3 else 2) * BUDGET["other"], "verifier": BUDGET["other"]}
    return {r: int(2 * gas_price_wei * g) + (k * amount if r == "client" else 0) for r, g in gas.items()}


def preflight(rpc, wallets, address=None, need_balance=True, say=log, amount=AMOUNT_DEFAULT, with_a3=True, deploy=True):
    results = []

    def check(label, ok, detail=""):
        results.append(bool(ok))
        say(("ok    " if ok else "FAIL  ") + label + (f"  [{detail}]" if detail else ""))
        return bool(ok)

    cid = rpc.chain_id()
    check("the node is Ethereum Sepolia (chain id 11155111)", cid == L.SEPOLIA, f"chain id {cid}")
    check("the node is local (rehearsal) or the confirmation variable is set", L.is_loopback(rpc.url) or __import__("os").environ.get(L.CONFIRM_VAR) == L.CONFIRM_VALUE, "local" if L.is_loopback(rpc.url) else "remote")
    gp = rpc.gas_price_gwei()
    check(f"the gas price is at most {L.MAX_GAS_PRICE_GWEI} gwei", gp <= L.MAX_GAS_PRICE_GWEI, f"{gp:.3f} gwei")
    check("the state and wallet directory is outside the repository", not L.inside_repo(L.STATE_DIR), str(L.STATE_DIR))
    bad = scan_repo_for_secrets()
    check("no key material in the repository's tracked or unignored files", not bad, ", ".join(bad))
    check("the secret locations are git-ignored as a second line of defence", all(ignored(p) for p in (".env", "keystores/x", "x.pw", "mnemonic.txt")))
    need = needs(int(gp * 10**9), amount, with_a3, deploy)
    for role, w in wallets.items():
        bal = rpc.balance(w.address)
        ok = (not need_balance or bal >= need[role]) and bal <= MAX_WALLET_WEI
        check(f"{role} {w.address}: a funded but small test balance", ok, f"{bal / L.ETH:.6f} ETH (needs >= {need[role] / L.ETH:.6f} at this gas price, refuse > {MAX_WALLET_WEI / L.ETH:.0f})")
    if deploy and "client" in wallets:
        _, init, _, _ = L.build_artifacts()
        try:
            est = L.estimate_gas(rpc, wallets["client"], None, "0x" + init, 0, create=True)
        except L.Abort as e:
            est = None
            check("the node's gas estimate for deploying Settlane is available", False, str(e)[:120])
        if est is not None:
            cost = est * int(gp * 10**9)
            check(f"the node's own gas estimate for the deployment is within the {GAS['deploy']} cap", int(est * 1.3) + 1000 <= GAS["deploy"], f"{est} gas, about {cost / L.ETH:.6f} ETH at {gp:.3f} gwei (a node on a fork that prices contract creation higher shows it here)")
    if address:
        _, _, runtime, _ = L.build_artifacts()
        check("the contract at --address has the runtime code of this checkout", rpc.call("eth_getCode", address, "latest") == "0x" + runtime)
    return all(results)


def plan_text(amount, a1, a2, with_a3):
    return f"""Settlane Sepolia plan (chain id 11155111). NOTHING IS SENT by `plan`.

Wallets (three DIFFERENT addresses, D-011): client, provider, verifier. Test ETH only.
Per test agreement: one milestone of {amount} wei ({amount / L.ETH} ETH), spec 81.

  #   who       action                                   expected result
  0a  client    fund provider and verifier (2 plain transfers, optional: the faucet can do it)
  0b  client    deploy Settlane (Fe 26.6.0 init code)     code at the address == Settlane.runtime.bin
  A1  Happy path, deliver_by = chain time + {a1} s, review period 3600 s
  1   client    create (value {amount})                   AgreementCreated id 1; contract holds {amount}
  2   provider  submit(1, 0, 0xE1)                        MilestoneSubmitted, state Submitted
  3   verifier  approve(1, 0, 0xE1, 1)                    MilestoneApproved, state Approved
  4   provider  claim(1, 0, provider)                     MilestoneClaimed {amount}, state Paid, balance -{amount}
  A2  Funded refund, deliver_by = chain time + {a2} s
  5   client    create (value {amount})                   AgreementCreated id 2
  -   (eth_call) refund before the deadline               REVERTS "milestone has not expired" (no tx, no gas)
  -   wait until the CHAIN's clock >= deliver_by
  6   client    refund(2, 0, client)                      MilestoneRefunded {amount}, state Refunded, balance -{amount}
""" + ("""  A3  Submitted refund (optional, --with-submitted-refund): deliver_by = chain time + 300 s, review period 120 s
  7   client    create (value amount)                     AgreementCreated id 3
  8   provider  submit(3, 0, 0xE3)                        Submitted (the review window then closes at decide_by)
  -   (eth_call) refund before decide_by                  REVERTS "milestone has not expired"
  -   wait until the CHAIN's clock >= decide_by (= deliver_by + 120)
  9   client    refund(3, 0, client)                      MilestoneRefunded, state Refunded
""" if with_a3 else "") + f"""
Then `verify` (read-only): code == runtime.bin, ABI lock, every entry point live, all events
decoded and replayed as the state machine, accounting per agreement and in total.

Transactions: deploy 1, A1 4, A2 2{", A3 3" if with_a3 else " (A3 adds 3)"}; `fund` adds 2 if the faucet is not used. Total {1 + 6 + (3 if with_a3 else 0)} (+2).
Value locked then returned: at most {amount * (3 if with_a3 else 2)} wei; the rest is gas.
Gas limits: deploy {GAS['deploy']}, create {GAS['create']}, others {GAS['other']} (actual use is lower;
see docs/TESTNET.md for the rehearsal's measured gas)."""


# ------------------------------------------------------------------ transaction steps
class Runner:
    def __init__(self, rpc, wallets, address, a):
        self.rpc, self.w, self.addr, self.a = rpc, wallets, address, a
        self.gas_used = []

    def sim(self, wallet, data, value=0):
        tx = {"from": wallet.address, "to": self.addr, "data": data}
        if value:
            tx["value"] = hex(value)
        try:
            self.rpc.call("eth_call", tx, "latest")
            return "ok"
        except L.RpcError as e:
            return L.revert_reason(e)

    def tx(self, label, wallet, data, value=0, gas="other", events=None):
        """Simulate, send, check status and the exact events."""
        s = self.sim(wallet, data, value)
        if s != "ok":
            raise L.Abort(f"step '{label}' would revert ({s}); nothing was sent for it")
        rc = L.send(self.rpc, wallet, self.addr, data, value, GAS[gas], broadcast=self.a.broadcast)
        used = int(rc["gasUsed"], 16)
        self.gas_used.append((label, used))
        log(f"  ok   {label}  tx {rc['_hash']}  block {int(rc['blockNumber'], 16)}  gas {used}")
        for sig, count in (events or {}).items():
            got = sum(1 for lg in rc["logs"] if lg["topics"][0] == L.keccak(sig))
            if got != count:
                raise L.Abort(f"step '{label}': expected {count} x {sig}, saw {got}")
        return rc

    def view(self, sig, *args):
        return L.words(self.rpc.call("eth_call", {"to": self.addr, "data": L.calldata(sig, *args)}, "latest"))

    def create(self, label, deliver_by, review, amount):
        w = self.w
        data = L.calldata("create(address,address,uint256,uint8,uint256[3],uint256[3],uint256[3])", w["provider"].address, w["verifier"].address, review, 1, f"[{amount},0,0]", f"[{deliver_by},0,0]", "[81,0,0]")
        rc = self.tx(label, w["client"], data, amount, "create", {"AgreementCreated(uint256,address,address,address,uint256,uint8)": 1})
        return int(next(lg for lg in rc["logs"] if lg["topics"][0] == L.keccak("AgreementCreated(uint256,address,address,address,uint256,uint8)"))["topics"][1], 16)

    def expect_state(self, i, state, label):
        got = self.view("getMilestone(uint256,uint8)", i, 0)[0]
        if got != state:
            raise L.Abort(f"{label}: milestone {i} is in state {got}, expected {state}")

    def expect_payout(self, kind, i, amount, before_bal):
        sig = {"claim": "MilestoneClaimed(uint256,uint8,address,uint256)", "refund": "MilestoneRefunded(uint256,uint8,address,uint256)"}[kind]
        after = self.rpc.balance(self.addr)
        if after != before_bal - amount:
            raise L.Abort(f"{kind}: the contract balance fell by {before_bal - after}, expected exactly {amount}")
        acc = self.view("getAccounting(uint256)", i)
        want = [amount, amount, 0, 0] if kind == "claim" else [amount, 0, amount, 0]
        if acc != want:
            raise L.Abort(f"{kind}: accounting {acc}, expected {want}")

    def a1(self, amount):
        w = self.w
        log("A1 happy path: create, submit, approve, claim")
        d1 = self.rpc.ts() + self.a.a1_window
        i = self.create("1  create (client)", d1, 3600, amount)
        self.expect_state(i, 1, "after create")
        self.tx("2  submit (provider)", w["provider"], L.calldata("submit(uint256,uint8,uint256)", i, 0, 0xE1), events={"MilestoneSubmitted(uint256,uint8,uint256,uint256)": 1})
        self.expect_state(i, 2, "after submit")
        self.tx("3  approve (verifier)", w["verifier"], L.calldata("approve(uint256,uint8,uint256,uint256)", i, 0, 0xE1, 1), events={"MilestoneApproved(uint256,uint8,uint256,uint256)": 1})
        self.expect_state(i, 3, "after approve")
        before = self.rpc.balance(self.addr)
        self.tx("4  claim (provider -> provider)", w["provider"], L.calldata("claim(uint256,uint8,address)", i, 0, w["provider"].address), events={"MilestoneClaimed(uint256,uint8,address,uint256)": 1})
        self.expect_state(i, 4, "after claim")
        self.expect_payout("claim", i, amount, before)

    def a2(self, amount):
        w = self.w
        log("A2 Funded refund: create, (premature refund simulated), wait, refund")
        d2 = self.rpc.ts() + self.a.a2_window
        i = self.create("5  create (client)", d2, 3600, amount)
        premature = self.sim(w["client"], L.calldata("refund(uint256,uint8,address)", i, 0, w["client"].address))
        if premature != "milestone has not expired":
            raise L.Abort(f"a refund before the deadline should revert with 'milestone has not expired', got: {premature}")
        log("  ok   eth_call refund before the deadline reverts: milestone has not expired (no tx sent)")
        L.wait_until(self.rpc, d2, self.a.rehearsal_warp, log)
        before = self.rpc.balance(self.addr)
        self.tx("6  refund (client -> client)", w["client"], L.calldata("refund(uint256,uint8,address)", i, 0, w["client"].address), events={"MilestoneRefunded(uint256,uint8,address,uint256)": 1})
        self.expect_state(i, 5, "after refund")
        self.expect_payout("refund", i, amount, before)

    def a3(self, amount):
        w = self.w
        log("A3 Submitted refund: create, submit, wait for decide_by, refund")
        d3 = self.rpc.ts() + 300
        i = self.create("7  create (client)", d3, 120, amount)
        self.tx("8  submit (provider)", w["provider"], L.calldata("submit(uint256,uint8,uint256)", i, 0, 0xE3), events={"MilestoneSubmitted(uint256,uint8,uint256,uint256)": 1})
        premature = self.sim(w["client"], L.calldata("refund(uint256,uint8,address)", i, 0, w["client"].address))
        if premature != "milestone has not expired":
            raise L.Abort(f"a refund of a Submitted milestone before decide_by should revert, got: {premature}")
        log("  ok   eth_call refund of a Submitted milestone before decide_by reverts: milestone has not expired")
        L.wait_until(self.rpc, d3 + 120, self.a.rehearsal_warp, log)
        before = self.rpc.balance(self.addr)
        self.tx("9  refund (client -> client)", w["client"], L.calldata("refund(uint256,uint8,address)", i, 0, w["client"].address), events={"MilestoneRefunded(uint256,uint8,address,uint256)": 1})
        self.expect_state(i, 5, "after refund")
        self.expect_payout("refund", i, amount, before)


# ------------------------------------------------------------------ subcommands
def cmd_plan(a):
    log(plan_text(a.amount_wei, a.a1_window, a.a2_window, a.with_submitted_refund))
    return 0


def cmd_preflight(a):
    rpc = L.Rpc(a.rpc_url)
    L.require_chain(rpc)
    st = load_state(L.SEPOLIA)
    ok = preflight(rpc, L.load_wallets(), a.address or st.get("address"), amount=a.amount_wei, with_a3=a.with_submitted_refund)
    log("preflight: " + ("ok" if ok else "FAILED"))
    return 0 if ok else 1


def cmd_fund(a):
    rpc = L.Rpc(a.rpc_url)
    L.require_send_allowed(rpc, a.broadcast)
    w = L.load_wallets()
    for role in ("provider", "verifier"):
        rc = L.send(rpc, w["client"], w[role].address, None, a.fund_wei, 100_000 * 3, broadcast=a.broadcast)
        log(f"  ok   funded {role} {w[role].address} with {a.fund_wei} wei  tx {rc['_hash']}")
    return 0


def cmd_deploy(a):
    rpc = L.Rpc(a.rpc_url)
    L.require_send_allowed(rpc, a.broadcast)
    w = L.load_wallets()
    if not preflight(rpc, w, None, say=log, amount=a.amount_wei, with_a3=a.with_submitted_refund):
        raise L.Abort("preflight failed: nothing was deployed")
    _, init, runtime, _ = L.build_artifacts()
    log(f"deploying Settlane: init {len(init) // 2} bytes, runtime sha256 {L.sha256_hex(runtime)}")
    rc = L.send(rpc, w["client"], None, "0x" + init, 0, GAS["deploy"], create=True, broadcast=a.broadcast)
    addr = rc["contractAddress"].lower()
    if rpc.call("eth_getCode", addr, "latest") != "0x" + runtime:
        raise L.Abort(f"the code at {addr} is NOT Settlane.runtime.bin")
    st = load_state(L.SEPOLIA)
    st.update({"address": addr, "deploy_tx": rc["_hash"], "deploy_block": int(rc["blockNumber"], 16), "deployer": w["client"].address, "runtime_sha256": L.sha256_hex(runtime), "gas_used_deploy": int(rc["gasUsed"], 16)})
    save_state(L.SEPOLIA, st)
    log(f"  ok   deployed at {addr}  tx {rc['_hash']}  block {st['deploy_block']}  gas {st['gas_used_deploy']}\n  state saved in {state_path(L.SEPOLIA)} (outside the repository)")
    return 0


def cmd_run(a):
    rpc = L.Rpc(a.rpc_url)
    L.require_send_allowed(rpc, a.broadcast)
    amount = a.amount_wei
    if not 0 < amount <= L.MAX_AGREEMENT_WEI:
        raise L.Abort(f"--amount-wei must be in 1..{L.MAX_AGREEMENT_WEI}")
    w = L.load_wallets()
    st = load_state(L.SEPOLIA)
    address = (a.address or st.get("address") or "").lower()
    if not address:
        raise L.Abort("no deployed address: run `deploy` first or pass --address")
    if not preflight(rpc, w, address, say=log, amount=amount, with_a3=a.with_submitted_refund, deploy=False):
        raise L.Abort("preflight failed: nothing was sent")
    r = Runner(rpc, w, address, a)
    r.a1(amount)
    r.a2(amount)
    if a.with_submitted_refund:
        r.a3(amount)
    log("\ngas used per transaction: " + ", ".join(f"{k.split()[0]}={v}" for k, v in r.gas_used))
    st["gas_used"] = dict(r.gas_used)
    save_state(L.SEPOLIA, st)
    log("\nverifying the deployment (read-only):")
    return 0 if verify_deployment.verify(rpc, address, L.SEPOLIA, st.get("deploy_block", 0), say=log) else 1


def cmd_verify(a):
    rpc = L.Rpc(a.rpc_url)
    st = load_state(L.SEPOLIA)
    address = a.address or st.get("address")
    if not address:
        raise L.Abort("no address: pass --address")
    return 0 if verify_deployment.verify(rpc, address, L.SEPOLIA, st.get("deploy_block", 0), say=log) else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["plan", "preflight", "fund", "deploy", "run", "verify"])
    ap.add_argument("--rpc-url")
    ap.add_argument("--broadcast", action="store_true", help="actually send transactions (default: refuse)")
    ap.add_argument("--address")
    ap.add_argument("--amount-wei", type=int, default=AMOUNT_DEFAULT)
    ap.add_argument("--fund-wei", type=int, default=4 * 10**15)
    ap.add_argument("--a1-window", type=int, default=900)
    ap.add_argument("--a2-window", type=int, default=180)
    ap.add_argument("--with-submitted-refund", action="store_true")
    ap.add_argument("--rehearsal-warp", action="store_true", help="local rehearsal only: fast-forward the node's clock instead of waiting")
    a = ap.parse_args(argv)
    if a.cmd != "plan" and not a.rpc_url:
        ap.error("--rpc-url is required")
    try:
        return {"plan": cmd_plan, "preflight": cmd_preflight, "fund": cmd_fund, "deploy": cmd_deploy, "run": cmd_run, "verify": cmd_verify}[a.cmd](a)
    except L.Abort as e:
        log(f"ABORT: {e}")
        return 2
    except (OSError, L.RpcError) as e:  # an unreachable or misbehaving node: nothing was sent
        log(f"ABORT: the node did not answer as expected ({type(e).__name__}: {str(e)[:150]}); nothing was sent")
        return 2


if __name__ == "__main__":
    sys.exit(main())

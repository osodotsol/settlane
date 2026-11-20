#!/usr/bin/env python3
"""Plan and (later, with explicit approval) run the Settlane public-testnet transactions.

NOTHING HERE HAS BEEN BROADCAST TO SEPOLIA. Every sending subcommand refuses unless `--broadcast` is
given, the node reports chain id 11155111, and (for a non-local node) the confirmation variable is
set. Keys: an encrypted keystore plus a password FILE, both outside the repository, read by
`cast --keystore --password-file`; no private key, mnemonic or password is ever an argument, an
environment variable or a log line.

Subcommands
  plan                      print the transaction plan and its cost estimate (no node, no key)
  node-preflight            read-only checks of the NODE alone (no wallet, no key): chain, genesis, fork, fees, gas estimates, limits, cost
  check-wallets             offline: the keystore layout, permissions and three distinct addresses (prints addresses only)
  preflight                 read-only checks of the node, the wallets, the balances and the repo
  fund                      client sends gas money to provider and verifier        (sends 2 tx)
  deploy                    build with Fe 26.6.0 and deploy Settlane                (sends 1 tx)
  run                       Create, Submit, Approve, Claim; Create and Refund; [Submitted refund]
  verify                    read-only verification of the deployment (bytecode, ABI, events, accounting)
  budget                    read-only: worst-case and expected cost of every transaction at the live fee, against the budget
  artifact                  show or check (--write: re-pin) the production build against experiments/sepolia/artifact.json
  resolve-pending           after a transaction without a receipt: check it, clear it or keep refusing

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
GAS = {"deploy": 14_000_000, "create": 2_600_000, "other": 1_200_000, "fund": 400_000}  # CAPS (above the real Sepolia estimates x 1.3, below the 16,777,216 EIP-7825 cap): the real limit is the node's estimate + 30%
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


def pending_add(label, h):
    st = load_state(L.SEPOLIA)
    st.setdefault("pending", []).append({"label": label, "tx": h})
    save_state(L.SEPOLIA, st)


def pending_clear(h):
    st = load_state(L.SEPOLIA)
    st["pending"] = [p for p in st.get("pending", []) if p["tx"] != h]
    save_state(L.SEPOLIA, st)


def ensure_no_pending(rpc):
    """A submitted transaction without a receipt must be resolved before ANYTHING new is sent."""
    for p in load_state(L.SEPOLIA).get("pending", []):
        rc = rpc.call("eth_getTransactionReceipt", p["tx"])
        if rc:
            pending_clear(p["tx"])
            log(f"  note: the earlier transaction '{p['label']}' {p['tx']} is now mined with status {int(rc['status'], 16)}; cleared from the pending list")
            if rc["status"] != "0x1":
                raise L.Abort(f"the earlier transaction '{p['label']}' {p['tx']} FAILED (status 0): inspect it before continuing")
        else:
            raise L.Abort(f"the earlier transaction '{p['label']}' {p['tx']} has no receipt yet. It may still be mined: do not resend. Wait, then run `resolve-pending`")


BUDGET_WEI = 60 * 10**15  # 0.06 ETH: the total the three wallets may lose, unless the owner raises it with --budget-wei
BUDGET = {"wei": BUDGET_WEI}


def wallets_total(rpc):
    return sum(rpc.balance(w.address) for w in L.load_wallets().values())


def enforce_budget(rpc, reserve_wei):
    """Total spending cap. `spent` = the three wallets' combined balance at the first send minus now, so it counts
    gas fees AND the value sitting in the contract (conservative: locked value usually comes back). A send is refused
    if spent + this transaction's worst case (gas limit x max fee + value) would exceed the budget. Recorded in the state."""
    st = load_state(L.SEPOLIA)
    now = wallets_total(rpc)
    if "budget_start_total_wei" not in st:
        st["budget_start_total_wei"] = now
        save_state(L.SEPOLIA, st)
    spent = st["budget_start_total_wei"] - now
    if spent + reserve_wei > BUDGET["wei"]:
        raise L.Abort(f"the spending budget of {BUDGET['wei'] / L.ETH:.4f} ETH would be exceeded (spent so far {spent / L.ETH:.6f} ETH, this transaction's worst case {reserve_wei / L.ETH:.6f} ETH): nothing was sent. Raise it only deliberately with --budget-wei")


def tsend(rpc, wallet, to, data, value, cap, label, create=False, broadcast=False):
    """lib.send with the budget guard and the pending marker (written at submission, cleared when the receipt arrives)."""
    return L.send(rpc, wallet, to, data, value, cap, create=create, broadcast=broadcast, on_submit=lambda h: pending_add(label, h), on_done=pending_clear, before=lambda limit, fee: enforce_budget(rpc, limit * fee["max_fee"] + value))


def progress_add(label, tx, extra=None):
    st = load_state(L.SEPOLIA)
    pr = st.setdefault("progress", {"steps": [], "complete": False, "address": st.get("address")})
    pr["steps"].append({"label": label.strip(), "tx": tx, **(extra or {})})
    save_state(L.SEPOLIA, st)


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
# Gas per transaction on the post-Osaka (Glamsterdam-generation) rules Sepolia runs now. deploy, create and the
# transfer to a new account are the REAL nodes' eth_estimateGas (publicnode, thirdweb and tenderly agreed);
# submit, approve, claim and refund need contract state, so they are the estimates of the same plan run on a
# local fork of Sepolia (docs/TESTNET.md). The two sources agree to within 1% where they overlap.
GAS_TABLE = {"deploy": 9_649_454, "create": 1_482_393, "fund": 207_391, "submit": 266_257, "approve": 50_864, "claim": 196_037, "refund": 196_215}
HEADROOM = 1.3  # the gas limit is the estimate x 1.3 (lib.send); the fee paid is for the gas actually used


def cost_model(price_wei, max_fee_wei, amount, with_a3, deploy=True, fund_wei=0):
    """Per wallet: ETH to HOLD to complete the run (fees at `price_wei` for all the gas, the largest single
    upfront reservation limit x max_fee, and the value the client locks), and the expected fees alone."""
    k = 3 if with_a3 else 2  # agreements
    g = GAS_TABLE
    txs = {
        "client": ([g["deploy"]] if deploy else []) + [g["create"]] * k + [g["refund"]] * (k - 1) + ([g["fund"]] * 2 if fund_wei else []),
        "provider": [g["submit"], g["claim"]] + ([g["submit"]] if with_a3 else []),
        "verifier": [g["approve"]],
    }
    out = {}
    for r, lst in txs.items():
        fees_total = int(sum(lst) * price_wei)
        reserve = int(max(lst) * HEADROOM * max_fee_wei)
        locked = (k * amount + 2 * fund_wei) if r == "client" else 0  # value locked in agreements, plus what `fund` sends to the other two
        out[r] = {"fees": fees_total, "hold": fees_total + reserve + locked, "gas": sum(lst)}
    return out


def needs(max_fee_wei, amount, with_a3, deploy=True, price_wei=None):
    m = cost_model(price_wei or max_fee_wei, max_fee_wei, amount, with_a3, deploy)
    return {r: int(1.5 * v["hold"]) for r, v in m.items()}  # a 50% safety margin on top


def preflight(rpc, wallets, address=None, need_balance=True, say=log, amount=AMOUNT_DEFAULT, with_a3=True, deploy=True):
    results = []

    def check(label, ok, detail=""):
        results.append(bool(ok))
        say(("ok    " if ok else "FAIL  ") + label + (f"  [{detail}]" if detail else ""))
        return bool(ok)

    cid = rpc.chain_id()
    check("the node is Ethereum Sepolia (chain id 11155111)", cid == L.SEPOLIA, f"chain id {cid}")
    check("the node is local (rehearsal) or the confirmation variable is set", L.is_loopback(rpc.url) or __import__("os").environ.get(L.CONFIRM_VAR) == L.CONFIRM_VALUE, "local" if L.is_loopback(rpc.url) else "remote")
    fee = L.fees(rpc)
    check(f"the max fee we would set (2 x base fee + tip) is at most {L.MAX_GAS_PRICE_GWEI} gwei", fee["max_fee"] / 1e9 <= L.MAX_GAS_PRICE_GWEI, f"base {fee['base']} wei, tip {fee['tip']} wei, max fee {fee['max_fee']} wei")
    check("the state and wallet directory is outside the repository", not L.inside_repo(L.STATE_DIR), str(L.STATE_DIR))
    bad = scan_repo_for_secrets()
    check("no key material in the repository's tracked or unignored files", not bad, ", ".join(bad))
    check("the secret locations are git-ignored as a second line of defence", all(ignored(p) for p in (".env", "keystores/x", "x.pw", "mnemonic.txt")))
    need = needs(fee["max_fee"], amount, with_a3, deploy, fee["base"] + fee["tip"])
    for role, w in wallets.items():
        bal = rpc.balance(w.address)
        ok = (not need_balance or bal >= need[role]) and bal <= MAX_WALLET_WEI
        check(f"{role} {w.address}: a funded but small test balance", ok, f"{bal / L.ETH:.6f} ETH (needs >= {need[role] / L.ETH:.6f} at this gas price, refuse > {MAX_WALLET_WEI / L.ETH:.0f})")
    if deploy and "client" in wallets:
        out, init, runtime, _ = L.build_artifacts()
        problems, notes = L.check_artifact(L.artifact_facts(out, init, runtime))
        check("the production build equals the pinned artifact (Fe version, init, runtime and ABI hashes, clean tree)", not problems, "; ".join(problems)[:200] or L.sha256_hex(runtime)[:16] + "...")
        try:
            est = L.estimate_gas(rpc, wallets["client"], None, "0x" + init, 0, create=True)
        except L.Abort as e:
            est = None
            check("the node's gas estimate for deploying Settlane is available", False, str(e)[:120])
        if est is not None:
            cost = est * (fee["base"] + fee["tip"])
            check(f"the node's own gas estimate for the deployment is within the {GAS['deploy']} cap", int(est * 1.3) + 1000 <= GAS["deploy"], f"{est} gas, about {cost / L.ETH:.8f} ETH at base+tip {(fee["base"] + fee["tip"]) / 1e9:.9f} gwei (a node on a fork that prices contract creation higher shows it here)")
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
        self.gas_used, self.estimates = [], []

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
        rc = tsend(self.rpc, wallet, self.addr, data, value, GAS[gas], label, broadcast=self.a.broadcast)
        progress_add(label, rc["_hash"])
        used = int(rc["gasUsed"], 16)
        self.gas_used.append((label, used))
        log(f"  ok   {label}  tx {rc['_hash']}  block {int(rc['blockNumber'], 16)}  gas used {used} (estimate {rc['_estimate']})")
        self.estimates.append((label, rc["_estimate"]))
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
    ensure_no_pending(rpc)
    for role in ("provider", "verifier"):
        rc = tsend(rpc, w["client"], w[role].address, None, a.fund_wei, GAS["fund"], f"fund {role}", broadcast=a.broadcast)
        log(f"  ok   funded {role} {w[role].address} with {a.fund_wei} wei  tx {rc['_hash']}")
    return 0


def cmd_deploy(a):
    rpc = L.Rpc(a.rpc_url)
    L.require_send_allowed(rpc, a.broadcast)
    w = L.load_wallets()
    if not preflight(rpc, w, None, say=log, amount=a.amount_wei, with_a3=a.with_submitted_refund):
        raise L.Abort("preflight failed: nothing was deployed")
    _, init, runtime, _ = L.build_artifacts()
    ensure_no_pending(rpc)
    out, _, _, _ = L.build_artifacts()
    problems, notes = L.check_artifact(L.artifact_facts(out, init, runtime))
    if problems:
        raise L.Abort("the build is not the pinned artifact, nothing was deployed: " + "; ".join(problems))
    log(f"deploying Settlane: init {len(init) // 2} bytes, runtime sha256 {L.sha256_hex(runtime)} (equals the pinned artifact)")
    rc = tsend(rpc, w["client"], None, "0x" + init, 0, GAS["deploy"], "deploy Settlane", create=True, broadcast=a.broadcast)
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
    ensure_no_pending(rpc)
    st = load_state(L.SEPOLIA)
    pr = st.get("progress")
    if pr and not pr.get("complete") and not a.abandon_previous:
        raise L.Abort(f"the previous run stopped after {len(pr['steps'])} step(s) (last: {pr['steps'][-1]['label'] if pr['steps'] else 'none'}) and is not complete. Inspect {state_path(L.SEPOLIA)} and the transactions, then pass --abandon-previous to start a NEW run (it creates new agreements)")
    st.pop("progress", None)  # recreated by the first transaction actually sent, so a run that aborts before sending leaves no trace
    save_state(L.SEPOLIA, st)
    r = Runner(rpc, w, address, a)
    r.a1(amount)
    r.a2(amount)
    if a.with_submitted_refund:
        r.a3(amount)
    log("\ngas used per transaction: " + ", ".join(f"{k.split()[0]}={v}" for k, v in r.gas_used))
    log("gas ESTIMATED per transaction: " + ", ".join(f"{k.split()[0]}={v}" for k, v in r.estimates))
    st = load_state(L.SEPOLIA)
    st.setdefault("progress", {"steps": []})["complete"] = True
    st["gas_used"] = dict(r.gas_used)
    st["gas_estimate"] = dict(r.estimates)
    save_state(L.SEPOLIA, st)
    log("\nverifying the deployment (read-only):")
    return 0 if verify_deployment.verify(rpc, address, L.SEPOLIA, st.get("deploy_block", 0), json.loads(L.PIN.read_text())["runtime_sha256"], say=log) else 1


def cmd_verify(a):
    rpc = L.Rpc(a.rpc_url)
    st = load_state(L.SEPOLIA)
    address = a.address or st.get("address")
    if not address:
        raise L.Abort("no address: pass --address")
    return 0 if verify_deployment.verify(rpc, address, L.SEPOLIA, st.get("deploy_block", 0), json.loads(L.PIN.read_text())["runtime_sha256"], say=log) else 1



SEPOLIA_GENESIS = "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9"
DUMMY = "0x00000000000000000000000000000000000dEaD1"  # an address nobody controls: estimation only, never a signer
TX_GAS_CAP = 16_777_216  # EIP-7825


def cmd_node_preflight(a):
    """Read-only checks of the NODE alone: no wallet, no key, no transaction."""
    import time
    rpc = L.Rpc(a.rpc_url)
    results = []

    def check(label, ok, detail=""):
        results.append(bool(ok))
        log(("ok    " if ok else "FAIL  ") + label + (f"  [{detail}]" if detail else ""))
        return bool(ok)

    cid = rpc.chain_id()
    check("the node is Ethereum Sepolia (chain id 11155111)", cid == L.SEPOLIA, f"chain id {cid}")
    if cid != L.SEPOLIA:
        raise L.Abort("not Sepolia: stopping")
    check("block 0 is the Sepolia genesis block", rpc.call("eth_getBlockByNumber", "0x0", False)["hash"] == SEPOLIA_GENESIS)
    try:
        log(f"      client {rpc.call('web3_clientVersion')}")
    except L.RpcError:
        pass
    head = rpc.call("eth_getBlockByNumber", "latest", False)
    age = int(time.time()) - int(head["timestamp"], 16)
    check("the head block is fresh (within 90 s) and the node is not syncing", age <= 90 and rpc.call("eth_syncing") is False, f"block {int(head['number'], 16)}, {age} s old")
    # the fork
    try:
        cfg = rpc.call("eth_config")
        cur = cfg["current"]
        log(f"      eth_config: forkId {cur.get('forkId')}, active since timestamp {cur.get('activationTime')}, next fork: {'none scheduled' if not cfg.get('next') else cfg['next'].get('activationTime')}")
    except L.RpcError:
        log("      eth_config is not offered by this node")
    fields = sorted(k for k in head if k in ("blobGasUsed", "requestsHash", "blockAccessListHash", "slotNumber"))
    amsterdam = "blockAccessListHash" in head and "slotNumber" in head
    check("the chain is on the post-Osaka (Glamsterdam-generation) rules that the runner's gas caps were set for", amsterdam, f"header fields {fields}: {'block access list and slot number present' if amsterdam else 'NOT present: an older fork, re-measure gas'}")
    # fees
    fee = L.fees(rpc)
    try:
        sug = int(rpc.call("eth_maxPriorityFeePerGas"), 16)
        fh = rpc.call("eth_feeHistory", hex(20), "latest", [50])
        tips = sorted(int(x[0], 16) for x in fh["reward"])
        log(f"      base fee {fee['base']} wei; eth_gasPrice {fee['gas_price']} wei; node's suggested tip {sug} wei; median tip paid in the last 20 blocks {tips[len(tips) // 2]} wei; our tip {fee['tip']} wei; our max fee {fee['max_fee']} wei")
    except L.RpcError as e:
        log(f"      fee history unavailable: {str(e)[:80]}")
    check(f"the max fee we would set is at most {L.MAX_GAS_PRICE_GWEI} gwei", fee["max_fee"] / 1e9 <= L.MAX_GAS_PRICE_GWEI)
    # gas estimates on the real node
    o, init, runtime, _ = L.build_artifacts()
    problems, notes = L.check_artifact(L.artifact_facts(o, init, runtime))
    check("the production build equals the pinned artifact (Fe version, init, runtime and ABI hashes, clean tree)", not problems, "; ".join(problems)[:200] or f"runtime sha256 {L.sha256_hex(runtime)}")
    for n in notes:
        log(f"      note: {n}")
    est = {}
    base_ov = {DUMMY: {"balance": hex(10**18)}}
    try:
        est["deploy"] = int(rpc.call("eth_estimateGas", {"from": DUMMY, "data": "0x" + init}), 16)
        now = rpc.ts()
        S, P, V = "0x00000000000000000000000000000000000dEaD5", "0x00000000000000000000000000000000000dEaD2", "0x00000000000000000000000000000000000dEaD3"
        data = L.calldata("create(address,address,uint256,uint8,uint256[3],uint256[3],uint256[3])", P, V, 3600, 1, f"[{a.amount_wei},0,0]", f"[{now + 900},0,0]", "[81,0,0]")
        est["create"] = int(rpc.call("eth_estimateGas", {"from": DUMMY, "to": S, "data": data, "value": hex(a.amount_wei)}, "latest", {**base_ov, S: {"code": "0x" + runtime}}), 16)
        est["fund"] = int(rpc.call("eth_estimateGas", {"from": DUMMY, "to": "0x00000000000000000000000000000000000abc77", "value": hex(a.fund_wei)}, "latest", base_ov), 16)
        views = L.words(rpc.call("eth_call", {"to": S, "data": L.calldata("totalOutstanding()")}, "latest", {S: {"code": "0x" + runtime}}))
        check("eth_call and eth_estimateGas accept state overrides (the verifier and this estimate rely on them)", views == [0])
    except (L.RpcError, L.Abort) as e:
        check("gas estimates and state overrides work on this node", False, str(e)[:120])
    for k, v in est.items():
        limit = int(v * HEADROOM) + 1000
        cap = GAS[k]
        check(f"real-node estimate for {k}: {v} gas, limit {limit} fits the runner cap {cap} and the {TX_GAS_CAP} protocol cap", limit <= cap and limit <= TX_GAS_CAP, f"table value {GAS_TABLE[k]} ({(v - GAS_TABLE[k]) / GAS_TABLE[k] * 100:+.2f}%)")
        check(f"the {k} estimate is within 5% of the table the cost model uses", abs(v - GAS_TABLE[k]) <= 0.05 * GAS_TABLE[k])
    # log range limit
    best = 0
    for span in (1_000, 10_000, 50_000, 100_000):
        try:
            rpc.call("eth_getLogs", {"address": DUMMY, "fromBlock": hex(max(int(head["number"], 16) - span, 0)), "toBlock": "latest"})
            best = span
        except L.RpcError:
            break
    check("eth_getLogs answers for an address filter over at least 1,000 blocks (the verifier halves a refused range)", best >= 1000, f"largest range accepted: {best} blocks")
    # burst
    t0, errs = time.time(), 0
    for _ in range(20):
        try:
            rpc.call("eth_blockNumber")
        except Exception:
            errs += 1
    check("20 calls in a row without a rate-limit error", errs == 0, f"{(time.time() - t0) / 20 * 1000:.0f} ms per call")
    # cost
    bad = scan_repo_for_secrets()
    check("no key material in the repository's tracked or unignored files", not bad, ", ".join(bad))
    log("\ncost model (gas from GAS_TABLE; fees = gas used x price; hold = fees + the largest upfront reservation + the value locked):")
    scen = [("expected now (our tip)", fee["base"] + fee["tip"], fee["max_fee"]), ("stress: tip 1 gwei, as many wallets pay", fee["base"] + 10**9, 2 * fee["base"] + 10**9), ("spike: tip 10 gwei", fee["base"] + 10 * 10**9, 2 * fee["base"] + 10 * 10**9)]
    for with_a3 in (False, True):
        log(f"  plan {'A1+A2+A3' if with_a3 else 'A1+A2'}:")
        for name, price, mx in scen:
            m = cost_model(price, mx, a.amount_wei, with_a3)
            log(f"    {name:42s} fees {sum(v['fees'] for v in m.values()) / L.ETH:.8f} ETH   hold  " + "  ".join(f"{r} {v['hold'] / L.ETH:.6f}" for r, v in m.items()))
    now_need = needs(fee["max_fee"], a.amount_wei, True, True, fee["base"] + fee["tip"])
    log("bare minimum at OUR tip (expected scenario x 1.5 margin, plan A1+A2+A3): " + ", ".join(f"{r} {v / L.ETH:.5f}" for r, v in now_need.items()) + f"  (total {sum(now_need.values()) / L.ETH:.5f} ETH)")
    rec = needs(2 * fee["base"] + 10**9, a.amount_wei, True, True, fee["base"] + 10**9)
    log(f"\nfunding per wallet (plan A1+A2+A3; 50 percent margin included; `fund` = the client sends {a.fund_wei / L.ETH:.4f} ETH to each of the other two, 2 more transactions):")
    for name, price, mx in scen[:2]:
        direct = {r: int(1.5 * v["hold"]) for r, v in cost_model(price, mx, a.amount_wei, True).items()}
        viafund = int(1.5 * cost_model(price, mx, a.amount_wei, True, True, a.fund_wei)["client"]["hold"])
        log(f"  {name:42s} faucet to EACH wallet: client {direct['client'] / L.ETH:.5f}  provider {direct['provider'] / L.ETH:.5f}  verifier {direct['verifier'] / L.ETH:.5f}   |   faucet to the client ONLY, then `fund`: client {viafund / L.ETH:.5f} (provider and verifier get {a.fund_wei / L.ETH:.4f} each)")
    log("\nrecommended minimum test ETH (stress scenario x 1.5 safety margin, plan A1+A2+A3): " + ", ".join(f"{r} {v / L.ETH:.4f}" for r, v in rec.items()) + f"  (total {sum(rec.values()) / L.ETH:.4f} ETH)")
    failed = results.count(False)
    log(f"\nnode-preflight: {len(results) - failed} ok, {failed} failed ({len(results)} checks); no transaction was sent, no wallet was used")
    return 0 if not failed else 1


def cmd_artifact(a):
    """Show the production build's identity; `--write` re-pins it (only after reviewing a contract change)."""
    out, init, runtime, _ = L.build_artifacts()
    facts = L.artifact_facts(out, init, runtime)
    for k, v in facts.items():
        log(f"  {k}: {v}")
    if a.write:
        if facts["production_tree_dirty"]:
            raise L.Abort("refusing to pin a build from a tree with uncommitted production changes")
        L.PIN.write_text(json.dumps({k: v for k, v in facts.items() if k != "production_tree_dirty"}, indent=2) + "\n")
        log(f"pinned in {L.PIN}")
        return 0
    problems, notes = L.check_artifact(facts)
    for n in notes:
        log(f"  note: {n}")
    log("artifact: " + ("equals the pin" if not problems else "DIFFERS from the pin: " + "; ".join(problems)))
    return 0 if not problems else 1


def cmd_resolve_pending(a):
    rpc = L.Rpc(a.rpc_url)
    L.require_chain(rpc)
    st = load_state(L.SEPOLIA)
    if not st.get("pending"):
        log("no pending transactions")
        return 0
    for p in list(st["pending"]):
        rc = rpc.call("eth_getTransactionReceipt", p["tx"])
        if rc:
            pending_clear(p["tx"])
            log(f"  resolved '{p['label']}' {p['tx']}: mined in block {int(rc['blockNumber'], 16)}, status {int(rc['status'], 16)}")
        else:
            log(f"  STILL PENDING '{p['label']}' {p['tx']}: no receipt yet; do not resend. If the node dropped it, check the account's nonce and inspect it on a block explorer before doing anything")
    return 0 if not load_state(L.SEPOLIA).get("pending") else 1


def cmd_budget(a):
    """Read-only: the worst-case and expected cost of every transaction at the live fee, against the budget."""
    rpc = L.Rpc(a.rpc_url)
    L.require_chain(rpc)
    fee = L.fees(rpc)
    w = L.load_wallets()
    g = GAS_TABLE
    rows = [("fund provider", "client", g["fund"]), ("fund verifier", "client", g["fund"]), ("deploy Settlane", "client", g["deploy"]),
            ("A1 create", "client", g["create"]), ("A1 submit", "provider", g["submit"]), ("A1 approve", "verifier", g["approve"]), ("A1 claim", "provider", g["claim"]),
            ("A2 create", "client", g["create"]), ("A2 refund", "client", g["refund"])]
    if a.with_submitted_refund:
        rows += [("A3 create", "client", g["create"]), ("A3 submit", "provider", g["submit"]), ("A3 refund", "client", g["refund"])]
    eff, mx = fee["base"] + fee["tip"], fee["max_fee"]
    log(f"live fee: base {fee['base']} wei, our tip {fee['tip']} wei -> effective {eff} wei per gas; max fee {mx} wei; gas limit = estimate x {HEADROOM} + 1000")
    log(f"{'transaction':18s} {'sender':9s} {'gas (estimate)':>14s} {'gas limit':>11s} {'expected fee ETH':>17s} {'worst case ETH (limit x max fee)':>33s}")
    tot_exp = tot_wc = 0
    for name, who, gas in rows:
        lim = int(gas * HEADROOM) + 1000
        e, wc = gas * eff, lim * mx
        tot_exp += e; tot_wc += wc
        log(f"{name:18s} {who:9s} {gas:14d} {lim:11d} {e / L.ETH:17.9f} {wc / L.ETH:33.9f}")
    locked = (3 if a.with_submitted_refund else 2) * a.amount_wei
    log(f"{'TOTAL':18s} {'':9s} {sum(r[2] for r in rows):14d} {'':11s} {tot_exp / L.ETH:17.9f} {tot_wc / L.ETH:33.9f}")
    log(f"value locked in agreements at the peak: {locked / L.ETH:.4f} ETH (A1's goes to the provider wallet, A2 and A3 return to the client); `fund` moves {2 * a.fund_wei / L.ETH:.4f} ETH between our own wallets")
    worst = tot_wc + locked
    log(f"WORST CASE at the live fee (every limit fully used, every value lost): {worst / L.ETH:.6f} ETH = {worst / BUDGET['wei'] * 100:.2f}% of the {BUDGET['wei'] / L.ETH:.2f} ETH budget; EXPECTED: {tot_exp / L.ETH:.6f} ETH of fees")
    lims = sum(int(gas * HEADROOM) + 1000 for _, _, gas in rows)
    be = ((BUDGET["wei"] - locked) / lims - fee["tip"]) / 2
    log(f"the budget would be exhausted by the worst case only if the BASE fee rose to about {be / 1e9:.2f} gwei (now {fee['base'] / 1e9:.9f}); above 60 gwei max fee the runner refuses anyway, and the budget guard refuses each send whose own worst case would break the total")
    for r in ("client", "provider", "verifier"):
        log(f"  {r:9s} {w[r].address}  balance {rpc.balance(w[r].address) / L.ETH:.6f} ETH")
    return 0


def cmd_check_wallets(a):
    """Offline: the three keystores and password files exist, sit outside the repo, are protected, and are three different addresses."""
    import stat as st
    w = L.load_wallets()
    for role, wl in w.items():
        log(f"  ok   {role:9s} {wl.address}   keystore {wl.keystore}   password file mode {oct(st.S_IMODE(wl.password_file.stat().st_mode))}")
    d = L.STATE_DIR.stat().st_mode & 0o077
    log(("  ok   " if not d else "  WARN ") + f"{L.STATE_DIR} " + ("is private to you" if not d else "is accessible to others: chmod 700 it"))
    log("check-wallets: ok (offline: no network, no balance, nothing printed but addresses and paths)")
    return 0



def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["plan", "node-preflight", "check-wallets", "artifact", "budget", "preflight", "fund", "deploy", "run", "resolve-pending", "verify"])
    ap.add_argument("--rpc-url")
    ap.add_argument("--broadcast", action="store_true", help="actually send transactions (default: refuse)")
    ap.add_argument("--address")
    ap.add_argument("--amount-wei", type=int, default=AMOUNT_DEFAULT)
    ap.add_argument("--fund-wei", type=int, default=4 * 10**15)
    ap.add_argument("--budget-wei", type=int, default=BUDGET_WEI, help="total the three wallets may lose, fees plus value in the contract (default 0.06 ETH)")
    ap.add_argument("--tip-wei", type=int, default=L.TIP_WEI, help="priority fee we offer per gas (default 0.01 gwei)")
    ap.add_argument("--a1-window", type=int, default=900)
    ap.add_argument("--a2-window", type=int, default=180)
    ap.add_argument("--with-submitted-refund", action="store_true")
    ap.add_argument("--write", action="store_true", help="artifact: re-pin the build (after reviewing a contract change)")
    ap.add_argument("--abandon-previous", action="store_true", help="run: start a new run although the previous one did not complete")
    ap.add_argument("--receipt-timeout", type=int, default=600, help="seconds to wait for a receipt before stopping with a pending marker")
    ap.add_argument("--rehearsal-warp", action="store_true", help="local rehearsal only: fast-forward the node's clock instead of waiting")
    a = ap.parse_args(argv)
    L.TIP_WEI = a.tip_wei
    BUDGET["wei"] = a.budget_wei
    L.RECEIPT_TIMEOUT_S = a.receipt_timeout
    if a.cmd not in ("plan", "check-wallets", "artifact") and not a.rpc_url:
        ap.error("--rpc-url is required")
    try:
        return {"plan": cmd_plan, "node-preflight": cmd_node_preflight, "check-wallets": cmd_check_wallets, "artifact": cmd_artifact, "budget": cmd_budget, "resolve-pending": cmd_resolve_pending, "preflight": cmd_preflight, "fund": cmd_fund, "deploy": cmd_deploy, "run": cmd_run, "verify": cmd_verify}[a.cmd](a)
    except L.Abort as e:
        log(f"ABORT: {e}")
        return 2
    except (OSError, L.RpcError) as e:  # an unreachable or misbehaving node: nothing was sent
        log(f"ABORT: the node did not answer as expected ({type(e).__name__}: {str(e)[:150]}); nothing was sent")
        return 2


if __name__ == "__main__":
    sys.exit(main())

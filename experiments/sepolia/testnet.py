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
  verify-step               verify the last mined step at its own block, or adopt a mined fund transaction (--tx)
  step                      ONE transaction of the first-run plan (dry run without --broadcast), verified, recorded, then stop
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
    state_path(chain).chmod(0o600)


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
    """The three balances read at ONE block number, so a load-balanced node cannot mix two heads in a single total."""
    bn = int(rpc.call("eth_blockNumber"), 16)
    return sum(int(rpc.call("eth_getBalance", w.address, hex(bn)), 16) for w in L.load_wallets().values())


def at_risk_value(to, value):
    """The part of a transaction's value that LEAVES our three wallets: a transfer to one of them (`fund`) is internal,
    so it is not exposure; value sent to the contract (an agreement's deposit) is, until it comes back (refund, or claim to a wallet)."""
    own = {w.address.lower() for w in L.load_wallets().values()}
    return 0 if (to and to.lower() in own) else value


def enforce_budget(rpc, reserve_wei):
    """Total spending cap. spent = the three wallets' combined balance at the FIRST send minus now. Therefore:
      * a transfer between our own wallets changes nothing but its fee (internal, not exposure);
      * a deposit in the contract counts as spent while it is locked, and stops counting when a refund or a claim to
        one of our wallets brings it back (conservative, and exact once settled);
      * an INCREASE of the combined balance above the baseline (a faucet drip, anything unexpected) is refused: the
        baseline would silently hide losses, so the workflow stops until the owner decides.
    A send is refused if spent + this transaction's worst case (gas limit x max fee + the value that leaves our wallets)
    would exceed the budget. The baseline is recorded in the state file at the first send."""
    st = load_state(L.SEPOLIA)
    now = wallets_total(rpc)
    if "budget_start_total_wei" not in st:
        st["budget_start_total_wei"] = now
        save_state(L.SEPOLIA, st)
    start = st["budget_start_total_wei"]
    if now > start:
        raise L.Abort(f"the three wallets hold {(now - start) / L.ETH:.6f} ETH MORE than at the start of the budget: an unexpected deposit. The budget baseline would hide losses, so nothing was sent; the owner must decide (delete budget_start_total_wei from the state file to re-baseline deliberately)")
    spent = start - now
    if spent + reserve_wei > BUDGET["wei"]:
        raise L.Abort(f"the spending budget of {BUDGET['wei'] / L.ETH:.4f} ETH would be exceeded (spent so far {spent / L.ETH:.6f} ETH, this transaction's worst case {reserve_wei / L.ETH:.6f} ETH): nothing was sent. Raise it only deliberately with --budget-wei")


def tsend(rpc, wallet, to, data, value, cap, label, create=False, broadcast=False):
    """lib.send with the budget guard and the pending marker (written at submission, cleared when the receipt arrives)."""
    return L.send(rpc, wallet, to, data, value, cap, create=create, broadcast=broadcast, on_submit=lambda h: pending_add(label, h), on_done=pending_clear, before=lambda limit, fee: enforce_budget(rpc, limit * fee["max_fee"] + at_risk_value(to, value)))


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

    def view(self, sig, *args, block=None):
        return L.words(self.rpc.call("eth_call", {"to": self.addr, "data": L.calldata(sig, *args)}, hex(block) if block else "latest"))

    def create(self, label, deliver_by, review, amount):
        w = self.w
        data = L.calldata("create(address,address,uint256,uint8,uint256[3],uint256[3],uint256[3])", w["provider"].address, w["verifier"].address, review, 1, f"[{amount},0,0]", f"[{deliver_by},0,0]", "[81,0,0]")
        rc = self.tx(label, w["client"], data, amount, "create", {"AgreementCreated(uint256,address,address,address,uint256,uint8)": 1})
        return int(next(lg for lg in rc["logs"] if lg["topics"][0] == L.keccak("AgreementCreated(uint256,address,address,address,uint256,uint8)"))["topics"][1], 16)

    def expect_state(self, i, state, label, block=None):
        got = self.view("getMilestone(uint256,uint8)", i, 0, block=block)[0]
        if got != state:
            raise L.Abort(f"{label}: milestone {i} is in state {got}, expected {state}")

    def expect_payout(self, kind, i, amount, before_bal, block=None):
        sig = {"claim": "MilestoneClaimed(uint256,uint8,address,uint256)", "refund": "MilestoneRefunded(uint256,uint8,address,uint256)"}[kind]
        after = int(self.rpc.call("eth_getBalance", self.addr, hex(block) if block else "latest"), 16)
        if after != before_bal - amount:
            raise L.Abort(f"{kind}: the contract balance fell by {before_bal - after}, expected exactly {amount}")
        acc = self.view("getAccounting(uint256)", i, block=block)
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
    if st.get("steps_done"):
        raise L.Abort("`step` mode is in use in this state: continue with `step`; `run` and `step` are not mixed")
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
    """Read-only: the exact transactions of the plan with sender, recipient, value, gas and worst case at the live fee, against the budget."""
    rpc = L.Rpc(a.rpc_url)
    L.require_chain(rpc)
    fee = L.fees(rpc)
    w = L.load_wallets()
    st = load_state(L.SEPOLIA)
    g = GAS_TABLE
    c, p, v = w["client"], w["provider"], w["verifier"]
    addr = st.get("address")
    if not addr:
        nonce = int(rpc.call("eth_getTransactionCount", c.address, "pending"), 16) + 2  # after the two fund transfers
        addr = L.run([L.tool("cast"), "compute-address", c.address, "--nonce", str(nonce)]).stdout.split()[-1].lower()
        addr_note = f"{addr} (predicted: the client's nonce {nonce})"
    else:
        addr_note = addr
    amt, fw = a.amount_wei, a.fund_wei
    rows = [("1 fund provider", c, p.address, fw, g["fund"]), ("2 fund verifier", c, v.address, fw, g["fund"]), ("3 deploy Settlane", c, "(creates the contract)", 0, g["deploy"]),
            ("4 A1 create", c, addr, amt, g["create"]), ("5 A1 submit", p, addr, 0, g["submit"]), ("6 A1 approve", v, addr, 0, g["approve"]), ("7 A1 claim -> provider", p, addr, 0, g["claim"]),
            ("8 A2 create", c, addr, amt, g["create"]), ("9 A2 refund -> client", c, addr, 0, g["refund"])]
    if a.with_submitted_refund:
        rows += [("10 A3 create", c, addr, amt, g["create"]), ("11 A3 submit", p, addr, 0, g["submit"]), ("12 A3 refund -> client", c, addr, 0, g["refund"])]
    eff, mx = fee["base"] + fee["tip"], fee["max_fee"]
    log(f"contract: {addr_note}")
    log(f"live fee: base {fee['base']} wei, tip {fee['tip']} wei -> effective {eff} wei/gas; max fee {mx} wei/gas; gas limit = estimate x {HEADROOM} + 1000; budget {BUDGET['wei'] / L.ETH:.4f} ETH")
    log(f"{'#  transaction':25s} {'from':9s} {'to':44s} {'value ETH':>10s} {'gas est':>9s} {'limit':>9s} {'max fee ETH':>12s} {'expected ETH':>13s}")
    tot_exp = tot_wc = ext = 0
    for name, snd, to, val, gas in rows:
        lim = int(gas * HEADROOM) + 1000
        e, wc = gas * eff, lim * mx
        tot_exp += e; tot_wc += wc
        ext += val if (to.startswith("0x") and to.lower() not in {x.address.lower() for x in w.values()}) else 0
        log(f"{name:25s} {snd.role:9s} {to:44s} {val / L.ETH:10.4f} {gas:9d} {lim:9d} {wc / L.ETH:12.9f} {e / L.ETH:13.9f}")
    peak = amt  # one agreement's deposit is locked at a time in the first-run plan (A1's is claimed before A2 is created)
    log(f"{'TOTAL fees':25s} {'':9s} {'':44s} {'':>10s} {sum(r[4] for r in rows):9d} {'':9s} {tot_wc / L.ETH:12.9f} {tot_exp / L.ETH:13.9f}")
    log(f"value: 'fund' moves {2 * fw / L.ETH:.4f} ETH between our own wallets (internal: not exposure); deposits to the contract total {ext / L.ETH:.4f} ETH, at most {peak / L.ETH:.4f} ETH locked at once, and each comes back to a wallet of ours (A1: claim to the provider, A2: refund to the client)")
    log(f"TOTAL EXPOSURE, worst case at the live fee (every limit used at the max fee, and every deposit never recovered): {(tot_wc + ext) / L.ETH:.6f} ETH = {(tot_wc + ext) / BUDGET['wei'] * 100:.2f}% of the budget; EXPECTED loss: {tot_exp / L.ETH:.6f} ETH of fees only")
    lims = sum(int(r[4] * HEADROOM) + 1000 for r in rows)
    be = ((BUDGET["wei"] - ext) / lims - fee["tip"]) / 2
    log(f"the budget could only be exhausted if the BASE fee rose to about {be / 1e9:.2f} gwei (now {fee['base'] / 1e9:.9f}); the guard refuses each send whose own worst case would break the total, and nothing is ever resent or escalated")
    for r in ("client", "provider", "verifier"):
        log(f"  {r:9s} {w[r].address}  balance {rpc.balance(w[r].address) / L.ETH:.6f} ETH")
    return 0


STEPS = ["fund-provider", "fund-verifier", "deploy", "a1-create", "a1-submit", "a1-approve", "a1-claim", "a2-create", "a2-refund"]


def cmd_step(a):
    """Execute (with --broadcast) or describe (without) exactly ONE next transaction of the first-run plan, verify
    its receipt, record it, and stop. Never continues by itself; never resends; stops on anything unexpected."""
    rpc = L.Rpc(a.rpc_url)
    L.require_chain(rpc)
    w = L.load_wallets()
    st = load_state(L.SEPOLIA)
    if st.get("progress"):
        raise L.Abort("`run` has already been used in this state: finish or inspect it; `step` and `run` are not mixed")
    unverified = [x["name"] for x in st.get("steps_done", []) if not x.get("verified")]
    if unverified:
        raise L.Abort(f"the step '{unverified[0]}' was sent and mined but its verification did not complete: nothing more will be sent until `verify-step` verifies it")
    done = [x["name"] for x in st.get("steps_done", [])]
    nxt = next((x for x in STEPS if x not in done), None)
    if nxt is None:
        log("every step is done: run `verify`")
        return 0
    if a.broadcast:
        L.require_send_allowed(rpc, True)
        ensure_no_pending(rpc)
    amount, fee = a.amount_wei, L.fees(rpc)
    c, p, v = w["client"], w["provider"], w["verifier"]
    address = st.get("address")
    r = Runner(rpc, w, address, a) if address else None
    log(f"next step {len(done) + 1} of {len(STEPS)}: {nxt}")
    # ---- build the transaction
    if nxt.startswith("fund"):
        tgt = p if nxt == "fund-provider" else v
        sender, to, data, value, create, cap = c, tgt.address, None, a.fund_wei, False, GAS["fund"]
    elif nxt == "deploy":
        out, init, runtime, _ = L.build_artifacts()
        problems, _ = L.check_artifact(L.artifact_facts(out, init, runtime))
        if problems:
            raise L.Abort("the build is not the pinned artifact, nothing was deployed: " + "; ".join(problems))
        nonce = int(rpc.call("eth_getTransactionCount", c.address, "pending"), 16)
        predicted = L.run([L.tool("cast"), "compute-address", c.address, "--nonce", str(nonce)]).stdout.split()[-1].lower()
        sender, to, data, value, create, cap = c, None, "0x" + init, 0, True, GAS["deploy"]
        log(f"  the contract will be created at {predicted} (the client's next nonce {nonce})")
    else:
        if not address:
            raise L.Abort("no deployed address in the state")
        if nxt in ("a1-create", "a2-create"):
            window = a.a1_window if nxt == "a1-create" else a.a2_window
            deliver_by = rpc.ts() + window  # the chain's clock now + the window; the same value goes into the transaction and the record
            data = L.calldata("create(address,address,uint256,uint8,uint256[3],uint256[3],uint256[3])", p.address, v.address, 3600, 1, f"[{amount},0,0]", f"[{deliver_by},0,0]", "[81,0,0]")
            sender, value = c, amount
        else:
            i = st["a1_id"] if nxt.startswith("a1") else st["a2_id"]
            data = {"a1-submit": L.calldata("submit(uint256,uint8,uint256)", i, 0, 0xE1) if nxt == "a1-submit" else None,
                    "a1-approve": L.calldata("approve(uint256,uint8,uint256,uint256)", i, 0, 0xE1, 1) if nxt == "a1-approve" else None,
                    "a1-claim": L.calldata("claim(uint256,uint8,address)", i, 0, p.address) if nxt == "a1-claim" else None,
                    "a2-refund": L.calldata("refund(uint256,uint8,address)", i, 0, c.address) if nxt == "a2-refund" else None}[nxt]
            sender = {"a1-submit": p, "a1-approve": v, "a1-claim": p, "a2-refund": c}[nxt]
            value = 0
        to, create, cap = address, False, GAS["create"] if "create" in nxt else GAS["other"]
        if nxt == "a2-refund":
            left = st["a2_deliver_by"] - rpc.ts()
            sim = Runner(rpc, w, address, a).sim(c, data)
            if left > 0:
                log(f"  the chain's clock is {left} s before the Funded deadline; a refund now simulates as: {sim} (nothing sent). Run `step` again after the chain time passes {st['a2_deliver_by']}")
                return 0
    est = L.estimate_gas(rpc, sender, to, data, value, create)
    limit = int(est * HEADROOM) + 1000
    worst = limit * fee["max_fee"] + at_risk_value(to, value)
    log(f"  from {sender.role} {sender.address}\n  to   {to or '(contract creation)'}\n  value {value} wei ({value / L.ETH} ETH){' [internal transfer between our own wallets]' if at_risk_value(to, value) == 0 and value else ''}\n  gas estimate {est}, limit {limit} (cap {cap}); max fee {fee['max_fee']} wei/gas, tip {fee['tip']} wei; worst case {worst / L.ETH:.9f} ETH; budget {BUDGET['wei'] / L.ETH:.4f} ETH")
    if not a.broadcast:
        log("  dry run: nothing was sent (add --broadcast to send exactly this one transaction)")
        return 0
    # ---- send exactly one transaction, RECORD it at once as unverified, then verify it at its own block
    rc = tsend(rpc, sender, to, data, value, cap, nxt, create=create, broadcast=True)
    used = int(rc["gasUsed"], 16)
    rec = {"name": nxt, "tx": rc["_hash"], "block": int(rc["blockNumber"], 16), "gas_used": used, "gas_estimate": est, "from": sender.address, "to": (to or rc.get("contractAddress", "")).lower(), "value": value, "verified": False}
    if nxt in ("a1-create", "a2-create"):
        rec["deliver_by"] = deliver_by
    st = load_state(L.SEPOLIA)
    st["steps_done"] = st.get("steps_done", []) + [rec]
    save_state(L.SEPOLIA, st)  # from here on a re-run can never repeat this transaction
    log(f"  mined: tx {rc['_hash']}  block {rec['block']}  gas used {used} (estimate {est})  status 1  [recorded, verification follows]")
    verify_recorded_step(rpc, w, a, rec, rc, predicted if nxt == "deploy" else None, runtime if nxt == "deploy" else None)
    return 0


def bal_at(rpc, addr, block):
    return int(rpc.call("eth_getBalance", addr, hex(block)), 16)


def verify_recorded_step(rpc, w, a, rec, rc, predicted=None, runtime=None):
    """Verify a mined step against the plan, reading state AT THE RECEIPT'S BLOCK (never `latest`: a load-balanced node can
    answer from a lagging backend). Marks the record verified and prints the spend; any difference aborts and leaves the
    record unverified, which blocks every later step."""
    nxt, bn, amount = rec["name"], rec["block"], a.amount_wei
    c, p, v = w["client"], w["provider"], w["verifier"]
    st = load_state(L.SEPOLIA)
    address = st.get("address")
    if rc.get("status") != "0x1":
        raise L.Abort(f"UNEXPECTED: {rec['tx']} has status {rc.get('status')}")
    if int(rc["blockNumber"], 16) != bn or rc["transactionHash"].lower() != rec["tx"].lower():
        raise L.Abort("UNEXPECTED: the receipt does not match the record")
    if nxt.startswith("fund"):
        tgt = p if nxt == "fund-provider" else v
        got = bal_at(rpc, tgt.address, bn) - bal_at(rpc, tgt.address, bn - 1)
        sent = bal_at(rpc, c.address, bn - 1) - bal_at(rpc, c.address, bn)
        fee = int(rc["gasUsed"], 16) * int(rc["effectiveGasPrice"], 16)
        tx = rpc.call("eth_getTransactionByHash", rec["tx"])
        if tx["to"].lower() != tgt.address.lower() or tx["from"].lower() != c.address.lower() or int(tx["value"], 16) != a.fund_wei or int(tx["chainId"], 16) != L.SEPOLIA:
            raise L.Abort("UNEXPECTED: the transaction's sender, recipient, value or chain id differ from the plan")
        if got != a.fund_wei or sent != a.fund_wei + fee:
            raise L.Abort(f"UNEXPECTED at block {bn}: the recipient gained {got} (expected {a.fund_wei}); the client lost {sent} (expected {a.fund_wei + fee})")
        log(f"  verified at block {bn}: recipient +{got} wei exactly; client -{sent} wei = value + fee {fee}; sender, recipient, value and chain id equal the plan")
    elif nxt == "deploy":
        code = rpc.call("eth_getCode", rc["contractAddress"], hex(bn))
        if code != "0x" + runtime or rc["contractAddress"].lower() != predicted:
            raise L.Abort(f"UNEXPECTED: the deployed code or address is not the pinned artifact's ({rc['contractAddress']} vs predicted {predicted})")
        st.update({"address": rc["contractAddress"].lower(), "deploy_tx": rec["tx"], "deploy_block": bn, "deployer": c.address, "runtime_sha256": L.sha256_hex(runtime)})
        log(f"  verified at block {bn}: deployed at {rc['contractAddress']}; code equals the pinned runtime ({L.sha256_hex(runtime)[:16]}...)")
    else:
        r = Runner(rpc, w, address, a)
        if nxt in ("a1-create", "a2-create"):
            sig = "AgreementCreated(uint256,address,address,address,uint256,uint8)"
            logs = [lg for lg in rc["logs"] if lg["topics"][0] == L.keccak(sig)]
            want = 1 if nxt == "a1-create" else 2
            i = int(logs[0]["topics"][1], 16) if len(logs) == 1 else None
            if i != want or r.view("getMilestone(uint256,uint8)", i, 0, block=bn)[0] != 1 or bal_at(rpc, address, bn) - bal_at(rpc, address, bn - 1) != amount:
                raise L.Abort(f"UNEXPECTED: create did not produce agreement {want} in state Funded holding {amount} wei")
            st["a1_id" if nxt == "a1-create" else "a2_id"] = i
            st["a1_deliver_by" if nxt == "a1-create" else "a2_deliver_by"] = rec["deliver_by"]
        else:
            i = st["a1_id"] if nxt.startswith("a1") else st["a2_id"]
            want_state = {"a1-submit": 2, "a1-approve": 3, "a1-claim": 4, "a2-refund": 5}[nxt]
            ev = {"a1-submit": "MilestoneSubmitted(uint256,uint8,uint256,uint256)", "a1-approve": "MilestoneApproved(uint256,uint8,uint256,uint256)", "a1-claim": "MilestoneClaimed(uint256,uint8,address,uint256)", "a2-refund": "MilestoneRefunded(uint256,uint8,address,uint256)"}[nxt]
            if sum(1 for lg in rc["logs"] if lg["topics"][0] == L.keccak(ev)) != 1 or r.view("getMilestone(uint256,uint8)", i, 0, block=bn)[0] != want_state:
                raise L.Abort(f"UNEXPECTED: {nxt} did not leave milestone {i} in state {want_state} with exactly one {ev.split('(')[0]}")
            if nxt in ("a1-claim", "a2-refund"):
                r.expect_payout("claim" if nxt == "a1-claim" else "refund", i, amount, bal_at(rpc, address, bn - 1), block=bn)
        log(f"  verified at block {bn}: state, events and balances equal the plan")
    for x in st["steps_done"]:
        if x["tx"] == rec["tx"]:
            x["verified"] = True
    save_state(L.SEPOLIA, st)
    total_now = wallets_total(rpc)
    log(f"  recorded and verified. Spent so far (combined balance of the three wallets vs the start): {(st.get('budget_start_total_wei', total_now) - total_now) / L.ETH:.9f} ETH of the {BUDGET['wei'] / L.ETH:.4f} ETH budget. {len(STEPS) - len(st['steps_done'])} step(s) remain. STOPPED: run `step` again to continue.")


def cmd_verify_step(a):
    """Verify the last recorded-but-unverified step, or ADOPT an already mined transaction (--tx) that is the next planned
    step. Read-only on the network; it only completes the local record. Adoption supports the fund steps only."""
    rpc = L.Rpc(a.rpc_url)
    L.require_chain(rpc)
    w = L.load_wallets()
    st = load_state(L.SEPOLIA)
    bad = [x for x in st.get("steps_done", []) if not x.get("verified")]
    if a.tx:
        if bad or any(x["tx"].lower() == a.tx.lower() for x in st.get("steps_done", [])):
            raise L.Abort("that transaction is already recorded, or another record is unverified: use `verify-step` without --tx")
        done = [x["name"] for x in st.get("steps_done", [])]
        nxt = next((x for x in STEPS if x not in done), None)
        if nxt not in ("fund-provider", "fund-verifier"):
            raise L.Abort(f"adoption supports the fund steps only; the next planned step is {nxt}: inspect it by hand")
        rc = rpc.call("eth_getTransactionReceipt", a.tx)
        tx = rpc.call("eth_getTransactionByHash", a.tx)
        if not rc or not tx:
            raise L.Abort("the transaction or its receipt was not found")
        tgt = w["provider"] if nxt == "fund-provider" else w["verifier"]
        if rc["status"] != "0x1" or tx["from"].lower() != w["client"].address.lower() or tx["to"].lower() != tgt.address.lower() or int(tx["value"], 16) != a.fund_wei:
            raise L.Abort("that transaction is not exactly the planned step (sender, recipient, value or status differ): nothing was recorded")
        rec = {"name": nxt, "tx": a.tx, "block": int(rc["blockNumber"], 16), "gas_used": int(rc["gasUsed"], 16), "gas_estimate": None, "from": tx["from"].lower(), "to": tx["to"].lower(), "value": int(tx["value"], 16), "verified": False, "adopted": True}
        st["steps_done"] = st.get("steps_done", []) + [rec]
        save_state(L.SEPOLIA, st)
        log(f"adopted {nxt}: tx {a.tx} in block {rec['block']}")
    else:
        if not bad:
            log("every recorded step is verified")
            return 0
        rec = bad[0]
        rc = rpc.call("eth_getTransactionReceipt", rec["tx"])
        if not rc:
            raise L.Abort("no receipt for the unverified step: use `resolve-pending` thinking, not `verify-step`")
    runtime = None
    predicted = None
    if rec["name"] == "deploy":
        _, _, runtime, _ = L.build_artifacts()
        predicted = rc["contractAddress"].lower()
    verify_recorded_step(rpc, w, a, rec, rc, predicted, runtime)
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
    ap.add_argument("cmd", choices=["plan", "node-preflight", "check-wallets", "artifact", "budget", "step", "verify-step", "preflight", "fund", "deploy", "run", "resolve-pending", "verify"])
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
    ap.add_argument("--tx", help="verify-step: adopt this already mined transaction if it is exactly the next planned fund step")
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
        return {"plan": cmd_plan, "node-preflight": cmd_node_preflight, "check-wallets": cmd_check_wallets, "artifact": cmd_artifact, "budget": cmd_budget, "step": cmd_step, "verify-step": cmd_verify_step, "resolve-pending": cmd_resolve_pending, "preflight": cmd_preflight, "fund": cmd_fund, "deploy": cmd_deploy, "run": cmd_run, "verify": cmd_verify}[a.cmd](a)
    except L.Abort as e:
        log(f"ABORT: {e}")
        return 2
    except (OSError, L.RpcError) as e:  # an unreachable or misbehaving node: nothing was sent
        log(f"ABORT: the node did not answer as expected ({type(e).__name__}: {str(e)[:150]}); nothing was sent")
        return 2


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Rehearse the whole Sepolia plan LOCALLY, on a throw-away Anvil that reports chain id 11155111.

This is the only thing that has been run: no transaction has been sent to Sepolia. It uses the same
`testnet.py` and `verify_deployment.py` code and the same keystore-signing path as the real run, with
throwaway keystores in a temporary directory outside the repository (the password of a throwaway
keystore on a local node is not a secret).

It proves, with exit code 0:
  * the guards refuse: no `--broadcast`, the wrong chain id, a remote node without the confirmation
    variable, a keystore or password file inside the repository, a world-readable password file, two
    roles sharing one address, an amount above the cap, key material in the repository;
  * the happy path works end to end: fund, deploy, A1 (create, submit, approve, claim), A2 (create,
    premature refund simulated, wait, refund), A3 (Submitted refund), then the read-only verification;
  * the verification FAILS on a contract with other code;
  * the private keys appear in no output and nothing was written into the repository.

Usage: python3 experiments/sepolia/rehearse.py [--hardfork prague|osaka|...] [--fork-url SEPOLIA_RPC]   (needs anvil and cast, see experiments/anvil/README.md)
"""
import json
import os
import pathlib
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lib  # noqa: E402
import testnet  # noqa: E402

results = []
PASSWORD = "rehearsal-only-throwaway"


def check(label, ok, detail=""):
    results.append(bool(ok))
    print(("ok    " if ok else "FAIL  ") + label + (f"  [{detail}]" if detail else ""), flush=True)
    return bool(ok)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Anvil:
    def __init__(self, chain_id, hardfork=None, fork_url=None, extra=()):
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.proc = subprocess.Popen([lib.tool("anvil"), "--host", "127.0.0.1", "--port", str(self.port), "--chain-id", str(chain_id), "--silent"] + (["--hardfork", hardfork] if hardfork else []) + (["--fork-url", fork_url] if fork_url else []) + list(extra), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.rpc = lib.Rpc(self.url)
        for _ in range(100):
            try:
                self.rpc.chain_id()
                return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("anvil did not start")

    def stop(self):
        self.proc.terminate()
        self.proc.wait(timeout=10)


def make_wallets(base):
    """Throwaway keystores and password files under `base` (outside the repository)."""
    keys = {}
    for role in lib.ROLES:
        (base / "keystores").mkdir(parents=True, exist_ok=True)
        (base / "passwords").mkdir(parents=True, exist_ok=True)
        pw = base / "passwords" / f"{role}.pw"
        pw.write_text(PASSWORD)
        pw.chmod(0o600)
        r = lib.run([lib.tool("cast"), "wallet", "new", str(base / "keystores"), role, "--unsafe-password", PASSWORD])
        assert r.returncode == 0, r.stderr
        d = lib.run([lib.tool("cast"), "wallet", "decrypt-keystore", role, "--keystore-dir", str(base / "keystores"), "--unsafe-password", PASSWORD])
        keys[role] = [t for t in d.stdout.split() if t.startswith("0x") and len(t) == 66][0] if d.returncode == 0 else None
        (base / "keystores" / role).chmod(0o600)  # the documented step: cast creates keystores world-readable
    for p in (base, base / "keystores", base / "passwords"):
        p.chmod(0o700)
    return keys


def cli(url, base, *args, extra_env=None):
    env = {**os.environ, "SETTLANE_TESTNET_DIR": str(base)}
    env.pop(lib.CONFIRM_VAR, None)
    env.update(extra_env or {})
    r = subprocess.run([sys.executable, str(HERE / "testnet.py"), *args, "--rpc-url", url], capture_output=True, text=True, env=env)
    return r.returncode, r.stdout + r.stderr


def nonce_of(node, addr):
    return int(node.rpc.call("eth_getTransactionCount", addr, "latest"), 16)


def extra_checks(fork, fork_url, base, out_all):
    """Permissions, the pinned artifact, make_wallets.sh, and the failure and delay behavior."""
    import types
    # ---------------- permissions: every loosening is refused, nothing is fixed silently
    def variant(mutator):
        d = pathlib.Path(tempfile.mkdtemp(prefix="settlane-perm-"))
        shutil.copytree(base / "keystores", d / "keystores"); shutil.copytree(base / "passwords", d / "passwords")
        for p in (d, d / "keystores", d / "passwords"):
            p.chmod(0o700)
        for p in list((d / "keystores").iterdir()) + list((d / "passwords").iterdir()):
            p.chmod(0o600)
        mutator(d)
        try:
            lib.load_wallets(d)
            return None
        except lib.Abort as e:
            return str(e)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    check("owner-only wallets are accepted (control for the refusals below)", variant(lambda d: None) is None)
    for label, mut, needle in (
        ("a keystore readable by group or others (0644)", lambda d: (d / "keystores" / "client").chmod(0o644), "accessible to group or others"),
        ("a password file readable by group (0640)", lambda d: (d / "passwords" / "verifier.pw").chmod(0o640), "accessible to group or others"),
        ("a keystores directory open to others (0755)", lambda d: (d / "keystores").chmod(0o755), "accessible to group or others"),
        ("a passwords directory open to group (0750)", lambda d: (d / "passwords").chmod(0o750), "accessible to group or others"),
        ("the wallet directory itself open to others (0755)", lambda d: d.chmod(0o755), "accessible to group or others"),
        ("a keystore that is a symbolic link", lambda d: ((d / "keystores" / "provider").rename(d / "real"), (d / "keystores" / "provider").symlink_to(d / "real")), "symbolic link"),
    ):
        msg = variant(mut)
        check(f"{label} is refused", msg is not None and needle in msg, (msg or "ACCEPTED")[:90])

    # ---------------- the pinned artifact
    out, init, runtime, _ = lib.build_artifacts()
    facts = lib.artifact_facts(out, init, runtime)
    problems, _ = lib.check_artifact(facts)
    check("the production build equals the pinned artifact (hashes of init, runtime and ABI, Fe version)", not problems, "; ".join(problems)[:120] or facts["runtime_sha256"][:16] + "...")
    for key in ("runtime_sha256", "init_sha256", "abi_sha256", "fe"):
        bad = dict(facts, **{key: "tampered"})
        pr, _ = lib.check_artifact(bad)
        check(f"a different {key} is refused", any(key in x for x in pr))
    check("uncommitted production changes are refused", any("uncommitted" in x for x in lib.check_artifact(dict(facts, production_tree_dirty=True))[0]))
    # a deploy with a wrong pin sends nothing
    pin_backup = lib.PIN
    tmp_pin = pathlib.Path(tempfile.mkdtemp(prefix="settlane-pin-")) / "artifact.json"
    pin = json.loads(pin_backup.read_text()); pin["runtime_sha256"] = "0" * 64; tmp_pin.write_text(json.dumps(pin))

    # ---------------- make_wallets.sh through a pty (nothing real is created)
    mw = pathlib.Path(tempfile.mkdtemp(prefix="settlane-mw-"))
    pw = "correct-horse-battery-1"
    feeder = "(sleep 1.5; for i in 1 2 3; do printf '%s\\n' '" + pw + "'; printf '%s\\n' '" + pw + "'; done; sleep 6)"
    env = {**os.environ, "SETTLANE_TESTNET_DIR": str(mw / "w")}
    r = subprocess.run(["bash", "-c", feeder + f" | script -qec 'bash {HERE}/make_wallets.sh' {mw}/typescript"], capture_output=True, text=True, env=env, timeout=120)
    try:
        wl = lib.load_wallets(mw / "w")
        made = len({w_.address for w_ in wl.values()}) == 3
    except lib.Abort as e:
        made = False
    modes = {str(p.relative_to(mw)): oct(p.stat().st_mode & 0o777) for p in [mw / "w", mw / "w/keystores", mw / "w/passwords", *(mw / "w/keystores").glob("*"), *(mw / "w/passwords").glob("*")]} if (mw / "w").exists() else {}
    check("make_wallets.sh creates three different wallets that load and pass every permission check", made)
    check("every directory is 0700 and every keystore and password file is 0600", bool(modes) and all(v == ("0o700" if "." not in k.split("/")[-1] and k.split("/")[-1] in ("w", "keystores", "passwords") else "0o600") for k, v in modes.items()), str(sorted(set(modes.values()))))
    ts = (mw / "typescript").read_text(errors="ignore") if (mw / "typescript").exists() else ""
    check("the typed password is not echoed anywhere in the terminal session (echo stays off), and is not in any other output", pw not in ts and pw not in r.stdout + r.stderr)
    r2 = subprocess.run(["bash", "-c", "printf 'x\\n' | script -qec 'bash " + str(HERE) + "/make_wallets.sh' /dev/null"], capture_output=True, text=True, env=env, timeout=60)
    check("running it again refuses to overwrite the existing wallets", "refusing to overwrite" in r2.stdout)
    r3 = subprocess.run(["bash", str(HERE / "make_wallets.sh")], capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL, timeout=30)
    check("it refuses to run without a terminal", "no terminal" in r3.stderr)
    shutil.rmtree(mw, ignore_errors=True)

    # ---------------- a transaction mined with status 0 stops the workflow
    class FailRpc(lib.Rpc):
        def call(self, method, *params):
            if method == "eth_getTransactionReceipt":
                return {"status": "0x0", "gasUsed": "0x5208", "blockNumber": "0x1"}
            return super().call(method, *params)
    node = Anvil(lib.SEPOLIA, fork, fork_url)
    try:
        w = lib.load_wallets(base)
        node.rpc.call("anvil_setBalance", w["client"].address, hex(10**17))
        real_run, real_est = lib.run, lib.estimate_gas
        try:
            lib.run = lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, "0x" + "ab" * 32 + "\n", "") if "send" in cmd else real_run(cmd, **kw)
            lib.estimate_gas = lambda *a_, **k_: 21000
            try:
                lib.send(FailRpc(node.url), w["client"], "0x00000000000000000000000000000000000abc77", None, 1, 100_000, broadcast=True)
                msg = "NO ABORT"
            except lib.Abort as e:
                msg = str(e)
        finally:
            lib.run, lib.estimate_gas = real_run, real_est
        check("a transaction mined with status 0 aborts the workflow", "status 0" in msg and "stopped" in msg, msg[:90])
    finally:
        node.stop()

    # ---------------- a run that stops midway, and a delayed transaction (node B, its own state)
    base2 = pathlib.Path(tempfile.mkdtemp(prefix="settlane-b-"))
    shutil.copytree(base / "keystores", base2 / "keystores"); shutil.copytree(base / "passwords", base2 / "passwords")
    for p in (base2, base2 / "keystores", base2 / "passwords"):
        p.chmod(0o700)
    nodeb = Anvil(lib.SEPOLIA, fork, fork_url)
    old_dir = lib.STATE_DIR
    lib.STATE_DIR = base2
    try:
        w2 = lib.load_wallets(base2)
        nodeb.rpc.call("anvil_setBalance", w2["client"].address, hex(10**17))
        n0 = int(nodeb.rpc.call("eth_getTransactionCount", w2["client"].address, "latest"), 16)
        rc, out = cli(nodeb.url, base2, "fund", "--broadcast", "--fund-wei", str(5 * 10**15)); out_all.append(out)
        check("node B: `fund` succeeds", rc == 0)
        # a build that is not the pinned artifact is never deployed
        import contextlib, io
        ns0 = types.SimpleNamespace(rpc_url=nodeb.url, broadcast=True, address=None, amount_wei=10**15, fund_wei=4 * 10**15, a1_window=900, a2_window=180, with_submitted_refund=False, rehearsal_warp=True, abandon_previous=False, receipt_timeout=60, tip_wei=lib.TIP_WEI)
        nb = nonce_of(nodeb, w2["client"].address)
        lib.PIN = tmp_pin
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                testnet.cmd_deploy(ns0)
            msg = "NO ABORT"
        except lib.Abort as e:
            msg = str(e)
        finally:
            lib.PIN = pin_backup
        check("a build that differs from the pinned artifact is NOT deployed (the preflight and the deploy both refuse)", "FAIL  the production build equals the pinned artifact" in buf.getvalue() and "nothing was deployed" in msg and nonce_of(nodeb, w2["client"].address) == nb, msg[:80])
        rc, out = cli(nodeb.url, base2, "deploy", "--broadcast"); out_all.append(out)
        check("node B: `deploy` of the pinned artifact succeeds", rc == 0)
        n0 = nonce_of(nodeb, w2["client"].address)
        rc, out = cli(nodeb.url, base2, "run", "--broadcast", "--a1-window", "0", "--rehearsal-warp")
        out_all.append(out)
        check("a step that would revert is refused BEFORE anything is sent (simulated first), and leaves no run record", rc == 2 and "would revert" in out and "deliver_by not in the future" in out and nonce_of(nodeb, w2["client"].address) == n0 and "progress" not in json.loads((base2 / f"state-{lib.SEPOLIA}.json").read_text() if (base2 / f"state-{lib.SEPOLIA}.json").exists() else "{}"), out.strip().splitlines()[-1][:100])
        # failure after the first transaction of A1
        real_tsend, calls = testnet.tsend, []
        def flaky(*a_, **k_):
            calls.append(1)
            if len(calls) == 2:
                raise lib.Abort("simulated failure of step 2 (a node error)")
            return real_tsend(*a_, **k_)
        testnet.tsend = flaky
        try:
            ns = types.SimpleNamespace(rpc_url=nodeb.url, broadcast=True, address=None, amount_wei=10**15, fund_wei=4 * 10**15, a1_window=900, a2_window=180, with_submitted_refund=False, rehearsal_warp=True, abandon_previous=False, receipt_timeout=60, tip_wei=lib.TIP_WEI)
            try:
                testnet.cmd_run(ns); msg = "NO ABORT"
            except lib.Abort as e:
                msg = str(e)
        finally:
            testnet.tsend = real_tsend
        st = json.loads((base2 / f"state-{lib.SEPOLIA}.json").read_text())
        check("a failure after the first transaction stops the run and records exactly what was done", "simulated failure" in msg and len(st["progress"]["steps"]) == 1 and st["progress"]["complete"] is False, f"{len(st['progress']['steps'])} step recorded")
        n1 = nonce_of(nodeb, w2["client"].address)
        rc, out = cli(nodeb.url, base2, "run", "--broadcast", "--rehearsal-warp"); out_all.append(out)
        check("the next run REFUSES to start (it would create duplicate agreements) and sends nothing", rc == 2 and "previous run stopped" in out and nonce_of(nodeb, w2["client"].address) == n1, out.strip().splitlines()[-1][:110])
        rc, out = cli(nodeb.url, base2, "run", "--broadcast", "--rehearsal-warp", "--abandon-previous"); out_all.append(out)
        check("--abandon-previous starts a new, complete run", rc == 0 and "0 failed" in out)
        # delayed transaction: the node stops mining
        nodeb.rpc.call("evm_setAutomine", False)
        rc, out = cli(nodeb.url, base2, "fund", "--broadcast", "--receipt-timeout", "4"); out_all.append(out)
        st = json.loads((base2 / f"state-{lib.SEPOLIA}.json").read_text())
        check("a transaction without a receipt in time stops the workflow, names the hash and says not to resend", rc == 2 and "do NOT resend" in out and len(st.get("pending", [])) == 1, out.strip().splitlines()[-1][:100])
        rc, out = cli(nodeb.url, base2, "fund", "--broadcast"); out_all.append(out)
        check("while it is pending, no new transaction can be sent", rc == 2 and "no receipt yet" in out)
        rc, out = cli(nodeb.url, base2, "resolve-pending"); out_all.append(out)
        check("resolve-pending reports it as still pending and keeps refusing", rc == 1 and "STILL PENDING" in out)
        nodeb.rpc.call("evm_mine")
        rc, out = cli(nodeb.url, base2, "resolve-pending"); out_all.append(out)
        st = json.loads((base2 / f"state-{lib.SEPOLIA}.json").read_text())
        check("once mined, resolve-pending clears it and the workflow may continue", rc == 0 and not st.get("pending") and "resolved" in out)
        nodeb.rpc.call("evm_setAutomine", True)
        # the spending budget: a send whose worst case would break it is refused before anything is signed
        nb2 = nonce_of(nodeb, w2["client"].address)
        rc, out = cli(nodeb.url, base2, "fund", "--broadcast", "--budget-wei", "1000"); out_all.append(out)
        check("a send that would exceed the spending budget is refused before it is signed, and nothing is sent", rc == 2 and "budget" in out and nonce_of(nodeb, w2["client"].address) == nb2, out.strip().splitlines()[-1][:110])
        st = json.loads((base2 / f"state-{lib.SEPOLIA}.json").read_text())
        check("the budget's starting point (the three wallets' combined balance) is recorded in the state", st.get("budget_start_total_wei", 0) > 0, str(st.get("budget_start_total_wei")))
    finally:
        lib.STATE_DIR = old_dir
        nodeb.stop()
        shutil.rmtree(base2, ignore_errors=True)


def budget_and_step_checks(fork, fork_url, base, out_all):
    """The spending budget (internal transfers, refundable deposits, unexpected inflows) and the one-transaction step mode."""
    import types, shutil as sh
    d = pathlib.Path(tempfile.mkdtemp(prefix="settlane-bud-"))
    sh.copytree(base / "keystores", d / "keystores"); sh.copytree(base / "passwords", d / "passwords")
    for p in (d, d / "keystores", d / "passwords"):
        p.chmod(0o700)
    old_dir, old_budget = lib.STATE_DIR, dict(testnet.BUDGET)
    lib.STATE_DIR = d
    try:
        w = lib.load_wallets(d)
        c, p_, v = w["client"].address, w["provider"].address, w["verifier"].address
        CONTRACT = "0x00000000000000000000000000000000000c0de1"
        # ---- 1. the accounting rules, with scripted balances (nothing on any chain)
        class Bal(lib.Rpc):
            def __init__(self):
                self.url = "http://127.0.0.1:0"
                self.b = {c: 10**18, p_: 0, v: 0}
            def balance(self, a):
                return self.b[a.lower()]
        rpc = Bal()
        testnet.BUDGET["wei"] = 3_500_000_000_000_000  # 0.0035 ETH
        FEE = 10**12  # a transaction's fee in these scripted steps
        def attempt(reserve_extra):
            try:
                testnet.enforce_budget(rpc, FEE + reserve_extra); return None
            except lib.Abort as e:
                return str(e)
        check("a transfer to one of our own wallets is not exposure (its value is not reserved)", testnet.at_risk_value(p_, 4 * 10**15) == 0 and testnet.at_risk_value(CONTRACT, 10**15) == 10**15 and testnet.at_risk_value(None, 0) == 0)
        check("the first send records the baseline and a fee alone passes", attempt(0) is None and testnet.load_state(lib.SEPOLIA)["budget_start_total_wei"] == 10**18)
        rpc.b[c] -= 4 * 10**15 + FEE; rpc.b[p_] += 4 * 10**15            # fund provider: only the fee leaves
        check("after an internal transfer only its fee counts as spent (the 0.004 ETH moved between our wallets is not)", attempt(testnet.at_risk_value(v, 4 * 10**15)) is None and 10**18 - sum(rpc.b.values()) == FEE)
        rpc.b[c] -= 4 * 10**15 + FEE; rpc.b[v] += 4 * 10**15            # fund verifier
        check("a second internal transfer is allowed even though 2 x 0.004 ETH exceeds the 0.0035 ETH budget", attempt(0) is None and 10**18 - sum(rpc.b.values()) == 2 * FEE)
        rpc.b[c] -= 10**15 + FEE                                         # create #1: deposit 0.001 locked in the contract
        check("a deposit counts as spent while it is locked (3 x 0.001 ETH fit in 0.0035 ETH, the 4th would not)", attempt(10**15) is None)
        rpc.b[c] -= 10**15 + FEE
        check("a second deposit still fits", attempt(10**15) is None)
        rpc.b[c] -= 10**15 + FEE
        msg = attempt(10**15)
        check("the fourth deposit is refused: locked deposits are exposure", msg is not None and "budget" in msg and "exceeded" in msg, (msg or "ACCEPTED")[:70])
        rpc.b[p_] += 10**15                                              # claim: the deposit comes back to a wallet of ours
        rpc.b[c] += 10**15                                               # refund: the deposit comes back to the client
        check("once a claim and a refund bring deposits back to our wallets, they stop counting and the next deposit is allowed", attempt(10**15) is None)
        rpc.b[c] += 5 * 10**17                                           # an unexpected deposit (e.g. a faucet drip)
        msg = attempt(0)
        check("an unexpected increase of the combined balance stops the workflow (the baseline would hide losses)", msg is not None and "MORE than at the start" in msg, (msg or "ACCEPTED")[:70])
    finally:
        lib.STATE_DIR = old_dir
        testnet.BUDGET.update(old_budget)
        sh.rmtree(d, ignore_errors=True)

    # ---- 2. step mode end to end, with a budget that internal-transfer or deposit mis-counting would break
    base3 = pathlib.Path(tempfile.mkdtemp(prefix="settlane-step-"))
    sh.copytree(base / "keystores", base3 / "keystores"); sh.copytree(base / "passwords", base3 / "passwords")
    for p in (base3, base3 / "keystores", base3 / "passwords"):
        p.chmod(0o700)
    node = Anvil(lib.SEPOLIA, fork, fork_url, extra=("--base-fee", "16"))
    try:
        w3 = lib.load_wallets(base3)
        node.rpc.call("anvil_setBalance", w3["client"].address, hex(10**18))
        BUD = ["--budget-wei", str(3_500_000_000_000_000)]
        def step(*extra):
            rc, out = cli(node.url, base3, "step", *extra, *BUD); out_all.append(out); return rc, out
        n0 = nonce_of(node, w3["client"].address)
        rc, out = step()
        check("`step` without --broadcast only describes the next transaction (recipient, value, gas, worst case) and sends nothing", rc == 0 and "dry run" in out and "fund-provider" in out and nonce_of(node, w3["client"].address) == n0)
        rc, out = cli(node.url, base3, "step", "--broadcast", "--budget-wei", "1000"); out_all.append(out)
        check("`step --broadcast` with a budget too small for its worst case is refused before signing", rc == 2 and "budget" in out and nonce_of(node, w3["client"].address) == n0, out.strip().splitlines()[-1][:90])
        names = []
        for i in range(8):                                                # everything up to the second create
            rc, out = step("--broadcast")
            names.append((rc, out.count("STOPPED")))
            if rc != 0:
                print(out)
                break
        check("eight single steps (2 internal transfers, deploy, A1 create/submit/approve/claim, A2 create) each run exactly one transaction and stop", all(r == 0 and n == 1 for r, n in names) and len(names) == 8, str(names))
        st = json.loads((base3 / f"state-{lib.SEPOLIA}.json").read_text())
        check("each step was recorded with its hash, block and gas used", [x["name"] for x in st["steps_done"]] == testnet.STEPS[:8] and all(len(x["tx"]) == 66 for x in st["steps_done"]))
        n1 = nonce_of(node, w3["client"].address)
        rc, out = step("--broadcast")
        check("the refund step does NOT send before the Funded deadline: it reports the time left and the simulated revert", rc == 0 and "before the Funded deadline" in out and "milestone has not expired" in out and nonce_of(node, w3["client"].address) == n1, out.strip().splitlines()[-1][:100])
        node.rpc.call("evm_setNextBlockTimestamp", st["a2_deliver_by"] + 1); node.rpc.call("evm_mine")
        rc, out = step("--broadcast")
        check("after the chain's clock passes the deadline the refund step sends one transaction and verifies the payout", rc == 0 and "0 step(s) remain" in out and "gas used" in out, out.strip().splitlines()[-1][:110])
        st = json.loads((base3 / f"state-{lib.SEPOLIA}.json").read_text())
        total = sum(node.rpc.balance(x.address) for x in w3.values())
        check("the nine steps complete within the 0.0035 ETH budget; only fees (under 0.0002 ETH) were lost (internal transfers and returned deposits cost nothing)", len(st["steps_done"]) == 9 and 0 < 10**18 - total < 2 * 10**14, f"lost {(10**18 - total) / 1e18:.9f} ETH")
        rc, out = cli(node.url, base3, "verify"); out_all.append(out)
        check("the read-only verification passes after the step-by-step run", rc == 0 and " 0 failed" in out)
        rc, out = cli(node.url, base3, "run", "--broadcast"); out_all.append(out)
        check("`run` refuses once step mode is in use (the two are not mixed)", rc == 2 and "step` mode is in use" in out)
    finally:
        node.stop()
        sh.rmtree(base3, ignore_errors=True)


def main():
    git_before = lib.run(["git", "status", "--porcelain"], cwd=lib.REPO).stdout
    base = pathlib.Path(tempfile.mkdtemp(prefix="settlane-rehearsal-"))
    fork = sys.argv[sys.argv.index("--hardfork") + 1] if "--hardfork" in sys.argv else None
    print(f"EVM hardfork of the rehearsal node: {fork or 'anvil default (latest)'}", flush=True)
    fork_url = sys.argv[sys.argv.index("--fork-url") + 1] if "--fork-url" in sys.argv else None
    if fork_url:
        print("the rehearsal node FORKS Sepolia read-only (state, fees and chain parameters come from the real chain; every transaction stays local)", flush=True)
    sep, other = Anvil(lib.SEPOLIA, fork, fork_url), Anvil(31337)
    out_all = []
    try:
        check("the rehearsal node reports chain id 11155111", sep.rpc.chain_id() == lib.SEPOLIA)
        keys = make_wallets(base)
        check("three throwaway keystores were created outside the repository", all(keys.values()) and not lib.inside_repo(base), str(base))
        w = lib.load_wallets(base)
        sep.rpc.call("anvil_setBalance", w["client"].address, hex(100 * 10**15))  # 0.1 ETH; provider and verifier start empty
        url = sep.url

        def nonce(addr, rpc=sep.rpc):
            return int(rpc.call("eth_getTransactionCount", addr, "latest"), 16)

        # ---- guards: each must refuse and send nothing
        n0 = nonce(w["client"].address)
        rc, out = cli(url, base, "deploy")
        out_all.append(out)
        check("deploy without --broadcast refuses and sends nothing", rc == 2 and "--broadcast" in out and nonce(w["client"].address) == n0, out.strip().splitlines()[-1][:110])
        rc, out = cli(other.url, base, "deploy", "--broadcast")
        out_all.append(out)
        check("a node that is not chain 11155111 (here 31337) is refused", rc == 2 and "31337" in out and nonce(w["client"].address, other.rpc) == 0, out.strip().splitlines()[-1][:110])
        # a remote node without the confirmation variable (the chain-id lookup is stubbed, nothing is sent anywhere)
        class Stub(lib.Rpc):
            def chain_id(self):
                return lib.SEPOLIA
        os.environ.pop(lib.CONFIRM_VAR, None)
        try:
            lib.require_send_allowed(Stub("https://sepolia.example.invalid"), True)
            refused = False
        except lib.Abort as e:
            refused = lib.CONFIRM_VAR in str(e)
        os.environ[lib.CONFIRM_VAR] = lib.CONFIRM_VALUE
        try:
            lib.require_send_allowed(Stub("https://sepolia.example.invalid"), True)
            allowed = True
        except lib.Abort:
            allowed = False
        os.environ.pop(lib.CONFIRM_VAR, None)
        check("a remote node needs the confirmation variable, and only then is it allowed", refused and allowed)
        rc, out = cli(url, base, "run", "--broadcast", "--amount-wei", str(10**16))
        out_all.append(out)
        check("an amount above the cap is refused", rc == 2 and "--amount-wei" in out, out.strip().splitlines()[-1][:100])
        # secrets inside the repository
        tmp_in_repo = lib.REPO / "experiments" / "sepolia" / ".guard-test"
        tmp_in_repo.mkdir(exist_ok=True)
        try:
            ks, pw = tmp_in_repo / "client", tmp_in_repo / "client.pw"
            ks.write_text("{}"); pw.write_text("x"); pw.chmod(0o600)
            try:
                lib.check_secret_paths(ks, pw, "client"); r1 = False
            except lib.Abort as e:
                r1 = "inside the repository" in str(e)
            check("a keystore or password file inside the repository is refused", r1)
            leak = tmp_in_repo / "leak.txt"
            leak.write_text("private" + "_key = 0x" + "ab" * 32 + "\n")
            check("key material left in the repository is detected by the preflight scan", "experiments/sepolia/.guard-test/leak.txt" in testnet.scan_repo_for_secrets())
        finally:
            shutil.rmtree(tmp_in_repo, ignore_errors=True)
        check("the repository scan is clean when nothing was left behind", testnet.scan_repo_for_secrets() == [])
        pwf = base / "passwords" / "client.pw"
        pwf.chmod(0o644)
        try:
            lib.check_secret_paths(base / "keystores" / "client", pwf, "client"); r2 = False
        except lib.Abort as e:
            r2 = "accessible to group or others" in str(e)
        pwf.chmod(0o600)
        check("a world-readable password file is refused", r2)
        dup = pathlib.Path(tempfile.mkdtemp(prefix="settlane-dup-"))
        try:
            shutil.copytree(base / "keystores", dup / "keystores"); shutil.copytree(base / "passwords", dup / "passwords")
            shutil.copy(dup / "keystores" / "client", dup / "keystores" / "provider")
            try:
                lib.load_wallets(dup); r3 = False
            except lib.Abort as e:
                r3 = "three different addresses" in str(e)
        finally:
            shutil.rmtree(dup, ignore_errors=True)
        check("two roles sharing one address are refused (D-011)", r3)
        check("nothing was sent by any refused command", nonce(w["client"].address) == n0)

        # ---- the happy path
        rc, out = cli(url, base, "preflight")
        out_all.append(out)
        check("preflight fails before provider and verifier are funded", rc == 1 and "FAIL" in out)
        for step in (["fund", "--broadcast", "--fund-wei", str(5 * 10**15)], ["deploy", "--broadcast"]):
            rc, out = cli(url, base, *step)
            out_all.append(out)
            check(f"`{step[0]} --broadcast` succeeds", rc == 0, out.strip().splitlines()[-1][:110])
            if rc != 0:
                print("\n".join("      | " + l for l in out.splitlines()), flush=True)
        rc, out = cli(url, base, "run", "--broadcast", "--rehearsal-warp", "--with-submitted-refund")
        out_all.append(out)
        print("\n".join("      | " + l for l in out.splitlines()), flush=True)
        check("`run --broadcast --with-submitted-refund` succeeds, including the final read-only verification", rc == 0 and "verify_deployment:" in out and " 0 failed" in out, out.strip().splitlines()[-1][:110])
        st = json.loads((base / f"state-{lib.SEPOLIA}.json").read_text())
        rc, out = cli(url, base, "verify")
        out_all.append(out)
        check("`verify` on its own passes (read-only, no key needed)", rc == 0 and " 0 failed" in out)
        # ---- verification must be able to FAIL
        fake = "0x00000000000000000000000000000000000fA4E5"
        sep.rpc.call("anvil_setCode", fake, "0x6001600055")
        rc, out = cli(url, base, "verify", "--address", fake)
        out_all.append(out)
        check("verification FAILS on a contract with other code", rc == 1 and "FAIL  the deployed runtime code equals" in out)
        extra_checks(fork, fork_url, base, out_all)
        budget_and_step_checks(fork, fork_url, base, out_all)
        # ---- hygiene
        blob = "\n".join(out_all)
        check("no private key and no password appears in any output", not any(k and k[2:] in blob.lower() for k in keys.values()) and PASSWORD not in blob)
        check("no file was created or changed in the repository", lib.run(["git", "status", "--porcelain"], cwd=lib.REPO).stdout == git_before)
        print(f"\nmeasured gas (rehearsal): deploy {st.get('gas_used_deploy')}, " + ", ".join(f"{k.split()[0]}={v}" for k, v in st.get("gas_used", {}).items()))
    finally:
        sep.stop(); other.stop()
        shutil.rmtree(base, ignore_errors=True)
    failed = results.count(False)
    print(f"\nrehearsal: {len(results) - failed} ok, {failed} failed ({len(results)} checks); nothing was sent to Sepolia")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())

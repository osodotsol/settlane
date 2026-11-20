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
    def __init__(self, chain_id, hardfork=None, fork_url=None):
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.proc = subprocess.Popen([lib.tool("anvil"), "--host", "127.0.0.1", "--port", str(self.port), "--chain-id", str(chain_id), "--silent"] + (["--hardfork", hardfork] if hardfork else []) + (["--fork-url", fork_url] if fork_url else []), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    return keys


def cli(url, base, *args, extra_env=None):
    env = {**os.environ, "SETTLANE_TESTNET_DIR": str(base)}
    env.pop(lib.CONFIRM_VAR, None)
    env.update(extra_env or {})
    r = subprocess.run([sys.executable, str(HERE / "testnet.py"), *args, "--rpc-url", url], capture_output=True, text=True, env=env)
    return r.returncode, r.stdout + r.stderr


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
            r2 = "readable by others" in str(e)
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

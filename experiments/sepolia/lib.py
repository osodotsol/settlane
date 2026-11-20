"""Shared helpers for the Sepolia preparation (read docs/TESTNET.md).

Safety design, enforced here and exercised by `rehearse.py`:
  * the chain id is read from the node and must be 11155111 before anything else happens;
  * a transaction is signed ONLY from an encrypted keystore + a password FILE that live OUTSIDE the
    repository (`cast --keystore --password-file`); there is no code path that accepts a raw private
    key, a mnemonic, a `--password` on the command line or a key in the environment;
  * sending needs `--broadcast`; to a non-loopback node it also needs the confirmation variable;
  * amounts and gas prices are capped; the secrets are never printed (only addresses and hashes).
Nothing here changes a contract.
"""
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

SEPOLIA = 11155111
REPO = pathlib.Path(__file__).resolve().parents[2]
STATE_DIR = pathlib.Path(os.environ.get("SETTLANE_TESTNET_DIR", str(pathlib.Path.home() / ".settlane-sepolia")))
EXTRA_BIN = pathlib.Path.home() / "tools" / "foundry" / "bin"
CONFIRM_VAR, CONFIRM_VALUE = "SETTLANE_TESTNET_CONFIRM", "sepolia-test-eth-only"
ETH = 10**18
MAX_AGREEMENT_WEI = 5 * 10**15  # 0.005 ETH: the most one test agreement may hold
MAX_GAS_PRICE_GWEI = 60
ROLES = ("client", "provider", "verifier")


class Abort(Exception):
    """A guard refused: nothing was sent."""


class RpcError(Exception):
    def __init__(self, method, error):
        super().__init__(f"{method}: {error}")
        self.error = error


def tool(name):
    found = shutil.which(name) or (str(EXTRA_BIN / name) if (EXTRA_BIN / name).exists() else None)
    if not found:
        raise Abort(f"missing tool: {name} (bash experiments/anvil/install_foundry.sh installs the pinned anvil and cast)")
    return found


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def is_loopback(url):
    return (urllib.parse.urlparse(url).hostname or "") in ("127.0.0.1", "localhost", "::1")


class Rpc:
    def __init__(self, url):
        self.url = url

    def call(self, method, *params):
        req = urllib.request.Request(self.url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": list(params)}).encode(), {"Content-Type": "application/json", "User-Agent": "settlane-testnet-prep"})
        r = json.load(urllib.request.urlopen(req, timeout=60))
        if "error" in r:
            raise RpcError(method, r["error"])
        return r["result"]

    def chain_id(self):
        return int(self.call("eth_chainId"), 16)

    def ts(self, number="latest"):
        return int(self.call("eth_getBlockByNumber", number, False)["timestamp"], 16)

    def balance(self, a):
        return int(self.call("eth_getBalance", a, "latest"), 16)

    def gas_price_gwei(self):
        return int(self.call("eth_gasPrice"), 16) / 10**9


def require_chain(rpc, expected=SEPOLIA):
    cid = rpc.chain_id()
    if cid != expected:
        raise Abort(f"the node reports chain id {cid}, not {expected} (Ethereum Sepolia): refusing to continue")
    return cid


def require_send_allowed(rpc, broadcast):
    """The gate in front of every transaction."""
    if not broadcast:
        raise Abort("this would send a transaction: pass --broadcast (nothing was sent)")
    require_chain(rpc)
    if not is_loopback(rpc.url) and os.environ.get(CONFIRM_VAR) != CONFIRM_VALUE:
        raise Abort(f"a non-local node needs {CONFIRM_VAR}={CONFIRM_VALUE} in the environment: it is your explicit confirmation that only Sepolia TEST ETH is used (nothing was sent)")


def inside_repo(path):
    p = pathlib.Path(path).resolve()
    return REPO == p or REPO in p.parents


def words(h):
    h = h[2:]
    return [int(h[i : i + 64], 16) for i in range(0, len(h), 64)]


def addr_word(w):
    return "0x" + w[-40:].lower()


def decode_revert(data_or_msg):
    """`Error(string)` text from revert data (0x08c379a0...) or from a node's message."""
    s = data_or_msg or ""
    if s.startswith("0x08c379a0") and len(s) >= 2 + 8 + 128:
        n = int(s[10 + 64 : 10 + 128], 16)
        return bytes.fromhex(s[10 + 128 : 10 + 128 + 2 * n]).decode(errors="replace")
    m = re.search(r"execution reverted:?\s*(.*)", s)
    return m.group(1).strip() if m and m.group(1).strip() else (s or "(empty)")


def revert_reason(err):
    e = err.error if isinstance(err, RpcError) else {}
    data = e.get("data") if isinstance(e, dict) else None
    if isinstance(data, dict):
        data = data.get("data")
    return decode_revert(data if isinstance(data, str) and data.startswith("0x08c379a0") else (e.get("message") if isinstance(e, dict) else str(err)))


_keccak = {}


def keccak(text):
    if text not in _keccak:
        _keccak[text] = run([tool("cast"), "keccak", text]).stdout.strip()
    return _keccak[text]


def calldata(sig, *args):
    r = run([tool("cast"), "calldata", sig, *map(str, args)])
    if r.returncode:
        raise Abort(f"cast calldata failed: {r.stderr.strip()}")
    return r.stdout.strip()


def build_artifacts(out_dir=None):
    """Build the PRODUCTION ingot with Fe 26.6.0 into a temp directory; returns (dir, init, runtime, abi)."""
    ver = run(["fe", "--version"]).stdout.strip()
    if not ver.startswith("fe 26.6.0"):
        raise Abort(f"Fe 26.6.0 is required, found: {ver or 'no fe'}")
    out = pathlib.Path(out_dir or tempfile.mkdtemp(prefix="settlane-art-"))
    b = run(["fe", "build", "--out-dir", str(out)], cwd=REPO)
    if b.returncode:
        raise Abort("fe build failed: " + (b.stdout + b.stderr).strip()[-300:])
    names = sorted(p.name for p in out.iterdir())
    if names != ["Settlane.abi.json", "Settlane.bin", "Settlane.runtime.bin"]:
        raise Abort(f"the build output is not exactly the production artifacts: {names}")
    return out, (out / "Settlane.bin").read_text().strip(), (out / "Settlane.runtime.bin").read_text().strip(), json.loads((out / "Settlane.abi.json").read_text())


def sha256_hex(h):
    import hashlib
    return hashlib.sha256(bytes.fromhex(h[2:] if h.startswith("0x") else h)).hexdigest()


# ------------------------------------------------------------------ wallets
class Wallet:
    def __init__(self, role, keystore, password_file):
        self.role, self.keystore, self.password_file = role, pathlib.Path(keystore), pathlib.Path(password_file)
        r = run([tool("cast"), "wallet", "address", "--keystore", str(self.keystore), "--password-file", str(self.password_file)])
        if r.returncode:
            raise Abort(f"cannot open the {role} keystore (wrong password file?)")
        self.address = r.stdout.strip().lower()


def _perm_problem(path, kind, want_dir=False):
    """Why `path` is not owner-only, or None. Applies to the keystore and password files and their directories."""
    p = pathlib.Path(path)
    if p.is_symlink():
        return f"{kind} {p} is a symbolic link: use the real file (a link can point into the repository or elsewhere)"
    st = p.stat()
    if st.st_uid != os.getuid():
        return f"{kind} {p} is owned by another user (uid {st.st_uid})"
    if want_dir and not stat.S_ISDIR(st.st_mode):
        return f"{kind} {p} is not a directory"
    mode = stat.S_IMODE(st.st_mode)
    if mode & 0o077:
        return f"{kind} {p} is accessible to group or others (mode {oct(mode)}): chmod {'700' if want_dir else '600'} {p}"
    return None


def check_secret_paths(keystore, password_file, role):
    """Everything that holds or protects a key must be OUTSIDE the repository and owner-only (0600 files,
    0700 directories, no symlinks, owned by the current user). Refuses otherwise: it never fixes silently."""
    for what, p in (("keystore", keystore), ("password file", password_file)):
        p = pathlib.Path(p)
        if not p.exists() and not p.is_symlink():
            raise Abort(f"the {role} {what} does not exist: {p}")
        if inside_repo(p):
            raise Abort(f"the {role} {what} is inside the repository ({p}): move it out; secrets never live in the checkout")
        bad = _perm_problem(p, f"the {role} {what}")
        if bad:
            raise Abort(bad)
        if p.parent.exists():
            bad = _perm_problem(p.parent, f"the directory of the {role} {what}", want_dir=True)
            if bad:
                raise Abort(bad)


def load_wallets(directory=None):
    d = pathlib.Path(directory or STATE_DIR)
    if d.exists():
        bad = _perm_problem(d, "the wallet directory", want_dir=True)
        if bad:
            raise Abort(bad)
    ws = {}
    for role in ROLES:
        ks, pw = d / "keystores" / role, d / "passwords" / f"{role}.pw"
        check_secret_paths(ks, pw, role)
        ws[role] = Wallet(role, ks, pw)
    if len({w.address for w in ws.values()}) != 3:
        raise Abort("client, provider and verifier must be three different addresses (D-011)")
    return ws


TIP_WEI = 10_000_000  # priority fee we offer: 0.01 gwei. Sepolia blocks are about a third full, so a small tip is included; the wallet's default would be taken from recent tips (about 1 gwei)


def fees(rpc):
    """The fee we will pay per gas: base fee now, our fixed tip, and max fee = 2 x base + tip (we set them explicitly)."""
    base = int(rpc.call("eth_getBlockByNumber", "latest", False).get("baseFeePerGas", "0x0"), 16)
    return {"base": base, "tip": TIP_WEI, "max_fee": 2 * base + TIP_WEI, "gas_price": int(rpc.call("eth_gasPrice"), 16)}


def estimate_gas(rpc, wallet, to, data, value=0, create=False):
    tx = {"from": wallet.address, "data": data if data else "0x", "value": hex(value)}
    if not create:
        tx["to"] = to
    try:
        return int(rpc.call("eth_estimateGas", tx), 16)
    except RpcError as e:
        raise Abort(f"the transaction would revert ({revert_reason(e)}); nothing was sent")


class Pending(Abort):
    """A transaction was submitted but no receipt arrived in time. It may still be mined: do NOT resend."""


RECEIPT_TIMEOUT_S = 600


def send(rpc, wallet, to, data, value=0, gas_cap=1_500_000, create=False, broadcast=False, on_submit=None, on_done=None):
    """Sign with the keystore and send one transaction; returns the receipt. Guards first.

    The gas limit is the node's estimate plus 30%, never above `gas_cap`; the fee is explicit (see `fees`).
    The transaction is submitted with `--async` and the receipt is polled here with our own timeout:
      * mined with status 0 -> Abort (a failed send must never look like a success);
      * no receipt within RECEIPT_TIMEOUT_S -> Pending (names the hash; the caller records it and the
        workflow stops: it must never resend a transaction that may still be mined)."""
    require_send_allowed(rpc, broadcast)
    if value > MAX_AGREEMENT_WEI:
        raise Abort(f"value {value} wei exceeds the {MAX_AGREEMENT_WEI} wei cap per transaction")
    fee = fees(rpc)
    if fee["max_fee"] / 1e9 > MAX_GAS_PRICE_GWEI:
        raise Abort(f"max fee {fee['max_fee'] / 1e9:.3f} gwei exceeds the {MAX_GAS_PRICE_GWEI} gwei cap: wait")
    est = estimate_gas(rpc, wallet, to, data, value, create)
    limit = int(est * 1.3) + 1000
    if limit > gas_cap:
        raise Abort(f"the gas estimate {est} (limit {limit}) exceeds the cap {gas_cap}; nothing was sent")
    cmd = [tool("cast"), "send", "--async", "--keystore", str(wallet.keystore), "--password-file", str(wallet.password_file), "--rpc-url", rpc.url, "--gas-limit", str(limit), "--gas-price", str(fee["max_fee"]), "--priority-gas-price", str(fee["tip"]), "--value", str(value)]
    cmd += ["--create", data] if create else ([to, data] if data else [to])
    r = run(cmd)
    if r.returncode:
        # the message may echo arguments but never the key: the password is in a file, not in argv
        raise Abort("cast send failed: " + (r.stderr.strip() or r.stdout.strip())[-400:])
    h = r.stdout.strip().split()[-1]
    if not re.fullmatch(r"0x[0-9a-fA-F]{64}", h):
        raise Abort("cast send returned something that is not a transaction hash: " + r.stdout.strip()[:120])
    if on_submit:
        on_submit(h)
    deadline = time.time() + RECEIPT_TIMEOUT_S
    while time.time() < deadline:
        rc = rpc.call("eth_getTransactionReceipt", h)
        if rc:
            rc["_hash"], rc["_estimate"], rc["_limit"] = h, est, limit
            if on_done:
                on_done(h)
            if rc.get("status") != "0x1":
                raise Abort(f"transaction {h} was mined with status 0 (gas used {int(rc['gasUsed'], 16)} of {limit}); the workflow stopped")
            return rc
        time.sleep(min(2, max(deadline - time.time(), 0.05)))
    raise Pending(f"transaction {h} has no receipt after {RECEIPT_TIMEOUT_S} s. It may still be mined: do NOT resend. Check it, then run `resolve-pending`")


def wait_until(rpc, target_ts, warp=False, log=print):
    """Wait until the latest block's timestamp is >= target_ts (chain time, not wall clock)."""
    start = time.time()
    while rpc.ts() < target_ts:
        if warp and is_loopback(rpc.url):
            rpc.call("evm_setNextBlockTimestamp", target_ts)
            rpc.call("evm_mine")
            continue
        if time.time() - start > (target_ts - rpc.ts()) + 600:
            raise Abort("waiting for the chain's clock took far longer than expected")
        time.sleep(6)
    log(f"      chain time {rpc.ts()} >= {target_ts}")


# ------------------------------------------------------------------ pinned artifact
PIN = pathlib.Path(__file__).resolve().parent / "artifact.json"


def artifact_facts(out, init, runtime):
    """What identifies the production build: the hashes of its three outputs and the git tree of the production ingot."""
    tree = run(["git", "rev-parse", "HEAD:ingots/settlane"], cwd=REPO).stdout.strip()
    dirty = bool(run(["git", "status", "--porcelain", "--", "ingots/settlane", "fe.toml"], cwd=REPO).stdout.strip())
    import hashlib
    return {
        "fe": run(["fe", "--version"]).stdout.strip(),
        "init_sha256": sha256_hex(init), "runtime_sha256": sha256_hex(runtime),
        "abi_sha256": hashlib.sha256((pathlib.Path(out) / "Settlane.abi.json").read_bytes()).hexdigest(),
        "init_bytes": len(init) // 2, "runtime_bytes": len(runtime) // 2,
        "production_tree": tree, "production_tree_dirty": dirty,
    }


def check_artifact(facts):
    """Compare a build with the pinned artifact. Returns (problems, notes). The BYTECODE hashes decide; a
    different source tree with identical bytecode is only a note."""
    if not PIN.exists():
        return ([f"{PIN.name} is missing: run `testnet.py artifact --write` after reviewing the build"], [])
    pin = json.loads(PIN.read_text())
    problems, notes = [], []
    for k in ("fe", "init_sha256", "runtime_sha256", "abi_sha256", "init_bytes", "runtime_bytes"):
        if facts[k] != pin.get(k):
            problems.append(f"{k}: built {facts[k]}, pinned {pin.get(k)}")
    if facts["production_tree_dirty"]:
        problems.append("the production ingot has uncommitted changes: deploy only from a committed tree")
    if facts["production_tree"] != pin.get("production_tree"):
        notes.append(f"the production ingot's git tree {facts['production_tree'][:12]} differs from the pinned {str(pin.get('production_tree'))[:12]} (the bytecode is identical, so this is only a note)")
    return problems, notes

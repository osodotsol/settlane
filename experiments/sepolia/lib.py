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


def check_secret_paths(keystore, password_file, role):
    for what, p in (("keystore", keystore), ("password file", password_file)):
        p = pathlib.Path(p)
        if not p.exists():
            raise Abort(f"the {role} {what} does not exist: {p}")
        if inside_repo(p):
            raise Abort(f"the {role} {what} is inside the repository ({p}): move it out; secrets never live in the checkout")
    mode = stat.S_IMODE(pathlib.Path(password_file).stat().st_mode)
    if mode & 0o077:
        raise Abort(f"the {role} password file is readable by others (mode {oct(mode)}): chmod 600 it")


def load_wallets(directory=None):
    d = pathlib.Path(directory or STATE_DIR)
    ws = {}
    for role in ROLES:
        ks, pw = d / "keystores" / role, d / "passwords" / f"{role}.pw"
        check_secret_paths(ks, pw, role)
        ws[role] = Wallet(role, ks, pw)
    if len({w.address for w in ws.values()}) != 3:
        raise Abort("client, provider and verifier must be three different addresses (D-011)")
    return ws


def estimate_gas(rpc, wallet, to, data, value=0, create=False):
    tx = {"from": wallet.address, "data": data if data else "0x", "value": hex(value)}
    if not create:
        tx["to"] = to
    try:
        return int(rpc.call("eth_estimateGas", tx), 16)
    except RpcError as e:
        raise Abort(f"the transaction would revert ({revert_reason(e)}); nothing was sent")


def send(rpc, wallet, to, data, value=0, gas_cap=1_500_000, create=False, broadcast=False):
    """Sign with the keystore and send one transaction; returns the receipt. Guards first.

    The gas limit is the node's estimate plus 30%, never above `gas_cap` (a node on a newer fork can
    price the same call differently, so a fixed limit would fail or overpay). A transaction that is
    mined with status 0 raises: a failed send must never look like a success."""
    require_send_allowed(rpc, broadcast)
    if value > MAX_AGREEMENT_WEI:
        raise Abort(f"value {value} wei exceeds the {MAX_AGREEMENT_WEI} wei cap per transaction")
    gp = rpc.gas_price_gwei()
    if gp > MAX_GAS_PRICE_GWEI:
        raise Abort(f"gas price {gp:.1f} gwei exceeds the {MAX_GAS_PRICE_GWEI} gwei cap: wait")
    est = estimate_gas(rpc, wallet, to, data, value, create)
    limit = int(est * 1.3) + 1000
    if limit > gas_cap:
        raise Abort(f"the gas estimate {est} (limit {limit}) exceeds the cap {gas_cap}; nothing was sent")
    cmd = [tool("cast"), "send", "--keystore", str(wallet.keystore), "--password-file", str(wallet.password_file), "--rpc-url", rpc.url, "--gas-limit", str(limit), "--value", str(value), "--json"]
    cmd += ["--create", data] if create else ([to, data] if data else [to])
    r = run(cmd)
    if r.returncode:
        # the message may echo arguments but never the key: the password is in a file, not in argv
        raise Abort("cast send failed: " + (r.stderr.strip() or r.stdout.strip())[-400:])
    h = json.loads(r.stdout)["transactionHash"]
    for _ in range(300):
        rc = rpc.call("eth_getTransactionReceipt", h)
        if rc:
            rc["_hash"] = h
            if rc.get("status") != "0x1":
                raise Abort(f"transaction {h} was mined with status 0 (gas used {int(rc['gasUsed'], 16)} of {limit})")
            return rc
        time.sleep(2)
    raise Abort(f"transaction {h} was not mined in time")


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

#!/usr/bin/env python3
"""Phase 4B: the PRODUCTION bytecode of Settlane on a local Anvil, with controlled block timestamps.

Isolated: not part of `fe test`, not part of the lint, nothing public. Everything runs on
127.0.0.1, chain id 31337, with the simulated ETH of a throw-away Anvil it starts and stops itself.

Suite (`python3 experiments/anvil/run.py`):
  1. checks `fe` is 26.6.0, builds the production ingot into a TEMPORARY directory, checks the
     output is exactly the deployable Settlane artifacts, deploys `Settlane.bin` and checks the
     deployed code equals `Settlane.runtime.bin` byte for byte;
  2. creation: a valid agreement (event, views, balance, stored deadlines) and the creation
     boundary (deliver_by in the past, equal to the block time, one second later);
  3. Submit at deliver_by - 1, deliver_by and deliver_by + 1 (the same calldata on each side);
  4. Approve and Reject at decide_by - 1, decide_by and decide_by + 1, each on its own agreement;
  5. Refund of a Funded milestone at deliver_by - 1, deliver_by, deliver_by + 1 and of a Submitted
     one at decide_by - 1, decide_by, decide_by + 1 (it is not refundable at deliver_by), a refund
     of an Approved milestone, and a rejection after deliver_by leaving a milestone refundable at once;
  6. Claim right after approval, after decide_by, and very long after, with a wrong caller, a zero
     payee and a replay;
  7. every transition is checked for its exact state, event, balances, accounting and revert reason
     (decoded from a transaction trace), and the block timestamp of every mined transaction is the
     one requested, far in the future of the wall clock;
  8. at the end the contract's balance equals `totalOutstanding` equals what the script expects.

Mutation mode (`--mutations`): for each of Create, Submit, Approve, Reject and Refund it rebuilds the
contract in a TEMPORARY copy with that arm's clock frozen at 0 and one day ahead, runs the suite on
it, and requires (a) the checks that guard that arm's boundary to FAIL, and (b) the checks of the
other arms to still PASS, so each mutation fails for its intended reason and no other. This is the
layer that sees a wrong production clock: no Fe test can (the Fe test block never advances).

It uses the unlocked accounts of the throw-away Anvil: no private key appears here. It does not
change any contract. Claim has no clock, and the production arms' other behavior is tested by the
Fe suite; this script covers the clock-dependent boundaries only.

Usage:
  python3 experiments/anvil/run.py                 # the suite on the repository's production ingot
  python3 experiments/anvil/run.py --mutations     # the suite plus the wrong-clock mutations
  python3 experiments/anvil/run.py --root <tree>   # the suite on another checkout
Needs: `anvil` and `cast` (Foundry, free) on PATH or in ~/tools/foundry/bin, and `fe` 26.6.0.
Exit 0 = every check (and every mutation expectation) held.
"""
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
EXTRA_BIN = pathlib.Path.home() / "tools" / "foundry" / "bin"
ETH = 10**18
SINK = "0x00000000000000000000000000000000000dEaD1"
CLOCK = "Clock { now: ctx.timestamp() }"


def tool(name):
    found = shutil.which(name) or (str(EXTRA_BIN / name) if (EXTRA_BIN / name).exists() else None)
    if not found:
        sys.exit(f"missing tool: {name} (Foundry v1.x from github.com/foundry-rs/foundry/releases; nothing else is needed)")
    return found


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Node:
    """A throw-away Anvil on loopback."""

    def __init__(self, anvil):
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.proc = subprocess.Popen([anvil, "--host", "127.0.0.1", "--port", str(self.port), "--chain-id", "31337", "--silent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                self.chain = int(self.rpc("eth_chainId"), 16)
                return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("anvil did not start")

    def rpc(self, method, *params):
        req = urllib.request.Request(self.url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": list(params)}).encode(), {"Content-Type": "application/json"})
        r = json.load(urllib.request.urlopen(req, timeout=30))
        if "error" in r:
            raise RuntimeError(f"{method}: {r['error']}")
        return r["result"]

    def stop(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def words(hexstr):
    h = hexstr[2:]
    return [int(h[i : i + 64], 16) for i in range(0, len(h), 64)]


def decode_error(out):
    """Solidity Error(string) from revert data, else the raw data."""
    if out and out.startswith("0x08c379a0") and len(out) >= 2 + 8 + 128:
        n = int(out[10 + 64 : 10 + 128], 16)
        return bytes.fromhex(out[10 + 128 : 10 + 128 + 2 * n]).decode()
    return out or "(empty)"


def addr_of(word_hex):
    return "0x" + word_hex[-40:].lower()


class Suite:
    """One run of the checks against one source tree. `results` is a list of dicts."""

    def __init__(self, root, say=print):
        self.root, self.say, self.results = pathlib.Path(root), say, []
        self.anvil, self.cast = tool("anvil"), tool("cast")

    # ------------------------------------------------------------------ reporting
    def check(self, key, label, ok, detail="", tag="misc"):
        ok = bool(ok)
        self.results.append({"key": key, "label": label, "ok": ok, "tag": tag})
        self.say(("ok    " if ok else "FAIL  ") + label + (f"  [{detail}]" if detail else ""))
        return ok

    def failed(self):
        return {r["key"] for r in self.results if not r["ok"]}

    def passed(self):
        return {r["key"] for r in self.results if r["ok"]}

    # ------------------------------------------------------------------ chain helpers
    def calldata(self, sig, *args):
        r = run([self.cast, "calldata", sig, *map(str, args)])
        assert r.returncode == 0, r.stderr
        return r.stdout.strip()

    def keccak(self, text):
        return run([self.cast, "keccak", text]).stdout.strip()

    def block_ts(self, number="latest"):
        return int(self.rpc("eth_getBlockByNumber", number, False)["timestamp"], 16)

    def send(self, frm, to, data, value=0, at=None, create=False):
        """Mine one transaction in its own block, at an exact timestamp when `at` is given."""
        if at is not None:
            self.rpc("evm_setNextBlockTimestamp", at)
        self.pre = self.bal(self.settlane) if getattr(self, "settlane", None) else 0  # contract balance before this tx
        tx = {"from": frm, "data": data, "gas": hex(5_000_000), "value": hex(value)}
        if not create:
            tx["to"] = to
        h = self.rpc("eth_sendTransaction", tx)
        for _ in range(200):
            rc = self.rpc("eth_getTransactionReceipt", h)
            if rc:
                rc["_hash"] = h
                return rc
            time.sleep(0.05)
        raise RuntimeError("transaction was not mined")

    def reason(self, rc):
        t = self.rpc("debug_traceTransaction", rc["_hash"], {"tracer": "callTracer"})
        return decode_error(t.get("output"))

    @staticmethod
    def ok(rc):
        return rc["status"] == "0x1"

    def ts_of(self, rc):
        return int(self.rpc("eth_getBlockByNumber", rc["blockNumber"], False)["timestamp"], 16)

    def view(self, sig, *args):
        return words(self.rpc("eth_call", {"to": self.settlane, "data": self.calldata(sig, *args)}, "latest"))

    def bal(self, a):
        return int(self.rpc("eth_getBalance", a, "latest"), 16)

    def ms(self, i, m=0):
        """getMilestone: [state, amount, deliver_by, decide_by, spec, evidence, rejections, revision]."""
        return self.view("getMilestone(uint256,uint8)", i, m)

    def acc(self, i):
        """getAccounting: [deposited, paid, refunded, outstanding]."""
        return self.view("getAccounting(uint256)", i)

    def events(self, rc, sig):
        t = self.keccak(sig)
        return [l for l in rc["logs"] if l["topics"][0] == t]

    # ------------------------------------------------------------------ the suite
    def build(self):
        self.out = pathlib.Path(tempfile.mkdtemp(prefix="settlane-anvil-"))
        fe = run(["fe", "--version"]).stdout.strip()
        self.check("env-fe", "fe is 26.6.0", fe.startswith("fe 26.6.0"), fe, "setup")
        b = run(["fe", "build", "--out-dir", str(self.out)], cwd=self.root)
        last = (b.stdout + b.stderr).strip().splitlines()
        self.check("env-build", "fe build (production ingot) succeeds", b.returncode == 0, last[-1] if last else "", "setup")
        files = sorted(p.name for p in self.out.iterdir())
        self.check("env-artifacts", "the build output is exactly the deployable Settlane artifacts (no test shell)", files == ["Settlane.abi.json", "Settlane.bin", "Settlane.runtime.bin"], files, "setup")
        if b.returncode != 0 or files != ["Settlane.abi.json", "Settlane.bin", "Settlane.runtime.bin"]:
            raise RuntimeError("the production build failed")
        self.init = (self.out / "Settlane.bin").read_text().strip()
        self.runtime = (self.out / "Settlane.runtime.bin").read_text().strip()
        abi = json.loads((self.out / "Settlane.abi.json").read_text())
        self.check("env-abi", "the ABI has no setTime or clock entry point", not [i["name"] for i in abi if i.get("type") == "function" and any(k in i["name"].lower() for k in ("time", "clock", "warp", "now"))], tag="setup")

    def run(self):
        node = None
        try:
            self.build()
            node = Node(self.anvil)
            self.rpc = node.rpc
            self.check("env-node", "the node is a local throw-away Anvil on loopback, chain id 31337", node.chain == 31337 and node.url.startswith("http://127.0.0.1:"), node.url, "setup")
            accounts = self.rpc("eth_accounts")
            self.client, self.provider, self.verifier = accounts[0], accounts[1], accounts[2]
            self.next_id = 0
            self.deploy()
            self.creation_part()
            self.windows_part()
            self.finish()
        finally:
            if node:
                node.stop()
            shutil.rmtree(getattr(self, "out", "/nonexistent"), ignore_errors=True)
        return self.results

    # ---- deployment
    def deploy(self):
        rc = self.send(self.client, None, "0x" + self.init, create=True)
        self.settlane = rc["contractAddress"]
        self.check("deploy-ok", "deployment succeeds", self.ok(rc), f"{self.settlane}, gas {int(rc['gasUsed'], 16)}", "setup")
        code = self.rpc("eth_getCode", self.settlane, "latest")
        self.check("deploy-bytecode", "the deployed code equals out/Settlane.runtime.bin byte for byte", code == "0x" + self.runtime, f"{(len(code) - 2) // 2} bytes", "setup")

    # ---- agreements
    def create(self, deliver_by, at, amount=ETH, value=None, spec=81, review=3600):
        data = self.calldata("create(address,address,uint256,uint8,uint256[3],uint256[3],uint256[3])", self.provider, self.verifier, review, 1, f"[{amount},0,0]", f"[{deliver_by},0,0]", f"[{spec},0,0]")
        rc = self.send(self.client, self.settlane, data, value=amount if value is None else value, at=at)
        if self.ok(rc):
            self.next_id += 1
            rc["_id"] = self.next_id
        return rc

    def submit(self, i, evidence, at):
        return self.send(self.provider, self.settlane, self.calldata("submit(uint256,uint8,uint256)", i, 0, evidence), at=at)

    def approve(self, i, evidence, revision, at):
        return self.send(self.verifier, self.settlane, self.calldata("approve(uint256,uint8,uint256,uint256)", i, 0, evidence, revision), at=at)

    def reject(self, i, evidence, revision, at):
        return self.send(self.verifier, self.settlane, self.calldata("reject(uint256,uint8,uint256,uint256)", i, 0, evidence, revision), at=at)

    def refund(self, i, to, at, frm=None):
        return self.send(frm or self.client, self.settlane, self.calldata("refund(uint256,uint8,address)", i, 0, to), at=at)

    def claim(self, i, to, at, frm=None):
        return self.send(frm or self.provider, self.settlane, self.calldata("claim(uint256,uint8,address)", i, 0, to), at=at)

    # ---- expectation helpers
    def expect_revert(self, key, label, rc, at, reason, tag, state_check=None):
        r = self.reason(rc) if not self.ok(rc) else "(succeeded)"
        good = (not self.ok(rc)) and self.ts_of(rc) == at and r == reason and (state_check() if state_check else True)
        return self.check(key, label, good, r, tag)

    def expect_payout(self, key, label, rc, at, kind, i, to, amount, tag, before_to):
        """kind 'refund' or 'claim': state, balances, accounting and exactly one event."""
        sig, state = ("MilestoneRefunded(uint256,uint8,address,uint256)", 5) if kind == "refund" else ("MilestoneClaimed(uint256,uint8,address,uint256)", 4)
        evs = self.events(rc, sig)
        good = self.ok(rc) and self.ts_of(rc) == at
        good &= len(evs) == 1 and len(rc["logs"]) == 1
        if evs:
            good &= [int(x, 16) for x in evs[0]["topics"][1:3]] == [i, 0] and addr_of(evs[0]["topics"][3]) == to.lower() and words(evs[0]["data"]) == [amount]
        good &= self.ms(i)[0] == state and self.ms(i)[1] == amount
        good &= self.bal(to) - before_to == amount
        good &= self.bal(self.settlane) == self.pre - amount  # exactly the stored amount left the contract
        a = self.acc(i)
        good &= a == ([amount, 0, amount, 0] if kind == "refund" else [amount, amount, 0, 0])
        return self.check(key, label, good, f"paid {amount / ETH} ETH, state {self.ms(i)[0]}, accounting {[x / ETH for x in a]}", tag)

    # ---- part 1: creation, Submit, Funded refund (the first 32 checks)
    def creation_part(self):
        wall0 = int(time.time())
        T0 = max(self.block_ts(), wall0) + 100
        D1 = T0 + 1000
        rc = self.create(D1, T0)
        self.check("create-valid", "valid creation succeeds", self.ok(rc), tag="create")
        self.check("create-ts", "the block that mined it has exactly the requested timestamp", self.ts_of(rc) == T0, f"{self.ts_of(rc)} == {T0}", "create")
        evs = self.events(rc, "AgreementCreated(uint256,address,address,address,uint256,uint8)")
        self.check("create-event", "exactly one AgreementCreated event, id 1, client and provider indexed", len(evs) == 1 and int(evs[0]["topics"][1], 16) == 1 and addr_of(evs[0]["topics"][2]) == self.client.lower() and addr_of(evs[0]["topics"][3]) == self.provider.lower(), tag="create")
        dw = words(evs[0]["data"]) if evs else []
        self.check("create-event-data", "the event carries verifier, total (1 ETH) and one milestone", dw == [int(self.verifier, 16), ETH, 1], tag="create")
        ag = self.view("getAgreement(uint256)", 1)
        self.check("create-views", "getAgreement returns the stored parties, review period and n", ag == [int(self.client, 16), int(self.provider, 16), int(self.verifier, 16), 3600, 1], tag="create")
        m = self.ms(1)
        self.check("create-milestone", "getMilestone: Funded, 1 ETH, deliver_by, decide_by = deliver_by + 3600, spec 81", m[:5] == [1, ETH, D1, D1 + 3600, 81], m[:5], "create")
        self.check("create-balance", "the contract holds exactly 1 ETH and totalOutstanding is 1 ETH", self.bal(self.settlane) == ETH and self.view("totalOutstanding()") == [ETH], tag="create")

        t = T0 + 10
        rc = self.create(t - 5, t)
        self.check("create-past-rejected", "creation with deliver_by in the past (t - 5) is rejected", not self.ok(rc) and self.ts_of(rc) == t and self.reason(rc) == "deliver_by not in the future", self.reason(rc), "create")
        t += 1
        rc = self.create(t, t)
        self.check("create-at-rejected", "creation with deliver_by == block timestamp is rejected (at the boundary)", not self.ok(rc) and self.ts_of(rc) == t and self.reason(rc) == "deliver_by not in the future", self.reason(rc), "create")
        t += 1
        rc = self.create(t + 1, t)
        self.check("create-before-ok", "creation with deliver_by == block timestamp + 1 succeeds (just before the boundary)", self.ok(rc) and self.ts_of(rc) == t, tag="create")
        self.check("create-rollback", "a rejected creation left nothing behind (2 agreements, 2 ETH held)", self.bal(self.settlane) == 2 * ETH and self.view("totalOutstanding()") == [2 * ETH], tag="create")

        # Submit on agreement 1 (deliver_by D1): the same calldata on each side of the boundary.
        data = self.calldata("submit(uint256,uint8,uint256)", 1, 0, 0xE1)
        rc = self.send(self.provider, self.settlane, data, at=D1 - 1)
        self.check("submit-before-ok", "Submit at deliver_by - 1 succeeds", self.ok(rc) and self.ts_of(rc) == D1 - 1 and self.ms(1)[0] == 2, f"block ts {self.ts_of(rc)}", "submit")
        for key, label, at in (("submit-at-closed", "the SAME Submit at deliver_by is rejected: delivery window is closed", D1), ("submit-after-closed", "the SAME Submit at deliver_by + 1 is rejected: delivery window is closed", D1 + 1)):
            rc = self.send(self.provider, self.settlane, data, at=at)
            self.expect_revert(key, label, rc, at, "delivery window is closed", "submit", lambda: self.ms(1)[0] == 2)
        rc = self.refund(1, self.client, D1 + 2)
        self.expect_revert("refund-submitted-after-deliver-by", "a Submitted milestone is NOT refundable after deliver_by (the review window is open)", rc, D1 + 2, "milestone has not expired", "refund", lambda: self.ms(1)[0] == 2)

        # Refund of a Funded milestone: one calldata, both sides of deliver_by.
        t = D1 + 10
        D2 = t + 1000
        rc = self.create(D2, t)
        i3 = rc["_id"]
        rd = self.calldata("refund(uint256,uint8,address)", i3, 0, SINK)
        rc = self.send(self.client, self.settlane, rd, at=D2 - 1)
        self.expect_revert("refund-funded-before-reverts", "Refund of a Funded milestone at deliver_by - 1 is rejected: milestone has not expired", rc, D2 - 1, "milestone has not expired", "refund", lambda: self.ms(i3)[0] == 1)
        before = self.bal(SINK)
        rc = self.send(self.client, self.settlane, rd, at=D2)
        self.expect_payout("refund-funded-at-ok", "the SAME Refund at deliver_by succeeds: exact amount, state, event and accounting", rc, D2, "refund", i3, SINK, ETH, "refund", before)
        rc = self.send(self.client, self.settlane, rd, at=D2 + 1)
        self.expect_revert("refund-funded-replay", "a second Refund at deliver_by + 1 is rejected: milestone cannot be refunded in this state", rc, D2 + 1, "milestone cannot be refunded in this state", "refund")
        t = D2 + 10
        D3 = t + 1000
        rc = self.create(D3, t)
        i4 = rc["_id"]
        before = self.bal(SINK)
        rc = self.send(self.client, self.settlane, self.calldata("refund(uint256,uint8,address)", i4, 0, SINK), at=D3 + 1)
        self.expect_payout("refund-funded-after-ok", "a first Refund at deliver_by + 1 succeeds", rc, D3 + 1, "refund", i4, SINK, ETH, "refund", before)

    # ---- part 2: the review window (Approve, Reject, Submitted refunds) and Claim
    def windows_part(self):
        base = max(self.block_ts(), int(time.time())) + 200
        G = 11
        E = [base + 5000 + 20 * g for g in range(G)]  # decide_by of group g; deliver_by = E - 3600
        amount = [(g + 2) * 10**17 for g in range(G)]
        payee = ["0x" + f"{0x1000 + g:040x}" for g in range(G)]
        ev = [0xE00 + g for g in range(G)]
        ids = []
        for g in range(G):
            rc = self.create(E[g] - 3600, base + g, amount=amount[g])
            ids.append(rc["_id"])
            assert self.ok(rc)
        good = all(self.ms(ids[g])[2:4] == [E[g] - 3600, E[g]] for g in range(G))
        self.check("win-setup-deadlines", f"{G} agreements created, each with decide_by = deliver_by + 3600", good, tag="setup")
        subs = [self.submit(ids[g], ev[g], base + 100 + g) for g in range(G)]
        self.check("win-setup-submitted", "every milestone was Submitted (revision 1) before its deliver_by", all(self.ok(r) for r in subs) and all(self.ms(ids[g])[0] == 2 and self.ms(ids[g])[7] == 1 and self.ms(ids[g])[5] == ev[g] for g in range(G)), tag="setup")

        sched = []

        def at(t, fn):
            sched.append((t, fn))

        def still_submitted(g):
            return lambda: self.ms(ids[g])[0] == 2 and self.ms(ids[g])[5] == ev[g] and self.ms(ids[g])[6] == 0

        def approved_ok(g, t, key, label, tag="approve"):
            rc = self.approve(ids[g], ev[g], 1, t)
            evs = self.events(rc, "MilestoneApproved(uint256,uint8,uint256,uint256)")
            m = self.ms(ids[g])
            good = self.ok(rc) and self.ts_of(rc) == t and len(rc["logs"]) == 1 and len(evs) == 1 and [int(x, 16) for x in evs[0]["topics"][1:]] == [ids[g], 0, ev[g]] and words(evs[0]["data"]) == [1] and m[0] == 3 and m[5] == ev[g] and m[6] == 0 and self.bal(self.settlane) == self.pre
            self.check(key, label, good, f"state {m[0]}, evidence kept, no ETH moved", tag)

        def rejected_ok(g, t, key, label):
            rc = self.reject(ids[g], ev[g], 1, t)
            evs = self.events(rc, "MilestoneRejected(uint256,uint8,uint256,uint256,uint256)")
            m = self.ms(ids[g])
            good = self.ok(rc) and self.ts_of(rc) == t and len(rc["logs"]) == 1 and len(evs) == 1 and [int(x, 16) for x in evs[0]["topics"][1:]] == [ids[g], 0, ev[g]] and words(evs[0]["data"]) == [1, 1] and m[0] == 1 and m[5] == 0 and m[6] == 1 and m[7] == 1 and self.bal(self.settlane) == self.pre
            self.check(key, label, good, f"state {m[0]}, evidence cleared, rejections {m[6]}, revision {m[7]}", "reject")

        def closed(g, t, which, key, label, tag):
            rc = (self.approve if which == "approve" else self.reject)(ids[g], ev[g], 1, t)
            self.expect_revert(key, label, rc, t, "review window is closed", tag, still_submitted(g))

        def refund_ok(g, t, key, label):
            before = self.bal(payee[g])
            rc = self.refund(ids[g], payee[g], t)
            self.expect_payout(key, label, rc, t, "refund", ids[g], payee[g], amount[g], "refund", before)

        def claim_ok(g, t, key, label):
            before = self.bal(payee[g])
            rc = self.claim(ids[g], payee[g], t)
            self.expect_payout(key, label, rc, t, "claim", ids[g], payee[g], amount[g], "claim", before)

        # group 0: approve at decide_by - 1; an Approved milestone is not refundable; claim AFTER decide_by
        at(E[0] - 1, lambda: approved_ok(0, E[0] - 1, "approve-before-ok", "Approve at decide_by - 1 succeeds: Approved, evidence kept, one MilestoneApproved(id, m, evidence, revision 1)"))
        at(E[0] + 1, lambda: self.expect_revert("refund-approved-after-decide-by", "an Approved milestone is NOT refundable after decide_by: milestone cannot be refunded in this state", self.refund(ids[0], payee[0], E[0] + 1), E[0] + 1, "milestone cannot be refunded in this state", "refund", lambda: self.ms(ids[0])[0] == 3))
        at(E[0] + 5, lambda: claim_ok(0, E[0] + 5, "claim-after-decide-by-ok", "Claim after decide_by of an approval made at decide_by - 1 pays the exact amount (no time guard)"))
        # group 1 / 2: approve at decide_by and decide_by + 1
        at(E[1], lambda: closed(1, E[1], "approve", "approve-at-closed", "Approve at decide_by is rejected: review window is closed (still Submitted, evidence kept)", "approve"))
        at(E[2] + 1, lambda: closed(2, E[2] + 1, "approve", "approve-after-closed", "Approve at decide_by + 1 is rejected: review window is closed", "approve"))
        # group 3: reject at decide_by - 1 (after deliver_by), and the milestone is refundable at once (F3)
        at(E[3] - 1, lambda: rejected_ok(3, E[3] - 1, "reject-before-ok", "Reject at decide_by - 1 succeeds: Funded again, evidence cleared, rejections 1, one MilestoneRejected"))
        at(E[3], lambda: refund_ok(3, E[3], "refund-rejected-late-ok", "a milestone rejected after deliver_by is refundable at once (Funded, delivery closed)"))
        # group 4 / 5: reject at decide_by and decide_by + 1
        at(E[4], lambda: closed(4, E[4], "reject", "reject-at-closed", "Reject at decide_by is rejected: review window is closed (still Submitted)", "reject"))
        at(E[5] + 1, lambda: closed(5, E[5] + 1, "reject", "reject-after-closed", "Reject at decide_by + 1 is rejected: review window is closed", "reject"))
        # group 6: a Submitted milestone, one Refund calldata at decide_by - 1, decide_by and decide_by + 1
        rd6 = self.calldata("refund(uint256,uint8,address)", ids[6], 0, payee[6])
        at(E[6] - 1, lambda: self.expect_revert("refund-submitted-before-reverts", "Refund of a Submitted milestone at decide_by - 1 is rejected: milestone has not expired", self.send(self.client, self.settlane, rd6, at=E[6] - 1), E[6] - 1, "milestone has not expired", "refund", still_submitted(6)))

        def refund6():
            before = self.bal(payee[6])
            rc = self.send(self.client, self.settlane, rd6, at=E[6])
            self.expect_payout("refund-submitted-at-ok", "the SAME Refund at decide_by succeeds: exact amount, Refunded, MilestoneRefunded, accounting", rc, E[6], "refund", ids[6], payee[6], amount[6], "refund", before)

        at(E[6], refund6)
        at(E[6] + 1, lambda: self.expect_revert("refund-submitted-replay", "a second Refund at decide_by + 1 is rejected: milestone cannot be refunded in this state", self.send(self.client, self.settlane, rd6, at=E[6] + 1), E[6] + 1, "milestone cannot be refunded in this state", "refund"))
        # group 7: first Refund attempt at decide_by + 1
        at(E[7] + 1, lambda: refund_ok(7, E[7] + 1, "refund-submitted-after-ok", "a first Refund of a Submitted milestone at decide_by + 1 succeeds"))
        # group 8: Approve refused at decide_by, the client is refunded one second later (disjoint windows)
        at(E[8], lambda: closed(8, E[8], "approve", "approve-closed-then-refund", "Approve at decide_by is rejected, then ...", "refund"))
        at(E[8] + 1, lambda: refund_ok(8, E[8] + 1, "refund-after-review-closed-ok", "... the client's Refund one second later succeeds on the same milestone (review and refund are disjoint)"))
        # group 9: approved early, claimed very long after decide_by
        at(base + 300, lambda: approved_ok(9, base + 300, "claim-late-approve", "Approve (early) of the milestone that will be claimed much later succeeds", "claim"))
        at(E[9] + 100_000, lambda: claim_ok(9, E[9] + 100_000, "claim-far-after-ok", "Claim 100,000 s after decide_by still pays the exact amount (approval never expires)"))
        # group 10: claim right after approval, before decide_by, with a wrong caller, a zero payee and a replay
        at(base + 310, lambda: approved_ok(10, base + 310, "claim-early-approve", "Approve (early) of the milestone that is claimed at once succeeds", "claim"))

        def wrong_caller():
            rc = self.claim(ids[10], payee[10], base + 320, frm=self.verifier)
            self.expect_revert("claim-wrong-caller", "Claim by the verifier is rejected: caller is not the provider", rc, base + 320, "caller is not the provider", "claim", lambda: self.ms(ids[10])[0] == 3)

        at(base + 320, wrong_caller)
        at(base + 321, lambda: self.expect_revert("claim-zero-payee", "Claim to the zero address is rejected: payee is zero", self.claim(ids[10], "0x" + "00" * 20, base + 321), base + 321, "payee is zero", "claim", lambda: self.ms(ids[10])[0] == 3))
        at(base + 322, lambda: claim_ok(10, base + 322, "claim-early-ok", "Claim before decide_by pays the exact amount to the chosen payee"))
        at(base + 323, lambda: self.expect_revert("claim-replay", "a second Claim is rejected: milestone is not approved", self.claim(ids[10], payee[10], base + 323), base + 323, "milestone is not approved", "claim", lambda: self.ms(ids[10])[0] == 4))

        times = [t for t, _ in sched]
        assert len(times) == len(set(times)), "two actions share a block timestamp"
        assert min(times) > self.block_ts(), "an action is not strictly in the future of the chain head"
        for t, fn in sorted(sched, key=lambda x: x[0]):
            fn()
        self.base, self.E0 = base, E[0]

    def finish(self):
        wall = int(time.time())
        self.check("clock-future", "the boundaries were crossed in the FUTURE of the wall clock (the chain's clock was set, not waited for)", self.E0 > wall + 500, f"decide_by - wall clock = {self.E0 - wall} s", "clock")
        bal = self.bal(self.settlane)
        out = self.view("totalOutstanding()")[0]
        owed = sum(self.ms(i)[1] for i in range(1, self.next_id + 1) if self.ms(i)[0] in (1, 2, 3))  # Funded, Submitted, Approved
        self.check("final-accounting", "the contract's balance equals totalOutstanding equals the amounts of the milestones still owed (read from the chain)", bal == out == owed, f"{bal / ETH} ETH == {out / ETH} ETH == {owed / ETH} ETH", "accounting")


# ---------------------------------------------------------------------- mutations
# (arm, mode) -> keys that MUST fail (the checks that guard that arm's boundary), and keys of the
# other arms that MUST still pass, so each mutation fails for its intended reason and no other.
OTHER = {
    "create": ["submit-at-closed", "approve-at-closed", "reject-at-closed", "refund-funded-at-ok", "refund-submitted-at-ok", "claim-early-ok"],
    "submit": ["create-at-rejected", "approve-at-closed", "approve-before-ok", "reject-at-closed", "reject-before-ok", "refund-funded-at-ok", "refund-submitted-at-ok", "claim-early-ok"],
    "approve": ["create-at-rejected", "submit-at-closed", "reject-at-closed", "reject-before-ok", "refund-funded-at-ok", "refund-funded-before-reverts", "refund-submitted-at-ok", "refund-submitted-before-reverts"],
    "reject": ["create-at-rejected", "submit-at-closed", "approve-at-closed", "approve-before-ok", "refund-funded-at-ok", "refund-funded-before-reverts", "refund-submitted-at-ok", "refund-submitted-before-reverts", "claim-early-ok"],
    "refund": ["create-at-rejected", "submit-at-closed", "approve-at-closed", "approve-before-ok", "reject-at-closed", "reject-before-ok", "claim-early-ok"],
}
MUTATIONS = [
    ("create", "frozen", ["create-past-rejected", "create-at-rejected"]),
    ("submit", "frozen", ["submit-at-closed", "submit-after-closed"]),
    ("approve", "frozen", ["approve-at-closed", "approve-after-closed"]),
    ("approve", "ahead", ["approve-before-ok"]),
    ("reject", "frozen", ["reject-at-closed", "reject-after-closed"]),
    ("reject", "ahead", ["reject-before-ok"]),
    ("refund", "frozen", ["refund-funded-at-ok", "refund-submitted-at-ok", "refund-submitted-after-ok"]),
    ("refund", "ahead", ["refund-funded-before-reverts", "refund-submitted-before-reverts"]),
]


def mutate_tree(arm, mode, dest):
    """A TEMPORARY copy of the production ingot whose `arm` reads a wrong clock."""
    shutil.copy(REPO / "fe.toml", dest / "fe.toml")
    shutil.copytree(REPO / "ingots", dest / "ingots", ignore=shutil.ignore_patterns("out", "__pycache__"))
    p = dest / "ingots/settlane/src/settlane.fe"
    s = p.read_text()
    name = arm.capitalize()
    hdr = re.search(rf"\n        (?:#\[payable\]\n        )?{name} \{{", s)
    assert hdr, f"arm {name} not found"
    i = s.index(CLOCK, hdr.end())
    assert not re.search(r"\n        (?:#\[payable\]\n        )?[A-Z]\w* \{", s[hdr.end() : i]), "the clock found belongs to another arm"
    new = "Clock { now: Timestamp::from_seconds(0) }" if mode == "frozen" else "Clock { now: Timestamp::from_seconds(ctx.timestamp().as_seconds() + 86400) }"
    p.write_text(s[:i] + new + s[i + len(CLOCK) :])


def main():
    root = pathlib.Path(sys.argv[sys.argv.index("--root") + 1]).resolve() if "--root" in sys.argv else REPO
    anvil = tool("anvil")
    print(f"anvil: {run([anvil, '--version']).stdout.splitlines()[0]}", flush=True)
    suite = Suite(root, say=lambda m: print(m, flush=True))
    suite.run()
    bad = [r for r in suite.results if not r["ok"]]
    print(f"\nanvil integration: {len(suite.results) - len(bad)} ok, {len(bad)} failed ({len(suite.results)} checks)", flush=True)
    code = 0 if not bad else 1
    if "--mutations" in sys.argv:
        print("\nwrong-clock mutations (each must fail ONLY the checks of its arm):", flush=True)
        if bad:
            print("the unmodified suite does not pass, so the mutations prove nothing", flush=True)
            return 1
        for arm, mode, must_fail in MUTATIONS:
            tmp = pathlib.Path(tempfile.mkdtemp(prefix="settlane-mut-"))
            try:
                mutate_tree(arm, mode, tmp)
                s = Suite(tmp, say=lambda m: None)
                s.run()
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
            failed, passed = s.failed(), s.passed()
            missing = [k for k in must_fail if k not in failed]
            leaked = [k for k in OTHER[arm] if k not in passed]
            good = not missing and not leaked
            code |= 0 if good else 1
            print(("ok    " if good else "FAIL  ") + f"{arm} clock {mode}: fails {len(failed)} checks, including all of {must_fail}" + (f"; NOT failing: {missing}" if missing else "") + (f"; unrelated checks broke: {leaked}" if leaked else ""), flush=True)
        print("mutations: " + ("all as intended" if code == 0 else "FAILED"), flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())

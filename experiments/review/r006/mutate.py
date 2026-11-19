#!/usr/bin/env python3
"""Apply one named mutation to a fresh copy of the reviewed tree and report every gate layer."""
import pathlib, re, shutil, subprocess, sys
# R-006 mutation driver (kept as evidence). Applies one named mutation to a TEMPORARY copy of this
# repository and prints every gate layer (check, tests, events, lint). Usage, from the repo root:
#   python3 experiments/review/r006/mutate.py A-prod-refund-clock-zero
import tempfile
BASE = pathlib.Path(__file__).resolve().parents[3]
S = pathlib.Path(tempfile.mkdtemp())
SETTLANE = "ingots/settlane/src/settlane.fe"; HANDLERS = "ingots/settlane/src/handlers.fe"; RULES = "ingots/settlane/src/rules.fe"
def nth(rel, old, new, n):
    def f(root):
        p = root / rel; s = p.read_text(); i = -1
        for _ in range(n):
            i = s.index(old, i + 1)
        p.write_text(s[:i] + new + s[i + len(old):])
    return f
M = {
 # A: production Refund arm reads a clock stuck at 0 (refunds can never expire on mainnet)
 "A-prod-refund-clock-zero": nth(SETTLANE, "Clock { now: ctx.timestamp() }", "Clock { now: Timestamp::from_seconds(0) }", 5),
 # B: production Refund arm reads a clock one day ahead (premature refunds)
 "B-prod-refund-clock-ahead": nth(SETTLANE, "Clock { now: ctx.timestamp() }", "Clock { now: Timestamp::from_seconds(ctx.timestamp().as_seconds() + 86400) }", 5),
 "G-prod-submit-clock-zero": nth(SETTLANE, "Clock { now: ctx.timestamp() }", "Clock { now: Timestamp::from_seconds(0) }", 2),
 # C: the refund event names the client instead of the chosen payee
 "C-refund-event-names-client": nth(HANDLERS, "MilestoneRefunded { id, m, to, amount }", "MilestoneRefunded { id, m, to: a.client, amount }", 1),
 # D: refund books the amount as `paid` as well as `refunded` (double count, I1)
 "D-refund-also-counts-paid": nth(HANDLERS, "                paid: a.paid,\n                refunded: a.refunded + amount,", "                paid: a.paid + amount,\n                refunded: a.refunded + amount,", 1),
 # E: Funded expires at decide_by instead of deliver_by (client kept waiting a review period longer)
 "E-funded-expires-at-decide-by": nth(RULES, "MilestoneState::Funded => !delivery_open(now, deliver_by),", "MilestoneState::Funded => !review_open(now, decide_by),", 1),
 # F: Submitted never expires (client funds stuck if the verifier disappears)
 "F-submitted-never-expires": nth(RULES, "MilestoneState::Submitted => !review_open(now, decide_by),", "MilestoneState::Submitted => false,", 1),
}
name = sys.argv[1]
root = S / f"m-{name}"
shutil.rmtree(root, ignore_errors=True); shutil.copytree(BASE, root, ignore=shutil.ignore_patterns("out", "__pycache__", ".git", "experiments"))
M[name](root)
subprocess.run(["fe", "fmt", "ingots"], cwd=root, capture_output=True)
def run(cmd):
    r = subprocess.run(cmd, shell=True, cwd=root, capture_output=True, text=True); return r.returncode, r.stdout + r.stderr
out = [f"== {name}"]
rc, o = run("fe check && fe check ingots/settlane-dev"); out.append(f"check: {'ok' if rc == 0 else 'FAIL'}")
rc, o = run("python3 scripts/check_tests.py")
fails = sorted(set(re.findall(r"^FAIL\s+\[[^\]]*\]\s+\S+\s+(\S+)", o, re.M)))
out.append(f"tests: {'ok' if rc == 0 else 'FAIL'} {len(fails)} failing: {fails}")
for t in fails[:3]:
    m = re.search(rf"FAIL.*{t}\n((?:\s+.*\n){{1,3}})", o)
    if m:
        hexes = re.findall(r"0x08c379a0[0-9a-f]+", m.group(1))
        msg = bytes.fromhex(hexes[0][2 + 8 + 128:]).rstrip(b"\0").decode(errors="replace") if hexes else m.group(1).strip()[:160]
        out.append(f"   {t}: {msg}")
rc, o = run("python3 scripts/check_events.py"); out.append(f"events: {'ok' if rc == 0 else 'FAIL'} " + " | ".join(l for l in o.splitlines() if l.startswith('check_events:'))[:400])
rc, o = run("rm -rf out && fe build >/dev/null 2>&1 && python3 scripts/settlane_lint.py ingots --abi-dir out")
out.append(f"lint: {'ok' if rc == 0 else 'FAIL'} " + " | ".join(sorted({l.split(':')[0] for l in o.splitlines() if re.match(r'^[CE]-[A-Z-]+:', l)})))
print("\n".join(out)); shutil.rmtree(S, ignore_errors=True)

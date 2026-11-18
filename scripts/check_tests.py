#!/usr/bin/env python3
"""Run `fe test` explicitly for every Settlane ingot and fail if tests did not run.

Why: in the D-014 workspace, a bare `fe test` runs only the default member (the
production ingot), and `fe test` prints "No tests found" with exit code 0 when an
ingot has none. Both are silent false greens (docs/FE_NOTES.md E10). This script
passes the ingot paths from scripts/test-policy.json, then requires, from the
output: exit code 0, no "No tests found", a `running N tests` line for every
policy ingot with N >= its floor, a final `test result: ok`, zero failures, and
a passed count equal to the tests announced.

Usage:
  python3 scripts/check_tests.py             run fe test and check the result
  python3 scripts/check_tests.py --selftest  check the checker on sample outputs
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
POLICY_PATH = ROOT / "test-policy.json"


def evaluate(output, returncode, policy):
    """Return (problems, per_ingot_counts, passed_total)."""
    problems = []
    if returncode != 0:
        problems.append(f"fe test exited with code {returncode}")
    if "No tests found" in output:
        problems.append("fe test reported 'No tests found' (a silent false green)")
    counts = {m.group(1): int(m.group(2)) for m in re.finditer(r"READY \[[^\]]*\]\s+(\S+)\s+running (\d+) tests?", output)}
    for name, spec in policy["ingots"].items():
        n = counts.get(name)
        if n is None:
            problems.append(f"ingot {name}: no 'running N tests' line, so its tests did not run")
        elif n < spec["min_tests"]:
            problems.append(f"ingot {name}: {n} tests ran, the policy floor is {spec['min_tests']}")
    for name in sorted(set(counts) - set(policy["ingots"])):
        problems.append(f"ingot {name} ran tests but is not in scripts/test-policy.json")
    passed = None
    m = re.search(r"test result: (\w+)\. (\d+) passed; (\d+) failed", output)
    if not m:
        problems.append("no 'test result' summary line")
    else:
        passed = int(m.group(2))
        if m.group(1) != "ok" or int(m.group(3)) != 0:
            problems.append(f"test result {m.group(1)}, {m.group(3)} failed")
        if passed == 0:
            problems.append("0 tests passed")
        if passed != sum(counts.values()):
            problems.append(f"{passed} passed but {sum(counts.values())} tests were announced")
    return problems, counts, passed


GOOD = """running `fe test` for 2 inputs (jobs=8)
READY [6.6s]  settlane     running 3 tests
PASS  [0.0074s]  settlane     a
READY [6.7s]  settlane_dev running 1 test
PASS  [0.0003s]  settlane_dev b

test result: ok. 4 passed; 0 failed
"""


def selftest(_real_policy):
    # A fixed policy, so the checker's logic is tested independently of the real floors in
    # scripts/test-policy.json (which are a ratchet and change whenever tests are added).
    policy = {"ingots": {"settlane": {"min_tests": 3}, "settlane_dev": {"min_tests": 1}}}
    cases = [
        ("good run", GOOD, 0, True),
        ("exit code nonzero", GOOD, 1, False),
        ("'No tests found' warning", GOOD + "Warning: No tests found in ingots/settlane\n", 0, False),
        ("dev ingot did not run", GOOD.replace("READY [6.7s]  settlane_dev running 1 test\n", ""), 0, False),
        ("below the floor", GOOD.replace("running 3 tests", "running 2 tests").replace("4 passed", "3 passed"), 0, False),
        ("failures reported", GOOD.replace("test result: ok. 4 passed; 0 failed", "test result: FAILED. 3 passed; 1 failed"), 0, False),
        ("zero tests", "test result: ok. 0 passed; 0 failed\n", 0, False),
        ("passed count != announced", GOOD.replace("4 passed", "5 passed"), 0, False),
        ("no summary", GOOD.replace("test result: ok. 4 passed; 0 failed", ""), 0, False),
        ("unlisted ingot ran", GOOD + "READY [1s]  rogue running 1 test\n", 0, False),
    ]
    ok = True
    for label, out, rc, want in cases:
        got = not evaluate(out, rc, policy)[0]
        print(("ok    " if got == want else "WRONG ") + f"{label}: accepted={got}")
        ok &= got == want
    return ok


def main(argv):
    policy = json.loads(POLICY_PATH.read_text())
    if "--selftest" in argv:
        return 0 if selftest(policy) else 1
    paths = [spec["path"] for spec in policy["ingots"].values()]
    proc = subprocess.run(["fe", "test", *paths], capture_output=True, text=True)
    output = proc.stdout + proc.stderr
    sys.stdout.write(output)
    problems, counts, passed = evaluate(output, proc.returncode, policy)
    for p in problems:
        print(f"check_tests: {p}")
    if problems:
        print("check_tests: FAILED")
        return 1
    print(f"check_tests: ok ({passed} tests: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) + ")")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

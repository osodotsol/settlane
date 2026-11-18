#!/usr/bin/env python3
"""Negative controls for CI: prove each approved D-014 condition makes CI FAIL.

For every mutation this copies the workspace to a temp directory, applies one
deliberate mistake, runs the real steps of .github/workflows/ci.yml in order
(skipping the Fe install and the Phase 1 experiments), and checks that CI fails
at the expected step. An unmodified copy must pass. Run it locally; it is not
part of CI because it repeats the whole pipeline once per mutation.

Usage: python3 scripts/ci_negative_controls.py [mutation-name ...]
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

try:
    import yaml
except ImportError:
    sys.exit("needs PyYAML (python3 -m pip install pyyaml)")

REPO = pathlib.Path(__file__).resolve().parent.parent
COPY = ["fe.toml", "ingots", "scripts", ".github"]

CLOCK_FROM_MESSAGE = """pub struct Clock {
    pub now: Timestamp,
}

pub fn delivery_open(deliver_by: Timestamp) -> bool uses (clock: Clock) {
    clock.now < deliver_by
}

msg ClockMsg {
    #[selector = sol("isOpen(uint256,uint256)")]
    IsOpen { now: Timestamp, deliver_by: Timestamp } -> bool,
}

pub contract Settlane {
    recv ClockMsg {
        IsOpen { now, deliver_by } -> bool {
            var open = false
            with (Clock = Clock { now }) {
                open = delivery_open(deliver_by: deliver_by)
            }
            open
        }
    }
}
"""

SHELL_IN_PRODUCTION = """msg ShellMsg {
    #[selector = sol("ping()")]
    Ping -> u256,
}

pub contract SettlaneTestClock {
    recv ShellMsg {
        Ping -> u256 {
            1
        }
    }
}
"""


def write(root, rel, text):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


FIXTURES = REPO / "scripts/lint-fixtures"


def add_fixture(fixture, rel):
    """Copy a lint fixture (a compiling attack shape) into the workspace copy."""
    return lambda r: write(r, rel, (FIXTURES / fixture).read_text())


def starve_revert_setup(root):
    """Review M2: give the setup call of the negative Vault test 1 gas, so it reverts early."""
    p = root / "ingots/settlane/src/tests.fe"
    s = p.read_text()
    i = s.index("fn withdraw_before_unlock_reverts")
    j = s.index("gas: 200000", i)
    p.write_text(s[:j] + "gas: 1" + s[j + len("gas: 200000") :])


def dev_not_default(root):
    p = root / "fe.toml"
    p.write_text(p.read_text().replace('default-members = ["ingots/settlane"]', 'default-members = ["ingots/settlane", "ingots/settlane-dev"]'))


# name -> (what is mutated, substring of the step expected to fail first or None, mutator)
MUTATIONS = {
    "control-unmodified": ("nothing", None, lambda r: None),
    "no-tests-in-dev-ingot": ("dev ingot has no tests (cond. 4, 5)", "Tests for both ingots", lambda r: (r / "ingots/settlane-dev/src/tests.fe").unlink()),
    "no-tests-in-production-ingot": ("production ingot has no tests (cond. 4, 5)", "Tests for both ingots", lambda r: (r / "ingots/settlane/src/tests.fe").unlink()),
    "dev-ingot-in-default-members": ("dev ingot is a default member (cond. 2, 3, 6)", "policy lint (fails", dev_not_default),
    "test-shell-in-production-ingot": ("test-only contract in the production ingot (cond. 1, 3)", "policy lint (fails", lambda r: write(r, "ingots/settlane/src/shell.fe", SHELL_IN_PRODUCTION)),
    "production-clock-from-message": ("production contract takes time from a message argument (cond. 7)", "policy lint (fails", lambda r: write(r, "ingots/settlane/src/clock.fe", CLOCK_FROM_MESSAGE)),
    # Review 2026-11-18 findings, each as a compiling shape placed in the production ingot.
    "qualified-call-type-in-production": ("H1: `call: mut std::evm::Call` in a contract header", "policy lint (fails", add_fixture("bad_call_qualified_type.fe", "ingots/settlane/src/attack.fe")),
    "call-import-alias-in-production": ("H1: `use std::evm::Call as Pay`", "policy lint (fails", add_fixture("bad_call_import_alias.fe", "ingots/settlane/src/attack.fe")),
    "lowercase-arm-in-production": ("H2: lowercase non-payout arm after a payout arm", "policy lint (fails", add_fixture("bad_lowercase_arm.fe", "ingots/settlane/src/attack.fe")),
    "raw-storage-in-production": ("H3: RawStorage sstore from a non-payout arm", "policy lint (fails", add_fixture("bad_raw_storage.fe", "ingots/settlane/src/attack.fe")),
    "shadowed-ctx-clock-in-production": ("H4a: `ctx` shadowed by a lookalike timestamp()", "policy lint (fails", add_fixture("bad_clock_ctx_shadowed.fe", "ingots/settlane/src/attack.fe")),
    "clock-type-alias-in-production": ("H4b: `type Tick = Clock` built from a message argument", "policy lint (fails", add_fixture("bad_clock_type_alias.fe", "ingots/settlane/src/attack.fe")),
    "starved-setup-in-negative-test": ("M2: the setup of a negative test reverts before the call under test", "Tests for both ingots", starve_revert_setup),
    "bare-should-revert-test": ("M2: a bare should_revert test is added", "policy lint (fails", add_fixture("bad_bare_should_revert.fe", "ingots/settlane/src/weak_test.fe")),
    "unformatted-dev-code": ("badly formatted dev code", "Format check", lambda r: write(r, "ingots/settlane-dev/src/messy.fe", "pub fn   messy ( )   ->  u256 {   1 }\n")),
}


def run_ci(root):
    wf = yaml.safe_load((root / ".github/workflows/ci.yml").read_text())
    for st in wf["jobs"]["test"]["steps"]:
        run = st.get("run")
        name = st.get("name") or (run or "").strip().splitlines()[0] if run else ""
        if not run or run.lstrip().startswith("curl ") or "experiments" in run:
            continue
        r = subprocess.run(run, shell=True, cwd=root, capture_output=True, text=True)
        if r.returncode:
            return name, (r.stdout + r.stderr)
    return None, ""


def main(argv):
    names = argv or list(MUTATIONS)
    ok = True
    for name in names:
        what, expect, mutate = MUTATIONS[name]
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            for item in COPY:
                src = REPO / item
                shutil.copytree(src, root / item, ignore=shutil.ignore_patterns("out", "__pycache__")) if src.is_dir() else shutil.copy(src, root / item)
            mutate(root)
            if name not in ("control-unmodified", "unformatted-dev-code"):
                subprocess.run(["fe", "fmt", "ingots"], cwd=root, capture_output=True)  # so the mistake reaches its own step
            failed_step, _ = run_ci(root)
        good = (failed_step is None) if expect is None else (failed_step is not None and expect in failed_step)
        ok &= good
        got = "PASSED" if failed_step is None else f"failed at '{failed_step}'"
        print(("ok    " if good else "WRONG ") + f"{name}: {what}: CI {got}" + ("" if expect is None else f" (expected '{expect}')"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

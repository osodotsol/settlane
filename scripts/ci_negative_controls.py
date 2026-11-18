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
import re
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
    """Review M2: give the shared `try_create` helper 1 gas, so every call reverts early.

    A negative test that only checks "the call failed" would still pass. The positive
    controls (`assert!(try_create(valid))`) are what make CI fail here."""
    p = root / "ingots/settlane/src/tests.fe"
    s = p.read_text()
    i = s.index("fn try_create")
    j = s.index("gas: 1000000", i)
    p.write_text(s[:j] + "gas: 1" + s[j + len("gas: 1000000") :])


def replace_in(rel, old, new):
    """Mutation: replace `old` with `new` once. Refuses to run if `old` is not found, so a
    refactor can never silently turn a control into a no-op."""

    def mutate(root):
        p = root / rel
        s = p.read_text()
        assert old in s, f"mutation target not found in {rel}: {old!r}"
        p.write_text(s.replace(old, new, 1))

    return mutate


def add_production_entry_point(variant_decl, arm):
    """Add a second message type `Admin` to the production contract (its own message type, so
    the dev ingot still compiles). `variant_decl` is the message variant, `arm` its handler."""

    def mutate(root):
        p = root / "ingots/settlane/src/settlane.fe"
        s = p.read_text()
        assert "    recv SettleMsg {" in s
        s = s.replace("    recv SettleMsg {", "    recv Admin {\n        " + arm + "\n    }\n\n    recv SettleMsg {", 1)
        s += "\npub msg Admin {\n    " + variant_decl + "\n}\n"
        p.write_text(s)

    return mutate


SET_TIME = add_production_entry_point('#[selector = sol("setTime(uint256)")]\n    SetTime { now: Timestamp },', "SetTime { now } uses (ctx) {\n            assert!(ctx.value() == Wei::zero())\n        }")
WARP = add_production_entry_point('#[selector = sol("warp(uint256)")]\n    Warp { to: Timestamp },', "Warp { to } uses (ctx) {\n            assert!(ctx.value() == Wei::zero())\n        }")
PING = add_production_entry_point('#[selector = sol("ping()")]\n    Ping -> u256,', "Ping -> u256 {\n            1\n        }")


def add_numeric_selector_arm(root):
    """R-002 finding 1: a callable arm addressed by a raw selector is missing from the ABI JSON."""
    p = root / "ingots/settlane/src/settlane.fe"
    s = p.read_text()
    assert "    recv SettleMsg {" in s
    s = s.replace("    recv SettleMsg {", "    recv HiddenMsg {\n        Hidden -> u256 {\n            42\n        }\n    }\n\n    recv SettleMsg {", 1)
    s += "\npub msg HiddenMsg {\n    #[selector = 0x1badc0de]\n    Hidden -> u256,\n}\n"
    p.write_text(s)


def replace_all_in(files, old, new):
    """Mutation across several files: every occurrence of `old` becomes `new`. Each file must
    contain it, so a refactor cannot silently turn a control into a no-op."""

    def mutate(root):
        for rel in files:
            p = root / rel
            s = p.read_text()
            assert old in s, f"mutation target not found in {rel}: {old!r}"
            p.write_text(s.replace(old, new))

    return mutate


def replace_nth_in(rel, old, new, n):
    """Mutation: replace the n-th (1-based) occurrence of `old`. Refuses to run if there are
    fewer than n occurrences."""

    def mutate(root):
        path = root / rel
        s = path.read_text()
        idx = -1
        for _ in range(n):
            idx = s.find(old, idx + 1)
            assert idx >= 0, f"occurrence {n} of {old!r} not found in {rel}"
        path.write_text(s[:idx] + new + s[idx + len(old) :])

    return mutate


def chain(*mutators):
    def mutate(root):
        for m in mutators:
            m(root)

    return mutate


# A control whose failing test must be exactly this one (see main).
ONLY_FAILING = {
    # R-003 f5: nothing but the surplus test exposes these two, so they prove that test has teeth.
    "mut-deposited-includes-surplus": "surplus_eth_keeps_balance_at_or_above_outstanding_and_is_never_owed",
    "mut-outstanding-follows-the-balance": "surplus_eth_keeps_balance_at_or_above_outstanding_and_is_never_owed",
}

SETTLANE = "ingots/settlane/src/settlane.fe"
RULES = "ingots/settlane/src/rules.fe"
HANDLERS = "ingots/settlane/src/handlers.fe"
TYPES = "ingots/settlane/src/types.fe"


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
    # Phase 2A behavior mutations: each breaks one rule of docs/LIFECYCLE.md, and the tests must catch it.
    "mut-client-may-be-provider": ("creation allows client == provider (D-011)", "Tests for both ingots", replace_in(RULES, "if client == provider {", "if client == provider && false {")),
    "mut-verifier-may-be-provider": ("creation allows provider == verifier (D-011)", "Tests for both ingots", replace_in(RULES, "if provider == verifier {", "if provider == verifier && false {")),
    "mut-deliver-by-boundary-off-by-one": ("deliver_by == now accepted (DE boundary)", "Tests for both ingots", replace_in(RULES, "if !(deliver_by[i as usize] > now) {", "if !(deliver_by[i as usize] >= now) {")),
    "mut-funding-not-checked": ("msg.value need not equal the milestone total", "Tests for both ingots", replace_in(RULES, "if value.as_wei() != sum {", "if false {")),
    "mut-decide-by-ignores-review-period": ("decide_by == deliver_by", "Tests for both ingots", replace_in(RULES, "    deliver_by + review_period\n}", "    deliver_by\n}")),
    "mut-zero-review-period-allowed": ("review_period == 0 accepted", "Tests for both ingots", replace_in(RULES, "if review_period == Duration::zero() {", "if false {")),
    "mut-unused-slot-not-checked": ("a non-empty unused slot is accepted", "Tests for both ingots", replace_in(RULES, "return CreateCheck::UnusedSlotNotEmpty", "i += 0")),
    "mut-none-not-first-variant": ("MilestoneState::None is not the first variant (D-017)", "Tests for both ingots", replace_in(TYPES, "    None,\n    Funded,", "    Funded,\n    None,")),
    "mut-ids-do-not-advance": ("every agreement gets the same id", "Tests for both ingots", replace_in(HANDLERS, "let id = totals.next_id + 1", "let id = totals.next_id")),
    "mut-outstanding-not-updated": ("total outstanding is not increased by a creation", "Tests for both ingots", replace_in(HANDLERS, "totals.outstanding = totals.outstanding + total", "totals.outstanding = totals.outstanding")),
    "mut-wrong-initial-state": ("milestones start Submitted instead of Funded", "Tests for both ingots", replace_in(HANDLERS, "state: MilestoneState::Funded,", "state: MilestoneState::Submitted,")),
    "mut-unknown-agreement-view-does-not-revert": ("getAgreement on an unknown id returns zeros", "Tests for both ingots", replace_in(HANDLERS, 'assert!(a.n != 0, "unknown agreement")', 'assert!(true, "unknown agreement")')),
    "mut-production-clock-frozen-at-zero": ("production Clock is not the block time (PC)", "Tests for both ingots", replace_in("ingots/settlane/src/settlane.fe", "Clock { now: ctx.timestamp() }", "Clock { now: Timestamp::from_seconds(0) }")),
    # A production time setter is caught by two independent layers; each control isolates one.
    "mut-production-time-setter": ("a production setTime(uint256) exists (PC): the explicit selector probe in the tests catches it", "Tests for both ingots", SET_TIME),
    "mut-production-time-setter-other-name": ("a production warp(uint256) exists (PC): no test probes it, so the lint (C-ABI) must", "policy lint (fails", WARP),
    "mut-production-extra-entry-point": ("a harmless-looking production ping() exists: only the exact ABI allowlist (C-ABI) can catch it", "policy lint (fails", PING),
    "mut-view-becomes-payable": ("getAgreement is made payable: the only-create-is-payable test catches it", "Tests for both ingots", replace_in("ingots/settlane/src/settlane.fe", "        GetAgreement { id } ->", "        #[payable]\n        GetAgreement { id } ->")),
    # R-002 findings (2026-11-18), each isolating one layer.
    "mut-production-numeric-selector-arm": ("R-002 f1: a callable arm with a numeric selector is missing from the ABI", "policy lint (fails", add_numeric_selector_arm),
    "mut-clock-reassigned-before-handler": ("R-002 f2: the Clock is held in a variable and reassigned (behavior unchanged, so only the lint can see it)", "policy lint (fails", replace_in("ingots/settlane/src/settlane.fe", "with (Clock = Clock { now: ctx.timestamp() }) {", "var held = Clock { now: ctx.timestamp() }\n            held.now = ctx.timestamp()\n            with (Clock = held) {")),
    "mut-clock-rewound-before-handler": ("R-002 f2: the Clock is reset to time 0 before the handler (the boundary tests catch it)", "Tests for both ingots", replace_in("ingots/settlane/src/settlane.fe", "with (Clock = Clock { now: ctx.timestamp() }) {", "var held = Clock { now: ctx.timestamp() }\n            held.now = Timestamp::from_seconds(0)\n            with (Clock = held) {")),
    "mut-spec-checked-inside-the-amounts-stage": ("R-002 f3: the spec rule runs slot by slot inside the amounts stage (wrong order)", "Tests for both ingots", replace_in(RULES, "        let a = amounts[i as usize].as_wei()\n", "        let a = amounts[i as usize].as_wei()\n        if specs[i as usize] == 0 {\n            return CreateCheck::ZeroSpec\n        }\n")),
    "mut-decide-by-overflow-not-prevalidated": ("R-002 f3: the decide_by window is not validated before the writes (it would only panic mid-write)", "Tests for both ingots", replace_in(RULES, "if deliver_by[i as usize].as_seconds() > U256_MAX - review_period.as_seconds() {", "if false {")),
    "mut-event-provider-and-verifier-swapped": ("R-002 f4: AgreementCreated carries the provider and verifier swapped (tests and ABI cannot see it)", "Events of both ingots", replace_in(HANDLERS, "AgreementCreated { id, client, provider, verifier, total, milestones: n }", "AgreementCreated { id, client, provider: verifier, verifier: provider, total, milestones: n }")),
    "mut-event-wrong-total": ("R-002 f4: AgreementCreated reports a zero total", "Events of both ingots", replace_in(HANDLERS, "AgreementCreated { id, client, provider, verifier, total, milestones: n }", "AgreementCreated { id, client, provider, verifier, total: Wei::zero(), milestones: n }")),
    "mut-event-client-is-provider": ("R-002 f4: AgreementCreated names the provider as the client", "Events of both ingots", replace_in(HANDLERS, "AgreementCreated { id, client, provider, verifier, total, milestones: n }", "AgreementCreated { id, client: provider, provider, verifier, total, milestones: n }")),
    "mut-event-not-emitted": ("R-002 f4: the creation event is never emitted", "Events of both ingots", replace_in(HANDLERS, "log.emit(\n        AgreementCreated { id, client, provider, verifier, total, milestones: n },\n    )", "let _ = id")),
    # R-003 findings (2026-11-18).
    "mut-later-slots-use-a-shifted-clock": ("R-003 f1: slot i is judged against now + i (slot 0 is right, later slots are not)", "Tests for both ingots", replace_in(RULES, "if !(deliver_by[i as usize] > now) {", "if !(deliver_by[i as usize] > Timestamp::from_seconds(now.as_seconds() + (i as u256))) {")),
    "mut-handler-advances-the-clock": ("R-003 f1: the handler hands the rules a clock one second ahead", "Tests for both ingots", replace_in(HANDLERS, "now: clock.now,", "now: Timestamp::from_seconds(clock.now.as_seconds() + 1),")),
    "mut-event-client-is-the-contract-for-a-2-eth-agreement": ("R-003 f2: a wrong client topic in one direct-call test (no incidental rule can see it)", "Events of both ingots", chain(replace_in(HANDLERS, "AgreementCreated { id, client, provider, verifier, total, milestones: n }", "AgreementCreated { id, client: if total == ether(2) { ctx.address() } else { client }, provider, verifier, total, milestones: n }"), replace_in(HANDLERS, "use std::evm::StorageMap", "use std::evm::{StorageMap, ether}"))),
    "mut-event-client-is-tx-origin": ("R-003 f2: the event names tx.origin instead of msg.sender", "Events of both ingots", replace_in(HANDLERS, "AgreementCreated { id, client, provider, verifier, total, milestones: n }", "AgreementCreated { id, client: ctx.origin(), provider, verifier, total, milestones: n }")),
    "mut-abi-output-type-widened": ("R-003 f3: getMilestone returns its state as uint256 instead of uint8 (Fe tests stay green; only the ABI output lock can see it)", "policy lint (fails", chain(replace_all_in([SETTLANE, "ingots/settlane/src/handlers.fe", "ingots/settlane-dev/src/lib.fe", "ingots/settlane/src/tests.fe", "ingots/settlane-dev/src/tests.fe"], "(u8, Wei, Timestamp, Timestamp, u256, u256, u256)", "(u256, Wei, Timestamp, Timestamp, u256, u256, u256)"), replace_in(HANDLERS, "        rules::state_code(x.state),\n        x.amount,", "        rules::state_code(x.state) as u256,\n        x.amount,"), replace_in("ingots/settlane-dev/src/tests.fe", "fn state_of(_ s: Address, _ id: u256, _ m: u8) -> u8 uses (evm: mut Evm) {", "fn state_of(_ s: Address, _ id: u256, _ m: u8) -> u256 uses (evm: mut Evm) {"))),
    "mut-deposited-includes-surplus": ("R-003 f5: an agreement's deposit absorbs any ETH already in the contract", "Tests for both ingots", replace_in(HANDLERS, "deposited: total,", "deposited: ctx.selfbalance() - totals.outstanding + total,")),
    "mut-outstanding-follows-the-balance": ("R-003 f5: total outstanding is set from the contract balance instead of the agreements", "Tests for both ingots", replace_in(HANDLERS, "totals.outstanding = totals.outstanding + total", "totals.outstanding = ctx.selfbalance()")),
    # Phase 2B: each mutation breaks one rule of T2 (Submit), T3 (Approve) or T4 (Reject).
    "mut-anyone-can-submit": ("T2: the caller need not be the provider", "Tests for both ingots", replace_in(RULES, "    if caller != provider {", "    if caller != provider && false {")),
    "mut-approved-milestone-accepts-new-evidence": ("T2: an Approved milestone can take new evidence (immutability broken)", "Tests for both ingots", replace_in(RULES, "    if !can_submit_from(state) {", "    if false {")),
    "mut-submit-ignores-the-delivery-window": ("T2: evidence is accepted after deliver_by", "Tests for both ingots", replace_in(RULES, "    if !delivery_open(now, deliver_by) {", "    if false {")),
    "mut-zero-evidence-accepted": ("T2: zero evidence is accepted", "Tests for both ingots", replace_in(RULES, "    if evidence == 0 {", "    if false {")),
    "mut-unused-slot-reports-the-wrong-reason": ("T2: an unused slot fails for the wrong reason (WrongState instead of NoSuchMilestone)", "Tests for both ingots", replace_nth_in(RULES, "    if state_code(state) == 0 {", "    if state_code(state) == 0 && false {", 1)),
    "mut-anyone-can-review": ("T3/T4: the caller need not be the verifier", "Tests for both ingots", replace_in(RULES, "    if caller != verifier {", "    if caller != verifier && false {")),
    "mut-review-from-any-state": ("T3/T4: a milestone need not be Submitted to be reviewed", "Tests for both ingots", replace_in(RULES, "    if state_code(state) != 2 {", "    if false {")),
    "mut-review-ignores-the-window": ("T3/T4: the verifier can review after decide_by", "Tests for both ingots", replace_in(RULES, "    if !review_open(now, decide_by) {", "    if false {")),
    "mut-review-ignores-the-evidence": ("T3/T4 (D-015): neither Approve nor Reject needs to name the stored evidence", "Tests for both ingots", replace_in(RULES, "    if evidence != stored_evidence {", "    if false {")),
    "mut-approve-ignores-the-named-evidence": ("T3: Approve always matches (the named evidence is replaced by the stored one)", "Tests for both ingots", replace_nth_in(HANDLERS, "            stored_evidence: x.evidence,\n            evidence,", "            stored_evidence: x.evidence,\n            evidence: x.evidence,", 1)),
    "mut-reject-ignores-the-named-evidence": ("T4 (D-015): Reject always matches (the S-1 race)", "Tests for both ingots", replace_nth_in(HANDLERS, "            stored_evidence: x.evidence,\n            evidence,", "            stored_evidence: x.evidence,\n            evidence: x.evidence,", 2)),
    "mut-reject-keeps-the-evidence": ("T4: a rejected milestone keeps its evidence", "Tests for both ingots", replace_in(HANDLERS, "                evidence: 0,\n                rejections,", "                evidence: x.evidence,\n                rejections,")),
    "mut-reject-does-not-count": ("T4: the rejection counter does not go up", "Tests for both ingots", replace_in(HANDLERS, "let rejections = x.rejections + 1", "let rejections = x.rejections")),
    "mut-reject-leaves-the-milestone-submitted": ("T4: Reject keeps the state Submitted instead of Funded", "Tests for both ingots", replace_nth_in(HANDLERS, "state: MilestoneState::Funded,", "state: MilestoneState::Submitted,", 2)),
    "mut-approve-sets-another-state": ("T3: Approve sets the state Paid", "Tests for both ingots", replace_in(HANDLERS, "state: MilestoneState::Approved,", "state: MilestoneState::Paid,")),
    "mut-submit-rewrites-the-deadline": ("T2: Submit moves deliver_by one second later (deadlines must be immutable)", "Tests for both ingots", replace_in(HANDLERS, "                state: MilestoneState::Submitted,\n                amount: x.amount,\n                deliver_by: x.deliver_by,", "                state: MilestoneState::Submitted,\n                amount: x.amount,\n                deliver_by: Timestamp::from_seconds(x.deliver_by.as_seconds() + 1),")),
    "mut-submit-checks-the-verifier-role": ("T2: Submit compares the caller with the verifier (roles swapped)", "Tests for both ingots", replace_in(HANDLERS, "            provider: a.provider,", "            provider: a.verifier,")),
    "mut-transition-becomes-payable": ("T2: Submit is payable (a transition must never take ETH)", "Tests for both ingots", replace_in(SETTLANE, "        Submit { id, m, evidence } uses (", "        #[payable]\n        Submit { id, m, evidence } uses (")),
    "mut-approved-event-reports-milestone-zero": ("T3: MilestoneApproved always reports milestone 0 (tests and ABI cannot see it)", "Events of both ingots", replace_in(HANDLERS, "MilestoneApproved { id, m, evidence }", "MilestoneApproved { id, m: 0, evidence }")),
    "mut-rejected-event-counter-off-by-one": ("T4: MilestoneRejected reports rejections + 1", "Events of both ingots", replace_in(HANDLERS, "MilestoneRejected { id, m, evidence, rejections }", "MilestoneRejected { id, m, evidence, rejections: rejections + 1 }")),
    "mut-submitted-event-not-emitted": ("T2: MilestoneSubmitted is never emitted", "Events of both ingots", replace_in(HANDLERS, "log.emit(MilestoneSubmitted { id, m, evidence })", "let _ = id")),
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


def dry_run():
    """Apply every mutation to a copy without running CI, so a target that no longer exists
    in the code is found in seconds, not after a long run."""
    ok = True
    for name, (what, expect, mutate) in MUTATIONS.items():
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            for item in COPY:
                src = REPO / item
                shutil.copytree(src, root / item, ignore=shutil.ignore_patterns("out", "__pycache__")) if src.is_dir() else shutil.copy(src, root / item)
            try:
                mutate(root)
                print(f"ok    {name}: applies")
            except (AssertionError, FileNotFoundError, ValueError) as e:
                print(f"WRONG {name}: cannot be applied: {e}")
                ok = False
    return 0 if ok else 1


def main(argv):
    if argv == ["--dry-run"]:
        return dry_run()
    names = argv or list(MUTATIONS)
    ok = True
    for name in names:
        what, expect, mutate = MUTATIONS[name]
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            for item in COPY:
                src = REPO / item
                shutil.copytree(src, root / item, ignore=shutil.ignore_patterns("out", "__pycache__")) if src.is_dir() else shutil.copy(src, root / item)
            try:
                mutate(root)
            except (AssertionError, FileNotFoundError, ValueError) as e:
                print(f"WRONG {name}: the mutation cannot be applied (the code it targets changed): {e}", flush=True)
                ok = False
                continue
            if name not in ("control-unmodified", "unformatted-dev-code"):
                subprocess.run(["fe", "fmt", "ingots"], cwd=root, capture_output=True)  # so the mistake reaches its own step
            failed_step, output = run_ci(root)
        good = (failed_step is None) if expect is None else (failed_step is not None and expect in failed_step)
        only = ONLY_FAILING.get(name)
        if only is not None and good:
            # The step is right; the failing test must be exactly the named one, so the control
            # proves that this test (and not some unrelated one) guards the behavior.
            failing = set(re.findall(r"^FAIL\s+\[[^\]]*\]\s+\S+\s+(\S+)", output, re.M))
            if failing != {only}:
                good = False
                failed_step = f"{failed_step}, but the failing tests are {sorted(failing)} instead of only [{only!r}]"
        ok &= good
        got = "PASSED" if failed_step is None else f"failed at '{failed_step}'"
        print(("ok    " if good else "WRONG ") + f"{name}: {what}: CI {got}" + ("" if expect is None else f" (expected '{expect}')"), flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

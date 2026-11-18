#!/usr/bin/env python3
"""Check the events emitted by the Fe tests (R-002 finding 4, R-003 findings 2 and 4).

Fe test code cannot read emitted events (the `Evm` effect has no log accessor), but
`fe test --show-logs` prints every log of every test, with topics and data. This script runs
the tests that way, decodes each `AgreementCreated` with an independent encoder (the validated
Keccak-256 in scripts/keccak.py and plain ABI word layout), and compares topics and payload
with what the tests did. It checks:

  * the event signature hash (topic0), the number of topics and the data length;
  * for every log: `id` (topic1), `client` (topic2, an address), `provider` (topic3),
    `verifier`, `total` and `milestones` (the three data words);
  * ids are consecutive from 1 per contract;
  * exact expected sequences for the named tests, including that a REJECTED creation emits
    nothing (it appears as `log (none)` or is simply absent);
  * **the client is the real msg.sender, for every creation** (R-003 finding 2). Two independent
    sources of truth, neither of which comes from Settlane:
      - a DIRECT call: the test contract emits `CallerProbe(its own address)`, and the `client`
        topic must equal it. Every test that creates agreements directly must emit the probe;
      - a call through the dev Actor: the Actor emits `Acted(its own address)` immediately
        before forwarding, and the `client` topic of the next AgreementCreated must equal it;
  * the production contract and the dev test-clock shell emit identical events for the same call.

Usage:
  python3 scripts/check_events.py             run fe test --show-logs and check the logs
  python3 scripts/check_events.py --selftest  check the checker on sample output
"""
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keccak import keccak256  # noqa: E402

CREATED_SIG = "AgreementCreated(uint256,address,address,address,uint256,uint8)"
ACTED_SIG = "Acted(address)"
PROBE_SIG = "CallerProbe(address)"
TOPIC_CREATED = "0x" + keccak256(CREATED_SIG.encode()).hex()
TOPIC_ACTED = "0x" + keccak256(ACTED_SIG.encode()).hex()
TOPIC_PROBE = "0x" + keccak256(PROBE_SIG.encode()).hex()
ETHER = 10**18
A1, A2, B1, B2 = 0xA1, 0xA2, 0xB1, 0xB2

RESULT = re.compile(r"^(PASS|FAIL)\s+\[[^\]]*\]\s+(\S+)\s+(\S+)\s*$")
LOGLINE = re.compile(r"^\s+(\S+)\s+log\s+(.*)$")
LOG = re.compile(r"Log \{ address: (0x[0-9a-fA-F]{40}), data: LogData \{ topics: \[([^\]]*)\], data: (0x[0-9a-fA-F]*) \} \}")


def parse(output):
    """{(ingot, test): [ {address, topics, data} ]} from `fe test --show-logs --jobs 1` output."""
    logs, cur = {}, None
    for line in output.splitlines():
        m = RESULT.match(line)
        if m:
            cur = (m.group(2), m.group(3))
            logs[cur] = []
            continue
        m = LOGLINE.match(line)
        if m and cur and m.group(1) == cur[0]:
            rest = m.group(2).strip()
            if rest == "(none)":
                continue
            lm = LOG.search(rest)
            if not lm:
                raise ValueError(f"unparsable log line: {line!r}")
            topics = [t.strip() for t in lm.group(2).split(",") if t.strip()]
            logs[cur].append({"address": lm.group(1).lower(), "topics": [t.lower() for t in topics], "data": lm.group(3).lower()})
    return logs


def words(data_hex):
    raw = data_hex[2:]
    return [int(raw[i : i + 64], 16) for i in range(0, len(raw), 64)] if len(raw) % 64 == 0 else None


def is_address(v):
    return v != 0 and v >> 160 == 0


def decode(log):
    """Decode a log as AgreementCreated, Acted or CallerProbe: (event or None, [problems])."""
    t = log["topics"]
    if not t:
        return None, ["a log with no topics"]
    if t[0] in (TOPIC_ACTED, TOPIC_PROBE):
        kind, field = ("Acted", "actor") if t[0] == TOPIC_ACTED else ("Probe", "who")
        if len(t) != 2 or log["data"] != "0x":
            return None, [f"{kind} must have 2 topics and empty data, got {len(t)} topics, data {log['data']}"]
        v = int(t[1], 16)
        if not is_address(v):
            return None, [f"{kind}.{field} is not a nonzero address"]
        return {"kind": kind, field: v, "address": log["address"]}, []
    if t[0] != TOPIC_CREATED:
        return None, [f"unknown event topic0 {t[0]}"]
    if len(t) != 4:
        return None, [f"AgreementCreated must have 4 topics (hash, id, client, provider), got {len(t)}"]
    w = words(log["data"])
    if w is None or len(w) != 3:
        return None, [f"AgreementCreated data must be 3 words (verifier, total, milestones), got {log['data']}"]
    problems = []
    tid, client, provider = (int(x, 16) for x in t[1:])
    verifier, total, n = w
    for name, v in (("client", client), ("provider", provider), ("verifier", verifier)):
        if not is_address(v):
            problems.append(f"{name} is not a nonzero address")
    if n < 1 or n > 3:
        problems.append(f"milestones {n} is not 1..3")
    if total == 0:
        problems.append("total is zero")
    if len({client, provider, verifier}) != 3:
        problems.append("client, provider and verifier are not distinct")
    return {"kind": "Created", "id": tid, "client": client, "provider": provider, "verifier": verifier, "total": total, "n": n, "address": log["address"]}, problems


def created(i, provider, verifier, total, n):
    return {"kind": "Created", "id": i, "provider": provider, "verifier": verifier, "total": total, "n": n}


GOOD3 = created(1, A1, A2, 6 * ETHER, 3)


def TWO(i):
    return created(i, A1, A2, 3 * ETHER, 2)


def SIX(i):
    return created(i, A1, A2, 6 * ETHER, 3)


# Exact expected AgreementCreated sequences (id, provider, verifier, total, milestones).
# Tests not listed here only get the structural checks. Every `rejects_*` creation that failed
# emitted nothing, so the sequences below contain only the successful creations.
EXPECTED = {
    ("settlane", "creates_a_single_milestone_agreement"): [created(1, A1, A2, 2 * ETHER, 1)],
    ("settlane", "creates_a_three_milestone_agreement_with_every_field_stored"): [GOOD3],
    ("settlane", "ids_increment_and_agreements_are_isolated"): [GOOD3, created(2, B1, B2, 9 * ETHER, 2)],
    ("settlane", "rejects_invalid_parties_and_leaves_no_trace"): [GOOD3],
    ("settlane", "rejects_a_milestone_count_outside_one_to_three"): [GOOD3],
    ("settlane", "requires_exact_funding"): [GOOD3],
    ("settlane", "rejects_a_zero_review_period"): [created(1, A1, A2, 6 * ETHER, 3)],
    ("settlane", "rejects_arithmetic_overflow_in_the_amount_sum"): [],
    ("settlane", "rejects_decide_by_overflow_and_accepts_the_exact_boundary"): [created(1, A1, A2, ETHER, 1)],
    ("settlane", "surplus_eth_keeps_balance_at_or_above_outstanding_and_is_never_owed"): [GOOD3, created(2, A1, A2, ETHER, 1)],
    ("settlane", "enforces_deliver_by_strictly_after_the_production_clock"): [created(1, A1, A2, ETHER, 1), SIX(2), SIX(3)],
    ("settlane", "every_slot_of_a_two_milestone_agreement_is_judged_against_the_same_clock"): [TWO(1), TWO(2), TWO(3)],
    ("settlane", "the_boundary_holds_in_every_slot_of_a_three_milestone_agreement"): [SIX(1), SIX(2), SIX(3)],
    ("settlane", "unknown_agreement_ids_revert_or_read_as_none"): [created(1, A1, A2, ETHER, 1)],
    ("settlane", "only_create_is_payable"): [created(1, A1, A2, ETHER, 1)],
    ("settlane_dev", "a_wide_n_is_rejected_at_decode_and_never_truncated"): [GOOD3],
    ("settlane_dev", "the_shell_crosses_creation_deadlines_that_a_frozen_block_cannot"): [
        created(1, A1, A2, ETHER, 1), created(2, A1, A2, ETHER, 1), created(3, A1, A2, ETHER, 1), created(4, A1, A2, 6 * ETHER, 3)],
    ("settlane_dev", "the_shell_judges_every_slot_against_one_clock"): [TWO(1), TWO(2), SIX(3), TWO(4)],
}
# Tests that must emit no event at all (no successful creation in them).
NO_EVENTS = [("settlane", "rules_accept_a_valid_agreement_and_report_each_failure"), ("settlane", "the_none_state_is_first_and_codes_are_stable")]
# Differential tests: production and the shell are called alternately and must emit identical events.
DIFFERENTIAL = {
    ("settlane_dev", "shell_and_production_agree_when_their_clocks_agree"): 4,
    ("settlane_dev", "shell_and_production_agree_on_every_two_and_three_milestone_boundary"): 8,
}


def check_client(key, evs):
    """R-003 finding 2: every `client` must be the real caller, from an independent source."""
    problems = []
    probes = {e["who"] for e in evs if e["kind"] == "Probe"}
    if len(probes) > 1:
        problems.append(f"{key[1]}: the test contract probed {len(probes)} different callers")
    pending = None
    for e in evs:
        if e["kind"] == "Acted":
            pending = e["actor"]
        elif e["kind"] == "Created":
            if pending is not None:
                if e["client"] != pending:
                    problems.append(f"{key[1]}: id {e['id']} client {e['client']:#x} is not the Actor that called ({pending:#x})")
                pending = None
            elif not probes:
                problems.append(f"{key[1]}: id {e['id']} was created by a direct call but the test emitted no CallerProbe, so its client is unverified")
            elif e["client"] not in probes:
                problems.append(f"{key[1]}: id {e['id']} client {e['client']:#x} is not the caller (the test contract is {next(iter(probes)):#x})")
    return problems


def check(logs):
    problems, checked = [], 0
    decoded = {}
    for key, entries in logs.items():
        evs = []
        for log in entries:
            ev, probs = decode(log)
            problems += [f"{key[1]}: {p}" for p in probs]
            if ev:
                evs.append(ev)
                checked += 1
        decoded[key] = evs
        per = {}
        for ev in evs:
            if ev["kind"] == "Created":
                per.setdefault(ev["address"], []).append(ev["id"])
        for addr, ids in per.items():
            if ids != list(range(1, len(ids) + 1)):
                problems.append(f"{key[1]}: contract {addr[:10]}.. emitted ids {ids}, expected 1..{len(ids)}")
        problems += check_client(key, evs)
    for key, want in EXPECTED.items():
        if key not in decoded:
            problems.append(f"expected test {key[1]} did not run")
            continue
        got = [e for e in decoded[key] if e["kind"] == "Created"]
        if len(got) != len(want):
            problems.append(f"{key[1]}: {len(got)} AgreementCreated events, expected {len(want)}")
            continue
        for i, (g, w) in enumerate(zip(got, want)):
            for field in ("id", "provider", "verifier", "total", "n"):
                if g[field] != w[field]:
                    problems.append(f"{key[1]} event #{i + 1}: {field} is {g[field]:#x}, expected {w[field]:#x}")
    for key in NO_EVENTS:
        if key in decoded and decoded[key]:
            problems.append(f"{key[1]}: emitted {len(decoded[key])} events, expected none")
    # Through the Actor: Acted, Created, then the rejected call emits nothing, then Acted, Created.
    k = ("settlane_dev", "the_client_is_the_caller_and_never_a_parameter")
    if k not in decoded:
        problems.append(f"expected test {k[1]} did not run")
    else:
        seq = [e["kind"] for e in decoded[k]]
        if seq != ["Acted", "Created", "Acted", "Created"]:
            problems.append(f"{k[1]}: event sequence {seq}, expected [Acted, Created, Acted, Created] (the rejected call must emit nothing)")
        elif [decoded[k][1]["id"], decoded[k][3]["id"]] != [1, 2]:
            problems.append(f"{k[1]}: ids {decoded[k][1]['id']}, {decoded[k][3]['id']}, expected 1, 2")
    # Production and the test-clock shell emit identical events for the same call.
    for k, count in DIFFERENTIAL.items():
        if k not in decoded:
            problems.append(f"expected test {k[1]} did not run")
            continue
        ev = [log for log in logs[k] if log["topics"] and log["topics"][0] == TOPIC_CREATED]
        if len(ev) != count:
            problems.append(f"{k[1]}: {len(ev)} AgreementCreated logs, expected {count} (production, shell, production, shell, ...)")
            continue
        prod, shell = ev[0]["address"], ev[1]["address"]
        if prod == shell or any(ev[i]["address"] != (prod if i % 2 == 0 else shell) for i in range(count)):
            problems.append(f"{k[1]}: logs do not alternate between one production and one shell contract")
        for i in range(0, count, 2):
            if ev[i]["topics"] != ev[i + 1]["topics"] or ev[i]["data"] != ev[i + 1]["data"]:
                problems.append(f"{k[1]}: production and shell emitted different events (pair {i // 2 + 1})")
    return problems, checked


def word(v):
    return f"{v:064x}"


def make_log(ident=1, client=0xBD, provider=A1, verifier=A2, total=2 * ETHER, n=1):
    return {"address": "0x" + "d2" * 20, "topics": [TOPIC_CREATED, "0x" + word(ident), "0x" + word(client), "0x" + word(provider)], "data": "0x" + word(verifier) + word(total) + word(n)}


def probe_log(who):
    return {"address": "0x" + "bd" * 20, "topics": [TOPIC_PROBE, "0x" + word(who)], "data": "0x"}


SAMPLE = """running `fe test` for 1 inputs (jobs=1)
PASS  [0.0003s]  settlane     creates_a_single_milestone_agreement
                 settlane         log Log { address: 0xd23ed5e6c88da4352e03add28d02db7518fdac6d, data: LogData { topics: [%s, 0x0000000000000000000000000000000000000000000000000000000000000001, 0x000000000000000000000000bd770416a3345f91e4b34576cb804a576fa48eb1, 0x00000000000000000000000000000000000000000000000000000000000000a1], data: 0x00000000000000000000000000000000000000000000000000000000000000a20000000000000000000000000000000000000000000000001bc16d674ec800000000000000000000000000000000000000000000000000000000000000000001 } }
PASS  [0.0000s]  settlane     the_none_state_is_first_and_codes_are_stable
                 settlane         log (none)
"""


def selftest():
    """Every negative case is built from a well-formed control and asserts its OWN reason
    (R-003 finding 4: a case that is rejected for the wrong reason proves nothing)."""
    cases = []

    def rejects(label, log, text):
        probs = " | ".join(decode(log)[1])
        cases.append((f"{label} [reason: {text}]", text in probs))

    good = make_log()
    ev, probs = decode(good)
    cases.append(("the well-formed control decodes with no problem", not probs and ev["id"] == 1 and ev["provider"] == A1 and ev["verifier"] == A2 and ev["total"] == 2 * ETHER and ev["n"] == 1))
    cases.append(("the control's data is exactly 3 words of 64 hex digits", len(good["data"]) - 2 == 192))
    cases.append(("topic0 is keccak256 of the event signature", TOPIC_CREATED == "0x5a4452b83280be38fc3f3026669c9535fc0f866883681db6ecef28ee26edd6b7"))
    sample = parse(SAMPLE % TOPIC_CREATED)
    one = sample[("settlane", "creates_a_single_milestone_agreement")]
    cases.append(("parses a result line, its log and a (none) log", len(one) == 1 and sample[("settlane", "the_none_state_is_first_and_codes_are_stable")] == [] and decode(one[0])[0]["client"] == 0xBD770416A3345F91E4B34576CB804A576FA48EB1))
    rejects("a wrong topic0", dict(good, topics=["0x" + "11" * 32] + good["topics"][1:]), "unknown event topic0")
    rejects("a missing topic", dict(good, topics=good["topics"][:3]), "must have 4 topics")
    rejects("short data (two words)", dict(good, data=good["data"][:-64]), "must be 3 words")
    rejects("malformed data (one digit too many)", dict(good, data=good["data"] + "0"), "must be 3 words")
    rejects("n = 0", make_log(n=0), "milestones 0 is not 1..3")
    rejects("n = 4", make_log(n=4), "milestones 4 is not 1..3")
    rejects("a zero total (well-formed otherwise)", make_log(total=0), "total is zero")
    rejects("a provider equal to the verifier", make_log(provider=A2), "not distinct")
    rejects("a client equal to the provider", make_log(client=A1), "not distinct")
    rejects("a zero client", make_log(client=0), "client is not a nonzero address")
    rejects("a client that is not an address", make_log(client=1 << 160), "client is not a nonzero address")
    rejects("a zero verifier", make_log(verifier=0), "verifier is not a nonzero address")
    rejects("a probe with data", dict(probe_log(0xBD), data="0x" + word(1)), "Probe must have 2 topics")
    cases.append(("the well-formed probe decodes", decode(probe_log(0xBD))[0]["who"] == 0xBD))
    # the client must be the real caller (R-003 finding 2)
    key = ("settlane", "t")
    probe = {"kind": "Probe", "who": 0xBD, "address": "x"}
    direct = {"kind": "Created", "id": 1, "client": 0xBD, "address": "y"}
    actor = {"kind": "Acted", "actor": 0xAC}
    via = {"kind": "Created", "id": 1, "client": 0xAC, "address": "y"}
    cases.append(("a direct call by the probed caller is accepted", not check_client(key, [probe, direct])))
    cases.append(("a direct call whose client is not the probed caller is rejected", any("is not the caller" in p for p in check_client(key, [probe, dict(direct, client=0xC1)]))))
    cases.append(("a direct call with no probe is rejected as unverified", any("no CallerProbe" in p for p in check_client(key, [direct]))))
    cases.append(("a call through the actor whose client is the actor is accepted", not check_client(key, [actor, via])))
    cases.append(("a call through the actor whose client is someone else is rejected", any("is not the Actor" in p for p in check_client(key, [actor, dict(via, client=0xC1)]))))
    cases.append(("an actor-called client equal to the probe is still rejected", any("is not the Actor" in p for p in check_client(key, [probe, actor, dict(via, client=0xBD)]))))
    cases.append(("two different probed callers in one test are rejected", any("different callers" in p for p in check_client(key, [probe, dict(probe, who=0xBE)]))))
    # sequences
    cases.append(("a mismatch with the expected sequence is reported", any("provider is" in p for p in check({("settlane", "creates_a_single_milestone_agreement"): [make_log(provider=B1)]})[0])))
    cases.append(("an unexpected event in a no-event test is reported", any("expected none" in p for p in check({NO_EVENTS[0]: [good]})[0])))
    cases.append(("a missing expected test is reported", any("did not run" in p for p in check({})[0])))
    ok = True
    for label, good_case in cases:
        print(("ok    " if good_case else "WRONG ") + label)
        ok &= bool(good_case)
    return ok


def main(argv):
    if "--selftest" in argv:
        return 0 if selftest() else 1
    proc = subprocess.run(["fe", "test", "--show-logs", "--jobs", "1", "ingots/settlane", "ingots/settlane-dev"], capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stdout.write(proc.stdout + proc.stderr)
        print("check_events: fe test failed")
        return 1
    logs = parse(proc.stdout)
    problems, checked = check(logs)
    for p in problems:
        print(f"check_events: {p}")
    if problems:
        print("check_events: FAILED")
        return 1
    print(f"check_events: ok ({checked} events decoded in {sum(1 for v in logs.values() if v)} tests, {len(EXPECTED)} exact sequences, every client verified against the real caller)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

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
  * the production contract and the dev test-clock shell emit identical events for the same call;
  * (Phase 2B) every MilestoneSubmitted / Approved / Rejected is decoded strictly, the events of each
    test are replayed as the milestone state machine of docs/LIFECYCLE.md (a Submit only from Funded
    or Submitted, a review only of a Submitted milestone and only naming the stored evidence, a
    Reject counting up by exactly one, nothing after Approved), and 11 tests have their exact
    transition sequence checked;
  * (Phase 3A) every MilestoneClaimed (topics: id, m, to; data: amount) is decoded strictly, the
    replay allows a Claim only of an Approved milestone and nothing after it (Paid is final), the
    amounts claimed from one agreement never exceed its total, and 6 tests have their exact claim
    sequence checked, including which contract paid (production or the shell). A claim whose
    transfer failed reverted with its event, so it must not appear.
  * (Phase 3B) every MilestoneRefunded (topics: id, m, to; data: amount) is decoded the same way;
    the replay allows a Refund only of a Funded or Submitted milestone and nothing after it
    (Refunded is final), what one agreement has paid and refunded together never exceeds its
    total, every test that emits a refund must have its exact refund sequence listed, and the
    listed tests are checked exactly (a refund whose transfer failed must not appear).

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
SUBMITTED_SIG = "MilestoneSubmitted(uint256,uint8,uint256,uint256)"
APPROVED_SIG = "MilestoneApproved(uint256,uint8,uint256,uint256)"
REJECTED_SIG = "MilestoneRejected(uint256,uint8,uint256,uint256,uint256)"
CLAIMED_SIG = "MilestoneClaimed(uint256,uint8,address,uint256)"
REFUNDED_SIG = "MilestoneRefunded(uint256,uint8,address,uint256)"
TOPIC_CREATED = "0x" + keccak256(CREATED_SIG.encode()).hex()
TOPIC_ACTED = "0x" + keccak256(ACTED_SIG.encode()).hex()
TOPIC_PROBE = "0x" + keccak256(PROBE_SIG.encode()).hex()
TOPIC_SUBMITTED = "0x" + keccak256(SUBMITTED_SIG.encode()).hex()
TOPIC_APPROVED = "0x" + keccak256(APPROVED_SIG.encode()).hex()
TOPIC_REJECTED = "0x" + keccak256(REJECTED_SIG.encode()).hex()
TOPIC_CLAIMED = "0x" + keccak256(CLAIMED_SIG.encode()).hex()
TOPIC_REFUNDED = "0x" + keccak256(REFUNDED_SIG.encode()).hex()
PAYOUT_KINDS = {TOPIC_CLAIMED: "Claimed", TOPIC_REFUNDED: "Refunded"}
TRANSITION_KINDS = ("Submitted", "Approved", "Rejected")
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
    if t[0] in (TOPIC_SUBMITTED, TOPIC_APPROVED, TOPIC_REJECTED):
        kind = {TOPIC_SUBMITTED: "Submitted", TOPIC_APPROVED: "Approved", TOPIC_REJECTED: "Rejected"}[t[0]]
        if len(t) != 4:
            return None, [f"Milestone{kind} must have 4 topics (hash, id, m, evidence), got {len(t)}"]
        w = words(log["data"])
        want = 2 if kind == "Rejected" else 1
        if w is None or len(w) != want:
            return None, [f"Milestone{kind} data must be {want} word(s), got {log['data']}"]
        tid, m, evidence = (int(x, 16) for x in t[1:])
        problems = []
        if tid == 0:
            problems.append("id is zero")
        if m > 2:
            problems.append(f"m {m} is not 0..2")
        if evidence == 0:
            problems.append("evidence is zero")
        revision = w[0]
        if revision == 0:
            problems.append("submission revision is zero")
        ev = {"kind": kind, "id": tid, "m": m, "evidence": evidence, "revision": revision, "address": log["address"]}
        if kind == "Rejected":
            ev["rejections"] = w[1]
            if w[1] == 0:
                problems.append("rejections is zero")
        return ev, problems
    if t[0] in PAYOUT_KINDS:
        kind = PAYOUT_KINDS[t[0]]
        if len(t) != 4:
            return None, [f"Milestone{kind} must have 4 topics (hash, id, m, to), got {len(t)}"]
        w = words(log["data"])
        if w is None or len(w) != 1:
            return None, [f"Milestone{kind} data must be 1 word (amount), got {log['data']}"]
        tid, m, to = (int(x, 16) for x in t[1:])
        problems = []
        if tid == 0:
            problems.append("id is zero")
        if m > 2:
            problems.append(f"m {m} is not 0..2")
        if not is_address(to):
            problems.append("payee is not a nonzero address")
        if w[0] == 0:
            problems.append(f"{kind.lower()} amount is zero")
        return {"kind": kind, "id": tid, "m": m, "to": to, "amount": w[0], "address": log["address"]}, problems
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


def S(i, m, e, revision=1):
    return ("Submitted", i, m, e, revision)


def A(i, m, e, revision=1):
    return ("Approved", i, m, e, revision)


def R(i, m, e, k, revision=1):
    return ("Rejected", i, m, e, revision, k)


# Exact expected transition events (Submitted, Approved, Rejected) in order, per test. A transition
# that reverts emits nothing, so these lists contain only the accepted steps.
EXPECTED_TRANSITIONS = {
    ("settlane_dev", "provider_submits_and_verifier_approves_on_production_with_the_real_clock"): [S(1, 0, 0xE1), A(1, 0, 0xE1), S(1, 1, 0xE2), A(1, 1, 0xE2)],
    ("settlane_dev", "only_the_provider_submits_and_only_the_verifier_reviews"): [S(1, 0, 0xE1), S(1, 1, 0xE2), A(1, 0, 0xE1), R(1, 1, 0xE2, 1)],
    ("settlane_dev", "evidence_must_match_and_stale_evidence_can_neither_be_approved_nor_rejected"): [S(1, 0, 0xE1), R(1, 0, 0xE1, 1), S(1, 0, 0xE2, 2), S(1, 0, 0xE3, 3), A(1, 0, 0xE3, 3)],
    ("settlane_dev", "replays_and_invalid_transitions_are_rejected_and_an_approved_milestone_never_changes"): [S(1, 0, 0xE1), S(1, 0, 0xE1, 2), A(1, 0, 0xE1, 2), S(2, 0, 0xE1), R(2, 0, 0xE1, 1), S(2, 0, 0xE2, 2)],
    ("settlane_dev", "an_approved_milestone_stays_immutable_through_every_deadline"): [S(1, 0, 0xE1), A(1, 0, 0xE1)],
    ("settlane_dev", "the_delivery_window_closes_exactly_at_deliver_by"): [S(1, 0, 0xE1), S(4, 0, 0xE1), S(5, 0, 0xE1), R(5, 0, 0xE1, 1)],
    ("settlane_dev", "the_review_window_closes_exactly_at_decide_by_and_a_late_submission_keeps_it_whole"): [S(i, 0, 0xE0 + i) for i in range(1, 7)] + [A(1, 0, 0xE1), A(2, 0, 0xE2), R(3, 0, 0xE3, 1)],
    ("settlane_dev", "agreements_are_isolated_and_milestones_are_independent"): [S(1, 0, 0xA0), S(1, 1, 0xA1), A(1, 0, 0xA0), R(1, 1, 0xA1, 1), S(2, 0, 0xB0), A(2, 0, 0xB0)],
    ("settlane_dev", "the_rejection_counter_counts_every_revision_request_and_never_decreases"): [S(1, 0, 0xC0), R(1, 0, 0xC0, 1), S(1, 0, 0xC1, 2), R(1, 0, 0xC1, 2, 2), S(1, 0, 0xC2, 3), R(1, 0, 0xC2, 3, 3), S(1, 0, 0xCF, 4), A(1, 0, 0xCF, 4)],
    ("settlane_dev", "transitions_are_not_payable_and_never_move_money"): [S(1, 0, 0xE1), A(1, 0, 0xE1)],
    ("settlane_dev", "unknown_agreements_and_unused_milestones_are_rejected_by_the_right_role_on_both_contracts"): [S(1, 0, 0xE1), S(1, 0, 0xE1)],
    ("settlane_dev", "restored_and_identical_evidence_require_a_fresh_review_revision"): [
        S(1, 0, 0xA1), S(1, 0, 0xB1, 2), S(1, 0, 0xA1, 3), R(1, 0, 0xA1, 1, 3),
        S(1, 0, 0xA1, 4), S(1, 0, 0xA1, 5), A(1, 0, 0xA1, 5),
    ],
    ("settlane_dev", "the_provider_claims_an_approved_milestone_and_is_paid_the_stored_amount_once"): [
        S(1, 1, 0xE2), A(1, 1, 0xE2), S(1, 0, 0xE1), A(1, 0, 0xE1), S(1, 2, 0xE3), A(1, 2, 0xE3)],
    ("settlane_dev", "only_the_provider_may_claim_and_only_an_approved_milestone_to_a_nonzero_payee"): [
        S(1, 0, 0xE1), R(1, 0, 0xE1, 1), S(1, 1, 0xE2), A(1, 1, 0xE2)],
    ("settlane_dev", "a_failed_transfer_reverts_the_whole_claim_and_a_retry_to_another_payee_succeeds"): [S(1, 1, 0xE2), A(1, 1, 0xE2)],
    ("settlane_dev", "a_reentrant_provider_is_paid_exactly_once"): [S(1, 0, 0xE1), A(1, 0, 0xE1)],
    ("settlane_dev", "claim_is_not_payable"): [S(1, 0, 0xE1), A(1, 0, 0xE1)],
    ("settlane_dev", "approval_never_expires_and_production_and_the_shell_agree_on_claims"): [
        S(1, 0, 0xE1), A(1, 0, 0xE1), S(1, 0, 0xE1), A(1, 0, 0xE1), S(1, 2, 0xE3), A(1, 2, 0xE3), S(1, 2, 0xE3), A(1, 2, 0xE3)],
    ("settlane_dev", "a_provider_that_always_re_enters_is_never_paid_under_the_stipend_and_never_twice"): [S(1, 0, 0xE1), A(1, 0, 0xE1), S(1, 1, 0xE2), A(1, 1, 0xE2)],
    ("settlane_dev", "a_provider_that_re_enters_once_with_whatever_gas_it_gets_cannot_be_paid"): [S(1, 0, 0xE1), A(1, 0, 0xE1), S(1, 1, 0xE2), A(1, 1, 0xE2)],
    ("settlane_dev", "a_payee_is_given_no_more_than_the_2300_gas_stipend"): [S(1, 0, 0xE1), A(1, 0, 0xE1)],
    ("settlane_dev", "precompile_payees_are_the_providers_own_choice_and_some_strand_the_eth"): [S(1, 0, 0xE1), A(1, 0, 0xE1), S(1, 1, 0xE2), A(1, 1, 0xE2)],
    ("settlane_dev", "the_client_refunds_expired_milestones_once_and_claim_and_refund_exclude_each_other"): [S(1, 1, 0xE2), S(1, 2, 0xE3), A(1, 2, 0xE3)],
    ("settlane_dev", "only_the_client_may_refund_and_only_an_expired_unpaid_milestone_to_a_nonzero_payee"): [S(1, 1, 0xE2), A(1, 1, 0xE2)],
    ("settlane_dev", "refund_boundaries_hold_at_d_minus_1_d_and_d_plus_1_in_every_slot_and_state"): [
        x for k in range(3) for x in (S(3, k, 0xD0 + k), S(4, k, 0xD0 + k))] + [S(5, 0, 0xE5), R(5, 0, 0xE5, 1)],
    ("settlane_dev", "a_failed_refund_transfer_reverts_the_whole_refund_and_a_retry_to_another_payee_succeeds"): [],
    ("settlane_dev", "a_client_that_always_re_enters_is_never_refunded_under_the_stipend_and_never_twice"): [],
    ("settlane_dev", "a_client_that_re_enters_once_with_whatever_gas_it_gets_cannot_be_refunded"): [],
    ("settlane_dev", "refund_is_not_payable_on_production_or_the_shell"): [],
    ("settlane_dev", "refunds_belong_to_each_agreements_client_and_accounting_holds_across_claims_and_refunds"): [
        S(1, 0, 0xA0), A(1, 0, 0xA0), S(2, 2, 0xB2), A(2, 2, 0xB2)],
    ("settlane_dev", "third_slot_revision_lifecycle_at_both_deadlines"): [
        S(1, 2, 0xD1), R(1, 2, 0xD1, 1), S(1, 2, 0xD2, 2), S(2, 2, 0xD3), S(3, 2, 0xD5), A(1, 2, 0xD2, 2), R(3, 2, 0xD5, 1),
    ],
}


PAYEE = 0x9B1
PAYEE2 = 0x9B2
LOOT = 0x9C1  # the third address of the always-re-entering attacker


def C(i, m, to, amount, contract=0):
    """A claim: `to` is an address or "provider" (the provider of that agreement, for contracts
    whose address the test derives at run time), `contract` is the index of the emitting contract
    in the order the contracts first created an agreement (0 production, 1 the shell)."""
    return (contract, i, m, to, amount)


# Exact expected MilestoneClaimed events in order, per test.
EXPECTED_CLAIMS = {
    ("settlane_dev", "the_provider_claims_an_approved_milestone_and_is_paid_the_stored_amount_once"): [
        C(1, 1, PAYEE, 2 * ETHER), C(1, 0, PAYEE, ETHER), C(1, 2, PAYEE2, 3 * ETHER)],
    ("settlane_dev", "only_the_provider_may_claim_and_only_an_approved_milestone_to_a_nonzero_payee"): [C(1, 1, PAYEE, 2 * ETHER)],
    ("settlane_dev", "a_failed_transfer_reverts_the_whole_claim_and_a_retry_to_another_payee_succeeds"): [C(1, 1, PAYEE, 2 * ETHER)],
    ("settlane_dev", "a_reentrant_provider_is_paid_exactly_once"): [C(1, 0, "provider", ETHER)],
    ("settlane_dev", "claim_is_not_payable"): [C(1, 0, PAYEE, ETHER)],
    ("settlane_dev", "a_provider_that_always_re_enters_is_never_paid_under_the_stipend_and_never_twice"): [C(1, 0, LOOT, ETHER), C(1, 1, PAYEE, 2 * ETHER)],
    # the control's nested claim (the fallback had real gas, and a stipend send to it succeeds)
    ("settlane_dev", "a_provider_that_re_enters_once_with_whatever_gas_it_gets_cannot_be_paid"): [C(1, 0, "provider", ETHER)],
    ("settlane_dev", "a_payee_is_given_no_more_than_the_2300_gas_stipend"): [C(1, 0, "any", ETHER)],  # the payee is a contract created at run time
    ("settlane_dev", "precompile_payees_are_the_providers_own_choice_and_some_strand_the_eth"): [C(1, 0, 4, ETHER), C(1, 1, 2, 2 * ETHER)],
    ("settlane_dev", "approval_never_expires_and_production_and_the_shell_agree_on_claims"): [
        C(1, 0, PAYEE, ETHER, 0), C(1, 0, PAYEE, ETHER, 1), C(1, 2, PAYEE, 3 * ETHER, 1)],
    ("settlane_dev", "the_client_refunds_expired_milestones_once_and_claim_and_refund_exclude_each_other"): [C(1, 2, PAYEE, 3 * ETHER)],
    ("settlane_dev", "refunds_belong_to_each_agreements_client_and_accounting_holds_across_claims_and_refunds"): [
        C(2, 2, PAYEE, 3 * ETHER), C(1, 0, PAYEE2, ETHER)],
}

# Exact expected MilestoneRefunded events in order, per test (same tuple as C). Every test that
# emits a refund must be listed here, so a refund cannot appear where none was intended.
EXPECTED_REFUNDS = {
    ("settlane", "production_refunds_are_never_expired_in_a_frozen_block_and_report_each_reason_in_order"): [],
    ("settlane_dev", "the_client_refunds_expired_milestones_once_and_claim_and_refund_exclude_each_other"): [
        C(1, 0, PAYEE, ETHER), C(1, 1, PAYEE2, 2 * ETHER)],
    ("settlane_dev", "only_the_client_may_refund_and_only_an_expired_unpaid_milestone_to_a_nonzero_payee"): [C(1, 0, PAYEE, ETHER)],
    ("settlane_dev", "refund_boundaries_hold_at_d_minus_1_d_and_d_plus_1_in_every_slot_and_state"): [
        x for k in range(3) for x in (C(1, k, 0x9B1, (k + 1) * ETHER), C(2, k, 0x9B2, (k + 1) * ETHER))]
        + [x for k in range(3) for x in (C(3, k, 0x9B3, (k + 1) * ETHER), C(4, k, 0x9B4, (k + 1) * ETHER))]
        + [C(5, 0, 0x9B5, ETHER)],
    ("settlane_dev", "a_failed_refund_transfer_reverts_the_whole_refund_and_a_retry_to_another_payee_succeeds"): [
        C(1, 1, PAYEE, 2 * ETHER), C(1, 0, "any", ETHER)],  # the second payee is a contract created at run time
    # the control's nested refund went to the third address; the attack itself emitted nothing
    ("settlane_dev", "a_client_that_always_re_enters_is_never_refunded_under_the_stipend_and_never_twice"): [
        C(1, 0, LOOT, ETHER), C(1, 1, PAYEE, 2 * ETHER)],
    # the control's nested refund went to the attacker, which is agreement 1's client
    ("settlane_dev", "a_client_that_re_enters_once_with_whatever_gas_it_gets_cannot_be_refunded"): [C(1, 0, "client", ETHER)],
    ("settlane_dev", "refund_is_not_payable_on_production_or_the_shell"): [C(1, 0, PAYEE, ETHER, 1)],
    ("settlane_dev", "refunds_belong_to_each_agreements_client_and_accounting_holds_across_claims_and_refunds"): [
        C(1, 1, PAYEE, 2 * ETHER), C(2, 0, PAYEE2, ETHER), C(2, 1, PAYEE2, 2 * ETHER), C(1, 2, PAYEE, 3 * ETHER)],
}


def payouts_of(evs, kind):
    """The claims ("Claimed") or refunds ("Refunded") of one test as C(..) tuples, resolving the
    emitter index and "provider" or "client" (a party whose address is derived at run time)."""
    emitters, parties, out = [], {}, []
    for e in evs:
        if e["kind"] == "Created":
            if e["address"] not in emitters:
                emitters.append(e["address"])
            parties[(e["address"], e["id"])] = (e.get("provider"), e.get("client"))
        elif e["kind"] == kind:
            idx = emitters.index(e["address"]) if e["address"] in emitters else -1
            provider, client = parties.get((e["address"], e["id"]), (None, None))
            to = "provider" if provider == e["to"] else "client" if client == e["to"] else e["to"]
            out.append((idx, e["id"], e["m"], to, e["amount"]))
    return out


def claims_of(evs):
    return payouts_of(evs, "Claimed")


def as_tuple(e):
    base = (e["kind"], e["id"], e["m"], e["evidence"], e["revision"])
    return base + ((e["rejections"],) if e["kind"] == "Rejected" else ())


def check_machine(key, evs):
    """Replay the events of one test as the milestone state machine of docs/LIFECYCLE.md and check
    each state and evidence transition against it: a Submit only from Funded or
    Submitted, an Approve or Reject only from Submitted and only naming the stored evidence, a
    Reject counting up by exactly one, and nothing after Approved."""
    problems = []
    state = {}  # (contract, id, m) -> [state, evidence, rejections, revision]
    sizes = {}  # (contract, id) -> milestones
    totals = {}  # (contract, id) -> [total, claimed and refunded so far]
    for e in evs:
        if e["kind"] == "Created":
            sizes[(e["address"], e["id"])] = e["n"]
            totals[(e["address"], e["id"])] = [e.get("total"), 0]
            for m in range(e["n"]):
                state[(e["address"], e["id"], m)] = ["Funded", 0, 0, 0]
            continue
        if e["kind"] not in TRANSITION_KINDS + ("Claimed", "Refunded"):
            continue
        k = (e["address"], e["id"], e["m"])
        label = f"{key[1]}: {e['kind']}(id {e['id']}, m {e['m']})"
        if (e["address"], e["id"]) not in sizes:
            problems.append(f"{label} on an agreement that was never created")
            continue
        if k not in state:
            problems.append(f"{label} on an unused milestone")
            continue
        st = state[k]
        if e["kind"] == "Claimed":
            if st[0] != "Approved":
                problems.append(f"{label} from {st[0]}, only an Approved milestone can be claimed")
            tot = totals[(e["address"], e["id"])]
            tot[1] += e["amount"]
            if tot[0] is not None and tot[1] > tot[0]:
                problems.append(f"{label}: claims and refunds total {tot[1]}, which exceeds the agreement total {tot[0]}")
            st[0] = "Paid"
            continue
        if e["kind"] == "Refunded":
            if st[0] not in ("Funded", "Submitted"):
                problems.append(f"{label} from {st[0]}, only a Funded or Submitted milestone can be refunded")
            tot = totals[(e["address"], e["id"])]
            tot[1] += e["amount"]
            if tot[0] is not None and tot[1] > tot[0]:
                problems.append(f"{label}: claims and refunds total {tot[1]}, which exceeds the agreement total {tot[0]}")
            st[0] = "Refunded"
            continue
        if e["kind"] == "Submitted":
            if st[0] not in ("Funded", "Submitted"):
                problems.append(f"{label} from {st[0]}")
            if e["revision"] != st[3] + 1:
                problems.append(f"{label} reports revision {e['revision']}, expected {st[3] + 1}")
            st[0], st[1], st[3] = "Submitted", e["evidence"], e["revision"]
        else:
            if st[0] != "Submitted":
                problems.append(f"{label} from {st[0]}, only a Submitted milestone can be reviewed")
            elif e["evidence"] != st[1]:
                problems.append(f"{label} names evidence {e['evidence']:#x} but {st[1]:#x} is stored")
            elif e["revision"] != st[3]:
                problems.append(f"{label} names revision {e['revision']}, expected {st[3]}")
            if e["kind"] == "Approved":
                st[0] = "Approved"
            else:
                if e["rejections"] != st[2] + 1:
                    problems.append(f"{label} reports rejections {e['rejections']}, expected {st[2] + 1}")
                st[0], st[1], st[2] = "Funded", 0, e["rejections"]
    return problems


# The test pairs where production and the shell are called alternately with identical inputs.
TRANSITION_DIFFERENTIAL = {
    ("settlane_dev", "production_and_the_shell_agree_on_every_step_of_a_transition_script"): [
        S(1, 0, 0xE1), R(1, 0, 0xE1, 1), S(1, 0, 0xE3, 2), A(1, 0, 0xE3, 2),
        S(1, 2, 0xE5), R(1, 2, 0xE5, 1), S(1, 2, 0xE5, 2), A(1, 2, 0xE5, 2),
    ],
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
        problems += check_machine(key, evs)
    for key, want in EXPECTED_TRANSITIONS.items():
        if key not in decoded:
            problems.append(f"expected test {key[1]} did not run")
            continue
        got = [as_tuple(e) for e in decoded[key] if e["kind"] in TRANSITION_KINDS]
        if got != want:
            problems.append(f"{key[1]}: transition events {got}, expected {want}")
    for key, want in EXPECTED_CLAIMS.items():
        if key not in decoded:
            problems.append(f"expected test {key[1]} did not run")
            continue
        got = claims_of(decoded[key])
        got = [g[:3] + ("any",) + g[4:] if w[3] == "any" else g for g, w in zip(got, want)] + got[len(want):]
        if got != want:
            problems.append(f"{key[1]}: claim events {got}, expected {want}")
    for key, want in EXPECTED_REFUNDS.items():
        if key not in decoded:
            problems.append(f"expected test {key[1]} did not run")
            continue
        got = payouts_of(decoded[key], "Refunded")
        got = [g[:3] + ("any",) + g[4:] if w[3] == "any" else g for g, w in zip(got, want)] + got[len(want):]
        if got != want:
            problems.append(f"{key[1]}: refund events {got}, expected {want}")
    for key, evs in decoded.items():
        if key not in EXPECTED_REFUNDS and any(e["kind"] == "Refunded" for e in evs):
            problems.append(f"{key[1]}: emits MilestoneRefunded but has no exact refund sequence in EXPECTED_REFUNDS")
    for key, want in TRANSITION_DIFFERENTIAL.items():
        if key not in decoded:
            problems.append(f"expected test {key[1]} did not run")
            continue
        emitters = [e["address"] for e in decoded[key] if e["kind"] == "Created"]
        if len(emitters) != 2 or emitters[0] == emitters[1]:
            problems.append(f"{key[1]}: expected one creation each from production and shell")
            continue
        expected = [(address, step) for step in want for address in emitters]
        got = [(e["address"], as_tuple(e)) for e in decoded[key] if e["kind"] in TRANSITION_KINDS]
        if got != expected:
            problems.append(f"{key[1]}: differential transition events {got}, expected {expected}")
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
    # Phase 2B: the three transition events, decoded strictly (each negative asserts its reason)
    def tlog(kind, i=1, m=0, e=0xE1, rej=1, revision=1):
        t0 = {"Submitted": TOPIC_SUBMITTED, "Approved": TOPIC_APPROVED, "Rejected": TOPIC_REJECTED}[kind]
        return {"address": "0x" + "d2" * 20, "topics": [t0, "0x" + word(i), "0x" + word(m), "0x" + word(e)], "data": "0x" + word(revision) + (word(rej) if kind == "Rejected" else "")}

    for kind in ("Submitted", "Approved", "Rejected"):
        ev, probs = decode(tlog(kind))
        cases.append((f"the well-formed Milestone{kind} control decodes", not probs and ev["kind"] == kind and ev["id"] == 1 and ev["m"] == 0 and ev["evidence"] == 0xE1))
    cases.append(("a Rejected control carries its rejection count", decode(tlog("Rejected", rej=3))[0]["rejections"] == 3))
    cases.append(("the three transition topics are distinct and match their signatures", len({TOPIC_SUBMITTED, TOPIC_APPROVED, TOPIC_REJECTED}) == 3 and TOPIC_SUBMITTED == "0x" + keccak256(SUBMITTED_SIG.encode()).hex()))
    for kind in ("Submitted", "Approved", "Rejected"):
        rejects(f"{kind}: zero evidence", tlog(kind, e=0), "evidence is zero")
        rejects(f"{kind}: m = 3", tlog(kind, m=3), "m 3 is not 0..2")
        rejects(f"{kind}: id zero", tlog(kind, i=0), "id is zero")
        rejects(f"{kind}: a missing topic", dict(tlog(kind), topics=tlog(kind)["topics"][:3]), "must have 4 topics")
    rejects("Rejected: zero rejections", tlog("Rejected", rej=0), "rejections is zero")
    rejects("Rejected: no data word", dict(tlog("Rejected"), data="0x"), "must be 2 word(s)")
    rejects("Submitted: an unexpected data word", dict(tlog("Submitted"), data="0x" + word(1) + word(1)), "must be 1 word(s)")
    # the state-machine replay (the logs alone must obey docs/LIFECYCLE.md)
    mk = ("settlane_dev", "t")
    def cr(i=1, n=2, a="c1"):
        return {"kind": "Created", "id": i, "n": n, "address": a}
    def tr(kind, i=1, m=0, e=0xE1, rej=1, a="c1", revision=1):
        return {"kind": kind, "id": i, "m": m, "evidence": e, "rejections": rej, "address": a, "revision": revision}
    good_run = [cr(), tr("Submitted"), tr("Rejected", rej=1), tr("Submitted", e=0xE2, revision=2), tr("Approved", e=0xE2, revision=2)]
    cases.append(("a legal Submit, Reject, Submit, Approve run replays cleanly", not check_machine(mk, good_run)))
    def machine_rejects(label, evs, text):
        cases.append((f"{label} [reason: {text}]", any(text in p for p in check_machine(mk, evs))))
    machine_rejects("an Approve with nothing submitted", [cr(), tr("Approved")], "from Funded")
    machine_rejects("a Reject with nothing submitted", [cr(), tr("Rejected")], "from Funded")
    machine_rejects("an Approve naming other evidence", [cr(), tr("Submitted"), tr("Approved", e=0x99)], "names evidence")
    machine_rejects("a Reject naming other evidence", [cr(), tr("Submitted"), tr("Rejected", e=0x99)], "names evidence")
    machine_rejects("a Submit that skips a revision", [cr(), tr("Submitted", revision=2)], "reports revision 2, expected 1")
    machine_rejects("an Approve naming a stale revision", good_run[:-1] + [tr("Approved", e=0xE2)], "names revision 1, expected 2")
    machine_rejects("a Reject naming a stale revision", good_run[:-1] + [tr("Rejected", e=0xE2)], "names revision 1, expected 2")
    machine_rejects("a Reject whose counter skips", [cr(), tr("Submitted"), tr("Rejected", rej=2)], "expected 1")
    machine_rejects("a replayed Reject", [cr(), tr("Submitted"), tr("Rejected"), tr("Rejected")], "from Funded")
    machine_rejects("a Submit after Approve", [cr(), tr("Submitted"), tr("Approved"), tr("Submitted", e=0xE2)], "from Approved")
    machine_rejects("a replayed Approve", [cr(), tr("Submitted"), tr("Approved"), tr("Approved")], "from Approved")
    machine_rejects("a Submit on an unused milestone", [cr(n=2), tr("Submitted", m=2)], "unused milestone")
    machine_rejects("a Submit on an agreement that was never created", [tr("Submitted")], "never created")
    machine_rejects("a transition on another contract's agreement", [cr(a="c1"), tr("Submitted", a="c2")], "never created")
    cases.append(("a replay keeps contracts separate: the same id on two contracts is fine", not check_machine(mk, [cr(a="c1"), cr(a="c2"), tr("Submitted", a="c1"), tr("Submitted", a="c2"), tr("Approved", a="c1")])))
    # Phase 3A: MilestoneClaimed, decoded strictly, and Claim in the replay
    def clog(i=1, m=0, to=PAYEE, amount=ETHER):
        return {"address": "0x" + "d2" * 20, "topics": [TOPIC_CLAIMED, "0x" + word(i), "0x" + word(m), "0x" + word(to)], "data": "0x" + word(amount)}

    ev, probs = decode(clog())
    cases.append(("the well-formed MilestoneClaimed control decodes", not probs and ev["kind"] == "Claimed" and ev["id"] == 1 and ev["m"] == 0 and ev["to"] == PAYEE and ev["amount"] == ETHER))
    cases.append(("the Claimed topic is keccak256 of its signature and distinct", TOPIC_CLAIMED == "0x" + keccak256(CLAIMED_SIG.encode()).hex() and TOPIC_CLAIMED not in (TOPIC_SUBMITTED, TOPIC_APPROVED, TOPIC_REJECTED, TOPIC_CREATED)))
    rejects("Claimed: zero amount", clog(amount=0), "claimed amount is zero")
    rejects("Claimed: zero payee", clog(to=0), "payee is not a nonzero address")
    rejects("Claimed: a payee wider than an address", clog(to=1 << 160), "payee is not a nonzero address")
    rejects("Claimed: m = 3", clog(m=3), "m 3 is not 0..2")
    rejects("Claimed: id zero", clog(i=0), "id is zero")
    rejects("Claimed: a missing topic", dict(clog(), topics=clog()["topics"][:3]), "must have 4 topics")
    rejects("Claimed: no data word", dict(clog(), data="0x"), "must be 1 word")
    rejects("Claimed: an extra data word", dict(clog(), data=clog()["data"] + word(1)), "must be 1 word")
    def cl(i=1, m=0, amount=ETHER, a="c1", to=PAYEE):
        return {"kind": "Claimed", "id": i, "m": m, "to": to, "amount": amount, "address": a}
    paid_run = [dict(cr(), total=3 * ETHER), tr("Submitted"), tr("Approved"), cl()]
    cases.append(("a legal Submit, Approve, Claim run replays cleanly", not check_machine(mk, paid_run)))
    machine_rejects("a Claim of a Funded milestone", [cr(), cl()], "from Funded")
    machine_rejects("a Claim of a Submitted milestone", [cr(), tr("Submitted"), cl()], "from Submitted")
    machine_rejects("a replayed Claim", paid_run + [cl()], "from Paid")
    machine_rejects("a Submit after a Claim", paid_run + [tr("Submitted", e=0xE2, revision=2)], "from Paid")
    machine_rejects("an Approve after a Claim", paid_run + [tr("Approved")], "from Paid")
    machine_rejects("a Reject after a Claim", paid_run + [tr("Rejected")], "from Paid")
    machine_rejects("a Claim on an unused milestone", [cr(n=1), cl(m=1)], "unused milestone")
    machine_rejects("a Claim on another contract's agreement", [cr(a="c1"), cl(a="c2")], "never created")
    machine_rejects("claims above the agreement total", [dict(cr(), total=ETHER), tr("Submitted"), tr("Approved"), cl(amount=2 * ETHER)], "exceeds the agreement total")
    cases.append(("claims that sum exactly to the total are fine", not check_machine(mk, [dict(cr(), total=3 * ETHER), tr("Submitted"), tr("Approved"), cl(), tr("Submitted", m=1), tr("Approved", m=1), cl(m=1, amount=2 * ETHER)])))
    ck = ("settlane_dev", "claim_is_not_payable")
    base = [make_log(), tlog("Submitted"), tlog("Approved")]
    cases.append(("an expected claim sequence that differs (wrong amount) is reported", any("claim events" in p for p in check({ck: base + [clog(amount=2 * ETHER)]})[0])))
    cases.append(("a missing expected claim is reported", any("claim events" in p for p in check({ck: base})[0])))
    cases.append(("claims_of resolves the provider and the emitting contract", claims_of([{"kind": "Created", "id": 1, "provider": 0xAB, "address": "p"}, {"kind": "Created", "id": 1, "provider": 0xAB, "address": "s"}, cl(to=0xAB, a="s")]) == [C(1, 0, "provider", ETHER, 1)]))
    # Phase 3B: MilestoneRefunded, decoded strictly, and Refund in the replay
    def rlog(i=1, m=0, to=PAYEE, amount=ETHER):
        return {"address": "0x" + "d2" * 20, "topics": [TOPIC_REFUNDED, "0x" + word(i), "0x" + word(m), "0x" + word(to)], "data": "0x" + word(amount)}

    ev, probs = decode(rlog())
    cases.append(("the well-formed MilestoneRefunded control decodes", not probs and ev["kind"] == "Refunded" and ev["id"] == 1 and ev["m"] == 0 and ev["to"] == PAYEE and ev["amount"] == ETHER))
    cases.append(("the Refunded topic is keccak256 of its signature and distinct", TOPIC_REFUNDED == "0x" + keccak256(REFUNDED_SIG.encode()).hex() and TOPIC_REFUNDED not in (TOPIC_CLAIMED, TOPIC_SUBMITTED, TOPIC_APPROVED, TOPIC_REJECTED, TOPIC_CREATED)))
    rejects("Refunded: zero amount", rlog(amount=0), "refunded amount is zero")
    rejects("Refunded: zero payee", rlog(to=0), "payee is not a nonzero address")
    rejects("Refunded: a payee wider than an address", rlog(to=1 << 160), "payee is not a nonzero address")
    rejects("Refunded: m = 3", rlog(m=3), "m 3 is not 0..2")
    rejects("Refunded: id zero", rlog(i=0), "id is zero")
    rejects("Refunded: a missing topic", dict(rlog(), topics=rlog()["topics"][:3]), "must have 4 topics")
    rejects("Refunded: an extra data word", dict(rlog(), data=rlog()["data"] + word(1)), "must be 1 word")
    def rf(i=1, m=0, amount=ETHER, a="c1", to=PAYEE):
        return {"kind": "Refunded", "id": i, "m": m, "to": to, "amount": amount, "address": a}
    cases.append(("a Refund of a Funded milestone replays cleanly", not check_machine(mk, [dict(cr(), total=3 * ETHER), rf()])))
    cases.append(("a Refund of a Submitted milestone replays cleanly", not check_machine(mk, [dict(cr(), total=3 * ETHER), tr("Submitted"), rf()])))
    cases.append(("a Refund after a Reject (Funded again) replays cleanly", not check_machine(mk, [dict(cr(), total=3 * ETHER), tr("Submitted"), tr("Rejected"), rf()])))
    machine_rejects("a Refund of an Approved milestone", [cr(), tr("Submitted"), tr("Approved"), rf()], "from Approved")
    machine_rejects("a replayed Refund", [cr(), rf(), rf()], "from Refunded")
    machine_rejects("a Refund after a Claim", paid_run + [rf()], "from Paid")
    machine_rejects("a Claim after a Refund", [cr(), rf(), cl()], "from Refunded")
    machine_rejects("a Submit after a Refund", [cr(), rf(), tr("Submitted")], "from Refunded")
    machine_rejects("a Refund on an unused milestone", [cr(n=1), rf(m=1)], "unused milestone")
    machine_rejects("a Refund on another contract's agreement", [cr(a="c1"), rf(a="c2")], "never created")
    machine_rejects("a claim and a refund above the agreement total", [dict(cr(), total=2 * ETHER), tr("Submitted"), tr("Approved"), cl(), rf(m=1, amount=2 * ETHER)], "exceeds the agreement total")
    rk = ("settlane_dev", "only_the_client_may_refund_and_only_an_expired_unpaid_milestone_to_a_nonzero_payee")
    rbase = [make_log(n=2, total=3 * ETHER)]
    cases.append(("the expected refund sequence control is accepted", not any("refund events" in p for p in check({rk: rbase + [rlog()]})[0])))
    cases.append(("an expected refund sequence that differs (wrong amount) is reported", any("refund events" in p for p in check({rk: rbase + [rlog(amount=2 * ETHER)]})[0])))
    cases.append(("an expected refund sequence that differs (wrong payee) is reported", any("refund events" in p for p in check({rk: rbase + [rlog(to=PAYEE2)]})[0])))
    cases.append(("a missing expected refund is reported", any("refund events" in p for p in check({rk: rbase})[0])))
    cases.append(("a refund in a test with no refund sequence is reported", any("no exact refund sequence" in p for p in check({ck: base + [rlog()]})[0])))
    cases.append(("payouts_of resolves the client", payouts_of([{"kind": "Created", "id": 1, "provider": 0xAB, "client": 0xCD, "address": "s"}, rf(to=0xCD, a="s")], "Refunded") == [C(1, 0, "client", ETHER, 0)]))
    cases.append(("an expected transition sequence that differs is reported", any("transition events" in p for p in check({("settlane_dev", "transitions_are_not_payable_and_never_move_money"): [tlog("Submitted"), tlog("Rejected")]})[0])))
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
    print(f"check_events: ok ({checked} events decoded in {sum(1 for v in logs.values() if v)} tests, {len(EXPECTED)} creation sequences and {len(EXPECTED_TRANSITIONS)} transition sequences and {len(EXPECTED_CLAIMS)} claim sequences and {len(EXPECTED_REFUNDS)} refund sequences checked exactly, every test replayed as the milestone state machine, every client verified against the real caller)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

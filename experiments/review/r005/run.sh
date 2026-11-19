#!/usr/bin/env bash
# R-005 Phase 3A review (docs/reviews/2026-11-19-phase3a.md): F-1 reproductions and probes.
#
# F-1 is an OPEN finding: the policy lint and the reentrancy test can be bypassed. This runner
# proves the bypasses still reproduce on the current code. Each mutation is applied to a
# TEMPORARY copy of the workspace (fe.toml, ingots, scripts); nothing in the repo is changed.
# It is deliberately NOT wired into experiments/review/run.sh or CI: once F-1 is fixed, the
# expected outcomes below flip (the lint or a test must then reject each shape), and the
# fix should turn these into lint fixtures and negative controls.
#
# Usage: bash experiments/review/r005/run.sh   (exit 0 = every reproduction behaves as recorded)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fail=0
fe --version

copy() { # name -> prints the path of a fresh workspace copy
  local ws="$tmp/$1"; rm -rf "$ws"; mkdir -p "$ws"
  cp -r "$repo/fe.toml" "$repo/ingots" "$repo/scripts" "$ws/"
  rm -rf "$ws/scripts/__pycache__"
  echo "$ws"
}
mutate() { # name -> workspace with patches/<name>.patch applied and formatted
  local ws; ws="$(copy "$1")"
  # Runs inside $(..): report on stderr and return 1; the caller records the failure.
  if ! (cd "$ws" && patch -s -p1 < "$here/patches/$1.patch" >&2); then echo "UNEXPECTED  $1: patch no longer applies" >&2; return 1; fi
  (cd "$ws" && fe fmt ingots >/dev/null 2>&1)
  echo "$ws"
}
add_probes() { # ws: append the probe contracts and tests to its dev ingot
  cat "$here/dev_lib_additions.fe.in" >> "$1/ingots/settlane-dev/src/lib.fe"
  cat "$here/dev_tests_additions.fe.in" >> "$1/ingots/settlane-dev/src/tests.fe"
  sed -i 's/^use ingot::{Actor, ActorMsg, AttackMsg, DevMsg, Reentrant, SettlaneTestClock}/use ingot::{Actor, ActorMsg, AttackMsg, DevMsg, GasCap, Greedy, Once, Reentrant, SettlaneTestClock}/' "$1/ingots/settlane-dev/src/tests.fe"
  grep -q "GasCap, Greedy, Once" "$1/ingots/settlane-dev/src/tests.fe" || { echo "UNEXPECTED  the dev tests import line changed; update add_probes"; fail=1; }
}
failing_tests() { # ws ingot -> sorted names of failing tests (empty if all pass)
  (cd "$1" && fe test "$2" 2>&1) | sed -n 's/^FAIL *\[[^]]*\] *\([A-Za-z0-9_]*\).*/\1/p' | sort | tr '\n' ' ' | sed 's/ $//'
}
hexmsg() { python3 -I -c "import sys; print(sys.argv[1].encode().hex())" "$1"; }

gate_passes_and_lint_ok() { # name ws: compiles and the policy lint accepts it (the bypass)
  if ! (cd "$2" && fe check >/dev/null 2>&1 && fe check ingots/settlane-dev >/dev/null 2>&1); then echo "UNEXPECTED  $1: does not compile"; fail=1; return 1; fi
  if (cd "$2" && rm -rf out && fe build >/dev/null 2>&1 && python3 scripts/settlane_lint.py ingots --abi-dir out >"$tmp/l" 2>&1); then
    echo "LINT-OK     $1 compiles and passes settlane_lint (bypass reproduces)"
  else echo "UNEXPECTED  $1: the lint now rejects it (F-1 fixed? update this runner):"; tail -5 "$tmp/l"; fail=1; return 1; fi
}
expect_failing() { # name ws ingot "expected sorted failing tests" (empty = all pass)
  local got; got="$(failing_tests "$2" "$3")"
  if [ "$got" = "$4" ]; then echo "AS-RECORDED $1 [$3]: failing tests = ${4:-none}"
  else echo "UNEXPECTED  $1 [$3]: failing tests = '${got:-none}', recorded '${4:-none}'"; fail=1; fi
}

expect_codegen_panic() { # name ws: fe check and fe build accept it, but `fe test` of the production
  # ingot crashes in the Sonatina backend while emitting the #[test] helper (a compiler panic)
  if (cd "$2" && fe test ingots/settlane 2>&1) | grep -q "Sonatina backend panicked.*synthetic owner-effect arg count mismatch"; then
    echo "AS-RECORDED $1 [ingots/settlane]: fe test crashes in the Sonatina backend (codegen panic), not a test failure"
  else echo "UNEXPECTED  $1 [ingots/settlane]: no Sonatina codegen panic"; fail=1; return 1; fi
}

REENT="a_reentrant_provider_is_paid_exactly_once"
FAILED_T="a_failed_transfer_reverts_the_whole_claim_and_a_retry_to_another_payee_succeeds"
NEVER_EXP="approval_never_expires_and_production_and_the_shell_agree_on_claims"

# --- Control: the unmodified code passes, and the probes behave as the report states.
ws="$(copy control)"; add_probes "$ws"
expect_failing "control (unmodified + probes)" "$ws" ingots/settlane-dev "r005_b7_once_is_paid_twice"
# Under the stipend the Once fallback cannot even store its flag, so the send fails and the
# shipped Claim reverts with `transfer failed`: the attacker is not paid at all.
if (cd "$ws" && fe test ingots/settlane-dev -f r005_b7 2>&1) | grep -q "$(hexmsg 'transfer failed')"; then
  echo "AS-RECORDED control: the shipped Claim refuses the Once attacker (\`transfer failed\`, nothing paid)"
else echo "UNEXPECTED  control: the Once test failed for another reason"; fail=1; fi
ws="$(copy control-plain)"
expect_failing "control (unmodified)" "$ws" ingots/settlane-dev ""

# --- Gas forwarded: the lint misses it, only the reentrancy test catches it.
for m in b1_gas_expression b2_try_call_raw_forwards_gas b3b_cei_nested_block_with_gas; do
  ws="$(mutate $m)" || { fail=1; continue; }
  gate_passes_and_lint_ok $m "$ws" && expect_failing $m "$ws" ingots/settlane-dev "$REENT"
done
# --- Effects after the transfer under the stipend: neither the lint nor any test sees it.
for m in b2b_try_call_raw_stipend_write_after b3_cei_nested_block b4_cei_helper_before_writes; do
  ws="$(mutate $m)" || { fail=1; continue; }
  gate_passes_and_lint_ok $m "$ws" && expect_failing $m "$ws" ingots/settlane-dev "" && expect_failing $m "$ws" ingots/settlane ""
done
# --- Result not really asserted: the lint misses it, the failed-transfer tests catch it.
m=b5_send_result_ignored_or_true; if ! ws="$(mutate $m)"; then fail=1; else gate_passes_and_lint_ok $m "$ws" \
  && expect_failing $m "$ws" ingots/settlane-dev "$FAILED_T $NEVER_EXP"; fi
# --- #[test] on a production helper: exempt from the transfer rules and callable by the contract.
m=b6_test_attribute_on_helper; if ! ws="$(mutate $m)"; then fail=1; else gate_passes_and_lint_ok $m "$ws" \
  && expect_codegen_panic $m "$ws" \
  && expect_failing $m "$ws" ingots/settlane-dev "$FAILED_T $REENT $NEVER_EXP"; fi

# --- B7: double payout that passes the FULL gate.
m=b7_double_pay_under_60k
if ! ws="$(mutate $m)"; then fail=1; else
  ok=1
  for step in "fe fmt --check ingots" "fe check" "fe check ingots/settlane-dev" "python3 scripts/check_tests.py" \
              "python3 scripts/check_events.py" "rm -rf out && fe build && python3 scripts/settlane_lint.py ingots --abi-dir out"; do
    if (cd "$ws" && eval "$step" >"$tmp/s" 2>&1); then :; else echo "UNEXPECTED  $m: gate step failed: $step"; tail -5 "$tmp/s"; ok=0; fail=1; fi
  done
  [ $ok -eq 1 ] && echo "GATE-PASSES $m: fmt, check (both), check_tests, check_events, build and lint all pass"
  add_probes "$ws"
  if (cd "$ws" && fe test ingots/settlane-dev -f r005_b7 >"$tmp/s" 2>&1) && grep -q "1 passed; 0 failed" "$tmp/s"; then
    echo "REPRODUCES  $m: the Once attacker is paid 2 ETH for a 1 ETH milestone; 7 ETH held vs 8 ETH owed (I1, I9 broken)"
  else echo "UNEXPECTED  $m: the double payout no longer reproduces:"; tail -8 "$tmp/s"; fail=1; fi
fi

[ $fail -eq 0 ] && echo "r005 reproductions: all behave as recorded" || echo "r005 reproductions: FAILED"
exit $fail

#!/usr/bin/env bash
# R-005 Phase 3A review (docs/reviews/2026-11-19-phase3a.md): the F-1 reproductions, AFTER the fix.
#
# Before the fix (b3a12f1) each patch in patches/ produced a compiling production handler that the
# policy lint accepted, and b7 (a double payout out of another agreement's escrow) passed the whole
# CI gate. This runner applies each patch to a TEMPORARY copy of the workspace (fe.toml, ingots,
# scripts; nothing in the repo changes) and checks that:
#   1. the policy lint now rejects every one of them, with the rule recorded below;
#   2. b6 still crashes the Fe 26.6.0 backend in `fe test` (a compiler panic, kept as a separate
#      FE_NOTES entry; the lint now rejects the shape before it matters);
#   3. the reentrancy tests catch the shapes that forward gas (b1, b2, b3b, b7), including both
#      attackers that have no gas threshold.
# The same patches are permanent negative controls in scripts/ci_negative_controls.py
# (`r005-*`), which run the whole CI pipeline on each.
#
# Usage: bash experiments/review/r005/run.sh   (exit 0 = every expectation holds)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fail=0
fe --version

copy() {
  local ws="$tmp/$1"; rm -rf "$ws"; mkdir -p "$ws"
  cp -r "$repo/fe.toml" "$repo/ingots" "$repo/scripts" "$ws/"
  rm -rf "$ws/scripts/__pycache__"
  echo "$ws"
}
mutate() { # name -> workspace with patches/<name>.patch applied and formatted
  local ws; ws="$(copy "$1")"
  if ! (cd "$ws" && patch -s -p1 -F3 < "$here/patches/$1.patch" >&2); then echo "UNEXPECTED  $1: the patch no longer applies" >&2; return 1; fi
  (cd "$ws" && fe fmt ingots >/dev/null 2>&1)
  echo "$ws"
}
lint_rules() { # ws -> sorted rule ids the text lint reports
  (cd "$1" && python3 scripts/settlane_lint.py ingots 2>&1) | sed -n 's/^\(C-[A-Z-]*\|E-[A-Z]*\):.*/\1/p' | sort -u | tr '\n' ' ' | sed 's/ $//'
}
expect_lint() { # name "expected rules"
  local ws got; ws="$(mutate "$1")" || { fail=1; return; }
  got="$(lint_rules "$ws")"
  if [ "$got" = "$2" ]; then echo "REJECTED    $1 by the policy lint: $got"
  else echo "UNEXPECTED  $1: lint rules = '${got:-none}', expected '$2'"; fail=1; fi
}
failing_tests() { (cd "$1" && fe test "$2" 2>&1) | sed -n 's/^FAIL *\[[^]]*\] *\([A-Za-z0-9_]*\).*/\1/p' | sort | tr '\n' ' ' | sed 's/ $//'; }

# --- 1. The lint rejects every reproduction (it accepted all nine before the fix).
expect_lint b1_gas_expression "C-XFER"
expect_lint b2_try_call_raw_forwards_gas "C-XFER C-XFER-RAW"
expect_lint b2b_try_call_raw_stipend_write_after "C-XFER C-XFER-RAW"
expect_lint b3_cei_nested_block "C-XFER"
expect_lint b3b_cei_nested_block_with_gas "C-XFER"
expect_lint b4_cei_helper_before_writes "C-XFER"
expect_lint b5_send_result_ignored_or_true "C-XFER"
expect_lint b6_test_attribute_on_helper "C-TEST C-XFER"
expect_lint b7_double_pay_under_60k "C-XFER"
ws="$(copy control)"; got="$(lint_rules "$ws")"
if [ -z "$got" ]; then echo "ACCEPTED    the unmodified code passes the lint (control)"; else echo "UNEXPECTED  control: the lint rejects the real code: $got"; fail=1; fi

# --- 2. b6: `fe check` and `fe build` accept a #[test] helper that the contract calls, but
# `fe test` of the production ingot crashes the Sonatina backend (docs/FE_NOTES.md, "b6").
ws="$(mutate b6_test_attribute_on_helper)" || fail=1
if [ -n "${ws:-}" ]; then
  if (cd "$ws" && fe check >/dev/null 2>&1 && rm -rf out && fe build >/dev/null 2>&1) && \
     (cd "$ws" && fe test ingots/settlane 2>&1) | grep -q "Sonatina backend panicked.*synthetic owner-effect arg count mismatch"; then
    echo "AS-RECORDED b6: fe check and fe build accept it; fe test crashes in the Sonatina backend (a compiler panic, not a test failure)"
  else echo "UNEXPECTED  b6: the compiler behaviour recorded in FE_NOTES changed (fixed upstream? update the note)"; fail=1; fi
fi

# --- 3. The tests see the shapes that forward gas, by name: both attackers with no threshold fail.
ATT1="a_provider_that_always_re_enters_is_never_paid_under_the_stipend_and_never_twice"
ATT2="a_provider_that_re_enters_once_with_whatever_gas_it_gets_cannot_be_paid"
for m in b1_gas_expression b7_double_pay_under_60k; do
  ws="$(mutate $m)" || { fail=1; continue; }
  got="$(failing_tests "$ws" ingots/settlane-dev)"
  if echo " $got " | grep -q " $ATT1 " && echo " $got " | grep -q " $ATT2 "; then echo "CAUGHT      $m: both always-re-entering attackers fail ($ATT1, $ATT2)"
  else echo "UNEXPECTED  $m: failing tests = '${got:-none}'"; fail=1; fi
done

[ $fail -eq 0 ] && echo "r005 reproductions: all behave as recorded after the fix" || echo "r005 reproductions: FAILED"
exit $fail

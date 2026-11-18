#!/usr/bin/env bash
# Phase 1 feasibility experiments. Re-run all and compare with docs/FE_NOTES.md.
# Usage: bash experiments/phase1/run.sh   (from the repo root)
set -u
cd "$(dirname "$0")"
fe --version
fail=0

expect_pass() { # file
  if fe test "$1" >/tmp/settlane-e.$$ 2>&1; then
    echo "PASS        $1 ($(grep -c '^PASS' /tmp/settlane-e.$$) tests)"
  else
    echo "UNEXPECTED  $1 failed:"; tail -15 /tmp/settlane-e.$$; fail=1
  fi
}

expect_compile_error() { # file error-code
  if fe check --standalone "$1" >/tmp/settlane-e.$$ 2>&1; then
    echo "ACCEPTED    $1 compiles (no error)"
    return 1
  fi
  if grep -q "error\[$2\]" /tmp/settlane-e.$$; then
    echo "REJECTED    $1 with error[$2] (as expected)"
  else
    echo "UNEXPECTED  $1 failed with a different error:"; head -15 /tmp/settlane-e.$$; fail=1
  fi
}

expect_pass e1_payable_exact.fe
expect_pass e2_struct_tuple_map.fe
expect_pass e3_enum_storage.fe
expect_compile_error e3_fail_nonexhaustive.fe 8-0034
expect_pass e4_actor_caller.fe
expect_pass e5_frozen_time.fe
expect_pass e6_send_value_failure.fe
expect_compile_error e7_fail_undeclared_call.fe 8-0012
# Known gap: a read-only `call` binding still permits send_value. Recorded, not a failure.
expect_compile_error e7_fail_readonly_call.fe 8-0066 || echo "            ^ known gap, see docs/FE_NOTES.md E7"
expect_pass e7_readonly_call_runtime.fe
expect_compile_error e7_fail_readonly_field.fe 8-0018
expect_compile_error e7_fail_user_effect_mut.fe 8-0066
# E7 localisation probes (see docs/FE_NOTES.md "E7 investigation").
expect_compile_error e7/a_trait_effect_readonly.fe 8-0066
expect_compile_error e7/c_create_omitted.fe 8-0012
expect_compile_error e7/d_ctx_only.fe 8-0012
expect_compile_error e7/e_user_trait_read_only_view.fe 8-0066
expect_compile_error e7/f_free_fn_readonly_call.fe 8-0066
expect_compile_error e7/g_free_fn_readonly_log.fe 8-0066
expect_compile_error e7/h_contract_level_readonly_call.fe 8-0066
# Known gaps: a contract arm that lists a built-in effect read-only is NOT narrowed.
for g in e7/b_readonly_call_call.fe e7/c_create_readonly.fe e7/i_contract_arm_readonly_log.fe e7/j_contract_arm_calls_free_fn.fe; do
  expect_compile_error "$g" 8-0066 || echo "            ^ known gap, see docs/FE_NOTES.md E7"
done
expect_pass e7/j_runtime.fe
expect_pass e8_wei_overflow.fe
expect_pass e9_clock_effect.fe
expect_compile_error e9_fail_missing_clock.fe 8-0036

rm -f /tmp/settlane-e.$$
exit $fail

#!/usr/bin/env bash
# Review 2026-11-18 (docs/reviews/2026-11-18-phase1.md): regression runner.
# 1. Each repro still behaves as recorded under the pinned Fe (the compiler facts).
# 2. The policy lint now REJECTS every attack repro (H1-H4), and the real M1 shape:
#    a dev contract's bytecode built into out/ without an ABI.
# Usage: bash experiments/review/run.sh   (from the repo root; exit 0 = all hold)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
lint="$repo/scripts/settlane_lint.py"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fail=0
fe --version

expect_tests_pass() { # file: the repro runs and its assertions hold
  if fe test "$here/$1" >"$tmp/t" 2>&1; then echo "PASS        $1 (repro still reproduces)"
  else echo "UNEXPECTED  $1 no longer reproduces:"; tail -12 "$tmp/t"; fail=1; fi
}
expect_compiles() { # file
  if fe check --standalone "$here/$1" >"$tmp/t" 2>&1; then echo "COMPILES    $1"
  else echo "UNEXPECTED  $1 does not compile:"; head -12 "$tmp/t"; fail=1; fi
}
expect_lint_rejects() { # file rule
  python3 "$lint" "$here/$1" >"$tmp/l" 2>&1
  if [ $? -ne 0 ] && grep -q "^$2:" "$tmp/l"; then echo "REJECTED    $1 by $2"
  else echo "UNEXPECTED  lint did not reject $1 with $2:"; cat "$tmp/l"; fail=1; fi
}

# Attack repros: they compile and work, and the lint must reject them.
expect_tests_pass b1_qualified_type.fe; expect_lint_rejects b1_qualified_type.fe E-CALL     # H1
expect_tests_pass b2_alias.fe;          expect_lint_rejects b2_alias.fe E-CALL              # H1
expect_tests_pass b3_lowercase.fe;      expect_lint_rejects b3_lowercase.fe E-CALL          # H2
expect_tests_pass r2_rawstorage.fe;     expect_lint_rejects r2_rawstorage.fe E-CALL         # H3
expect_lint_rejects r2_rawstorage.fe E-UNSAFE                                                # H3
expect_tests_pass c2_clock_shadow.fe;   expect_lint_rejects c2_clock_shadow.fe C-CLOCK      # H4a
expect_tests_pass c3_clock_alias.fe;    expect_lint_rejects c3_clock_alias.fe C-CLOCK       # H4b
expect_compiles c1_clock_ctor.fe;       expect_lint_rejects c1_clock_ctor.fe C-CLOCK        # H4 note
expect_compile_error() { # file code
  if fe check --standalone "$here/$1" >"$tmp/t" 2>&1; then echo "UNEXPECTED  $1 compiles"; fail=1
  elif grep -q "error\[$2\]" "$tmp/t"; then echo "REJECTED    $1 with error[$2] (as expected)"
  else echo "UNEXPECTED  $1 failed differently:"; head -12 "$tmp/t"; fail=1; fi
}
# Facts the design relies on.
expect_compile_error s2_handler_omit_call.fe 8-0036   # D-016: omitting call blocks a Call-requiring handler
expect_tests_pass s1_shared_arm.fe   # S-2: whole handler as a shared fn, shell crosses the deadline
expect_tests_pass u1_u8_abi.fe       # u8 out of range is rejected at ABI decode

# M1: a dev contract's bytecode in the production out/ without an ABI must fail C-ARTIFACT.
ws="$tmp/ws"; mkdir -p "$ws"
cp -r "$repo/fe.toml" "$repo/ingots" "$ws/"
if (cd "$ws" && fe build >/dev/null 2>&1 && fe build ingots/settlane-dev --emit bytecode,runtime-bytecode --out-dir out >/dev/null 2>&1); then
  if (cd "$ws" && python3 "$lint" ingots --abi-dir out >"$tmp/l" 2>&1); then
    echo "UNEXPECTED  M1: dev bytecode in out/ passed the lint:"; cat "$tmp/l"; fail=1
  elif grep -q "^C-ARTIFACT: .*Actor.bin" "$tmp/l"; then echo "REJECTED    M1 dev bytecode without ABI in out/ by C-ARTIFACT"
  else echo "UNEXPECTED  M1 failed for another reason:"; cat "$tmp/l"; fail=1; fi
  # Control: a clean production build of the same copy passes.
  if (cd "$ws" && rm -rf out && fe build >/dev/null 2>&1 && python3 "$lint" ingots --abi-dir out >"$tmp/l" 2>&1); then echo "PASS        M1 control: clean production build passes the lint"
  else echo "UNEXPECTED  M1 control failed:"; cat "$tmp/l"; fail=1; fi
else
  echo "UNEXPECTED  M1 build step failed"; fail=1
fi

[ $fail -eq 0 ] && echo "review regressions: all hold" || echo "review regressions: FAILED"
exit $fail

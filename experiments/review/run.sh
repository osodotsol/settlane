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

# R-002 finding 1: an arm with a numeric selector is callable but absent from the ABI JSON.
expect_abi_lacks() { # file function: the compiler warns, and the ABI JSON omits the function
  fe build --standalone "$here/$1" --out-dir "$tmp/abi-$1" >"$tmp/b" 2>&1
  if ! grep -q "skipping recv arm" "$tmp/b"; then echo "UNEXPECTED  $1: the compiler did not warn about the skipped arm:"; cat "$tmp/b"; fail=1; return; fi
  if python3 -I -c "import json,sys; a=json.load(open('$tmp/abi-$1/Settlane.abi.json')); sys.exit(1 if any(x.get('name','').lower()=='$2' for x in a) else 0)"; then
    echo "REJECTED    $1: callable arm \`$2\` is absent from the ABI JSON (the compiler warns \`skipping recv arm\`)"
  else echo "UNEXPECTED  $1: \`$2\` is in the ABI JSON"; fail=1; fi
}
expect_tests_pass a1_numeric_selector.fe;       expect_abi_lacks a1_numeric_selector.fe hidden
expect_lint_rejects a1_numeric_selector.fe C-ABI                                              # R-002 finding 1
# R-002 finding 2: the Clock is built as the lint requires and then changed before the handler.
expect_tests_pass d1_clock_var_mutation.fe;     expect_lint_rejects d1_clock_var_mutation.fe C-CLOCK
expect_tests_pass d2_clock_mut_effect.fe;       expect_lint_rejects d2_clock_mut_effect.fe C-CLOCK

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

# R-003 finding 3: the ABI lock covers the exact OUTPUT types and their order. Five edits to the
# outputs of the clean production build in $ws/out (all accepted before the fix) must be rejected.
if [ -f "$ws/out/Settlane.abi.json" ]; then
  python3 -I - "$ws/out" "$lint" "$ws" <<'PYEOF'
import json, shutil, subprocess, sys, tempfile, pathlib
out, lint, ws = map(pathlib.Path, sys.argv[1:4])
def fn(abi, name): return next(x for x in abi if x.get("name") == name)
def swap(abi): o = fn(abi, "getAgreement")["outputs"]; o[3], o[4] = o[4], o[3]
def widen(abi): fn(abi, "getMilestone")["outputs"][0]["type"] = "uint256"
def drop(abi): fn(abi, "getAccounting")["outputs"].pop()
def add(abi): fn(abi, "totalOutstanding")["outputs"].append({"name": "", "type": "uint256"})
def retype(abi): fn(abi, "getAgreement")["outputs"][0]["type"] = "uint256"
bad = 0
for label, edit in (("swap two outputs", swap), ("uint8 output widened", widen), ("an output dropped", drop), ("an output added", add), ("address output retyped", retype)):
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d) / "out"; shutil.copytree(out, d)
        p = d / "Settlane.abi.json"; abi = json.load(open(p)); edit(abi); json.dump(abi, open(p, "w"))
        r = subprocess.run(["python3", str(lint), "ingots", "--abi-dir", str(d)], cwd=ws, capture_output=True, text=True)
    if r.returncode != 0 and "outputs of" in r.stdout:
        print(f"REJECTED    R-003 f3: ABI output edit ({label}) by C-ABI")
    else:
        print(f"UNEXPECTED  R-003 f3: ABI output edit ({label}) was not rejected:\n{r.stdout}"); bad = 1
sys.exit(bad)
PYEOF
  [ $? -eq 0 ] || fail=1
else
  echo "UNEXPECTED  R-003 f3: no clean production ABI to edit"; fail=1
fi

[ $fail -eq 0 ] && echo "review regressions: all hold" || echo "review regressions: FAILED"
exit $fail

#!/usr/bin/env bash
# R-006 Phase 3B review (docs/reviews/2026-11-19-phase3b.md): L-1 and L-2 reproductions.
#
# L-1  A production arm whose clock is not `ctx.timestamp()` is invisible to every test for four of
#      the five arms (the test block never advances), so the policy lint is the only layer. This
#      freezes the clock of each arm at 0 in a TEMPORARY copy and requires the lint to reject it
#      with C-CLOCK; for the Refund arm it also shows `check_tests.py` stays green (which is the
#      finding). The same mutations are permanent negative controls `l1-*`.
# L-2  The original probe from the review (`cross_lib.fe.in`, `cross_tests.fe.in`): a payee that is
#      the client of one agreement and the provider of another and always re-enters the other
#      payout. Shipped code: both probe tests pass. With the refund transfer forwarding gas, the
#      probe's first test fails. The permanent versions are the dev tests
#      `a_refund_payee_that_re_enters_claim_..` and `a_claim_payee_that_re_enters_refund_..`.
# Nothing in the repository is changed.
#
# Usage: bash experiments/review/r006/run.sh   (exit 0 = every expectation holds)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fail=0
fe --version

copy() { local ws="$tmp/$1"; rm -rf "$ws"; mkdir -p "$ws"; cp -r "$repo/fe.toml" "$repo/ingots" "$repo/scripts" "$ws/"; rm -rf "$ws/scripts/__pycache__"; echo "$ws"; }

freeze() { # ws arm: replace the production clock of one arm of settlane.fe with a clock frozen at 0
  python3 - "$1" "$2" <<'PY'
import pathlib, re, sys
root, arm = pathlib.Path(sys.argv[1]), sys.argv[2]
p = root / "ingots/settlane/src/settlane.fe"; s = p.read_text()
clock = "Clock { now: ctx.timestamp() }"
hdr = re.search(rf"\n        (?:#\[payable\]\n        )?{arm} \{{", s)
assert hdr, arm
i = s.index(clock, hdr.end())
assert not re.search(r"\n        (?:#\[payable\]\n        )?[A-Z]\w* \{", s[hdr.end():i]), "clock of another arm"
p.write_text(s[:i] + "Clock { now: Timestamp::from_seconds(0) }" + s[i + len(clock):])
PY
}

# --- L-1: the lint rejects a frozen clock in every production arm.
for arm in Create Submit Approve Reject Refund; do
  ws="$(copy l1-$arm)"
  if ! freeze "$ws" "$arm"; then echo "UNEXPECTED  L-1 $arm: the mutation does not apply"; fail=1; continue; fi
  if (cd "$ws" && python3 scripts/settlane_lint.py ingots 2>&1) | grep -q '^C-CLOCK:'; then
    echo "REJECTED    L-1: the $arm arm with a clock frozen at 0 is rejected by C-CLOCK"
  else echo "UNEXPECTED  L-1 $arm: the lint accepted a frozen clock"; fail=1; fi
done
# The finding itself: for Refund the tests stay green (they cannot see it).
ws="$(copy l1-tests)"; freeze "$ws" Refund && (cd "$ws" && fe fmt ingots >/dev/null 2>&1)
if (cd "$ws" && python3 scripts/check_tests.py >"$tmp/t" 2>&1); then
  echo "AS-RECORDED L-1: with the Refund clock frozen at 0, every test still passes (only the lint can see it)"
else echo "UNEXPECTED  L-1: a test now catches a frozen Refund clock (update the finding and SECURITY.md)"; tail -5 "$tmp/t"; fail=1; fi

# --- L-2: the original probe, renamed so it does not clash with the permanent `Cross`.
probe() { # ws: append the probe contract and tests to the dev ingot
  sed 's/\bCross\b/CrossProbe/g' "$here/cross_lib.fe.in" >> "$1/ingots/settlane-dev/src/lib.fe"
  sed 's/\bCross\b/CrossProbe/g' "$here/cross_tests.fe.in" >> "$1/ingots/settlane-dev/src/tests.fe"
  sed -i '0,/^    Reentrant,$/s//    Reentrant,\n    CrossProbe,/' "$1/ingots/settlane-dev/src/tests.fe"
  (cd "$1" && fe fmt ingots >/dev/null 2>&1)
}
ws="$(copy l2-shipped)"; probe "$ws"
if (cd "$ws" && fe test ingots/settlane-dev -f r006_probe >"$tmp/p" 2>&1) && grep -q "2 passed; 0 failed" "$tmp/p"; then
  echo "AS-RECORDED L-2: shipped code, both probe tests pass (a refund to a payee that re-enters Claim fails, nothing settles)"
else echo "UNEXPECTED  L-2: the probe no longer passes on the shipped code:"; tail -8 "$tmp/p"; fail=1; fi
ws="$(copy l2-gas)"
python3 - "$ws" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "ingots/settlane/src/handlers.fe"; s = p.read_text()
i = s.index("pub fn refund_handler"); old = "call.send_value(addr: to, gas: 0, value: amount)"; j = s.index(old, i)
p.write_text(s[:j] + "call.send_value(addr: to, gas: 500000, value: amount)" + s[j + len(old):])
PY
probe "$ws"
if ! (cd "$ws" && fe test ingots/settlane-dev -f r006_probe_refund_payee >"$tmp/p" 2>&1) && grep -q "^FAIL.*r006_probe_refund_payee_reenters_claim_elsewhere" "$tmp/p"; then
  echo "CAUGHT      L-2: with the refund forwarding gas, the probe fails (the payee's nested claim landed)"
else echo "UNEXPECTED  L-2: the probe did not fail when the refund forwards gas:"; tail -8 "$tmp/p"; fail=1; fi

[ $fail -eq 0 ] && echo "r006 reproductions: all behave as recorded" || echo "r006 reproductions: FAILED"
exit $fail

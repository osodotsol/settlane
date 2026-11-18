#!/usr/bin/env python3
"""Settlane policy lint (standard library only).

Why this exists: Fe 26.6.0 does not narrow a `recv` arm that lists a built-in
effect read-only. An arm written `uses (call)` can still move ETH (see
docs/FE_NOTES.md, E7). Omitting `call` / `create` IS enforced by the compiler,
so this lint makes "only payout arms mention them" a failing CI check.

Rules (a violation exits 1):
  E-CALL      an arm or init that is not a listed payout arm lists a
              value-moving effect (Call, Create, Super, Evm) or its binding.
  E-BODY      such an arm's body references a value-moving binding.
  E-UNLISTED  a contract with value-moving effects is missing from the policy.
  E-DUP       a payout arm name (for example `Claim`) is also used by an arm of
              another message type in the same contract. Payout arms are
              identified by `Msg::Arm`, so a reused bare name cannot inherit
              the permission, and the reuse is rejected outright.
  E-PARSE     nothing was scanned (missing path, no .fe files), or a contract
              with value-moving effects has a `recv` but no arms could be
              parsed. The lint fails closed.
  C-CLOCK     a production contract builds a Clock from anything other than
              `Clock { now: ctx.timestamp() }`, or stores a Clock field.
  C-ABI       a production contract's ABI has a state-changing function whose
              name mentions time or clock (needs the `fe build` output).
  C-ARTIFACT  the build output directory contains an artifact for a contract
              marked `test_only` in the policy (for example the test-clock
              shell), or for a contract the policy does not list, or does
              not exist. Fails closed.

Usage:
  python3 scripts/settlane_lint.py src [--abi-dir out]
  python3 scripts/settlane_lint.py --selftest
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
POLICY_PATH = ROOT / "lint-policy.json"
FIXTURES = ROOT / "lint-fixtures"
TIME_NAME = re.compile(r"(time|clock|now|warp|timestamp)", re.I)


def strip_noise(src):
    """Blank out comments and string contents, keeping offsets and newlines."""
    out, i, n = [], 0, len(src)
    while i < n:
        if src.startswith("//", i):
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", src[i:j]))
            i = j
        elif src[i] == '"':
            j = i + 1
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            j = min(j + 1, n)
            out.append('"' + " " * max(j - i - 2, 0) + '"')
            i = j
        else:
            out.append(src[i])
            i += 1
    return "".join(out)


def match_close(text, open_idx):
    pairs = {"{": "}", "(": ")", "[": "]"}
    opener = text[open_idx]
    closer, depth = pairs[opener], 0
    for k in range(open_idx, len(text)):
        if text[k] == opener:
            depth += 1
        elif text[k] == closer:
            depth -= 1
            if depth == 0:
                return k
    return len(text) - 1


def split_top(s, sep=","):
    parts, depth, cur = [], 0, []
    for ch in s:
        if ch in "({[<":
            depth += 1
        elif ch in ")}]>":
            depth -= 1
        if ch == sep and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def uses_items(header):
    """Return [(name, type_or_None)] from the first `uses (...)` in header."""
    m = re.search(r"\buses\s*\(", header)
    if not m:
        return []
    start = m.end() - 1
    inner = header[start + 1 : match_close(header, start)]
    items = []
    for raw in split_top(inner):
        raw = re.sub(r"^mut\s+", "", raw)
        if ":" in raw:
            name, typ = raw.split(":", 1)
            typ = re.sub(r"^\s*mut\s+", "", typ).strip()
            typ = re.split(r"[<\s]", typ)[0]
            items.append((name.strip(), typ))
        else:
            items.append((raw.strip(), None))
    return items


def contracts_in(text):
    for m in re.finditer(r"\bcontract\s+(\w+)", text):
        brace = text.find("{", m.end())
        if brace < 0:
            continue
        close = match_close(text, brace)
        yield m.group(1), text[m.end() : brace], text[brace + 1 : close]


def arms_in(recv_body):
    """Split a recv body into (name, text) arms using brace depth at line start."""
    arms, depth, cur_name, cur = [], 0, None, []
    for line in recv_body.split("\n"):
        m = re.match(r"\s*(?:#\[[^\n]*\]\s*)*([A-Z]\w*)", line) if depth == 0 else None
        if m:
            if cur_name:
                arms.append((cur_name, "\n".join(cur)))
            cur_name, cur = m.group(1), []
        cur.append(line)
        depth += line.count("{") - line.count("}")
    if cur_name:
        arms.append((cur_name, "\n".join(cur)))
    return arms


def lint_text(text, policy, path="<src>"):
    """Return a list of (rule, message) violations for one source text."""
    text = strip_noise(text)
    value_types = set(policy["value_types"])
    found = []
    for cname, header, body in contracts_in(text):
        effects = uses_items(header)
        value_names = {n for n, t in effects if t in value_types}
        entry = policy["contracts"].get(cname)
        production = bool(entry and entry.get("production"))
        if value_names:
            if entry is None:
                found.append(("E-UNLISTED", f"{path}: contract {cname} has value-moving effects {sorted(value_names)} but is not in the policy"))
            else:
                allowed = set(entry.get("payout_arms", []))
                forbidden = value_names | {"call", "create"}
                bodies = re.findall(r"\brecv\b[^{]*\{", body)
                arms = []  # (message type, arm name, arm text)
                for m in re.finditer(r"\brecv\b[^{]*\{", body):
                    open_idx = m.end() - 1
                    mm = re.match(r"\brecv\s+([\w:]+)", m.group(0))
                    msg = mm.group(1) if mm else "?"
                    arms += [(msg, n, t) for n, t in arms_in(body[open_idx + 1 : match_close(body, open_idx)])]
                if bodies and not arms:
                    found.append(("E-PARSE", f"{path}: contract {cname}: recv found but no arms parsed"))
                for im in re.finditer(r"\binit\s*\(", body):
                    brace = body.find("{", im.end())
                    head = body[im.start() : brace if brace > 0 else len(body)]
                    bad = [n for n, t in uses_items(head) if n in forbidden or t in value_types]
                    if bad:
                        found.append(("E-CALL", f"{path}: {cname}.init lists {bad}"))
                for short in sorted({a.split("::")[-1] for a in allowed}):
                    owners = sorted(f"{msg}::{n}" for msg, n, _ in arms if n == short)
                    if len(owners) > 1:
                        found.append(("E-DUP", f"{path}: {cname}: payout arm name `{short}` is used by {owners}"))
                for msg, aname, atext in arms:
                    qualified = f"{msg}::{aname}"
                    if qualified in allowed:
                        continue
                    bad = [n for n, t in uses_items(atext) if n in forbidden or n in value_types or t in value_types]
                    if bad:
                        found.append(("E-CALL", f"{path}: {cname}.{qualified} lists {bad} but is not a payout arm {sorted(allowed)}"))
                        continue
                    refs = [n for n in sorted(forbidden) if re.search(rf"(?<![\w.]){re.escape(n)}\b", atext)]
                    if refs:
                        found.append(("E-BODY", f"{path}: {cname}.{qualified} references {refs}"))
        if production:
            full = header + "{" + body + "}"
            if re.search(r":\s*(?:mut\s+)?Clock\b", full):
                found.append(("C-CLOCK", f"{path}: production contract {cname} stores or requires a Clock"))
            for cm in re.finditer(r"\bClock\s*\{", full):
                open_idx = cm.end() - 1
                inner = re.sub(r"\s+", "", full[open_idx + 1 : match_close(full, open_idx)]).rstrip(",")
                if inner != "now:ctx.timestamp()":
                    found.append(("C-CLOCK", f"{path}: production contract {cname} builds Clock from `{inner}`"))
    return found


def check_abi(abi, cname):
    bad = []
    for item in abi:
        if item.get("type") == "function" and item.get("stateMutability") not in ("view", "pure"):
            if TIME_NAME.search(item.get("name", "")):
                bad.append(item["name"])
    return [("C-ABI", f"{cname}: state-changing time/clock functions in ABI: {bad}")] if bad else []


def check_artifacts(abi_dir, policy):
    d = pathlib.Path(abi_dir)
    if not d.is_dir():
        return [("C-ARTIFACT", f"{abi_dir}: build output directory missing, run `fe build` first")]
    found = []
    for p in sorted(d.glob("*.abi.json")):
        name = p.name[: -len(".abi.json")]
        entry = policy["contracts"].get(name)
        if entry is None:
            found.append(("C-ARTIFACT", f"{p}: built contract {name} is not listed in the policy"))
        elif entry.get("test_only"):
            found.append(("C-ARTIFACT", f"{p}: test-only contract {name} was built into the production output"))
    return found


def lint_tree(src_dir, policy, abi_dir=None):
    found = []
    seen_production = set()
    target = pathlib.Path(src_dir)
    if not target.exists():
        return [("E-PARSE", f"{src_dir}: path does not exist, nothing was scanned")]
    files = [target] if target.is_file() else sorted(target.rglob("*.fe"))
    if not files:
        return [("E-PARSE", f"{src_dir}: no .fe files found, nothing was scanned")]
    for f in files:
        text = f.read_text()
        found += lint_text(text, policy, str(f))
        for cname, _, _ in contracts_in(strip_noise(text)):
            if policy["contracts"].get(cname, {}).get("production"):
                seen_production.add(cname)
    if abi_dir is not None:
        found += check_artifacts(abi_dir, policy)
    for cname in sorted(seen_production):
        if abi_dir is None:
            continue
        p = pathlib.Path(abi_dir) / f"{cname}.abi.json"
        if not p.exists():
            found.append(("C-ABI", f"{p} missing: run `fe build` before the lint"))
        else:
            found += check_abi(json.loads(p.read_text()), cname)
    return found


def selftest(policy):
    ok = True
    for f in sorted(FIXTURES.glob("*.fe")):
        text = f.read_text()
        m = re.match(r"// EXPECT: (pass|fail)(?: ([A-Z,\-]+))?", text)
        assert m, f"{f.name}: missing EXPECT header"
        rules = {r for r, _ in lint_text(text, policy, f.name)}
        if m.group(1) == "pass":
            good = not rules
        else:
            good = rules == set(m.group(2).split(","))
        print(("ok    " if good else "WRONG ") + f"{f.name}: rules={sorted(rules)} expected={m.group(1)} {m.group(2) or ''}")
        ok &= good
    abi_bad = check_abi([{"type": "function", "name": "setTime", "stateMutability": "nonpayable"}], "Settlane")
    abi_ok = check_abi([{"type": "function", "name": "getNow", "stateMutability": "view"}, {"type": "function", "name": "approve", "stateMutability": "nonpayable"}], "Settlane")
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        t = pathlib.Path(tmp)
        (t / "Settlane.abi.json").write_text("[]")
        clean = check_artifacts(t, policy)
        (t / "SettlaneTestClock.abi.json").write_text("[]")
        shell = check_artifacts(t, policy)
        (t / "SettlaneTestClock.abi.json").unlink()
        (t / "Rogue.abi.json").write_text("[]")
        unlisted = check_artifacts(t, policy)
    for label, good in (
        ("artifacts: Settlane alone accepted", not clean),
        ("artifacts: test-only shell in output rejected", bool(shell) and "SettlaneTestClock" in shell[0][1]),
        ("artifacts: unlisted contract in output rejected", bool(unlisted)),
        ("artifacts: missing output directory rejected", bool(check_artifacts("/nonexistent-settlane-out", policy))),
        ("abi: setTime rejected", bool(abi_bad)),
        ("abi: view getNow and approve accepted", not abi_ok),
        ("fail-closed: missing path is an error", bool(lint_tree("/nonexistent-settlane-path", policy))),
        ("fail-closed: a directory with no .fe files is an error", bool(lint_tree(FIXTURES / "no-such-subdir", policy))),
    ):
        print(("ok    " if good else "WRONG ") + label)
        ok &= good
    return ok


def main(argv):
    policy = json.loads(POLICY_PATH.read_text())
    if "--selftest" in argv:
        return 0 if selftest(policy) else 1
    abi_dir = argv[argv.index("--abi-dir") + 1] if "--abi-dir" in argv else None
    targets = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--abi-dir")]
    found = []
    for t in targets or ["src"]:
        found += lint_tree(t, policy, abi_dir)
    for rule, msg in found:
        print(f"{rule}: {msg}")
    print("settlane-lint: FAILED" if found else "settlane-lint: ok")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

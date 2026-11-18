#!/usr/bin/env python3
"""Settlane policy lint (standard library only).

Why this exists: Fe 26.6.0 does not narrow a `recv` arm that lists a built-in
effect read-only. An arm written `uses (call)` can still move ETH (see
docs/FE_NOTES.md, E7). Omitting `call` / `create` IS enforced by the compiler,
so this lint makes "only payout arms mention them" a failing CI check.

Rules (a violation exits 1):
  E-CALL      an arm or init that is not a listed payout arm lists a
              privileged effect (Call, Create, Super, Evm, RawStorage, RawOps)
              or its binding. Effect types are normalised first: the last
              path segment is used (`std::evm::Call` is `Call`) and
              `use .. as X` / `type X = ..` aliases are resolved (review H1).
  E-BODY      such an arm's body references a privileged binding.
  E-UNLISTED  a contract with privileged effects is missing from the policy.
  E-EFFECT    a contract in the production ingot declares a contract-level
              effect whose type is not on the allowlist (Ctx, Log and the
              privileged types). Fails closed on anything the lint cannot
              resolve, such as an alias defined in another file (review H1).
  E-UNSAFE    the production ingot contains `unsafe` (raw storage writes are
              invisible to the access checker, review H3).
  E-SHADOW    the production ingot defines or imports-as a name that equals a
              std effect (Ctx, Log, Call, Create, ...), so a lookalike type
              cannot stand in for the real effect.
  E-DUP       a payout arm name (for example `Claim`) is also used by an arm of
              another message type in the same contract. Payout arms are
              identified by `Msg::Arm`, so a reused bare name cannot inherit
              the permission, and the reuse is rejected outright.
  E-PARSE     nothing was scanned (missing path, no .fe files), or a contract
              with privileged effects has a `recv` but no arms could be
              parsed, or one parsed arm holds more than one `uses (` header
              (two arms merged, review H2). Arm names may be any identifier,
              lowercase included. The lint fails closed.
  C-CLOCK     in the production ingot the identifier `Clock` may appear only in its
              declaration, in imports, in `uses (name: Clock)` lists (read-only), and in
              the one literal `with (Clock = Clock { now: ctx.timestamp() })`. A variable
              holding a Clock, a Clock parameter or return type, `mut Clock`, `with (Clock
              = mut ..)`, a `with` item other than that literal, or an assignment to
              `.now` lets code change the time between construction and the shared
              handler (R-002 finding 2). Also: anywhere in the production ingot, a Clock is built from anything
              other than `Clock { now: ctx.timestamp() }`, a production
              contract stores a Clock field, Clock is aliased (`type X =
              Clock`, `use .. Clock as X`), an `impl` block with a body targets
              Clock, a `uses` item named `ctx` has a type other than Ctx, or
              `ctx` appears anywhere except in a `uses (..)` list or as
              `ctx.method(..)`, so it cannot be shadowed by a lookalike with a
              `timestamp()` method (review H4).
  T-REVERT    a test uses `#[test(should_revert)]` without a `panic = ..`
              code. Any revert passes such a test, including one in its setup
              (review M2). Use `evm.try_call(..).success()` after a positive
              control instead.
  C-LAYOUT    a test-only contract is defined in the production ingot, a
              production or deployable contract is defined in the dev ingot,
              or an ingot directory is not classified in the policy.
  C-ABI       a production arm uses a selector that is not `sol("..")` (a numeric
              selector makes the arm callable but leaves it out of the ABI JSON, so
              the allowlist cannot see it, R-002 finding 1), or the number of
              `recv` arms in a production contract differs from the number of
              functions in its built ABI, or the production contract's ABI differs from its policy allowlist (every
              function with its mutability, every event with its indexed flags;
              any receive/fallback/error entry), or has a state-changing function whose
              name mentions time or clock (needs the `fe build` output).
  C-ARTIFACT  the build output is not exactly an allowlist: ANY file in it
              (.bin, .runtime.bin, .abi.json or other) belongs to a contract
              that is not marked `deployable` in the policy, has an unknown
              suffix, or is a directory; or it lacks the .bin, .runtime.bin or
              .abi.json of a deployable contract defined in the production
              ingot; or an artifact is older than the newest production source
              (stale, `fe build` never clears out/, review M1); or it does not
              exist. Fails closed.

Usage:
  python3 scripts/settlane_lint.py ingots [--abi-dir out]
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


def aliases_in(text):
    """Map alias -> target (last path segment) for `use .. X as Y` and `type Y = X`."""
    found = {}
    for m in re.finditer(r"\buse\b", text):
        nl = text.find("\n", m.end())
        nl = len(text) if nl < 0 else nl
        brace = text.find("{", m.end(), nl)
        end = match_close(text, brace) if brace >= 0 else nl
        for a in re.finditer(r"([\w:]+)\s+as\s+(\w+)", text[m.end() : end + 1]):
            found[a.group(2)] = a.group(1).split("::")[-1]
    for m in re.finditer(r"\btype\s+(\w+)\s*(?:<[^=\n]*>)?\s*=\s*([\w:]+)", text):
        found[m.group(1)] = m.group(2).split("::")[-1]
    return found


def norm_type(typ, aliases=None):
    """`mut std::evm::Call<..>` -> `Call`, then follow aliases (bounded)."""
    typ = re.sub(r"^\s*mut\s+", "", typ).strip()
    typ = re.split(r"[<\s]", typ)[0].split("::")[-1]
    for _ in range(10):
        if not aliases or typ not in aliases or aliases[typ] == typ:
            break
        typ = aliases[typ]
    return typ


def uses_items(header, aliases=None):
    """Return [(name, normalised type or None)] from the first `uses (...)` in header."""
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
            items.append((name.strip(), norm_type(typ, aliases)))
        else:
            items.append((raw.strip(), None))
    return items


def all_uses_items(text, aliases=None):
    """Every (name, type) from every `uses (...)` list in text."""
    items = []
    for m in re.finditer(r"\buses\s*\(", text):
        items += uses_items(text[m.start() :], aliases)
    return items


def blank_uses(text):
    """Blank the contents of every `uses (...)` list, keeping offsets."""
    out = list(text)
    for m in re.finditer(r"\buses\s*\(", text):
        start = m.end() - 1
        for k in range(start + 1, match_close(text, start)):
            if out[k] != "\n":
                out[k] = " "
    return "".join(out)


def contracts_in(text):
    for m in re.finditer(r"\bcontract\s+(\w+)", text):
        brace = text.find("{", m.end())
        if brace < 0:
            continue
        close = match_close(text, brace)
        yield m.group(1), text[m.end() : brace], text[brace + 1 : close]


def arms_in(recv_body):
    """Split a recv body into (name, text) arms using brace depth at line start.

    Any identifier starts an arm: Fe accepts lowercase msg variants, and a
    capital-only match let a lowercase arm merge into the arm before it (H2).
    """
    arms, depth, cur_name, cur = [], 0, None, []
    for line in recv_body.split("\n"):
        m = re.match(r"\s*(?:#\[[^\n]*\]\s*)*([A-Za-z_]\w*)", line) if depth == 0 else None
        # `fe fmt` wraps a long header so that `uses (..)` starts a line: that continues the
        # arm, it is not a new arm (found while counting arms against the ABI, R-002).
        if m and m.group(1) in ("uses", "where"):
            m = None
        if m:
            if cur_name:
                arms.append((cur_name, "\n".join(cur)))
            cur_name, cur = m.group(1), []
        cur.append(line)
        depth += line.count("{") - line.count("}")
    if cur_name:
        arms.append((cur_name, "\n".join(cur)))
    return arms


def classify(path, policy):
    """Return 'production', 'dev', or None (unclassified ingot) for a source path.

    Paths outside any `ingots/<name>/` directory are treated as production, which is
    the strict default.
    """
    parts = pathlib.PurePath(path).parts
    if "ingots" in parts:
        i = len(parts) - 1 - parts[::-1].index("ingots")
        if i + 1 < len(parts) - 1:
            return policy.get("ingots", {}).get(parts[i + 1])
    return "production"


def lint_text(text, policy, path="<src>", kind="production"):
    """Return a list of (rule, message) violations for one source text.

    kind is 'production' (strict) or 'dev' (test helpers). In a dev ingot, contracts the
    policy does not list, or lists with `value_rules: exempt`, may move value, but a
    production or deployable contract may not be defined there.
    """
    text = strip_noise(text)
    value_types = set(policy["value_types"])
    benign = set(policy.get("benign_contract_effects", ["Ctx", "Log"]))
    reserved = value_types | benign | {"Evm"}
    aliases = aliases_in(text)
    found = []
    if kind == "production":
        found += production_text_rules(text, aliases, reserved, path)
    for tm in re.finditer(r"#\[test\b([^\]]*)\]", text):
        if re.search(r"\bshould_revert\b", tm.group(1)) and not re.search(r"\bpanic\s*=", tm.group(1)):
            line = text.count("\n", 0, tm.start()) + 1
            found.append(("T-REVERT", f"{path}:{line}: bare `should_revert` passes on any revert; use try_call after a positive control, or give `panic = ..`"))
    for cname, header, body in contracts_in(text):
        effects = uses_items(header, aliases)
        value_names = {n for n, t in effects if t in value_types}
        entry = policy["contracts"].get(cname)
        production = bool(entry and entry.get("production"))
        if kind == "production":
            unknown = sorted(f"{n}: {t}" for n, t in effects if t is None or t not in value_types | benign)
            if unknown:
                found.append(("E-EFFECT", f"{path}: contract {cname} declares effects the lint cannot classify {unknown}; allowed: {sorted(value_types | benign)}"))
        if kind == "production" and entry and entry.get("test_only"):
            found.append(("C-LAYOUT", f"{path}: test-only contract {cname} is defined in the production ingot"))
        if kind == "dev" and entry and (entry.get("production") or entry.get("deployable")):
            found.append(("C-LAYOUT", f"{path}: production/deployable contract {cname} is defined in the dev ingot"))
        dev_exempt = kind == "dev" and (entry is None or entry.get("value_rules") == "exempt")
        if value_names and not dev_exempt:
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
                    bad = [n for n, t in uses_items(head, aliases) if n in forbidden or t in value_types]
                    if bad:
                        found.append(("E-CALL", f"{path}: {cname}.init lists {bad}"))
                for short in sorted({a.split("::")[-1] for a in allowed}):
                    owners = sorted(f"{msg}::{n}" for msg, n, _ in arms if n == short)
                    if len(owners) > 1:
                        found.append(("E-DUP", f"{path}: {cname}: payout arm name `{short}` is used by {owners}"))
                for msg, aname, atext in arms:
                    qualified = f"{msg}::{aname}"
                    headers = len(re.findall(r"\buses\s*\(", atext))
                    if headers > 1:
                        found.append(("E-PARSE", f"{path}: {cname}.{qualified}: {headers} `uses (` headers in one parsed arm, so arms were merged"))
                        continue
                    if qualified in allowed:
                        continue
                    bad = [n for n, t in uses_items(atext, aliases) if n in forbidden or n in value_types or t in value_types]
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
    if kind == "production":
        for cm in re.finditer(r"\bClock\s*\{", text):
            if re.search(r"(?:\bstruct|\bimpl\b[^{};]*)\s*$", text[: cm.start()]):
                continue  # `struct Clock {` and `impl .. Clock {` headers (impl is its own rule)
            open_idx = cm.end() - 1
            inner = re.sub(r"\s+", "", text[open_idx + 1 : match_close(text, open_idx)]).rstrip(",")
            if inner != "now:ctx.timestamp()":
                found.append(("C-CLOCK", f"{path}: production ingot builds Clock from `{inner}`"))
        for alias, target in aliases.items():
            if target == "Clock" and alias != "Clock":
                found.append(("C-CLOCK", f"{path}: production ingot aliases Clock as `{alias}`"))
        for im in re.finditer(r"\bimpl\b[^{};]*\bClock\s*\{", text):
            open_idx = im.end() - 1
            if text[open_idx + 1 : match_close(text, open_idx)].strip():
                found.append(("C-CLOCK", f"{path}: production ingot has an impl block with a body on Clock"))
        for n, t in all_uses_items(text, aliases):
            if n == "ctx" and t not in (None, "Ctx"):
                found.append(("C-CLOCK", f"{path}: `ctx` is bound to `{t}`, not Ctx"))
        # R-002 finding 1: every selector must be `sol("..")`, or the arm is callable but not in the ABI.
        for m in re.finditer(r"#\[\s*selector\s*=\s*(?=\S)(?!sol\s*\()", text):
            line = text.count("\n", 0, m.start()) + 1
            found.append(("C-ABI", f"{path}:{line}: a selector that is not `sol(\"..\")` makes the arm callable but missing from the ABI JSON, so the ABI allowlist cannot see it"))
        # R-002 finding 2: the Clock may be handled only in the permitted forms.
        scrub = blank_uses(text)
        scrub = re.sub(r"\buse\b[^\n{]*(?:\{[^}]*\})?[^\n]*", lambda m: re.sub(r"[^\n]", " ", m.group(0)), scrub)
        scrub = re.sub(r"\bstruct\s+Clock\b", lambda m: " " * len(m.group(0)), scrub)
        scrub = re.sub(r"\bClock\s*=\s*Clock\s*\{\s*now\s*:\s*ctx\s*\.\s*timestamp\s*\(\s*\)\s*,?\s*\}", lambda m: re.sub(r"[^\n]", " ", m.group(0)), scrub)
        for m in re.finditer(r"\bClock\b", scrub):
            line = scrub.count("\n", 0, m.start()) + 1
            found.append(("C-CLOCK", f"{path}:{line}: `Clock` is used outside its declaration, imports, `uses (name: Clock)` lists and `with (Clock = Clock {{ now: ctx.timestamp() }})`; it could be stored, passed or changed before a handler sees it"))
        for m in re.finditer(r"\bmut\s+Clock\b", text):
            line = text.count("\n", 0, m.start()) + 1
            found.append(("C-CLOCK", f"{path}:{line}: `mut Clock` lets a handler change the time"))
        for m in re.finditer(r"\.\s*now\s*(?:[-+*]?=)(?!=)", text):
            line = text.count("\n", 0, m.start()) + 1
            found.append(("C-CLOCK", f"{path}:{line}: assignment to `.now`: the Clock must never be modified"))
        for m in re.finditer(r"\bwith\s*\(", text):
            inner = text[m.end() : match_close(text, m.end() - 1)]
            for item in split_top(inner):
                if not re.fullmatch(r"Clock\s*=\s*Clock\s*\{\s*now\s*:\s*ctx\s*\.\s*timestamp\s*\(\s*\)\s*,?\s*\}", item.strip()):
                    line = text.count("\n", 0, m.start()) + 1
                    found.append(("C-CLOCK", f"{path}:{line}: `with ({item.strip()})` in the production ingot: only `with (Clock = Clock {{ now: ctx.timestamp() }})` is allowed"))
        blank = blank_uses(text)
        for m in re.finditer(r"(?<![\w.])ctx\b", blank):
            if not re.match(r"\s*\.\s*\w+\s*\(", blank[m.end() :]):
                line = blank.count("\n", 0, m.start()) + 1
                found.append(("C-CLOCK", f"{path}:{line}: `ctx` used other than as the Ctx effect (`ctx.method(..)`); it could be shadowed"))
    return found


def production_text_rules(text, aliases, reserved, path):
    """E-UNSAFE and E-SHADOW over one production source text (noise already stripped)."""
    found = []
    for m in re.finditer(r"\bunsafe\b", text):
        found.append(("E-UNSAFE", f"{path}:{text.count(chr(10), 0, m.start()) + 1}: `unsafe` is not allowed in the production ingot"))
    for m in re.finditer(r"\b(?:struct|enum|trait|type|msg|contract)\s+(\w+)", text):
        if m.group(1) in reserved:
            found.append(("E-SHADOW", f"{path}: production ingot defines `{m.group(1)}`, the name of a std effect"))
    for alias, target in aliases.items():
        if alias in reserved and alias != target:
            found.append(("E-SHADOW", f"{path}: production ingot aliases `{target}` as `{alias}`, the name of a std effect"))
    return found


def abi_type(item):
    """ABI type string of an input or output; tuples are expanded to `(t1,t2)`."""
    t = item["type"]
    if t.startswith("tuple"):
        return "(" + ",".join(abi_type(c) for c in item.get("components", [])) + ")" + t[len("tuple"):]
    return t


def abi_surface(abi):
    """(functions {signature: mutability}, events {signature}, other entry types) of an ABI.

    A function signature is `name(input types)->(output types)`, outputs in order: the lock
    covers the exact output types and their order, not only the inputs (R-003 finding 3).
    Output NAMES are empty in the compiled ABI, so two outputs of the same type in a swapped
    order cannot be told apart here. The tests check the meaning of each position."""
    funcs, events, other = {}, set(), []
    for item in abi:
        kind = item.get("type")
        if kind == "function":
            ins = ",".join(abi_type(i) for i in item.get("inputs", []))
            outs = ",".join(abi_type(o) for o in item.get("outputs", []))
            funcs[f"{item['name']}({ins})->({outs})"] = item.get("stateMutability")
        elif kind == "event":
            args = ",".join(i["type"] + (" indexed" if i.get("indexed") else "") for i in item.get("inputs", []))
            events.add(f"{item['name']}({args})")
        else:
            other.append(kind)
    return funcs, events, other


def check_abi_lock(abi, cname, lock):
    """The production ABI must equal the policy allowlist exactly (functions with their
    mutability, events with their indexed flags). A new entry point, a `view` that became
    `payable`, or a `receive`/`fallback`/`error` entry is a violation until the policy is
    changed in a reviewed change (docs/DECISIONS.md D-018 item 7)."""
    funcs, events, other = abi_surface(abi)
    want_f, want_e = lock.get("functions", {}), set(lock.get("events", []))
    found = []
    # Same name and inputs but different outputs is one finding, not an unknown plus a missing.
    want_by_head = {s.split("->")[0]: s for s in want_f}
    changed = set()
    for sig in sorted(set(funcs) - set(want_f)):
        head = sig.split("->")[0]
        if head in want_by_head:
            changed.add(want_by_head[head])
            found.append(("C-ABI", f"{cname}: outputs of {head} are ->{sig.split('->')[1]} but the allowlist says ->{want_by_head[head].split('->')[1]}"))
        else:
            found.append(("C-ABI", f"{cname}: function {sig} ({funcs[sig]}) is not in the ABI allowlist"))
    for sig in sorted(set(want_f) - set(funcs) - changed):
        found.append(("C-ABI", f"{cname}: allowlisted function {sig} is missing from the ABI"))
    for sig in sorted(set(funcs) & set(want_f)):
        if funcs[sig] != want_f[sig]:
            found.append(("C-ABI", f"{cname}: {sig} is {funcs[sig]}, the allowlist says {want_f[sig]}"))
    for sig in sorted(events - want_e):
        found.append(("C-ABI", f"{cname}: event {sig} is not in the ABI allowlist"))
    for sig in sorted(want_e - events):
        found.append(("C-ABI", f"{cname}: allowlisted event {sig} is missing from the ABI"))
    allowed_other = {"constructor"} if lock.get("constructor") else set()
    for kind in other:
        if kind not in allowed_other:
            found.append(("C-ABI", f"{cname}: ABI entry of type `{kind}` is not allowed"))
    return found


def check_abi(abi, cname, lock=None):
    bad = []
    for item in abi:
        if item.get("type") == "function" and item.get("stateMutability") not in ("view", "pure"):
            if TIME_NAME.search(item.get("name", "")):
                bad.append(item["name"])
            # A time-like input on a state-changing function is a clock from the caller (review H4).
            bad += [f"{item.get('name')}({i.get('name')})" for i in item.get("inputs", []) if TIME_NAME.search(i.get("name", ""))]
    found = [("C-ABI", f"{cname}: state-changing time/clock functions or inputs in ABI: {bad}")] if bad else []
    return found + (check_abi_lock(abi, cname, lock) if lock else [])


ARTIFACT_SUFFIXES = (".runtime.bin", ".abi.json", ".bin", ".metadata.json", ".sizes.txt")
REQUIRED_SUFFIXES = (".bin", ".runtime.bin", ".abi.json")


def check_artifacts(abi_dir, policy):
    """Every file in the build output must belong to a deployable contract (review M1).

    The old check globbed only `*.abi.json`, so `fe build <dev> --emit bytecode
    --out-dir out` left a test contract's `.bin` in out/ unseen.
    """
    d = pathlib.Path(abi_dir)
    if not d.is_dir():
        return [("C-ARTIFACT", f"{abi_dir}: build output directory missing, run `fe build` first")]
    found = []
    for p in sorted(d.iterdir()):
        if p.is_dir():
            found.append(("C-ARTIFACT", f"{p}: unexpected directory in the build output"))
            continue
        suffix = next((s for s in ARTIFACT_SUFFIXES if p.name.endswith(s) and len(p.name) > len(s)), None)
        if suffix is None:
            found.append(("C-ARTIFACT", f"{p}: unexpected file in the build output (not a known artifact type)"))
            continue
        name = p.name[: -len(suffix)]
        entry = policy["contracts"].get(name)
        if entry is None:
            found.append(("C-ARTIFACT", f"{p}: built contract {name} is not listed in the policy"))
        elif entry.get("test_only"):
            found.append(("C-ARTIFACT", f"{p}: test-only contract {name} was built into the production output"))
        elif not entry.get("deployable"):
            found.append(("C-ARTIFACT", f"{p}: contract {name} is not on the deployable allowlist"))
    return found


def check_fresh(abi_dir, cname, newest_source):
    """Required artifacts of a deployable contract exist and are newer than every production source."""
    found = []
    for suffix in REQUIRED_SUFFIXES:
        p = pathlib.Path(abi_dir) / f"{cname}{suffix}"
        if not p.exists():
            found.append(("C-ARTIFACT", f"{p} missing: deployable contract {cname} was not fully built (run `fe build`)"))
        elif newest_source is not None and p.stat().st_mtime < newest_source:
            found.append(("C-ARTIFACT", f"{p} is older than the newest production source (stale; `rm -rf out && fe build`)"))
    return found


def arm_count(text, cname):
    """Number of `recv` arms across all recv blocks of contract `cname` (noise already stripped)."""
    total = 0
    for name, _, body in contracts_in(text):
        if name != cname:
            continue
        for m in re.finditer(r"\brecv\b[^{]*\{", body):
            open_idx = m.end() - 1
            total += len(arms_in(body[open_idx + 1 : match_close(body, open_idx)]))
    return total


def check_arm_count(cname, arms, abi):
    """Every callable arm must be in the ABI: the counts must match (R-002 finding 1)."""
    funcs = sum(1 for x in abi if x.get("type") == "function")
    if arms != funcs:
        return [("C-ABI", f"{cname}: {arms} recv arms in the source but {funcs} functions in the built ABI, so an arm is callable but missing from the ABI (numeric selector?)")]
    return []


def lint_tree(src_dir, policy, abi_dir=None):
    found = []
    seen_production = set()
    arms_by_contract = {}
    target = pathlib.Path(src_dir)
    if not target.exists():
        return [("E-PARSE", f"{src_dir}: path does not exist, nothing was scanned")]
    files = [target] if target.is_file() else sorted(target.rglob("*.fe"))
    if not files:
        return [("E-PARSE", f"{src_dir}: no .fe files found, nothing was scanned")]
    seen_deployable = set()
    newest_source = None
    for f in files:
        kind = classify(f, policy)
        if kind is None:
            found.append(("C-LAYOUT", f"{f}: ingot directory is not classified in lint-policy.json"))
            continue
        text = f.read_text()
        found += lint_text(text, policy, str(f), kind)
        if kind == "production":
            newest_source = max(newest_source or 0, f.stat().st_mtime)
            for cname, _, _ in contracts_in(strip_noise(text)):
                entry = policy["contracts"].get(cname, {})
                if entry.get("production"):
                    seen_production.add(cname)
                    arms_by_contract[cname] = arms_by_contract.get(cname, 0) + arm_count(strip_noise(text), cname)
                if entry.get("deployable"):
                    seen_deployable.add(cname)
    if abi_dir is not None:
        found += check_artifacts(abi_dir, policy)
        for cname in sorted(seen_deployable):
            p = pathlib.Path(abi_dir) / f"{cname}.abi.json"
            found += check_fresh(abi_dir, cname, newest_source)
            if p.exists() and cname in seen_production:
                abi = json.loads(p.read_text())
                found += check_abi(abi, cname, policy["contracts"].get(cname, {}).get("abi"))
                found += check_arm_count(cname, arms_by_contract.get(cname, 0), abi)
    return found


def selftest(policy):
    ok = True
    for f in sorted(FIXTURES.glob("*.fe")):
        text = f.read_text()
        m = re.match(r"// EXPECT: (pass|fail)(?: ([A-Z,\-]+))?", text)
        assert m, f"{f.name}: missing EXPECT header"
        km = re.search(r"^// KIND: (production|dev)", text, re.M)
        rules = {r for r, _ in lint_text(text, policy, f.name, km.group(1) if km else "production")}
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
    import copy
    policy2 = copy.deepcopy(policy)
    policy2["contracts"]["Helper"] = {"note": "listed but not deployable"}
    with tempfile.TemporaryDirectory() as tmp:
        t = pathlib.Path(tmp)
        (t / "Helper.abi.json").write_text("[]")
        helper = check_artifacts(t, policy2)
    with tempfile.TemporaryDirectory() as tmp:
        t = pathlib.Path(tmp)
        for rel, body in (
            ("ingots/settlane/src/lib.fe", "pub contract SettlaneTestClock uses (ctx: Ctx) {}\n"),
            ("ingots/settlane-dev/src/lib.fe", "pub contract Settlane uses (ctx: Ctx) {}\n"),
            ("ingots/rogue/src/lib.fe", "pub contract Whatever uses (ctx: Ctx) {}\n"),
        ):
            (t / rel).parent.mkdir(parents=True, exist_ok=True)
            (t / rel).write_text(body)
        layout = {m for r, m in lint_tree(t / "ingots", policy) if r == "C-LAYOUT"}
    # Review M1: every file in out/ counts, not only *.abi.json, and artifacts must be fresh.
    import os
    import time
    with tempfile.TemporaryDirectory() as tmp:
        t = pathlib.Path(tmp)
        for suffix in REQUIRED_SUFFIXES:
            (t / f"Settlane{suffix}").write_text("00")
        complete = check_artifacts(t, policy) + check_fresh(t, "Settlane", time.time() - 60)
        (t / "Settlane.bin").unlink()
        missing_bin = check_fresh(t, "Settlane", None)
        (t / "Settlane.bin").write_text("00")
        past = time.time() - 3600
        os.utime(t / "Settlane.abi.json", (past, past))
        stale = check_fresh(t, "Settlane", time.time() - 60)
        (t / "Actor.bin").write_text("00")
        (t / "Actor.runtime.bin").write_text("00")
        dev_bytecode = check_artifacts(t, policy)
        (t / "Actor.bin").unlink()
        (t / "Actor.runtime.bin").unlink()
        (t / "Stale.marker").write_text("")
        unknown_file = check_artifacts(t, policy)
        (t / "Stale.marker").unlink()
        (t / "nested").mkdir()
        subdir = check_artifacts(t, policy)
    m1_checks = (
        ("artifacts: complete, fresh Settlane output accepted", not complete),
        ("artifacts: dev .bin/.runtime.bin without an ABI rejected (M1)", len(dev_bytecode) == 2 and all("Actor" in m for _, m in dev_bytecode)),
        ("artifacts: unknown file in output rejected (M1)", any("Stale.marker" in m for _, m in unknown_file)),
        ("artifacts: directory in output rejected (M1)", any("nested" in m for _, m in subdir)),
        ("artifacts: deployable missing its .bin rejected (M1)", any("Settlane.bin missing" in m for _, m in missing_bin)),
        ("artifacts: artifact older than the newest source rejected (M1)", any("older than" in m for _, m in stale)),
    )
    # Review H1: effect types are normalised before classification.
    al = aliases_in("use std::evm::{Ctx, Call as Pay}\ntype Wire = Pay\nuse std::evm::Create as Mk\n")
    norm_checks = (
        ("types: `mut std::evm::Call` normalises to Call (H1)", norm_type("mut std::evm::Call") == "Call"),
        ("types: alias chain Wire -> Pay -> Call resolved (H1)", norm_type("Wire", al) == "Call"),
        ("types: braced `use {.. Create as Mk}` resolved (H1)", norm_type("mut Mk", al) == "Create"),
    )
    prod_ok = classify("ingots/settlane/src/lib.fe", policy) == "production"
    dev_ok = classify("ingots/settlane-dev/src/tests.fe", policy) == "dev"
    base = {"type": "function", "inputs": [], "outputs": []}
    lock = {"functions": {"a()->()": "view", "b(uint256)->(uint256)": "payable", "c()->(uint8,uint256)": "view"}, "events": ["E(uint256 indexed,address)"]}
    out = lambda *types: [{"type": t, "name": ""} for t in types]
    good_abi = [dict(base, name="a", stateMutability="view"), dict(base, name="b", inputs=[{"type": "uint256", "name": "x"}], outputs=out("uint256"), stateMutability="payable"), dict(base, name="c", outputs=out("uint8", "uint256"), stateMutability="view"), {"type": "event", "name": "E", "inputs": [{"type": "uint256", "indexed": True, "name": "i"}, {"type": "address", "indexed": False, "name": "o"}]}]
    def with_outputs(name, *types):
        return [dict(x, outputs=out(*types)) if x.get("name") == name else x for x in good_abi]
    def abi_with(extra=(), drop=(), edit=None):
        out = [x for x in good_abi if x.get("name") not in drop] + list(extra)
        return [dict(x, **(edit or {})) if x.get("name") == "a" else x for x in out]
    lock_checks = (
        ("abi lock: exact match accepted", not check_abi_lock(good_abi, "S", lock)),
        ("abi lock: an extra harmless function rejected", any("ping()" in m for _, m in check_abi_lock(abi_with([dict(base, name="ping", stateMutability="view")]), "S", lock))),
        ("abi lock: a view that became payable rejected", any("payable" in m for _, m in check_abi_lock(abi_with(edit={"stateMutability": "payable"}), "S", lock))),
        ("abi lock: a missing function rejected", any("missing" in m for _, m in check_abi_lock(abi_with(drop=("b",)), "S", lock))),
        ("abi lock: an extra event rejected", any("event F" in m for _, m in check_abi_lock(abi_with([{"type": "event", "name": "F", "inputs": []}]), "S", lock))),
        ("abi lock: an event whose indexed flag changed rejected", bool(check_abi_lock([x for x in good_abi if x.get("type") != "event"] + [{"type": "event", "name": "E", "inputs": [{"type": "uint256", "indexed": False, "name": "i"}, {"type": "address", "indexed": False, "name": "o"}]}], "S", lock))),
        ("abi lock: a receive entry rejected", any("receive" in m for _, m in check_abi_lock(abi_with([{"type": "receive", "stateMutability": "payable"}]), "S", lock))),
        ("abi lock: a fallback entry rejected", any("fallback" in m for _, m in check_abi_lock(abi_with([{"type": "fallback", "stateMutability": "payable"}]), "S", lock))),
        ("abi lock: wired through check_abi", any("ping()" in m for _, m in check_abi(abi_with([dict(base, name="ping", stateMutability="view")]), "S", lock))),
        # R-003 finding 3: the exact output types and their order
        ("abi lock: an output type changed (uint256 -> uint8) rejected, naming the function", any("outputs of b(uint256)" in m and "uint8" in m for _, m in check_abi_lock(with_outputs("b", "uint8"), "S", lock))),
        ("abi lock: two outputs in swapped order rejected", any("outputs of c()" in m and "(uint256,uint8)".strip("()") in m for _, m in check_abi_lock(with_outputs("c", "uint256", "uint8"), "S", lock))),
        ("abi lock: a dropped output rejected", any("outputs of c()" in m for _, m in check_abi_lock(with_outputs("c", "uint8"), "S", lock))),
        ("abi lock: an added output rejected", any("outputs of a()" in m for _, m in check_abi_lock(with_outputs("a", "uint256"), "S", lock))),
        ("abi lock: an address output changed to uint256 rejected", any("outputs of" in m for _, m in check_abi_lock(with_outputs("b", "address"), "S", lock))),
        ("abi lock: a changed output is one finding, not an unknown plus a missing function", len(check_abi_lock(with_outputs("b", "uint8"), "S", lock)) == 1),
        ("abi lock: tuple outputs are expanded, so a component change is seen", abi_type({"type": "tuple[]", "components": [{"type": "uint8"}, {"type": "address"}]}) == "(uint8,address)[]"),
    )
    wrapped = strip_noise((FIXTURES / "ok_wrapped_payout_arm.fe").read_text())
    numeric = strip_noise((FIXTURES / "bad_numeric_selector_arm.fe").read_text())
    abi5 = [dict(base, name=f"f{i}", stateMutability="view") for i in range(5)]
    arm_checks = (
        ("arm count: a wrapped `uses (..)` header is not a second arm", arm_count(wrapped, "Settlane") == 2),
        ("arm count: matching arms and ABI functions accepted", not check_arm_count("S", 5, abi5)),
        ("arm count: an arm missing from the ABI rejected (numeric selector, R-002)", any("missing from the ABI" in m for _, m in check_arm_count("S", 6, abi5))),
        ("arm count: the numeric-selector fixture has 2 arms and the compiler ABI would list 1", arm_count(numeric, "Settlane") == 2),
        ("selector rule: `sol(..)`, with or without spaces, is accepted", not [1 for t in ('#[selector = sol("a()")]', '#[selector=sol( "a()" )]', "#[selector =  sol(\"a()\")]") if re.search(r"#\[\s*selector\s*=\s*(?=\S)(?!sol\s*\()", strip_noise(t))]),
        ("selector rule: a numeric selector is rejected (R-002)", all(re.search(r"#\[\s*selector\s*=\s*(?=\S)(?!sol\s*\()", t) for t in ("#[selector = 0x1badc0de]", "#[selector=7]", "#[selector =  0xdeadbeef]"))),
    )
    for label, good in lock_checks + arm_checks:
        print(("ok    " if good else "WRONG ") + label)
        ok &= good
    for label, good in (
        ("artifacts: Settlane (deployable) accepted", not clean),
        ("artifacts: listed but non-deployable contract rejected", bool(helper)),
        ("layout: test-only contract in the production ingot rejected", any("SettlaneTestClock" in m and "production ingot" in m for m in layout)),
        ("layout: production contract in the dev ingot rejected", any("Settlane is defined in the dev" in m or "contract Settlane is" in m for m in layout)),
        ("layout: unclassified ingot directory rejected", any("not classified" in m for m in layout)),
        ("layout: ingot paths classified production/dev", prod_ok and dev_ok),
        ("artifacts: test-only shell in output rejected", bool(shell) and "SettlaneTestClock" in shell[0][1]),
        ("artifacts: unlisted contract in output rejected", bool(unlisted)),
        ("artifacts: missing output directory rejected", bool(check_artifacts("/nonexistent-settlane-out", policy))),
        ("abi: setTime rejected", bool(abi_bad)),
        ("abi: view getNow and approve accepted", not abi_ok),
        ("abi: state-changing function with a time-like input rejected (H4)", bool(check_abi([{"type": "function", "name": "refund", "inputs": [{"name": "id"}, {"name": "now"}], "stateMutability": "nonpayable"}], "Settlane"))),
        ("fail-closed: missing path is an error", bool(lint_tree("/nonexistent-settlane-path", policy))),
        ("fail-closed: a directory with no .fe files is an error", bool(lint_tree(FIXTURES / "no-such-subdir", policy))),
        *m1_checks,
        *norm_checks,
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
    for t in targets or ["ingots"]:
        found += lint_tree(t, policy, abi_dir)
    for rule, msg in found:
        print(f"{rule}: {msg}")
    print("settlane-lint: FAILED" if found else "settlane-lint: ok")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

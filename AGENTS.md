# Settlane — agent instructions (Codex and other reviewers)

Settlane is a Fe 26.6 EVM contract for milestone-based settlement. Claude Code is the primary builder. **Your role is independent reviewer**: find defects, unsupported Fe usage, and missing tests. Do not reimplement features.

## Rules
- Work only on the assignment in `docs/HANDOFF.md`. Stay inside its file scope and acceptance criteria.
- Do not edit `ingots/` unless the handoff explicitly allows it. Put findings in the handoff's review section, or in a new `docs/reviews/<date>-<topic>.md`.
- Reproduce before reporting. A finding needs a concrete input or sequence, the expected result, the actual or predicted result, and a severity: critical (fund loss or lock), high (wrong settlement), medium, or low.
- The spec is `docs/LIFECYCLE.md` and the invariants are in `docs/SECURITY.md`. If code and spec disagree, report it as a finding.
- Fe facts: `docs/FE_NOTES.md`. If you think Fe syntax is wrong, check it with `fe check` before asserting it.
- Never push, create remotes, or commit secrets. Do not commit unless the handoff says to.

## Commands
```sh
fe --version            # expect fe 26.6.0
fe fmt --check ingots && fe check && fe check ingots/settlane-dev
python3 scripts/check_tests.py     # runs fe test for BOTH ingots; a bare `fe test` runs only the production ingot
rm -rf out && fe build && python3 scripts/settlane_lint.py ingots --abi-dir out
bash experiments/review/run.sh     # review 2026-11-18 regressions (docs/reviews/2026-11-18-phase1.md)
bash experiments/anvil/install_foundry.sh && python3 experiments/anvil/run.py --mutations   # production bytecode on a local Anvil (CI job `anvil`)
```

Skill: `.agents/skills/independent-review/SKILL.md`.

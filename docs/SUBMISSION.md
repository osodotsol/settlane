# Submission checklist

Requirements verified against https://fe-lang.org/contest/ and the starter README on 2026-11-17. The root `SUBMISSION.md` is the organizers' README template. This file tracks readiness only. Never record the project ID or submission link here.

| Requirement | Status |
| --- | --- |
| Registration by 2026-11-17 23:59 UTC (owner) | **unknown, owner must confirm** |
| Registration email with project ID and private link received | unknown |
| Public GitHub repo under the owner's account | **published**: https://github.com/osodotsol/settlane (commit `22cf736`). `origin` stays the starter, push disabled (D-010). |
| OSI license (Apache-2.0 kept, or replaced) | present |
| `fe.toml` workspace manifest; production ingot named `settlane` | done (D-014). Folder rename and repo remote pending (D-010) |
| Exact Fe version stated (`fe 26.6.0`), CI on 26.6.0 | stated in README; CI installs the v26.6.0 asset by SHA-256 (D-029); **first hosted run green** (run 44854564457, all three jobs) |
| Reproducible build and test instructions (`python3 scripts/check_tests.py`, `fe build`); clean-clone check | in README; clean-clone check from the public repository not done |
| Automated tests appropriate to the project | 90 tests (43 production, 47 dev) plus event checker, policy lint, test gate, Anvil suite and 142 CI negative controls (D-029). |
| README covering problem, approach, architecture, limitations | done (D-029); owner fields Team and AI wording open |
| One-sentence pitch and one Fe-specific highlight with a code excerpt | done in README (Clock effect, omission-enforced `Call`) |
| Demo: reproducible CLI example | README: Sepolia transaction table plus read-only `verify_deployment.py` command, and the local test commands |
| Declaration of pre-existing work (starter commit `0646e48`/`f9d9aa9`), third-party code, AI assistance (Claude Code, Codex) | in README (base `f9d9aa9`, no third-party contract code); owner to confirm the AI wording, including whether Codex should be named |
| Full commit SHA submitted | not started |
| Organizer acceptance email (the form receipt alone is not confirmation) | not started |
| Reply to organizer clarifications within 48 h | note for Nov 25 to Dec 1 |

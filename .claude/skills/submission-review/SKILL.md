---
name: submission-review
description: Use in Phases 7–8 to check Settlane's README, disclosures, and reproducibility against the Fe Builders Challenge requirements before submission.
---

# Submission review

1. Go through `docs/SUBMISSION.md` row by row. Mark each row with evidence such as a command output, file, or URL. Never mark a row done on assumption.
2. Run a clean clone (`git clone <local path> /tmp/...-scratch`), then `fe --version`, `python3 scripts/check_tests.py`, and `fe build`, then list `out/` (it must be exactly the deployable allowlist). Record the exact output summary.
3. Check that the README follows the root `SUBMISSION.md` template, including: the pitch, the Fe highlight with a real excerpt from `ingots/settlane/src/`, the architecture, the state diagram, limitations, trust assumptions, and the declaration (the starter commits as pre-existing work, and AI tools used).
4. Check the claims: nothing says "secure", "trustless", "audited", "original escrow", or gives market figures without a source. The commercial claims match `docs/MARKET.md`.
5. Confirm that no secrets, project ID, or private submission link appear in tracked files (`git grep`).

## Acceptance
Every checklist row is backed by evidence. Remaining items are listed for the owner. Submission and confirmation steps are left to the owner.

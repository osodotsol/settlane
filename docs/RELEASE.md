# GitHub release: audit, manual steps and what is still unverified

Status at commit time: **the public repository has not been created and nothing has been pushed.** This environment has no GitHub authentication (the GitHub CLI `gh` is not installed, and there is no token, credential helper or SSH key), so creating a repository or pushing is not possible from here. Everything that can be prepared and checked offline was. The steps below are exact and take a few minutes.

## Audit of the tree and the history (done, 2026-11-20)
| Check | Result |
| --- | --- |
| Secrets, keys, tokens | `git grep` over the file contents of HEAD and **every commit** for GitHub, AWS, Slack and OpenAI token shapes, PEM private keys, and the owner's personal email address and its mail domain: **none in any file** (commit metadata holds only the no-reply address and the starter author's). The only 64-hex strings are `0xff..ff` constants and Keccak test vectors. No `.env`, key, log or `settings.local.json` file is tracked. |
| Generated files | None tracked (`out/` and `__pycache__/` are in `.gitignore`; no `.bin`, `.pyc` or binary blob in history; the largest blob is a 136 KB test file). |
| Registration or submission identifiers | None of ours. `README.md` still contains the **organizers'** public registration form link from the starter (see "Remaining blockers"). |
| License | `LICENSE` is the unmodified Apache License 2.0 text from the starter (OSI approved, as the challenge requires). No source file carries a license header and there is no `NOTICE`; none is required by Apache-2.0 for this repository. |
| Authors in history | 17 commits by `osodotsol <283860466+osodotsol@users.noreply.github.com>` (a no-reply address) and 3 starter commits by the organizers' author, whose own email is already public in the starter repository. History is preserved as it is: pushing `settlane/dev` publishes all 20. |
| Third-party code | None vendored. Foundry is downloaded by the installer at CI time and is not in the repository. |
| `origin` | Still `https://github.com/fe-lang/builders-challenge-starter` (the organizers' repository), fetch and push. **Never push to it.** |
| Name | `https://api.github.com/repos/osodotsol/settlane` returned 404, so the name was free when checked. The account `osodotsol` exists (user, 6 public repositories). |
| Workflow pre-flight | The URLs the workflow depends on answer 200: the Fe installer script, the Fe `v26.6.0` release, the pinned Foundry v1.10.0 tarball, `actions/checkout` v5. The workflow parses as YAML, `test` is byte-identical to the one validated locally, and `release-gate` needs `test` and `anvil`. A dedicated workflow linter (`actionlint`) was **not** run: downloading it was refused by this environment's permission classifier. |

## Manual steps
Run these yourself; none needs the assistant to see a credential.

1. **Create the empty public repository** (owner `osodotsol`, name `settlane`). Either in the browser (github.com/new: Public, and do **not** add a README, license or .gitignore), or with the GitHub CLI after `gh auth login`:
   ```sh
   gh repo create osodotsol/settlane --public --description "Settlane: milestone settlement of digital-service agreements in Fe (Fe Builders Challenge 2026)"
   ```
   (no `--source` and no `--push`: the push below is the only push.)
2. **Push the branch to that repository only**, from this checkout:
   ```sh
   cd /home/user/hackathons/feguard
   git remote -v                                   # origin must still be the starter
   git remote set-url --push origin DISABLED       # optional guard: a push to origin now fails
   git remote add public https://github.com/osodotsol/settlane.git
   git push -u public settlane/dev                 # no --force
   ```
   Authenticate with your own credential: `gh auth setup-git`, or a fine-grained personal access token limited to this one repository with "Contents: write", or an SSH key. Do not paste it into a chat or a file.
3. **Default branch.** The first push makes `settlane/dev` the default branch. Check Settings > Branches. (The workflow runs on `push` to any branch and on pull requests.)
4. **Watch the run** (Actions tab, or `gh run watch` and `gh run view --log-failed`). Three jobs should appear: `test`, `anvil (production bytecode)` and `release-gate (test and anvil)`. Send me the run URL or the failing log and I fix confirmed workflow problems without touching contract behavior.
5. **Require the gate** (the part a workflow file cannot do). Settings > Branches > Add branch protection rule (or a ruleset) for `settlane/dev`: tick "Require status checks to pass before merging" and add **`release-gate (test and anvil)`**; tick "Do not allow force pushes" and "Do not allow deletions". The check name only appears in the search box **after it has run once**, so do this after step 4. Do not tick "Require a pull request" unless you want to stop pushing directly. Selecting `release-gate` is enough: it fails unless both `test` and `anvil` succeeded, and a skipped or cancelled job counts as a failure.

## What is verified and what is not
| Item | State |
| --- | --- |
| Full Fe CI steps (`test` job) | **Verified locally** (all 14 runnable steps, 84 tests). Not run on GitHub. |
| `anvil` job | **Emulated locally** from a clean home directory: 52 of 52 checks and 8 of 8 mutations. The Foundry download was replaced by a stand-in for the network only (the live download timed out here at the installer's 600 s cap). **Not run on GitHub**, so the live download there, Anvil on the runner image and the 30-minute timeout are unverified. |
| `release-gate` | Script tested locally for all 16 combinations of results. The GitHub expression syntax (`needs`, `if: always()`, `needs.<job>.result`) is **unverified until a hosted run**. |
| Branch protection | **Not set** (a repository setting). |
| Foundry release attestation | Not verified (the SHA-256 pinned in the repository proves the bytes, not who built them). |

## Remaining release blockers (known, none caused by the contract)
1. **No hosted CI run yet.** Nothing in `.github/workflows/ci.yml` has ever run on GitHub (D-007 noted this for the `test` job too).
2. **The README is still the organizers' starter README** (including their registration form link). It must be rewritten (problem, approach, architecture, limitations, disclosures) before the repository is submitted: that is Phase 7 of `docs/PROGRESS.md`.
3. **Independent review is incomplete.** R-005 and R-006 were reviewed by Claude only; Codex has run neither.
4. **Experiments to remove or keep.** `experiments/phase1/` is marked "remove before submission", and `experiments/review/` runs in CI.
5. **Submission requirements** in `docs/SUBMISSION.md` (clean-clone reproducibility check, pitch, one Fe-specific highlight, disclosures) are not done.
6. **Never claim the contract is secure or trustless.** The verifier is a trusted party (`docs/SECURITY.md`).

# GitHub release: readiness, manual steps and what is still unverified

Status (2026-11-21): **published** by the owner at https://github.com/osodotsol/settlane (public, default branch `settlane/dev`, commit `22cf736`). The first hosted CI run [44854564457](https://github.com/osodotsol/settlane/actions/runs/44854564457) **succeeded**: `test` (all steps, including the pinned Fe install), `anvil (production bytecode)` and `release-gate (test and anvil)`. The push guard on `origin` is in place. The sections below are the preparation record.

## Readiness audit (2026-11-21)
| Check | Result |
| --- | --- |
| Working tree | Clean on `settlane/dev`; the release commit is the one that adds this file (see `git log -1`). |
| Secrets, keys, tokens | `git grep` over HEAD and **every commit** for GitHub, AWS, Slack and OpenAI token shapes, PEM private keys, keystore JSON (`"crypto"`, `ciphertext`) and the owner's personal email address: **none**. The 64-hex strings in HEAD are the seven public Sepolia transaction hashes, the Sepolia genesis hash, an event-topic hash and test vectors. No `.env`, key, keystore, log or `settings.local.json` file is tracked (`experiments/sepolia/make_wallets.sh` is a generator script and contains no key). |
| Registration or submission identifiers | None in HEAD. Older commits of `README.md` contain the **organizers'** public registration and submission form links from the starter (they are already public in the starter repository); none of ours appears anywhere. |
| Generated files | None tracked (`out/`, `__pycache__/` ignored). Largest blob: a 155 KB test file. |
| License | `LICENSE` is the unmodified Apache License 2.0 (OSI approved). No `NOTICE` is required. |
| Authors in history | 34 project commits by `osodotsol <283860466+osodotsol@users.noreply.github.com>` (no-reply address), dated 2026-11-18 to 2026-11-21, on top of 3 starter commits by the organizers' author (base `f9d9aa9`). Pushing `settlane/dev` publishes all of them. |
| README | Settlane documentation (D-029): pitch, transition table, Fe highlight, architecture, build and test, Sepolia transaction table (each hash verified on-chain), limitations, declaration. Two owner placeholders remain: **Team** and confirmation of the **AI assistance** wording. |
| `origin` | `https://github.com/fe-lang/builders-challenge-starter` (the organizers' repository). **Never push to it.** |
| Target name | `https://api.github.com/repos/osodotsol/settlane` returned **404** on 2026-11-21 (free, or private). The account `osodotsol` exists (8 public repositories). |
| Workflow pre-flight | Parses as YAML; jobs `test`, `anvil`, `release-gate` (`needs: [test, anvil]`). The URLs it depends on resolve: the Fe v26.6.0 release asset (302 to GitHub's asset host), the Foundry v1.10.0 tarball (302), `actions/checkout` v5. Both installs check a SHA-256 pinned in the repository and install nothing on a mismatch. `actionlint` was not run. |
| Local gate on this tree | fmt, check, 90/90 tests, events, build, lint and self-tests, review reproductions, artifact pin, Anvil 52/52 + 8/8, CI negative controls 142/142 (`docs/PROGRESS.md`). |

## Publish (run these yourself; no credential is ever shown to the assistant)
1. **Create the empty public repository** `osodotsol/settlane`: in the browser at https://github.com/new (owner `osodotsol`, name `settlane`, **Public**, and **no** README, license or .gitignore), or after `gh auth login`:
   ```sh
   gh repo create osodotsol/settlane --public --description "Settlane: milestone settlement of digital-service agreements in Fe (Fe Builders Challenge 2026)"
   ```
2. **Push `settlane/dev` to that repository only** (from this checkout; no `--force`):
   ```sh
   cd /home/user/hackathons/feguard
   git status --short                              # must print nothing
   git remote -v                                   # origin must still be the starter
   git remote set-url --push origin DISABLED       # guard: any push to origin now fails
   git remote add public https://github.com/osodotsol/settlane.git
   git push -u public settlane/dev
   ```
   Authenticate with your own credential (`gh auth setup-git`, a fine-grained token limited to this repository with "Contents: write", or an SSH key with `git@github.com:osodotsol/settlane.git` as the remote URL). Never paste it into a chat or a file.
3. **Default branch.** The first push makes `settlane/dev` the default branch, so the README shows on the repository page. Confirm in Settings > General.
4. **Watch the first run** in the Actions tab (or `gh run watch`). Three jobs must appear: `test`, `anvil (production bytecode)` and `release-gate (test and anvil)`. Then send the assistant the run URL (a public repository's runs can be read without a token), or the log of a failing job.
5. **Require the gate** after it has run once: Settings > Branches (or Rules > Rulesets) for `settlane/dev`: "Require status checks to pass" with **`release-gate (test and anvil)`**, plus "Do not allow force pushes" and "Do not allow deletions".

## Verified and unverified
| Item | State |
| --- | --- |
| `test` job | Every runnable step verified locally on this tree. The pinned Fe install step was emulated from the workflow file (correct hash installs `fe 26.6.0 (5b3f96a)`, a corrupted hash installs nothing), with the asset served from a local mirror because the 56 MB download did not finish here in 15 minutes. **Not run on GitHub.** |
| `anvil` job | Suite 52/52 and mutations 8/8 locally; Foundry download emulated (it timed out here). **Not run on GitHub**: the live downloads, Anvil on the runner image and the 30-minute timeout are unverified. |
| `release-gate` | Script tested locally for all 16 result combinations; the `needs` / `if: always()` expression semantics are **unverified until a hosted run**. |
| Branch protection | Not set (repository setting). |
| Release attestations | The pinned SHA-256 values prove the bytes, not who built them; sigstore attestations not verified. |

## Remaining submission blockers (none in the contract)
1. **Publish** (steps above) and **one green hosted run**.
2. **README owner fields:** Team; confirm the AI-assistance wording.
3. **Registration and submission (owner only):** registration confirmation, the private submission link, the full commit SHA to submit (the commit on `settlane/dev` after publishing), by **2026-11-24 23:59 UTC**.
4. **Clean-clone check** of the build and test instructions from the public repository (`docs/SUBMISSION.md`).
5. **`experiments/phase1/`** is marked "remove before submission" but runs in CI (`experiments/phase1/run.sh`); keep or remove is the owner's decision (removing it means removing its CI step in the same change).
6. Open decisions with no recorded owner approval: D-002, D-018, D-028 and the provisional approvals listed at the top of `docs/DECISIONS.md`.
7. **Never claim the contract is secure or trustless.** The verifier is a trusted party (`docs/SECURITY.md`).

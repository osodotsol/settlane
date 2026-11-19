# Fe Builders Challenge starter

A starting point for the [Fe Builders Challenge](https://fe-lang.org/contest/):
three weeks to build something with [Fe](https://fe-lang.org) and compete for
$5,000 in prizes. It contains a small Fe project with tests, a CI workflow, and
a template for your final README.

## Register your project by November 17

> [!IMPORTANT]
> **Registration is required to submit.** Register by **November 17, 2026,
> at 23:59 UTC**. This deadline is firm.
>
> **[Register your project](https://docs.google.com/forms/d/e/1FAIpQLSehDUUbqfQt67Ecy21zIsOFN7pp4orx9Ko9DKCWcDkjhEUVBg/viewform)**

You don't need a finished project or a final idea to register: a project name,
a one-sentence idea, your team, and a contact email are enough, and your idea
can change as you build. Registering early is best. You will receive your
project ID and the private submission link by email, and you need that link
to submit your project.

## Dates

All times are UTC.

| Date | Milestone |
| --- | --- |
| November 3, 2026, 00:00 | Build window opens |
| November 17, 2026, 23:59 | [Registration](https://docs.google.com/forms/d/e/1FAIpQLSehDUUbqfQt67Ecy21zIsOFN7pp4orx9Ko9DKCWcDkjhEUVBg/viewform) closes |
| November 24, 2026, 23:59 | [Submission](https://docs.google.com/forms/d/e/1FAIpQLSd2pqUkJzFpZMu5FVQP-NtetrIoB6nI-pHG1MLTOQhCpsLKqg/viewform) closes |
| December 1, 2026 | Winners announced (target date) |

The [contest page](https://fe-lang.org/contest/) has the full details and the
rules.

## Get started

1. Install Fe 26.5 or later. Any Fe release from 26.5.0 on is allowed for the
   contest; see the [installation guide](https://fe-lang.org/getting-started/installation/).

   ```sh
   curl -fsSL https://raw.githubusercontent.com/argotorg/fe/master/feup/feup.sh | bash -s -- --version v26.5.0
   ```

2. Clone this repository into a new project and point it at your own GitHub
   repository:

   ```sh
   git clone https://github.com/fe-lang/builders-challenge-starter my-project
   cd my-project
   git remote set-url origin https://github.com/<you>/<your-project>.git
   ```

3. Run the tests and build the contract:

   ```sh
   fe test
   fe build
   ```

4. [Register your project](https://docs.google.com/forms/d/e/1FAIpQLSehDUUbqfQt67Ecy21zIsOFN7pp4orx9Ko9DKCWcDkjhEUVBg/viewform)
   by November 17, if you haven't already.

## What's inside

| Path | Contents |
| --- | --- |
| `fe.toml` | The workspace manifest (Settlane, D-014). `default-members` is the production ingot only. |
| `ingots/settlane/` | Production ingot: the `Settlane` contract (agreement creation and funding, evidence submission, and verifier approval or revision requests so far; no payouts yet). Only this ingot is built by `fe build`. |
| `ingots/settlane/src/` | `types.fe` (storage types, the `Clock` effect, events), `rules.fe` (pure rules), `handlers.fe` (shared handler bodies), `settlane.fe` (messages and the contract), `tests.fe`. |
| `ingots/settlane-dev/` | Dev ingot: the test-clock shell (`SettlaneTestClock`), an `Actor` helper, a `Reentrant` attacker contract and their tests. Never built by default and never deployable. |
| `scripts/` | Policy lint and test gate used by CI. Run the tests with `python3 scripts/check_tests.py` (a bare `fe test` runs only the production ingot). |
| `.github/workflows/ci.yml` | Checks formatting, runs both ingots' tests, builds, and runs the policy lint with Fe 26.6.0 on every push. |
| `SUBMISSION.md` | A template for the README the jury reads. |
| `LICENSE` | Apache-2.0. |

The starter's vault example has been replaced by Settlane. Replace it with your own project; it does not
need to be a contract. Native programs, libraries, and developer tools are
welcome too, as long as the core technical contribution is written in Fe. The
[Fe guide](https://fe-lang.org/getting-started/what-is-fe/) is a good place to
start.

## Before you submit

Submit by **November 24, 2026, at 23:59 UTC** with the personal submission link
from your registration email. Without a registration, you can't submit. Your submission needs:

- [ ] A public GitHub repository with an OSI-approved license. You can keep the
      Apache-2.0 `LICENSE` or replace it with another OSI-approved license.
- [ ] The full commit SHA the jury should review.
- [ ] Your project manifest (`fe.toml`) and the exact Fe version you used.
- [ ] Reproducible build and test instructions, and automated tests that fit
      your project.
- [ ] A README covering the problem, your approach, the architecture, and
      limitations. Start from `SUBMISSION.md`.
- [ ] A one-sentence pitch and one Fe-specific technical highlight.
- [ ] A short demo: a video, screenshots, or a reproducible CLI example.
- [ ] A declaration of pre-existing work, reused third-party code, and AI
      assistance.

You can submit again before the deadline; the latest valid submission counts.

## Get help

- Ask questions and share progress on [Fe Zulip](https://fe-lang.zulipchat.com/#narrow/channel/594128-office-hours).
- Report compiler bugs in the [Fe issue tracker](https://github.com/argotorg/fe/issues),
  ideally with a minimal example.
- If something blocks your entry, email [hello@fe-lang.org](mailto:hello@fe-lang.org).

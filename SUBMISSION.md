# Submission: Settlane

Answers for the Fe Builders Challenge submission form. The jury's main document is the [README](README.md).

| Field | Answer |
| --- | --- |
| Project name | Settlane |
| One-sentence pitch | Settlane is milestone escrow written in Fe: a client funds every milestone up front, a trusted verifier approves the exact submitted evidence, and the contract lets the provider claim approved work or the client refund expired work, by rules fixed before the work begins. |
| Repository | https://github.com/osodotsol/settlane |
| Commit | The full 40-character SHA of the commit you submit. The last code change is `f72f24934ba7180e1e68fe7590d9c9da6867e466`; later commits change documentation only. |
| Fe version | `fe 26.6.0 (5b3f96a)` |
| Live demo | https://settlane.vercel.app (reads the Sepolia deployment; no wallet needed to explore) |
| Contract | `0xf79d229a039bf5c84ecc7327060f8bbc888d2182` on Ethereum Sepolia (chain id 11155111) |
| License | Apache-2.0 |

## Fe-specific highlight

Moving money is a declared capability. Every message arm lists the effects and storage it uses, and only `Claim` and `Refund` hold `mut call`, the effect that sends ETH. Time is a user-defined `Clock` effect: production supplies it from `ctx.timestamp()`, and a test-only contract in a separate ingot runs the same handlers under a settable clock, so every deadline is tested at d−1, d and d+1 against real contract code. We found that Fe 26.6.0 does not enforce arm-level `mut` on built-in contract effects (a read-only `call` can still send ETH), reproduced it, and closed the gap with a policy lint and a balance-neutral invariant test. Details: [`docs/WHY_FE.md`](docs/WHY_FE.md).

## Demo and reproduction

No wallet or test ETH is needed:

1. Open https://settlane.vercel.app/agreements/4: a payment, Funded → Submitted → Approved → Paid, each step linked to its Sepolia transaction.
2. Open https://settlane.vercel.app/agreements/3: a refund after the deadline.
3. Open https://settlane.vercel.app/contract: the deployed bytecode is hashed live and matches the pinned Fe 26.6.0 build.

Reproduce the contract: `python3 scripts/check_tests.py` (90 Fe tests), `rm -rf out && fe build`, `python3 scripts/settlane_lint.py ingots --abi-dir out`. Re-verify the deployment from a node: `python3 experiments/sepolia/verify_deployment.py --rpc-url https://ethereum-sepolia-rpc.publicnode.com --address 0xf79d229a039bf5c84ecc7327060f8bbc888d2182 --from-block 12175958`. Full walkthrough: [`docs/EVIDENCE.md`](docs/EVIDENCE.md).

## Declaration

- **Pre-existing work:** the project started from the Fe Builders Challenge starter repository at commit [`f9d9aa9`](https://github.com/fe-lang/builders-challenge-starter/commit/f9d9aa92a03af82c2bbb0dc2e0810244eb13e686), whose example contract was replaced. All project work dates from 2026-11-18, inside the build window.
- **Reused code:** none in the contract. The application uses open-source libraries (Next.js, React, viem, wagmi, TanStack Query, Tailwind CSS, lucide icons) under their licenses, and self-hosted IBM Plex fonts (SIL OFL).
- **AI assistance:** built with AI coding assistants (Claude Code) under the owner's direction. The owner set the requirements, approved every specification decision (`docs/DECISIONS.md`) and signed every testnet transaction.

## Eligibility

Public repository with an OSI-approved license (Apache-2.0), a Fe workspace manifest (`fe.toml`), the exact Fe version, automated tests, reproducible build and test instructions, and hosted CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml), green on `main`). Unaudited prototype for the Sepolia testnet with a trusted verifier.

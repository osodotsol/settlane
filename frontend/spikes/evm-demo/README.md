# F0 spike: Settlane bytecode on an in-browser EVM

Isolated feasibility check for the guided demo (`frontend/PLAN.md` §4, milestone F0). It is **not** part of the app: it has its own `package.json`, and the app's build, lint, type check and tests ignore it. Nothing here touches Sepolia; everything runs on a local, in-memory EVM with simulated ETH.

What it does (`spike.mjs`): deploys the pinned production init code (`out/Settlane.bin` from `fe build`) on `@ethereumjs/vm` (Prague rules), then replays the Sepolia story with a controllable block timestamp: A1 create, submit, a stale approval (must revert), approve, claim; A2 create, an early refund (must revert with "milestone has not expired"), a time jump to `deliver_by`, refund. It checks states, accounting, balances and the exact revert reasons decoded from the contract (14 checks).

## Result (2026-11-21)

| | Node 22.23.4 | Headless Chromium 158 (Playwright 1.65.0) |
| --- | --- | --- |
| Checks | 14/14 | 14/14 |
| Create VM | 3 ms | 3 ms |
| Deploy (6,056-byte runtime) | 17 ms | 12 ms |
| 12-step script | 144 ms | 79 ms |
| Page load to finished | n/a | 194 ms (bundle served uncompressed from localhost) |

Bundle (esbuild, minified, ESM, browser): **446 KB, 133 KB gzip**, including the bytecode and ABI. Largest parts: `@ethereumjs/evm` about 147 KB and `@noble/curves` about 80 KB (minified). Loaded only on `/demo` it does not affect the other routes.

Decision: **adopt the in-browser EVM for the guided demo** (the deterministic reducer fallback is not needed). The demo then shows the contract's real behaviour and real revert reasons, not a re-implementation. Licence: `@ethereumjs/*` is MPL-2.0 (file-level copyleft; used unmodified as a dependency).

Running Chromium under WSL needed four system libraries that are not installed (`libnspr4`, `libnss3`, `libnssutil3`, `libasound2`). They were taken from the signed Ubuntu archive with `apt-get download` and unpacked into `~/tools/chromium-libs` (outside the repository, no root, no system change), used via `LD_LIBRARY_PATH`.

## Reproduce

```sh
rm -rf out && fe build                       # at the repository root
cd frontend/spikes/evm-demo && npm install
npm run node                                 # the 14 checks in Node
npm run bundle && npx playwright install chromium-headless-shell
npm run browser                              # the same checks in headless Chromium
```

# Settlane frontend

Next.js 16 app for Settlane: a read-only explorer and agreement pages that work without a wallet, a landing page, and (next milestones) wallet flows and a guided simulation. Design: [`DESIGN.md`](DESIGN.md). Plan and milestones: [`PLAN.md`](PLAN.md). The Fe contract is frozen; this app only reads it (and, from F5, sends transactions the user signs in their own wallet).

## Requirements
- Node 22 LTS (`engines`: `>=22.11 <23`); CI uses 22.23.4.
- The production ABI: run `rm -rf out && fe build` at the repository root once (Fe 26.6.0).

## Commands (from `frontend/`)
```sh
npm ci                # exact, locked dependencies
npm run check-abi     # src/contract/abi.ts equals the fresh build and the lint's ABI lock
npm run lint          # ESLint 10 with Next's core-web-vitals and TypeScript rules
npm run typecheck     # next typegen + tsc
npm run test          # Vitest: formatting, lifecycle predicates at d-1/d/d+1, revert-reason coverage, ABI and config
npm run build         # production build
npm run dev           # http://localhost:3000
npm run check         # all of the above except dev
npm run test:live     # opt-in: re-read Sepolia and compare A1/A2 and their events with the recorded fixture
npm run e2e           # Playwright: Sepolia (read-only) and a throw-away local Anvil; needs Chromium and Anvil
```

`npm run e2e` builds the app twice (`SETTLANE_DIST_DIR`), checks the real Sepolia agreements, 404s, no-JavaScript rendering, axe (WCAG 2.2 AA, light and dark) and horizontal overflow at 360 to 1440 px (screenshots in `e2e/screenshots/`, not committed), then deploys the production bytecode on a local Anvil (chain id 11155111, simulated ETH) to check that new agreements and events appear within seconds, that a passed deadline shows refund eligibility, and that an RPC failure serves the last data with a notice. Nothing is sent to a public network. Install the browser once with `npx playwright install chromium-headless-shell`; under WSL Chromium may need `libnspr4`, `libnss3` and `libasound2` (the runner picks them up from `~/tools/chromium-libs` if present).
`scripts/record-fixtures.mjs` re-records `tests/fixtures/sepolia-a1-a2.json` (read-only).

## Configuration
Only public values, all optional (defaults are the verified Sepolia deployment): `NEXT_PUBLIC_SETTLANE_ADDRESS`, `NEXT_PUBLIC_DEPLOY_BLOCK`, `NEXT_PUBLIC_RPC_URLS` (comma-separated). No key, keystore, project id or secret is used anywhere.

## Notes
- `.npmrc` sets `legacy-peer-deps`: npm 10.9 crashes while resolving vitest 5's optional peers. Every peer the app needs is listed explicitly (including `vite` for vitest).
- Fonts are self-hosted SIL OFL files in `src/fonts/` (Newsreader, IBM Plex Sans, IBM Plex Mono), loaded with `next/font/local`.
- Explorer, agreement and contract pages render per request through `src/contract/cache.ts` (10 s TTL, one request per key, last good data on RPC failure); event history is scanned in 10,000-block chunks, incrementally, re-scanning the last 64 blocks so reorged logs are replaced.
- `src/proxy.ts` returns a real HTTP 404 for agreements that do not exist, before rendering; `htmlLimitedBots: /.*/` keeps pages complete without JavaScript.
- `spikes/evm-demo/` is the isolated F0 feasibility spike (in-browser EVM), not part of the app.

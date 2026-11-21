# Settlane frontend: plan

**Status:** planning only (D-030 proposed). No frontend code exists yet. The Fe contract is frozen. Design authority: `frontend/DESIGN.md`. Specification authority: `docs/LIFECYCLE.md`.

Deployed contract (Sepolia, chain 11155111): `0xf79d229a039bf5c84ecc7327060f8bbc888d2182`, deployed in block `12175958`. Runtime SHA-256 `f0965efd…b4f3a8` (`experiments/sepolia/artifact.json`).

---

## 1. Design reference study (nepproof.vercel.app, 2026-11-21)

**Method and limits.** No browser or screenshot tool was available in this session, so the rendered page was **not seen**. What follows comes from the served HTML (57 KB, Next.js) and its one stylesheet (42 KB). Anything about rendered appearance or behaviour in use (perceived spacing, motion feel, real responsive behaviour) is **not verified**.

Observed in the source:

| Area | Observation | Principle worth adopting |
| --- | --- | --- |
| Narrative | The heading sequence goes from problem ("…runs on trust"), to both audiences, to "Three outcomes. No ambiguity.", to proof anyone can check, to the exact specification, availability, and the call to action. | Copy-led storytelling in the order a sceptical reader asks questions. |
| Colour | A dark ink ladder (`#0a0a0a`…`#262626`), three foreground greys, white hairlines at 8/12/18% alpha, one accent, and semantic outcome colours (`pass`, `fail`, `hold`, `chain`, `idle`). The accent appears on one element only. | A tight neutral ladder, colours reserved for **real states**, and an accent used sparingly. |
| Type | Inter and JetBrains Mono declared; small UI sizes (11.5–15px); display tracking down to −0.045em; weights 500–740. **No `@font-face` and no font preload:** Inter is never loaded, so visitors without it installed get Segoe UI or system fonts. | Tight display tracking and a disciplined scale. **Avoid the gap:** self-host the fonts. |
| Structure | 9 sections. Custom classes `station`, `connector` and `dot` form a stepper whose connector becomes 1px wide below 1024px (horizontal steps turn vertical). | A process visual that changes orientation responsively. |
| Motion | Keyframes `word-up` (headline words), `draw` (underline), `rise`, `shimmer` (skeleton), `blink`/`bar` (an intro sequence). An ease-out `cubic-bezier(.16,1,.3,1)`. `prefers-reduced-motion` disables all animation, shows revealed content and hides the intro. | Few authored moments, an expo-out easing, and full reduced-motion handling. |
| Accessibility | Skip link present; 28 `aria-label`s; `(hover:hover)` media queries. | Same baseline as a minimum. |
| Theme | Dark only; no light theme or `prefers-color-scheme` handling. | Settlane chooses its theme from the use scene, and supports both. |

Not adopted: NEPProof's branding, copy, dark-and-lime look, layout or components.

## 2. Design skill evaluation (contents reviewed 2026-11-21; none installed)

| Skill | What it is (reviewed) | Decision |
| --- | --- | --- |
| UI/UX Pro Max (`nextlevelbuilder/ui-ux-pro-max-skill`, MIT) | 742 files: 6 skills, 133 Python scripts, 144 CSV "decision" tables with BM25 search, slide generation, bundled fonts. | **Not installed.** Mostly generic and much broader than this product needs. Its one useful idea, primitive → semantic → component tokens, is in `DESIGN.md` §2. |
| Impeccable (`pbakaus/impeccable`, Apache-2.0) | A design-direction skill with modes (Persuade, Operate, Read, Experience), a "craft floor" of checks and refusals, and commands (critique, audit, polish). It needs a launcher binary and browser-automation scripts, and offers an auto-running detector **hook**. | **Not installed** (the hook conflicts with D-008, and the runtime is heavy). Its principles are folded into `DESIGN.md` (modes, refusals) and §7 here (checks). It could be reconsidered for a one-off `critique`/`audit` pass after F8, without the hook, with your approval. |
| Taste (`Leonxlnx/taste-skill`, MIT) | Built for marketing sites: house rules require one section per screen, photographs, award-site scenes and hover lifts on cards; it has an `install.sh` and component kits. | **Not installed.** Its aesthetic programme fits brand sites, not a restrained financial tool. Two of its bans are adopted: no fade-in on every section, and no invented figures or reviews. |
| Awesome DESIGN.md (`VoltAgent/awesome-design-md`, MIT) | Markdown only: DESIGN.md files describing other companies' brands, in a 9-section format. | **Format adopted** for `frontend/DESIGN.md`. **No brand file used,** since copying another company's look is what to avoid. |

Net effect: no new dependency and no repository skill change.

## 3. Architecture

**Stack** (versions checked 2026-11-21; pin exact versions at least two weeks old when F1 starts):
- Next.js 16 (App Router) with React 19 and TypeScript;
- Tailwind CSS 4, with tokens from `DESIGN.md` as CSS variables;
- viem 2 for reads, encoding and simulation;
- wagmi 3 with TanStack Query 5, for wallet and account state (injected EIP-6963 wallets only);
- `next/font` for the self-hosted fonts and Lucide for icons;
- Vitest, Playwright and axe for tests.

**Why wagmi,** given the "few dependencies" goal: it handles EIP-6963 discovery, reconnection and chain switching, which are easy to get subtly wrong by hand. **No WalletConnect:** it needs a project ID, which the repository rules forbid in tracked files, and an external service.

**Hard boundaries:**
- No database, no backend state, no authentication, no custodial keys, no mainnet. The chain is the only source of truth.
- Keystores and anything under `experiments/sepolia/` are never imported, bundled or referenced by the frontend.
- The configuration holds only public values: chain id, contract address, deploy block, and public RPC URLs (`NEXT_PUBLIC_*`).
- **Real versus simulated is a code boundary.** `src/chain/*` talks to Sepolia. `src/demo/*` runs a local in-browser EVM. Both sit behind one `SettlaneReader` / `SettlaneWriter` interface. The demo provider is mounted only under `/demo`, and the UI always shows a simulation banner when it is active.
- RPC (verified 2026-11-21): `ethereum-sepolia-rpc.publicnode.com` and `sepolia.gateway.tenderly.co` both send `Access-Control-Allow-Origin: *`, so the browser can read without a proxy. publicnode is primary (`eth_getLogs` limit 10,000 blocks), with Tenderly as fallback (viem `fallback` transport). **Multicall3** is deployed on Sepolia at `0xcA11…CA11` (verified), so view calls are batched.

**Rendering:**
- `/`, `/contract` and `/demo` are static.
- `/explorer` and `/agreements/[id]` render on the server from chain reads with `revalidate: 30`, so judges get a complete page with no wallet, and the content is in the HTML even without JavaScript.
- The client then hydrates, follows new blocks (12 s polling) and refreshes.

**Reads:**
- Agreement count: batched `getAgreement(1..k)` until the first revert ("unknown agreement" marks the end).
- Detail: `getAgreement`, `getAccounting`, `getMilestone(id, 0..n-1)`, `totalOutstanding`, and the latest block (timestamp).
- History: `eth_getLogs` for the contract address with `topic1 = id`, in 10,000-block chunks from the deploy block, cached.
- Receipts also contain the protocol's ETH-transfer logs from `0xfff…fffe` (EIP-7708). They are ignored by address.

**Time:** every window state uses the **latest block timestamp**, never the browser clock. The UI shows both only when they differ by more than 60 s.

**Display logic versus authority:** `src/domain/lifecycle.ts` mirrors the pure predicates of `rules.fe` (`delivery_open`, `review_open`, `expired`, allowed actions per role and state). It decides only what to *offer*. **Every write is simulated with `eth_call` first,** so a display bug can show a wrong button but cannot send a transaction the contract would reject without the user first seeing the reason.

**Route map:**

| Route | Purpose | Wallet | Data |
| --- | --- | --- | --- |
| `/` | Landing (Persuade) | no | static + live proof numbers from chain |
| `/explorer` | All agreements, read-only | no | Sepolia |
| `/agreements/[id]` | Agreement detail; role actions when connected | optional | Sepolia |
| `/app` | My agreements, grouped by role | yes | Sepolia |
| `/create` | Create and fund | yes (to send) | Sepolia |
| `/demo` | Guided demonstration, simulated | no | in-browser EVM |
| `/contract` | Deployment evidence: address, bytecode hash, ABI, source, CI | no | static + 1 live check |

**Layout** (`frontend/`):
- `app/` holds the routes above.
- `src/contract/` holds the ABI, address and deploy block, revert-reason copy, event decoding, and read/write helpers.
- `src/chain/` holds clients, the wagmi config and block time.
- `src/domain/` holds lifecycle predicates, ETH and time formatting, and hashing.
- `src/demo/` holds the VM, accounts and guided script.
- `src/ui/` holds components.
- `scripts/sync-abi.mjs` generates `src/contract/abi.ts` from `out/Settlane.abi.json`.
- `tests/`.

## 4. Page-by-page UX

**Landing `/`.**
1. **Hero:** one-line promise ("Pay for work one milestone at a time, by rules fixed in advance"), a sub-line naming Fe, Sepolia and the trusted verifier, and two actions: *Explore live agreements* and *Try the guided demo*. The settlement lane draws once.
2. **The problem** (two short columns: client risk, provider risk).
3. **How a milestone settles:** the T1–T6 path as a single lane with the four outcomes, stated as rules with their deadlines.
4. **Proof anyone can check:** live numbers read from Sepolia (agreements, total outstanding, the A1 and A2 outcomes linking to `/agreements/1` and `/agreements/2`), plus the deployed bytecode hash equal to the open-source build, linking to `/contract`.
5. **Built with Fe:** the Clock-effect excerpt from the README, and the honest note on what the compiler enforces.
6. **Limitations, in plain words:** trusted verifier, test ETH only, unaudited, lost keys lock funds, 2300-gas payouts.
7. Closing call to action and footer (repository, licence, contract link).

**Explorer `/explorer`.**
- A table with: id, state summary (a chip per milestone), parties (shortened, with roles), deposited, outstanding, next deadline, last activity.
- Filters: open/closed, plus a search by id or address.
- Empty state for "no agreements match".
- On mobile, each agreement is a stacked list item.

**Agreement `/agreements/[id]`.**
- Title row: Agreement #id, its open/closed state (derived), and the three parties with their roles.
- Ledger strip, then shared settlement lanes, then a detail block per milestone: amount, deadlines (UTC and relative), spec hash, current evidence and revision, rejections.
- Activity history: decoded events with block, time and tx link.
- **Action panel** for the connected role only, showing:
  - what the role can do now;
  - otherwise *why not* and *when* ("Refund opens at 2026-11-20 16:12 UTC");
  - for an observer: "Read-only. Connect the provider, verifier or client wallet to act."
- Unknown id: a 404-style state ("No agreement #7 on this contract").

**Create `/create`.**
- *Parties:* provider and verifier addresses, checksummed, nonzero, and pairwise distinct with the connected address (the client). It explains that the verifier is trusted.
- *Milestones (1–3):* amount in ETH, delivery deadline (local date-time, shown in UTC, which must be in the future at send time), and a spec, given as text or a file hashed locally with keccak256 (the file never leaves the device) or as a pasted hash.
- *Review period:* presets (1 h, 1 day, 3 days, 7 days) or custom, greater than 0.
- *Review step:* every value, `decide_by` per milestone, the total, and "You will send exactly X test ETH", then the transaction receipt.
- Validation mirrors the contract's creation rules and their order (`LIFECYCLE.md`), and the simulation shows the contract's own reason when something still fails.

**Submit evidence (provider).**
- Evidence as text, a file (hashed locally) or a hash.
- Shows the delivery window's remaining time and "This becomes revision n+1".
- After `deliver_by` the panel explains why submission is closed.

**Review (verifier).**
- Shows the stored evidence hash and revision. **Approve revision r** and **Request revision** (Reject) both pass the exact evidence and revision.
- A note: "If the provider resubmits before your transaction lands, it reverts. Nothing changes."
- The review window countdown.
- A rejection after `deliver_by` shows the warning "the milestone becomes refundable immediately" (F3).

**Claim (provider).** `to` defaults to the connected address, and can be changed. Note: "Payouts forward only 2,300 gas; smart-contract wallets may not receive it. Use a plain account if it fails." No deadline.

**Refund (client).** Shown only when the milestone is expired by block time; otherwise the exact opening time. `to` defaults to the connected address.

**My agreements `/app`.** Three sections: as client, as provider, as verifier. Each item states the next action needed by *you*, for example "Approve revision 2 by Nov 22 14:00 UTC".

**Wallet and network states:**
- *No wallet:* full read-only use; a single quiet note at the point of action.
- *Wallet present, not connected:* "Connect wallet".
- *Wrong network:* a banner with *Switch to Sepolia* (`wallet_switchEthereumChain`, and `wallet_addEthereumChain` as fallback). Write buttons are disabled with the reason.
- *Connected:* address and role badges.
- *Insufficient balance for create:* the exact shortfall.
- *Wallet rejected:* neutral receipt state.
- *RPC unavailable:* a retry with fallback, and a stale-data timestamp.

**Guided demo `/demo`** (labelled simulation):
- The pinned production bytecode `Settlane.bin` runs **in the browser** on a local EVM (`@ethereumjs/vm` 10, MPL-2.0, lazy-loaded on this route only), with three local demo accounts and a **time control** that sets block timestamps.
- It uses the same UI components as the real pages, behind the demo provider.
- Script:
  1. Client creates and funds.
  2. Provider submits.
  3. Verifier approves.
  4. Provider claims (ledger strip moves to paid).
  5. Second agreement: time passes `deliver_by`, and the client refunds.
  6. Free play, including a rejected stale approval and an early-refund attempt that show the real revert reasons.
- Each step has "What just happened on-chain" and links to the matching **real** Sepolia transaction (A1 and A2).
- Spike first (F0). If bundle or startup budgets fail, the fallback is a TypeScript reducer of the LIFECYCLE rules, checked by conformance tests against the contract's documented revert order (and labelled the same way).

**Contract `/contract`:** address, deploy tx and block, runtime SHA-256, a live check that the deployed code hash equals the pin, the ABI table, a link to the source at the commit, the CI badge, the read-only verifier command, and the test-ETH and unaudited notices.

## 5. Components and interactions

- **Primitives:** Button, IconButton, Chip (state), Address, Hash, Amount, Timestamp (UTC/relative toggle), Field, Select, DateTimeField (UTC preview), HashInput (text, file or hash), Banner, Toast (only for copy confirmations), Table/List, Skeleton (static, no shimmer under reduced motion).
- **Composites:** SettlementLane (SVG with a text equivalent), LedgerStrip, MilestoneDetail, ActionPanel (role- and state-driven), TxReceipt (stepper), ActivityList, NetworkControl, WalletControl, SimulationBanner, ProofStats.
- **Interaction rules:**
  - No modals for actions; the action panel is inline and keeps focus order.
  - Every disabled control has a visible reason (not a tooltip only).
  - Destructive or irreversible actions (Reject, Refund, Claim to a non-default `to`) get an inline confirmation step that restates the effect.
  - Keyboard: the full flow is operable; focus moves to the receipt's current step and is announced (`aria-live="polite"`).
  - After a confirmed write, data refreshes from chain; the UI never assumes the result.

## 6. Contract integration mapping

ABI source: `out/Settlane.abi.json`, locked by `scripts/lint-policy.json`. `scripts/sync-abi.mjs` generates `abi.ts`, and a test fails if they differ.

| Function | Caller (UI) | Arguments from UI | Offered when (display rule) | Success shows |
| --- | --- | --- | --- | --- |
| `create(address,address,uint256,uint8,uint256[3],uint256[3],uint256[3]) payable → uint256` | anyone (becomes client) | provider, verifier, review period (s), n, amounts (wei), deliver_by (unix), spec hashes; unused slots 0; `value = Σ amounts` | wallet on Sepolia, form valid | `AgreementCreated`, go to `/agreements/{id}` |
| `submit(uint256,uint8,uint256)` | provider | id, m, evidence (keccak256 as uint256, nonzero) | state Funded/Submitted and `now < deliver_by` | `MilestoneSubmitted(revision)` |
| `approve(uint256,uint8,uint256,uint256)` | verifier | id, m, stored evidence, stored revision | Submitted and `now < decide_by` | `MilestoneApproved` |
| `reject(uint256,uint8,uint256,uint256)` | verifier | same | same | `MilestoneRejected(rejections)` |
| `claim(uint256,uint8,address) → uint256` | provider | id, m, `to` | Approved | `MilestoneClaimed(to, amount)` |
| `refund(uint256,uint8,address) → uint256` | client | id, m, `to` | expired (Funded and `now ≥ deliver_by`, or Submitted and `now ≥ decide_by`) | `MilestoneRefunded(to, amount)` |
| `getAgreement(uint256)` | read | id | always (reverts "unknown agreement") | client, provider, verifier, review period, n |
| `getMilestone(uint256,uint8)` | read | id, m | always (unknown reads as state 0) | state, amount, deliver_by, decide_by, spec, evidence, rejections, revision |
| `getAccounting(uint256)` | read | id | always | deposited, paid, refunded, outstanding |
| `totalOutstanding()` | read | none | always | global outstanding |

State codes: 0 None, 1 Funded, 2 Submitted, 3 Approved, 4 Paid, 5 Refunded.

**Revert reasons** (exact strings from `ingots/settlane/src/handlers.fe`). A unit test parses every `assert!(false, "…")` and `"transfer failed"` in that file and fails if any lacks copy here.

| Reason | User copy | Recovery |
| --- | --- | --- |
| provider is zero / verifier is zero | "Enter the provider's / verifier's address." | fix field |
| client is provider / client is verifier / provider is verifier | "Client, provider and verifier must be three different addresses." | fix field |
| milestone count not 1..3 | "An agreement has 1 to 3 milestones." | fix form |
| unused milestone slot not empty | (internal: the form always zeroes unused slots) | report bug |
| milestone amount is zero | "Each milestone needs an amount above 0." | fix field |
| milestone amounts overflow | "The total is too large." | fix amounts |
| value does not equal the milestone total | "The ETH sent must equal the milestone total exactly." | retry (form recomputes) |
| deliver_by not in the future | "A delivery deadline has passed. Choose a later time." | fix date |
| review period is zero | "Choose a review period." | fix field |
| deliver_by plus review period overflows | "That deadline is too far in the future." | fix date |
| milestone spec is zero | "Add a specification for each milestone." | fix field |
| unknown agreement | "There is no agreement with this number." | go to explorer |
| caller is not the provider / caller is not the verifier / caller is not the client | "Only this agreement's {role} can do this. You are connected as {address}." | switch account |
| no such milestone | "This agreement has no milestone {m+1}." | — |
| milestone cannot take evidence in this state | "This milestone is {state}; it no longer takes evidence." | refresh |
| delivery window is closed | "The delivery deadline passed at {time}." | — |
| evidence is zero | "Add evidence before submitting." | fix field |
| milestone is not submitted | "There is no submission waiting for review." | refresh |
| review window is closed | "The review deadline passed at {time}." | — |
| evidence does not match the submitted evidence / submission revision does not match | "The provider submitted a newer revision. Review revision {r} instead." | refresh |
| milestone is not approved | "This milestone is {state}, not approved." | refresh |
| payee is zero | "Enter the address to receive the ETH." | fix field |
| milestone cannot be refunded in this state | "This milestone is {state}; it cannot be refunded." | refresh |
| milestone has not expired | "Refund opens at {time} (block time)." | wait |
| transfer failed | "The receiving address rejected the payment (it may be a contract wallet). Try a plain account." | change `to` |
| empty revert data on a write | "This function does not accept ETH." (non-payable) | report bug |

**Events** (decoded for history and receipts): `AgreementCreated(id, client, provider; verifier, total, milestones)`, `MilestoneSubmitted(id, m, evidence; revision)`, `MilestoneApproved(id, m, evidence; revision)`, `MilestoneRejected(id, m, evidence; revision, rejections)`, `MilestoneClaimed(id, m, to; amount)`, `MilestoneRefunded(id, m, to; amount)`.

## 7. Implementation milestones (ordered; each ends with its QA subset passing)

| # | Milestone | Done when |
| --- | --- | --- |
| F0 | **Approval and spike.** You approve D-030 (frontend scope). Install Node 22 LTS. Spike: `@ethereumjs/vm` runs the pinned `Settlane.bin` (create, then submit, then a time jump, then refund) in a browser bundle. | Spike passes, and the gzipped VM chunk size and startup time are measured. Decide in-browser EVM versus reducer. |
| F1 | Scaffold `frontend/`: tokens, fonts, primitives, ABI sync, lint and typecheck, a CI job `frontend` (separate from `test`, so the negative-control runner is unaffected) | Build is green; primitives render in a `/dev/ui` page excluded from production |
| F2 | **Read-only MVP:** read layer, `/explorer`, `/agreements/[id]` (lane, ledger strip, history), `/contract` | Real A1 and A2 render correctly with no wallet; axe passes |
| F3 | Landing `/` with live proof | Copy reviewed against the "don't" list |
| F4 | `/demo` guided simulation | Full script runs; banner everywhere; reduced motion respected |
| F5 | Wallet and network states, TxReceipt, `/create` | Creates on a **local Anvil** with the production bytecode in e2e; the Sepolia path only by your own action |
| F6 | Role actions: submit, approve/reject, claim, refund | e2e on local Anvil covers every action and every revert reason |
| F7 | `/app` my agreements | Grouping by role and next actions correct |
| F8 | QA pass (§8) and a Vercel preview | All criteria met at 4 widths, light and dark |
| F9 | Production deploy (your Vercel account), README link | Live URL works without a wallet |

**Deadline note:** submissions close 2026-11-24 23:59 UTC. The judge-facing value is F1–F4 (read-only explorer, landing, demo). F5–F7 are only valuable if the earlier milestones are solid. The contract repository is already submittable, and a later valid submission replaces an earlier one, so submit the current commit as soon as you are ready rather than waiting for the frontend.

## 8. Responsive, accessibility and visual QA criteria

- **Widths:** 360, 390, 768, 1024, 1440. No horizontal scroll, no clipped text with real data (42-character addresses, 78-digit wei values, 3 milestones), light and dark.
- **Accessibility (WCAG 2.2 AA):**
  - Contrast as measured in `DESIGN.md`.
  - Visible focus (cobalt, 2px plus 2px offset).
  - Full keyboard operation and a skip link.
  - Landmarks and a heading order.
  - Every icon-only control named; state never by colour alone.
  - The lane SVG has a text equivalent.
  - Live regions for transaction progress and copy confirmations.
  - Reduced motion honoured; 200% zoom; touch targets at least 44px.
  - axe: no serious or critical violations on every route.
- **States:** every async view has loading (skeleton), empty, error (with retry) and stale-data variants. Every action covers allowed, disallowed-with-reason, pending, confirmed, reverted-with-reason and wallet-rejected.
- **Accuracy:**
  - Amounts equal chain values to the wei (an e2e test against fixtures recorded from Sepolia A1/A2).
  - Deadlines are shown in UTC from stored values.
  - Window states match `lifecycle.ts`, tested at d−1, d and d+1.
  - The simulation banner is present on 100% of demo screens and absent elsewhere.
- **Visual:**
  - Playwright screenshots per route at 390/768/1440 × light/dark, reviewed against `DESIGN.md` §8.
  - No eyebrow labels, gradient text, nested panels or icon-card grids.
  - Tabular figures in every numeric column.
- **Performance:** landing LCP under 2.5 s on Slow 4G (Lighthouse mobile); JavaScript on read-only routes under 200 KB gzip; the demo VM chunk is lazy-loaded and measured in F0.

## 9. Deployment (Vercel)

- **Project:** your Vercel account (Hobby, free); I cannot deploy from here. Import `osodotsol/settlane`, root directory `frontend/`, framework Next.js, Node 22.
- **Branches:** production branch `settlane/dev` (or a future `main`); preview deployments for other branches.
- **Environment (all public, none secret):**
  - `NEXT_PUBLIC_CHAIN_ID=11155111`
  - `NEXT_PUBLIC_SETTLANE_ADDRESS=0xf79d…2182`
  - `NEXT_PUBLIC_DEPLOY_BLOCK=12175958`
  - `NEXT_PUBLIC_RPC_URLS` (publicnode, Tenderly).

  Defaults are compiled in, so the build works without them.
- **Headers** (`next.config`):
  - CSP with `connect-src 'self'` plus the two RPC hosts;
  - `frame-ancestors 'none'`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy` denying camera, microphone and geolocation.
- **No** analytics, tracking or third-party scripts.
- **Before production:** a CI `frontend` job green; F8 criteria met; the README "Demo" section links the URL. Rollback is Vercel's instant rollback to the previous deployment.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Deadline (3 days) | Read-only and demo first (F1–F4); submit the contract repository independently |
| Scope change (PRODUCT.md lists the frontend as out of scope) | D-030, proposed, needs your approval before F1 |
| In-browser EVM bundle or compatibility | F0 spike with a measured budget; reducer fallback |
| Public RPC rate limits or outage | Server-side ISR caching, fallback transport, stale-data notice |
| Display logic drifting from the contract | Simulate before every write; `lifecycle.ts` boundary tests; revert-reason coverage test against `handlers.fe` |
| Users mistaking the simulation for chain data | Code boundary, a demo-only provider, a persistent banner, and an e2e check |
| Wallet edge cases (smart-contract wallets and the 2,300-gas stipend) | Clear copy, an editable `to`, and the "transfer failed" recovery |
| `@ethereumjs/vm` is MPL-2.0 | Used unmodified as a dependency (file-level copyleft only); credited in the README |

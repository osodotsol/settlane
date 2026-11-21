# Settlane — Design System

**Status:** authoritative for the Settlane frontend (planning, D-030 proposed). Implementation must follow it; deviations are changed here first.
**Product truth it serves:** a Fe contract on Ethereum Sepolia that holds test ETH per milestone and releases it by fixed rules (`docs/LIFECYCLE.md`). The verifier is a trusted party. ETH only, testnet only, unaudited.

Structure follows the DESIGN.md convention (theme, colour, type, components, layout, depth, do/don't, responsive, agent guide). No brand system was copied; the design reference was studied for principles only (`frontend/PLAN.md` §1).

---

## 1. Visual theme and atmosphere

**Idea: a clearing house on paper.** Settlane settles obligations, so the interface borrows from the artefacts of settlement: the statement, the ledger, the dated schedule. These are quiet, exact things. The visual world is **warm paper, deep ink and a small set of meaningful colours**. It is not the dark neon of a trading terminal or a lime-on-black "web3" look.

- **Exactness is the aesthetic.** Every amount shows in full ETH precision on request. Every deadline shows its absolute UTC time, and every state names its rule. Decoration never stands in for information.
- **Colour means where the money goes.** Hue encodes a milestone's state. Fill encodes finality: an *outlined* chip is a state or possibility still open, and a *solid* chip is settled and final.
- **One signature visual: the settlement lane.** Each milestone is drawn as a horizontal lane on a time axis: creation, then `deliver_by`, then `decide_by`, with the windows in which each action is allowed, and a "now" cursor set from **block time**. It shows the contract's time rules exactly (`delivery_open`, `review_open`, `expired`).
- **One supporting visual: the ledger strip.** It is a single proportional bar showing `deposited = paid + refunded + outstanding`, with exact values in tabular figures.
- **Density by mode** (from Impeccable's mode distinction). The landing page *persuades*: generous space, a strong headline, one authored motion moment. The app *operates*: compact, scannable and consistent, with expression limited to precise details.

## 2. Colour

Three layers: primitives, then semantic roles, then components. Components reference **semantic tokens only**. Every pair below was measured (WCAG 2.2). Text pairs are at least 4.5:1 on `paper`, `surface`, `sunken` and their own tint. Control and state borders are at least 3:1.

### Semantic tokens

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--paper` | `#F5F3EE` | `#0F1115` | Page ground |
| `--surface` | `#FFFFFF` | `#161920` | Panels, form fields, the lane track |
| `--sunken` | `#ECE9E2` | `#0B0D10` | Wells, code and hash blocks, table stripes |
| `--line` | `#DDD8CE` | `#262A33` | Decorative hairlines (never the only carrier of meaning) |
| `--line-control` | `#8A8375` | `#6B7280` | Input, checkbox and select borders (≥3:1) |
| `--ink` | `#15171B` | `#ECEDEF` | Primary text, primary button fill (light) |
| `--ink-2` | `#454B54` | `#B6BAC2` | Secondary text |
| `--ink-3` | `#60666F` | `#8C919B` | Meta text, captions, axis labels (≥4.77:1) |
| `--cobalt` | `#2E47C9` | `#93A5FF` | Links, focus ring, the "now" cursor, selected nav (the one brand accent) |
| `--danger` | `#B42318` | `#F97066` | Reverts, validation errors, destructive confirmations |

### Milestone state colours (text-safe; each has a tint for fills)

| State | Meaning shown to users | Light fg / tint | Dark fg / tint | Chip |
| --- | --- | --- | --- | --- |
| `none` | Unused slot / unknown | `--ink-3` / none | `--ink-3` / none | dashed outline |
| `funded` | ETH locked, awaiting delivery | `#4A5568` / `#E8EBF0` | `#A7B0BF` / `#1E232C` | outlined |
| `submitted` | Evidence submitted, awaiting the verifier | `#8F5400` / `#F6E9D3` | `#E2A54A` / `#2E2414` | outlined |
| `approved` | Provider is entitled; claim available | `#0D6B61` / `#DAEDEA` | `#4EC0AF` / `#12302C` | outlined, check glyph |
| `paid` | Settled to the provider (final) | `#1D6A33` / `#DCEDDF` | `#5DC17A` / `#15301D` | **solid** |
| `refunded` | Returned to the client (final) | `#9A3D1C` / `#F4E1D8` | `#E8906A` / `#33201A` | **solid** |
| `expired` (derived, not stored) | Funded or Submitted past its window; client may refund | `refunded` fg, hatched tint | same | outlined + 45° hatch |

Rules: a state is never conveyed by colour alone. It always pairs with a label and a glyph from the icon set. `expired` is computed from block time and labelled "Expired · refundable". It is never presented as a stored state.

## 3. Typography

All three faces are open-licensed (SIL OFL) and **self-hosted at build time** with `next/font`, so there is no runtime request to a font CDN and no layout shift.

| Role | Face | Use |
| --- | --- | --- |
| Display | **Newsreader** (variable, optical size) | Landing headline, page titles, agreement titles. It gives the contractual, editorial gravity of a statement heading. |
| Interface | **IBM Plex Sans** | All UI text, body, buttons, labels. Engineered and plain, with its own character (not the default grotesque of AI dashboards). |
| Data | **IBM Plex Mono**, `tabular-nums` | Addresses, hashes, amounts, block numbers, timestamps. Monospace only for real data, never as a "technical" costume. |

| Step | Size / line height | Face, weight, tracking | Use |
| --- | --- | --- | --- |
| `display-xl` | clamp(2.75rem, 5vw + 1rem, 4.75rem) / 1.02 | Newsreader 500, −0.03em | Landing hero only |
| `display` | clamp(2rem, 2.5vw + 1rem, 3rem) / 1.08 | Newsreader 500, −0.02em | Page titles |
| `title` | 1.5rem / 1.25 | Newsreader 500, −0.01em | Section titles, agreement name |
| `heading` | 1.125rem / 1.4 | Plex Sans 600 | Panel headings |
| `body` | 1rem / 1.6 | Plex Sans 400 | Default text (measure 60–72ch) |
| `small` | 0.875rem / 1.5 | Plex Sans 400/500 | Secondary text, table cells |
| `micro` | 0.8125rem / 1.4 | Plex Sans 500, +0.01em | Chips, axis labels (minimum size anywhere) |
| `data` | 0.9375rem / 1.4 | Plex Mono 400, tabular | Amounts, hashes |

Rules:
- Headings have more space above than below, and are balanced (`text-wrap: balance`).
- No eyebrow or kicker labels above headings, and no gradient text.
- Amounts are right-aligned in tables.
- Long hex values are shortened in the middle (`0xf79d…2182`) with a copy button and the full value in an accessible name and on focus or hover. They are never truncated at the end.
- ETH amounts default to up to 6 significant decimals, with the exact wei value one click away. A value is never rounded to zero: below 0.000001, show "< 0.000001 ETH".

## 4. Components

Every component specifies these states: default, hover, focus-visible, active, disabled, loading, error, empty.

- **Button.**
  - *Primary:* `--ink` fill with `--paper` text (16:1) in light; inverted in dark.
  - *Secondary:* `--surface` with a `--line-control` border.
  - *Quiet:* text only, with a cobalt underline on hover.
  - *Danger:* `--danger` outline, solid only in the confirmation step.
  - Height 44px (40px dense in tables); radius 8px; the label names the action ("Fund agreement · 0.30 ETH", "Approve revision 2", never "Submit").
  - Loading keeps the width and shows a progress glyph plus the stage ("Waiting for wallet…").
- **State chip.** Glyph plus label in `micro`; outlined or solid per §2; radius 999px; minimum height 24px.
- **Address / hash.** Mono with middle elision and a copy button (the "Copied" announcement goes to a live region). It shows a role badge (Client, Provider, Verifier, You) when known, and an external-link icon to Sepolia Etherscan.
- **Amount.** Mono with tabular figures and the unit set in Plex Sans `--ink-3`. Expands to exact wei.
- **Settlement lane** (signature):
  - A time axis from creation to just past the latest `decide_by`.
  - Segments: *delivery window* (creation → `deliver_by`, funded tint), *review window* (→ `decide_by`, submitted tint), and *refund zone* (after the relevant deadline, hatched; it starts at `deliver_by` while Funded and at `decide_by` while Submitted).
  - Event marks for submissions (revision numbers), rejections, approval, and payout or refund (solid terminal mark).
  - The "now" cursor uses `--cobalt` and block time, with exact UTC and relative time ("in 3 h 12 min") on hover or focus.
  - It is a native SVG with a text equivalent: a visually hidden ordered list of the same facts.
  - For 2–3 milestones, the lanes share one time axis.
- **Ledger strip.** One 12px bar, segmented paid (solid green), refunded (solid rust) and outstanding (funded tint with an ink border). Below it is a four-column legend in `data`, and the identity is written out once: "Deposited 0.30 = Paid 0.10 + Refunded 0.05 + Outstanding 0.15 ETH". It is not a ring or a sparkline.
- **Transaction receipt** (all writes): a vertical stepper that stays on screen after the action.
  1. *Check:* `eth_call` simulation; shows the contract's exact revert reason, in plain language, before anything is signed.
  2. *Confirm in wallet.*
  3. *Pending:* tx hash with an Etherscan link and elapsed time.
  4. *Confirmed:* block, gas used, the decoded Settlane event; or *Reverted:* decoded reason with a recovery action.

  Rejection in the wallet is a neutral outcome, not an error.
- **Banner** (inline, never a modal unless focus must be held): network, read-only or simulation notices. A simulation banner uses a distinct diagonal-stripe edge and the words "Simulation — no blockchain, no real transactions".
- **Form field.** Label above, hint below, error below the hint with an icon. Validation runs on blur and on submit, and repeats the contract's own rule wording.
- **Table / list.** Row height 48px, sticky header, amounts right-aligned; on mobile, rows become stacked definition lists.
- **Icons.** One library (Lucide, 1.5px stroke), sized 16/20px, consistent everywhere. No emoji or Unicode glyphs as icons.

## 5. Layout

- 4px base. Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- Content width 1200px (app) / 1080px (landing text blocks 720px). Gutters 16px (<640), 24px (<1024), 32px.
- App shell: top bar (wordmark, Explorer, My agreements, Create, Demo, network and wallet control). There is no sidebar; the content is narrow enough without one.
- Agreement page composition, desktop:
  - Title row (agreement #, state summary, parties).
  - Ledger strip.
  - Shared settlement lanes.
  - A two-column region: milestone detail on the left (2/3) and the **action panel** for the connected role on the right (1/3, sticky).
  - Activity history below.
- Grouping uses space and hairlines first. Panels are used only for an action and are never nested. There is no grid of identical icon cards anywhere.

## 6. Depth and elevation

Nearly flat; paper does not float.

- Level 0 is the page.
- Level 1 is a `--surface` panel with a `--line` border and no shadow.
- Level 2 (popover, menu, toast) is `--surface` with a border plus `0 8px 24px -8px rgb(21 23 27 / 0.18)` (dark: `rgb(0 0 0 / 0.5)`).
- No glass or blur as decoration, no coloured glows, no hard offset shadows, and no one-sided accent bars on boxes.

## 7. Motion

- **One authored moment** on the landing page: the hero's settlement lane draws from creation to settlement on first view (~1.2 s), then rests.
- App transitions are functional only:
  - 120–180 ms for hover and press;
  - 200–260 ms for panel and stepper changes;
  - ease-out `cubic-bezier(0.16, 1, 0.3, 1)` from an already-visible default.
- The "now" cursor moves without animation (it re-renders on new blocks).
- **`prefers-reduced-motion: reduce`:** no drawing animation (the lane renders complete), no transitions beyond opacity at ≤100 ms, and no smooth scroll.
- Never: fade-in on every section, parallax, scroll-jacking, carousels, timed tabs, confetti on payout.

## 8. Do's and don'ts

Do:
- Name the rule when something is unavailable ("Refund opens at 14:30 UTC, when the delivery window closes").
- Show the trusted-verifier model wherever a verifier acts ("The verifier's decision is final on-chain; Settlane cannot check the work").
- Label every amount as Sepolia test ETH in the app shell.
- Prefer showing the contract's revert reason over guessing.

Don't:
- Use the words secure, trustless, guaranteed or audited.
- Show invented metrics, testimonials, logos or TVL.
- Use violet or neon accents, gradient text, eyebrow labels, section numbers, hero-metric blocks, or nested cards.
- Present simulated demo state anywhere that also shows real chain data without the simulation banner.

## 9. Responsive behaviour

| Breakpoint | Layout |
| --- | --- |
| ≥1280 | Full composition; the action panel is sticky |
| 1024–1279 | Same; lane axis labels thin out |
| 640–1023 | Single column; the action panel moves directly under the title (where the user acts first); lanes keep a horizontal axis with fewer ticks |
| <640 | Each milestone is a stacked block: state chip, a compact 6px mini-lane, and deadlines as a definition list. The ledger strip stays; tables become lists; the top bar collapses to the wordmark, a network dot and a menu |

- Touch targets are at least 44×44px.
- No horizontal page scroll at 360px. The lane SVG scales and never scrolls sideways.
- Text zooms to 200% without loss.

## 10. Agent quick reference

- Paper `#F5F3EE`, ink `#15171B`, accent cobalt `#2E47C9`.
- State hues: funded slate, submitted ochre, approved teal, paid green, refunded rust. Outlined = open, solid = final.
- Newsreader for titles, Plex Sans for UI, Plex Mono for data.
- Signature visuals: the settlement lane and the ledger strip.
- Every write passes through simulate → wallet → pending → confirmed or reverted.
- Never hide that the verifier is trusted and that this is Sepolia test ETH.

---

## 11. Revision: premium pass (2026-11-21)

Applied with UI/UX Pro Max v2.15.0 (`.claude/skills/ui-ux-pro-max`): its design-system query ("fintech escrow settlement trust blockchain milestone payments", dials variance 6 / motion 7 / density 4), landing, typography, UX-motion and focus searches. **Adopted:** Minimalism and Swiss style, IBM Plex Sans as the financial UI face (already used), the stagger and scroll-reveal principles (small offset, 300 to 450 ms, deceleration, final state under reduced motion, no content hidden without a fallback), focus-not-obscured, one primary action per view. **Rejected:** its suggested palette (amber `#F59E0B` with purple `#8B5CF6` on navy), which contradicts this identity (no violet) and the skill's own "avoid AI purple" line; its sales CTA ("Contact Sales"), which Settlane does not have; GSAP, because CSS scroll-driven animations do the same without a dependency. A timeline-chart search returned no verified match, so the lane follows the general rule (every range labelled with text, colour supplementary). Nothing from the other installed skills (brand, design, slides, banner, ui-styling) is used; several call the Gemini API or install shadcn through `npx`, which this project does not need.

**Surfaces.** Besides paper and ink there is the **stage**: a dark panel that stays dark in the light theme (`.stage` redefines the semantic tokens, so components inside need no variants). It is used for the hero replay, the story card, the code panel, the verification seal and the closing call to action: the places that present proof. Hairline "ledger rules" (4.5% ink, fading in and out) sit behind the hero only.

**Type.** Newsreader gains its true italic (146 KB, same OFL licence), used for one emphasised clause in the hero headline. Display sizes: `display-2xl` for the hero (clamp 2.75 to 4.5 rem), `numeral` for stat figures (lining, tabular).

**Motion system (one vocabulary, `globals.css`).** Tokens: press 120 ms, hover 180 ms, panel 260 ms, reveal 420 ms, one ease-out `cubic-bezier(0.16, 1, 0.3, 1)`; constant-rate progress is linear. Four kinds of motion only:
1. *Entrance* (`.enter`): played once on load, staggered with `--d`.
2. *Hero replay*: the real agreement 1 on its lane: bars draw, a cursor sweeps at a constant rate, marks pop and transcript rows light as it passes, then the outcome appears (about 3.3 s, once).
3. *Scroll-driven* (`.reveal`, `.reveal-stagger`, `.grow-x`, `.pop-in`, `.scroll-progress`): CSS `animation-timeline` only, no scripts, only where supported; a hairline reading-progress bar under the header.
4. *State*: hover lift (1 px) and underline draw on devices that hover, press scale 0.98 everywhere, the sticky story card, tooltips on lane marks.
Rules: nothing is hidden by default (no JavaScript, unsupported browsers and print see the final state); `prefers-reduced-motion` removes every animation, hides the replay cursor and shows all final states; no infinite animations; no blur or glow as decoration (the scrolled header is opaque).

**Components added.** `HeroStage`, `StoryStepper` (the only client-side story logic: an IntersectionObserver picks the step; the card is aria-hidden and hidden on phones), `MilestoneTrack` (Funded, In review, Approved, Paid; or Funded, Expired, Refunded), `Avatar` (deterministic identicon, decorative), timeline `ActivityList`, richer `SettlementLane` (time axis, window labels at the bottom of segments, marks in the upper half so they never collide), `LedgerStrip` (large figure, shares), `VerificationSeal`, `CommandBlock`, `CodeBlock` (hand-highlighted, no highlighter shipped), `ExplorerTable` mini bars, a four-column footer.

**Responsive.** The full navigation needs 1024 px (at 768 the logo, four links, network pill and wallet did not fit: found on the production build); below it the compact row shows Explorer, Contract and How it settles, and Limitations moves to the footer. Parties stack until 1024 px. Grid children that hold code or wide content carry `min-w-0` (a grid item otherwise cannot shrink below its content: the cause of a 666 px landing page on phones before the fix). Lane tooltips are width-bounded so a hidden tooltip can never widen the page.

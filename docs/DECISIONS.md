# Decisions log (authoritative)

Status values: **proposed**, **approved**, **rejected**, or **superseded**. Only the human owner approves.

| ID | Date | Decision | Status |
| --- | --- | --- | --- |
| D-001 | 2026-11-17 | Develop on local branch `settlane/dev`. Keep starter history. No pushes. `origin` currently points to the organizers' repo. | approved |
| D-002 | 2026-11-17 | Single Fe ingot and one production contract. Pure `rules.fe` kept separate from storage and transfers. No off-chain services. | proposed |
| D-003 | 2026-11-17 | Create and fund atomically, with an exact `msg.value`. There is no unfunded agreement state. | provisionally approved |
| D-004 | 2026-11-17 | Pull payments: approval creates an entitlement, and `Claim`/`Refund` transfer to a caller-chosen `to`. | provisionally approved |
| D-005 | 2026-11-17 | Refund is client-only, unlike ERC-8183, which recommends permissionless refunds. | open: owner requires a complete authorization and deadline analysis |
| D-006 | 2026-11-17 | `Rejected` is final. Retry only by resubmission before `deliver_by`. `Approve` restates the evidence hash. | **not approved**: failure and appeal scenarios must be analysed first |
| D-007 | 2026-11-17 | Bump CI `FE_VERSION` to v26.6.0 to match local development. | approved, conditional on verified compatibility |
| D-008 | 2026-11-17 | Skills: 3 for Claude (fe-implementation, contract-security, submission-review) and 1 for Codex (independent-review). Test guidance folded into fe-implementation. No MCP servers, hooks, or subagents. | provisionally approved |
| D-009 | pending Phase 1 | Testing approach for frozen time (Q5 option A, B, or C). | open |
| D-010 | later | Rename ingot `starter` → `settlane`. Rename folder `feguard` → `settlane`. Repoint `origin` to the owner's GitHub repo. | open (needs owner) |

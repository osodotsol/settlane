# Product — Settlane

**Tagline:** Fair payments for work delivered.

**Pitch (draft):** Settlane is a Fe contract that settles each milestone of a service agreement independently. Approved work becomes a provider entitlement, and expired or rejected work becomes refundable to the client. One conservation identity, `deposited = paid + refunded + outstanding`, is queryable on-chain and checked after every transition in the tests.

## Problem
- Clients risk paying for undelivered work, and providers risk delivering without being paid.
- All-or-nothing escrow (for example ERC-8183's single-budget job) treats a partly delivered agreement as fully paid or fully refunded.
- Disputes often have no settlement rules that were agreed in advance.

## Actors
| Actor | Role |
| --- | --- |
| Client | Creates and fully funds the agreement, and receives refunds for rejected or expired milestones. |
| Provider | Submits deliverable commitments and claims approved milestones. |
| Verifier | A trusted party that approves or rejects submitted milestones. It cannot move funds. |

## MVP scope (hackathon)
One contract. Each agreement has one client, one provider, one verifier, and 1–3 milestones, funded atomically in simulated ETH for exactly the milestone total. Each milestone has a spec commitment, a delivery deadline, and a review window. Payouts and refunds are pull-based. The contract exposes state and accounting queries and emits events. Tests cover positive, negative, and boundary cases, and there is a deterministic CLI demo via `fe test`.

## Out of scope
NEAR or Rust, automated or AI verification of work, fiat or naira rails, ERC-20 (deferred), mainnet, bridges, dispute arbitration, marketplace matching, identity or KYC, fees, frontend, backend services.

## Honest framing
- Milestone escrow, refunds, and verifier-gated payment are **not new** (see `docs/MARKET.md`).
- The verifier is trusted. Settlane enforces settlement rules, not the truth of work quality.
- This is a prototype. It is not audited and not for real funds.

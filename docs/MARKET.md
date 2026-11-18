# Market and originality assessment

Researched 2026-11-17. Each claim is marked **[observed]** (seen in a source), **[inferred]**, or **[hypothesis]** (unvalidated).

## Existing alternatives
| Alternative | What it already does | Source |
| --- | --- | --- |
| Centralized marketplace escrow (Upwork, Fiverr) | The platform holds funds and releases them per milestone. Disputes are handled by the platform. | [observed] described as the traditional model in a milestone-gateway guide, [chainscorelabs](https://www.chainscorelabs.com/guides/cross-border-payments-and-remittances/smart-contract-payment-systems/how-to-architect-a-milestone-based-payment-gateway-for-freelancers) |
| ERC-8183 Agentic Commerce (draft, 2026-02-25) | A job with an escrowed budget and an evaluator who completes or rejects it. Expiry refunds the client. Optional fees and hooks. **Single budget, all-or-nothing, no milestones.** Push payouts in the reference implementation. | [observed] [EIP-8183](https://eips.ethereum.org/EIPS/eip-8183), [Magicians thread](https://ethereum-magicians.org/t/erc-8183-agentic-commerce/27902) |
| Smart Invoice | Open-source, non-custodial milestone escrow with optional arbitration, on several EVM chains. | [observed] [Gitcoin listing](https://checker.gitcoin.co/public/project/show/smart-invoice-1) |
| Trustless Work (Stellar) | Multi-release escrow with per-milestone status, an evidence reference, then approval or dispute. | [observed] [docs](https://docs.trustlesswork.com/trustless-work/technology-overview/escrow-lifecycle/milestone-status-update) |
| Hackathon and OSS escrows (Soroban Trellis, EscrowFlow, Solana, Aptos, EVM) | Per-milestone lock, approve, release, and dispute. | [observed] search results, for example [Trellis](https://github.com/Trellis-Ecosystem/trellis) |
| Payment splitting and streaming (Sablier, Superfluid) | Time-based or proportional flows, not verification-gated. | [inferred] Not researched in depth. Treat this as an assumption. |

**Conclusion:** milestone escrow with verifier approval and refunds is a crowded, well-established pattern. Settlane must not claim the mechanism as original.

## Answers to the brief
1. **Problem.** Counterparty risk in staged digital-service work, and the unfairness of all-or-nothing settlement. [observed: pattern widely implemented]
2. **Who would pay.** Marketplaces and agencies that want embeddable settlement. [hypothesis, with no customer interviews]
3. **What alternatives do.** Everything in the table above.
4. **Our specific improvement.** A *specified and verified* settlement core: (a) an explicit total transition table in which every unlisted transition reverts, (b) deadline races resolved by a single pure Fe predicate with disjoint guards, and (c) a conservation identity that is queryable on-chain and checked after every step of the test suite.
5. **Why it matters.** Escrow bugs come from ambiguous transitions and accounting drift. A small core with a spec, a matrix of tests, and a checkable identity is something an integrator can audit cheaply. [inferred]
6. **Why Fe.** Effects make "verification cannot move money" and "rules cannot touch storage or time" compile-time properties, and typed `Wei`, `Timestamp`, and `Duration` plus exhaustive `match` remove whole classes of bugs. This is pending experiments E7 and E9.
7. **What we can demonstrate.** A reproducible `fe test` run showing partial settlement of a three-milestone agreement, rejected invalid operations, the identity holding at each step, and the full transition-matrix tests.

## Measurable differentiator (proposed)
**Transition-matrix coverage with an accounting oracle.** For every (stored state × action × caller role × time position relative to the deadline), there is a test asserting the outcome and the I1/I9 identity. We report the count of covered cells out of the total, which is objective and reproducible.

## Unsupported commercial hypotheses
- Marketplaces or agencies would adopt or pay for on-chain settlement. **No evidence gathered.**
- Transaction fees or paid integrations would be viable revenue. **No evidence.**
- Users prefer partial settlement to all-or-nothing. **Plausible, not validated.**
- A trusted-verifier model is acceptable to customers. **Not validated.**

## Originality risk (flagged)
The mechanism is not novel. The originality score depends on rigor (the formal table, Fe-effect capability guarantees, and verifiable accounting), not on the idea. If experiments E7 and E9 fail, the Fe-specific story weakens substantially. This needs a human decision at the end of Phase 1.

// Plain-language copy for every revert reason of the production contract
// (exact strings from ingots/settlane/src/handlers.fe; frontend/PLAN.md §6). A unit test parses
// handlers.fe and fails if any reason lacks an entry here. `{…}` placeholders are filled by the caller.

export type ReasonCopy = { message: string; recovery: string };

export const REVERT_REASONS: Record<string, ReasonCopy> = {
  "provider is zero": { message: "Enter the provider's address.", recovery: "Fix the provider field." },
  "verifier is zero": { message: "Enter the verifier's address.", recovery: "Fix the verifier field." },
  "client is provider": { message: "Client, provider and verifier must be three different addresses.", recovery: "Use a different provider address." },
  "client is verifier": { message: "Client, provider and verifier must be three different addresses.", recovery: "Use a different verifier address." },
  "provider is verifier": { message: "Client, provider and verifier must be three different addresses.", recovery: "Use different provider and verifier addresses." },
  "milestone count not 1..3": { message: "An agreement has 1 to 3 milestones.", recovery: "Adjust the milestones." },
  "unused milestone slot not empty": { message: "An unused milestone slot was not empty.", recovery: "This is an interface bug; please report it." },
  "milestone amount is zero": { message: "Each milestone needs an amount above 0.", recovery: "Enter an amount." },
  "milestone amounts overflow": { message: "The total is too large.", recovery: "Lower the amounts." },
  "value does not equal the milestone total": { message: "The ETH sent must equal the milestone total exactly.", recovery: "Try again; the form recomputes the total." },
  "deliver_by not in the future": { message: "A delivery deadline has passed.", recovery: "Choose a later time." },
  "review period is zero": { message: "Choose a review period.", recovery: "Pick a review period above zero." },
  "deliver_by plus review period overflows": { message: "That deadline is too far in the future.", recovery: "Choose an earlier date." },
  "milestone spec is zero": { message: "Add a specification for each milestone.", recovery: "Enter specification text, a file or a hash." },
  "unknown agreement": { message: "There is no agreement with this number.", recovery: "Open the explorer to find it." },
  "caller is not the provider": { message: "Only this agreement's provider can do this.", recovery: "Switch to the provider's account." },
  "caller is not the verifier": { message: "Only this agreement's verifier can do this.", recovery: "Switch to the verifier's account." },
  "caller is not the client": { message: "Only this agreement's client can do this.", recovery: "Switch to the client's account." },
  "no such milestone": { message: "This agreement has no such milestone.", recovery: "Check the milestone number." },
  "milestone cannot take evidence in this state": { message: "This milestone no longer takes evidence.", recovery: "Refresh to see its current state." },
  "delivery window is closed": { message: "The delivery deadline has passed.", recovery: "Submission is closed for this milestone." },
  "evidence is zero": { message: "Add evidence before submitting.", recovery: "Enter text, a file or a hash." },
  "milestone is not submitted": { message: "There is no submission waiting for review.", recovery: "Refresh to see its current state." },
  "review window is closed": { message: "The review deadline has passed.", recovery: "The client can now refund this milestone." },
  "evidence does not match the submitted evidence": { message: "The provider submitted newer evidence.", recovery: "Review the latest revision instead." },
  "submission revision does not match": { message: "The provider submitted a newer revision.", recovery: "Review the latest revision instead." },
  "milestone is not approved": { message: "This milestone is not approved.", recovery: "Refresh to see its current state." },
  "payee is zero": { message: "Enter the address that receives the ETH.", recovery: "Fix the recipient field." },
  "milestone cannot be refunded in this state": { message: "This milestone cannot be refunded in its current state.", recovery: "Refresh to see its current state." },
  "milestone has not expired": { message: "The refund is not open yet.", recovery: "Wait until the deadline shown (block time)." },
  "transfer failed": { message: "The receiving address rejected the payment (it may be a contract wallet).", recovery: "Try again with a plain account address." },
};

/** Copy for a revert reason, or a generic fallback that still shows the raw reason. */
export function reasonCopy(reason: string | undefined): ReasonCopy {
  if (reason && REVERT_REASONS[reason]) return REVERT_REASONS[reason];
  if (!reason) return { message: "The transaction would fail and returned no reason.", recovery: "Check that no ETH is attached and the network is Sepolia." };
  return { message: `The contract refused: "${reason}".`, recovery: "Refresh and try again." };
}

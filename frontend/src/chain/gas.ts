// Gas limit for a Settlane transaction: the node's estimate plus a margin.
//
// Why a margin: on the real Sepolia run (docs/ACCEPTANCE_REAL_WALLET.md, section 7) the wallet used the estimate
// verbatim as the limit, and the transactions used 99.1% (create), 98.8% (submit), 99.2% (approve) and 92.4%
// (refund) of it. State can change between the estimate and inclusion (another submission, a first write to a
// storage slot), and an out-of-gas failure still costs the fee. Unused gas is not charged (the fee is gas USED
// times the price), so a margin only raises the worst case the wallet reserves. 25% covers the observed spread
// with room to spare; the earlier testnet plan used 30% (docs/TESTNET.md). Fees (max fee, tip) are never set
// here: the wallet keeps its own fee settings.

export const GAS_MARGIN_PERCENT = 25n;

/** EIP-7825 per-transaction gas cap, active on Sepolia since the Osaka-generation fork (docs/TESTNET.md). */
export const TX_GAS_CAP = 16_777_216n;

/** estimate × 1.25, rounded up, never above the protocol cap. Throws if the estimate itself exceeds the cap. */
export function gasWithMargin(estimate: bigint): bigint {
  if (estimate <= 0n) throw new Error("gas estimate must be positive");
  if (estimate > TX_GAS_CAP) throw new Error("gas estimate exceeds the per-transaction cap");
  const padded = (estimate * (100n + GAS_MARGIN_PERCENT) + 99n) / 100n;
  return padded > TX_GAS_CAP ? TX_GAS_CAP : padded;
}

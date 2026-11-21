import type { Activity } from "@/contract/events";
import type { Agreement } from "@/contract/read";

// An ILLUSTRATION of one agreement settling, used only when the real one cannot be read from Sepolia (the
// hero labels it "Illustration of the rules"). It uses no real address and is never shown as chain data.
const ZERO_HASH = `0x${"0".repeat(64)}` as const;
const ADDR = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
const T0 = 1_800_000_000n;

export function sampleAgreement(): { agreement: Agreement; activity: Activity[]; now: bigint } {
  const amount = 300_000_000_000_000_000n; // 0.30 ETH
  const agreement: Agreement = {
    id: 1n,
    client: ADDR(0xc1),
    provider: ADDR(0xb2),
    verifier: ADDR(0xa3),
    reviewPeriod: 3600n,
    n: 1,
    deposited: amount,
    paid: amount,
    refunded: 0n,
    outstanding: 0n,
    milestones: [{ index: 0, state: "paid", amount, deliverBy: T0 + 3600n, decideBy: T0 + 7200n, spec: 1n, evidence: 1n, rejections: 0n, revision: 1n }],
  };
  const at = (kind: Activity["kind"], offset: bigint, extra: Partial<Activity> = {}): Activity => ({
    kind,
    id: 1n,
    m: kind === "created" ? null : 0,
    blockNumber: 1n,
    logIndex: 0,
    txHash: ZERO_HASH,
    timestamp: T0 + offset,
    ...extra,
  });
  return {
    agreement,
    activity: [
      at("created", 0n, { total: amount, milestones: 1 }),
      at("submitted", 1500n, { evidence: 1n, revision: 1n }),
      at("approved", 3900n, { evidence: 1n, revision: 1n }),
      at("claimed", 5100n, { amount, to: agreement.provider }),
    ],
    now: T0 + 9000n,
  };
}

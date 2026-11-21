import data from "./fixtures/sepolia-a1-a2.json";
import { decodeActivity, type Activity } from "@/contract/events";
import type { Agreement, Milestone } from "@/contract/read";
import { storedState } from "@/domain/lifecycle";
import type { Address, Hex } from "viem";

// Typed access to the recorded Sepolia fixture (A1 Paid, A2 Refunded; terminal, immutable).
export const fixture = data;

export function fixtureAgreement(id: 1 | 2): Agreement {
  const a = data.agreements[String(id) as "1" | "2"];
  const [deposited, paid, refunded, outstanding] = a.accounting.map(BigInt) as [bigint, bigint, bigint, bigint];
  const milestones: Milestone[] = a.milestones.map((x, index) => ({
    index,
    state: storedState(Number(x[0])),
    amount: BigInt(x[1]!),
    deliverBy: BigInt(x[2]!),
    decideBy: BigInt(x[3]!),
    spec: BigInt(x[4]!),
    evidence: BigInt(x[5]!),
    rejections: BigInt(x[6]!),
    revision: BigInt(x[7]!),
  }));
  return {
    id: BigInt(id),
    client: a.client as Address,
    provider: a.provider as Address,
    verifier: a.verifier as Address,
    reviewPeriod: BigInt(a.reviewPeriod),
    n: a.n,
    deposited,
    paid,
    refunded,
    outstanding,
    milestones,
  };
}

export function fixtureActivity(): Activity[] {
  return data.logs
    .map((l) =>
      decodeActivity(
        { topics: l.topics as Hex[], data: l.data as Hex, blockNumber: BigInt(l.blockNumber), logIndex: l.logIndex, transactionHash: l.transactionHash as Hex },
        BigInt(data.timestamps[l.blockNumber as keyof typeof data.timestamps]),
      ),
    )
    .filter((a): a is Activity => a !== null);
}

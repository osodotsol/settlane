import { describe, expect, it } from "vitest";
import { scanActivity } from "@/contract/events";
import { readAgreement } from "@/contract/read";
import { fixture, fixtureActivity, fixtureAgreement } from "./fixture";

// Opt-in (`npm run test:live`): re-reads Sepolia and compares with the recorded fixture. A1 and A2 are
// terminal, so any difference means the reader or the decoder is wrong, never that the chain moved.
describe.runIf(process.env.SETTLANE_LIVE === "1")("live Sepolia equals the recorded fixture", () => {
  it("agreements 1 and 2 read exactly as recorded", async () => {
    for (const id of [1, 2] as const) expect(await readAgreement(BigInt(id))).toEqual(fixtureAgreement(id));
  }, 60_000);
  it("the event history up to the recorded block decodes exactly as recorded", async () => {
    const live = await scanActivity(BigInt(fixture.fromBlock), BigInt(fixture.toBlock));
    expect(live).toEqual(fixtureActivity());
  }, 120_000);
});

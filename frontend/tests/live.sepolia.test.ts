import { describe, expect, it } from "vitest";
import { history as engine } from "@/contract/history-instance";
import { readAgreement } from "@/contract/read";
import { fixture, fixtureActivity, fixtureAgreement } from "./fixture";

// Opt-in (`npm run test:live`): re-reads Sepolia and compares with the recorded fixture. A1 and A2 are
// terminal, so any difference means the reader or the decoder is wrong, never that the chain moved.
describe.runIf(process.env.SETTLANE_LIVE === "1")("live Sepolia equals the recorded fixture", () => {
  it("agreements 1 and 2 read exactly as recorded", async () => {
    for (const id of [1, 2] as const) expect(await readAgreement(BigInt(id))).toEqual(fixtureAgreement(id));
  }, 60_000);
  it("the event history up to the recorded block decodes exactly as recorded", async () => {
    // through the application's own engine (verified snapshot + live scan): A1's and A2's events must equal the fixture
    const { events, status } = await engine.refresh();
    expect(status.snapshot.used).toBe(true);
    const upTo = events.filter((e) => e.blockNumber >= BigInt(fixture.fromBlock) && e.blockNumber <= BigInt(fixture.toBlock)).map((e) => {
      const copy: Partial<typeof e> = { ...e };
      delete copy.blockHash; // the fixture predates block hashes
      return copy;
    });
    expect(upTo).toEqual(fixtureActivity());
  }, 120_000);
});

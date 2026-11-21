import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { settlaneAbi } from "@/contract/abi";
import { DEPLOY_BLOCK, RUNTIME_SHA256, SETTLANE_ADDRESS } from "@/config/chain";

const repo = (p: string) => new URL(`../../${p}`, import.meta.url);
type Param = { type: string };

describe("ABI", () => {
  it("equals the ABI lock in scripts/lint-policy.json (functions, outputs, mutability)", () => {
    const lock = JSON.parse(readFileSync(repo("scripts/lint-policy.json"), "utf8")).contracts.Settlane.abi.functions as Record<string, string>;
    const fns = Object.fromEntries(
      settlaneAbi
        .filter((x) => x.type === "function")
        .map((x) => {
          const f = x as unknown as { name: string; inputs: Param[]; outputs: Param[]; stateMutability: string };
          return [`${f.name}(${f.inputs.map((i) => i.type).join(",")})->(${f.outputs.map((o) => o.type).join(",")})`, f.stateMutability];
        }),
    );
    expect(fns).toEqual(lock);
  });
  it("has the six Settlane events", () => {
    expect(settlaneAbi.filter((x) => x.type === "event").map((x) => (x as { name: string }).name).sort()).toEqual([
      "AgreementCreated", "MilestoneApproved", "MilestoneClaimed", "MilestoneRefunded", "MilestoneRejected", "MilestoneSubmitted",
    ]);
  });
});

describe("deployment config", () => {
  it("pins the runtime hash recorded in experiments/sepolia/artifact.json", () => {
    expect(RUNTIME_SHA256).toBe(JSON.parse(readFileSync(repo("experiments/sepolia/artifact.json"), "utf8")).runtime_sha256);
  });
  it("matches the deployment documented in the README", () => {
    const readme = readFileSync(repo("README.md"), "utf8");
    expect(readme.toLowerCase()).toContain(SETTLANE_ADDRESS.toLowerCase());
    expect(readme).toContain(`--from-block ${DEPLOY_BLOCK}`);
  });
});

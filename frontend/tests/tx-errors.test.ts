import { ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError, encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";
import { describeTxError } from "@/chain/errors";
import { createdAgreementId } from "@/chain/write";
import { SETTLANE_ADDRESS } from "@/config/chain";
import { settlaneAbi } from "@/contract/abi";
import { encodeAbiParameters, encodeEventTopics } from "viem";

const errorAbi = [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }] as const;

describe("transaction errors are explained, not swallowed", () => {
  it("maps a contract revert to its plain-language reason", () => {
    const data = encodeErrorResult({ abi: errorAbi, errorName: "Error", args: ["milestone is not approved"] });
    const error = new ContractFunctionRevertedError({ abi: settlaneAbi, functionName: "claim", data });
    const p = describeTxError(error);
    expect(p.reason).toBe("milestone is not approved");
    expect(p.message).toMatch(/not approved/);
  });
  it("says that declining in the wallet sent nothing", () => {
    expect(describeTxError(new UserRejectedRequestError(new Error("denied"))).message).toMatch(/declined/);
    expect(describeTxError({ code: 4001 }).recovery).toMatch(/Nothing was sent/);
  });
  it("explains insufficient funds and keeps unknown errors visible", () => {
    expect(describeTxError(new InsufficientFundsError()).message).toMatch(/Sepolia ETH/);
    expect(describeTxError(new Error("boom")).message).toBe("boom");
  });
});

describe("created agreement id comes from the receipt's own log", () => {
  const log = (address: `0x${string}`, id: bigint) => ({
    address,
    topics: encodeEventTopics({ abi: settlaneAbi, eventName: "AgreementCreated", args: { id, client: "0x00000000000000000000000000000000000000c1", provider: "0x00000000000000000000000000000000000000b2" } }),
    data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint8" }], ["0x00000000000000000000000000000000000000a3", 5n, 1]),
  });
  it("reads it from the Settlane contract's log only", () => {
    expect(createdAgreementId({ logs: [log(SETTLANE_ADDRESS, 7n)] as never })).toBe(7n);
    expect(createdAgreementId({ logs: [log("0x0000000000000000000000000000000000000dad", 9n)] as never })).toBeUndefined();
    expect(createdAgreementId({ logs: [] })).toBeUndefined();
  });
});

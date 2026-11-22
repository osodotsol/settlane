import { NextResponse, type NextRequest } from "next/server";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { PROXY_BUDGET_MS, withBudget } from "@/chain/budget";
import { publicClient } from "@/chain/client";
import { SETTLANE_ADDRESS } from "@/config/chain";
import { settlaneAbi } from "@/contract/abi";

// Real HTTP 404s for agreements that do not exist. The page itself streams (so a notFound() thrown while
// rendering keeps status 200 with a noindex tag, per the Next.js docs), so the check runs here, before
// rendering. Ids start at 1, are consecutive and are never deleted (LIFECYCLE, D-018): once an id is known
// to exist, every id up to it exists, and those requests need no RPC call.
let highestKnown = 0n;

const ID = /^[1-9]\d{0,76}$/;

function notFoundResponse(request: NextRequest) {
  return NextResponse.rewrite(new URL("/not-found-agreement", request.url), { status: 404 });
}

async function exists(id: bigint): Promise<boolean | null> {
  if (id <= highestKnown) return true;
  try {
    // bounded (R2 H1): a hanging node must not hold the request; on timeout the page renders and says so itself
    await withBudget(publicClient.readContract({ address: SETTLANE_ADDRESS, abi: settlaneAbi, functionName: "getAgreement", args: [id] }), PROXY_BUDGET_MS, "agreement check");
    if (id > highestKnown) highestKnown = id;
    return true;
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    if (revert instanceof ContractFunctionRevertedError && revert.reason === "unknown agreement") return false;
    return null; // the RPC failed: let the page render its own error state
  }
}

export async function proxy(request: NextRequest) {
  const raw = request.nextUrl.pathname.split("/")[2] ?? "";
  if (!ID.test(raw)) return notFoundResponse(request);
  if ((await exists(BigInt(raw))) === false) return notFoundResponse(request);
  return NextResponse.next();
}

export const config = { matcher: "/agreements/:id" };

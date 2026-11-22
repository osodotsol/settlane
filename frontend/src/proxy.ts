import { NextResponse, type NextRequest } from "next/server";
import { PROXY_BUDGET_MS } from "@/chain/budget";
import { ID_PATTERN } from "@/contract/known-ids";
import { knownIds } from "@/contract/data";

// Real HTTP 404s for agreements that do not exist. The page itself streams (so a notFound() thrown while
// rendering keeps status 200 with a noindex tag, per the Next.js docs), so the check runs here, before
// rendering. Ids start at 1, are consecutive and are never deleted (LIFECYCLE, D-018), so one number (the count of
// agreements) answers every id: src/contract/known-ids.ts reads it at most once per few seconds, shared by every
// request, so made-up ids cannot multiply RPC traffic (R2-B).

function notFoundResponse(request: NextRequest) {
  return NextResponse.rewrite(new URL("/not-found-agreement", request.url), { status: 404 });
}

export async function proxy(request: NextRequest) {
  const raw = request.nextUrl.pathname.split("/")[2] ?? "";
  if (!ID_PATTERN.test(raw)) return notFoundResponse(request);
  // bounded (R2 H1): on "unknown" (the count could not be read in time) the page renders and says so itself
  if ((await knownIds.check(BigInt(raw), PROXY_BUDGET_MS)) === "missing") return notFoundResponse(request);
  return NextResponse.next();
}

export const config = { matcher: "/agreements/:id" };

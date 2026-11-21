import type { Metadata } from "next";
import { getActivity, getOverview } from "@/contract/data";
import type { Agreement } from "@/contract/read";
import { formatRelative, formatUtc } from "@/domain/format";
import { displayState, isFinal } from "@/domain/lifecycle";
import { nextStep } from "@/domain/next-step";
import { Amount } from "@/ui/Amount";
import { Banner } from "@/ui/Banner";
import { Container } from "@/ui/Container";
import { ExplorerTable, type ExplorerRow } from "@/ui/ExplorerTable";

export const metadata: Metadata = { title: "Explorer" };
// Rendered per request through the short-lived server cache: agreements are discovered on-chain (ids are
// probed until the contract reports "unknown agreement"), so a new agreement appears within seconds.
export const dynamic = "force-dynamic";

function nextText(a: Agreement, now: bigint): string {
  const steps = a.milestones.map((m) => nextStep(m, now));
  const urgent = steps
    .filter((s): s is Extract<typeof s, { by: bigint }> => s.kind === "deliver" || s.kind === "review")
    .sort((x, y) => (x.by < y.by ? -1 : 1))[0];
  if (urgent) return `${urgent.kind === "deliver" ? "Delivery due" : "Review due"} ${formatRelative(urgent.by, now)}`;
  if (steps.some((s) => s.kind === "refund")) return "Refund available to the client";
  if (steps.some((s) => s.kind === "claim")) return "Claim available to the provider";
  return "Settled";
}

export default async function ExplorerPage() {
  let overview;
  try {
    overview = await getOverview();
  } catch {
    overview = null;
  }
  let createdAt = new Map<string, bigint>();
  try {
    const activity = await getActivity();
    createdAt = new Map(activity.value.filter((a) => a.kind === "created").map((a) => [a.id.toString(), a.timestamp]));
  } catch {
    /* creation times are optional */
  }

  const data = overview?.value;
  const rows: ExplorerRow[] = (data?.agreements ?? []).map((a) => ({
    id: a.id.toString(),
    states: a.milestones.map((m) => displayState(m.state, data!.blockTime, m.deliverBy, m.decideBy)),
    client: a.client,
    provider: a.provider,
    verifier: a.verifier,
    deposited: a.deposited.toString(),
    outstanding: a.outstanding.toString(),
    open: a.milestones.some((m) => !isFinal(displayState(m.state, data!.blockTime, m.deliverBy, m.decideBy))),
    next: nextText(a, data!.blockTime),
    created: createdAt.has(a.id.toString()) ? `Created ${formatUtc(createdAt.get(a.id.toString())!)}` : null,
  }));

  return (
    <Container className="py-14">
      <h1 className="text-display">Agreements</h1>
      <p className="mt-3 measure text-ink-2">
        Every agreement on the deployed contract, discovered and read directly from Sepolia. No wallet needed. States are judged against the latest
        block time.
      </p>

      <div className="mt-10">
        {!data ? (
          <Banner tone="danger" title="The Sepolia endpoints did not answer">
            Nothing is wrong with the agreements; the public RPC is unavailable. Reload the page to try again.
          </Banner>
        ) : (
          <>
            {overview!.stale && (
              <div className="mb-6">
                <Banner title="Showing the last data read from Sepolia">
                  The public endpoints are not answering right now. Read at {new Date(overview!.fetchedAt).toISOString().slice(0, 19).replace("T", " ")} UTC.
                </Banner>
              </div>
            )}
            <p className="mb-6 text-sm text-ink-3">
              {data.agreements.length} agreement{data.agreements.length === 1 ? "" : "s"} · held for open milestones <Amount wei={data.totalOutstanding} /> · block
              time {formatUtc(data.blockTime)}
            </p>
            {rows.length === 0 ? <Banner title="No agreements yet">The contract is deployed and holds no agreements.</Banner> : <ExplorerTable rows={rows} />}
          </>
        )}
      </div>
    </Container>
  );
}

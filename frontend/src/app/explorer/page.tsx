import type { Metadata } from "next";
import Link from "next/link";
import { readOverview } from "@/contract/read";
import { formatUtc } from "@/domain/format";
import { isFinal, displayState } from "@/domain/lifecycle";
import { Address } from "@/ui/Address";
import { Amount } from "@/ui/Amount";
import { Banner } from "@/ui/Banner";
import { Container } from "@/ui/Container";
import { MilestoneChips } from "@/ui/MilestoneChips";

export const metadata: Metadata = { title: "Explorer" };
export const revalidate = 30;

export default async function ExplorerPage() {
  let data: Awaited<ReturnType<typeof readOverview>> | null = null;
  try {
    data = await readOverview();
  } catch {
    data = null;
  }

  return (
    <Container className="py-14">
      <h1 className="text-display">Agreements</h1>
      <p className="mt-3 measure text-ink-2">
        Every agreement on the deployed contract, read directly from Sepolia. No wallet needed. States are judged
        against the latest block time.
      </p>

      <div className="mt-10">
        {data === null ? (
          <Banner tone="danger" title="The Sepolia endpoints did not answer">
            Nothing is wrong with the agreements; the public RPC is unavailable. Reload the page to try again.
          </Banner>
        ) : data.agreements.length === 0 ? (
          <Banner title="No agreements yet">The contract is deployed and holds no agreements.</Banner>
        ) : (
          <>
            <p className="mb-4 text-sm text-ink-3">
              {data.agreements.length} agreement{data.agreements.length === 1 ? "" : "s"} · total held for open milestones{" "}
              <Amount wei={data.totalOutstanding} /> · block time {formatUtc(data.blockTime)}
            </p>
            {/* Desktop: a table. Mobile: stacked items (DESIGN.md §9). */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-line-control text-ink-3">
                <tr>
                  <th scope="col" className="py-3 pr-4 font-medium">Agreement</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Milestones</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Client</th>
                  <th scope="col" className="py-3 pr-4 font-medium">Provider</th>
                  <th scope="col" className="py-3 pr-4 text-right font-medium">Deposited</th>
                  <th scope="col" className="py-3 text-right font-medium">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.agreements.map((a) => (
                  <tr key={a.id.toString()} className="align-middle">
                    <th scope="row" className="py-3 pr-4 font-medium">
                      <Link href={`/agreements/${a.id}`} className="text-ink underline decoration-line-control underline-offset-4 hover:decoration-cobalt">
                        #{a.id.toString()}
                      </Link>
                    </th>
                    <td className="py-3 pr-4"><MilestoneChips milestones={a.milestones} now={data.blockTime} /></td>
                    <td className="py-3 pr-4"><Address address={a.client} /></td>
                    <td className="py-3 pr-4"><Address address={a.provider} /></td>
                    <td className="py-3 pr-4 text-right"><Amount wei={a.deposited} /></td>
                    <td className="py-3 text-right"><Amount wei={a.outstanding} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line border-y border-line md:hidden">
              {data.agreements.map((a) => {
                const open = a.milestones.some((m) => !isFinal(displayState(m.state, data.blockTime, m.deliverBy, m.decideBy)));
                return (
                  <li key={a.id.toString()} className="py-4">
                    <Link href={`/agreements/${a.id}`} className="text-heading underline decoration-line-control underline-offset-4">
                      Agreement #{a.id.toString()}
                    </Link>
                    <span className="ml-2 text-sm text-ink-3">{open ? "Open" : "Closed"}</span>
                    <div className="mt-2"><MilestoneChips milestones={a.milestones} now={data.blockTime} /></div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <dt className="text-ink-3">Deposited</dt>
                      <dd className="text-right"><Amount wei={a.deposited} /></dd>
                      <dt className="text-ink-3">Outstanding</dt>
                      <dd className="text-right"><Amount wei={a.outstanding} /></dd>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Container>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ID_PATTERN } from "@/contract/known-ids";
import { AgreementWorkspace } from "@/ui/app/AgreementWorkspace";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: `Agreement #${(await params).id}` };
}

export default async function Page({ params }: Params) {
  const { id } = await params;
  if (!ID_PATTERN.test(id)) notFound(); // same rule as src/proxy.ts: no read for malformed or absurd ids
  return <AgreementWorkspace id={BigInt(id)} />;
}

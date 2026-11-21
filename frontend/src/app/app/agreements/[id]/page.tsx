import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgreementWorkspace } from "@/ui/app/AgreementWorkspace";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: `Agreement #${(await params).id}` };
}

export default async function Page({ params }: Params) {
  const { id } = await params;
  if (!/^[1-9]\d{0,76}$/.test(id)) notFound();
  return <AgreementWorkspace id={BigInt(id)} />;
}

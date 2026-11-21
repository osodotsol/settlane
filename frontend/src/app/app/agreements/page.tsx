import type { Metadata } from "next";
import { AgreementsView } from "@/ui/app/AgreementsView";

export const metadata: Metadata = { title: "My Agreements" };
export default function Page() {
  return <AgreementsView />;
}

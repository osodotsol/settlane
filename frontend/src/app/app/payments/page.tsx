import type { Metadata } from "next";
import { PaymentsView } from "@/ui/app/PaymentsView";

export const metadata: Metadata = { title: "Payments" };
export default function Page() {
  return <PaymentsView />;
}

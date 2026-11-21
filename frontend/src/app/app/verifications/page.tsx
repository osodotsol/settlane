import type { Metadata } from "next";
import { QueueView } from "@/ui/app/QueueView";

export const metadata: Metadata = { title: "Verifications" };
export default function Page() {
  return <QueueView role="verifier" />;
}

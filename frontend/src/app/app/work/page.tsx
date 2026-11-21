import type { Metadata } from "next";
import { QueueView } from "@/ui/app/QueueView";

export const metadata: Metadata = { title: "My Work" };
export default function Page() {
  return <QueueView role="provider" />;
}

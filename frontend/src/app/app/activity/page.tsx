import type { Metadata } from "next";
import { ActivityView } from "@/ui/app/ActivityView";

export const metadata: Metadata = { title: "Activity" };
export default function Page() {
  return <ActivityView />;
}

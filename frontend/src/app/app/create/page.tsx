import type { Metadata } from "next";
import { CreateView } from "@/ui/app/CreateView";

export const metadata: Metadata = { title: "Create Agreement" };
export default function Page() {
  return <CreateView />;
}

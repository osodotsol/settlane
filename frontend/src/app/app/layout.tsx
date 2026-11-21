import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/ui/app/AppShell";

export const metadata: Metadata = { title: { default: "Settlane app", template: "%s · Settlane app" } };

// The application shell: sidebar navigation, wallet and network state. Reading never needs a wallet.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

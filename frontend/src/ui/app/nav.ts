import { Activity, Banknote, BriefcaseBusiness, FolderOpen, LayoutDashboard, PlusCircle, ShieldCheck, type LucideIcon } from "lucide-react";

export type AppNavItem = { href: string; label: string; icon: LucideIcon; hint: string; badge?: "work" | "verify" | "pay" };

// The application's sections. Each maps to one real view of the deployed contract (docs/PRODUCT.md).
export const APP_NAV: AppNavItem[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard, hint: "Your agreements, funds and next actions" },
  { href: "/app/agreements", label: "My Agreements", icon: FolderOpen, hint: "Every agreement you are a party to" },
  { href: "/app/create", label: "Create Agreement", icon: PlusCircle, hint: "Fund up to three milestones" },
  { href: "/app/work", label: "My Work", icon: BriefcaseBusiness, hint: "Milestones you deliver as provider", badge: "work" },
  { href: "/app/verifications", label: "Verifications", icon: ShieldCheck, hint: "Submissions waiting for your decision", badge: "verify" },
  { href: "/app/payments", label: "Payments", icon: Banknote, hint: "Claims, refunds and payout history", badge: "pay" },
  { href: "/app/activity", label: "Activity", icon: Activity, hint: "Every event, with its transaction" },
];

export function isActive(path: string, href: string): boolean {
  if (href === "/app") return path === "/app";
  return path === href || path.startsWith(`${href}/`);
}

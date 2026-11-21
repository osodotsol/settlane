import { Activity, Banknote, BriefcaseBusiness, FolderOpen, LayoutDashboard, PlusCircle, ShieldCheck, type LucideIcon } from "lucide-react";

export type AppNavItem = { href: string; label: string; icon: LucideIcon; hint: string; group: "overview" | "act"; badge?: "work" | "verify" | "pay" };

// The application's sections. Each maps to one real view of the deployed contract (docs/PRODUCT.md).
export const APP_NAV: AppNavItem[] = [
  { href: "/app", label: "Dashboard", group: "overview", icon: LayoutDashboard, hint: "Your agreements, funds and next actions" },
  { href: "/app/agreements", label: "My Agreements", group: "overview", icon: FolderOpen, hint: "Every agreement you are a party to" },
  { href: "/app/create", label: "Create Agreement", group: "act", icon: PlusCircle, hint: "Fund up to three milestones" },
  { href: "/app/work", label: "My Work", group: "act", icon: BriefcaseBusiness, hint: "Milestones you deliver as provider", badge: "work" },
  { href: "/app/verifications", label: "Verifications", group: "act", icon: ShieldCheck, hint: "Submissions waiting for your decision", badge: "verify" },
  { href: "/app/payments", label: "Payments", group: "act", icon: Banknote, hint: "Claims, refunds and payout history", badge: "pay" },
  { href: "/app/activity", label: "Activity", group: "overview", icon: Activity, hint: "Every event, with its transaction" },
];

export const NAV_GROUPS = [
  { id: "overview", label: "Overview" },
  { id: "act", label: "Act" },
] as const;

export function isActive(path: string, href: string): boolean {
  if (href === "/app") return path === "/app";
  return path === href || path.startsWith(`${href}/`);
}

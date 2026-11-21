"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useOverview } from "@/chain/queries";
import { useWallet } from "@/chain/use-wallet";
import { SETTLANE_ADDRESS } from "@/config/chain";
import { attentionFor } from "@/domain/app-model";
import { shortHex } from "@/domain/format";
import { WalletControl } from "../WalletControl";
import { Wordmark } from "../Wordmark";
import { APP_NAV, NAV_GROUPS, isActive, type AppNavItem } from "./nav";

/** Counts of things waiting on the connected wallet, shown as badges in the navigation. */
function useBadges(): Record<NonNullable<AppNavItem["badge"]>, number> {
  const { address } = useWallet();
  const { data } = useOverview();
  if (!data || !address) return { work: 0, verify: 0, pay: 0 };
  const items = attentionFor(data.agreements, address, data.blockTime);
  return {
    work: items.filter((i) => i.action === "submit").length,
    verify: items.filter((i) => i.action === "review").length,
    pay: items.filter((i) => i.action === "claim" || i.action === "refund").length,
  };
}

function Badge({ n, label }: { n: number; label: string }) {
  if (n === 0) return null;
  return (
    <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-cobalt px-1.5 text-[0.6875rem] font-semibold leading-5 text-paper" aria-label={`${n} ${label}`}>
      {n}
    </span>
  );
}

function SideLink({ item, active, badges }: { item: AppNavItem; active: boolean; badges: ReturnType<typeof useBadges> }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.hint}
      className={`press group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-[var(--dur-hover)] ${
        active ? "bg-sunken text-ink" : "text-ink-2 hover:bg-sunken/70 hover:text-ink"
      }`}
    >
      <Icon aria-hidden size={18} strokeWidth={1.75} className={active ? "text-cobalt" : "text-ink-3 group-hover:text-ink-2"} />
      {item.label}
      {item.badge && <Badge n={badges[item.badge]} label="waiting for you" />}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const badges = useBadges();
  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-line bg-paper lg:block">
        <div className="sticky top-0 flex h-dvh flex-col px-4 pb-5 pt-5">
          <div className="px-2">
            <Wordmark />
          </div>
          <nav aria-label="Application" className="mt-7 space-y-5">
            {NAV_GROUPS.map((g) => (
              <div key={g.id}>
                <p className="px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-3">{g.label}</p>
                <div className="flex flex-col gap-0.5">
                  {APP_NAV.filter((i) => i.group === g.id).map((item) => (
                    <SideLink key={item.href} item={item} active={isActive(path, item.href)} badges={badges} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto space-y-3">
            <div className="card p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <span aria-hidden className="size-2 rounded-full bg-paid" />
                Sepolia testnet
              </p>
              <p className="mt-1 text-ink-3">Test ETH only. Contract <span className="text-data text-[0.8125rem]">{shortHex(SETTLANE_ADDRESS)}</span></p>
            </div>
            <ul className="space-y-0.5 text-sm text-ink-2">
              {[
                ["/explorer", "Public explorer"],
                ["/contract", "Contract evidence"],
                ["/", "Back to the site"],
              ].map(([href, label]) => (
                <li key={href}>
                  <Link href={href!} className="group flex h-9 items-center justify-between rounded-lg px-3 hover:bg-sunken/70 hover:text-ink">
                    {label}
                    <ArrowUpRight aria-hidden size={15} className="text-ink-3 transition-transform duration-[var(--dur-hover)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur-sm">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden">
              <Wordmark />
            </div>
            <p className="hidden text-sm text-ink-3 lg:block">{APP_NAV.find((i) => isActive(path, i.href))?.hint ?? "Settlane application"}</p>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-micro text-ink-2 sm:inline-flex">
                <span aria-hidden className="size-1.5 rounded-full bg-paid" />
                Sepolia · test ETH
              </span>
              <WalletControl />
            </div>
          </div>
          {/* Phones and tablets: every section stays one tap away in a scrollable strip. */}
          <nav aria-label="Application (compact)" className="border-t border-line lg:hidden">
            <ul className="flex gap-1 overflow-x-auto px-3 py-1.5 [scrollbar-width:none]">
              {APP_NAV.map((item) => {
                const active = isActive(path, item.href);
                return (
                  <li key={item.href} className="shrink-0">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`press inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ${active ? "bg-sunken text-ink" : "text-ink-2 hover:text-ink"}`}
                    >
                      {item.label}
                      {item.badge && badges[item.badge] > 0 && <span className="rounded-full bg-cobalt px-1.5 text-[0.6875rem] font-semibold leading-5 text-paper">{badges[item.badge]}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </header>
        <main id="main" className="min-w-0 flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-8">
          <div className="mx-auto w-full max-w-[1100px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

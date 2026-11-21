"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { useConnect, useConnectors, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { useOverview } from "@/chain/queries";
import { useWallet } from "@/chain/use-wallet";
import type { Agreement } from "@/contract/read";
import { ACTION_LABEL, ROLE_LABEL, agreementsFor, isOpen, nextLine, rolesOf, type AttentionItem, type Role } from "@/domain/app-model";
import { formatEth, formatRelative } from "@/domain/format";
import { Amount } from "../Amount";
import { Button } from "../Button";
import { MilestoneChips } from "../MilestoneChips";

// ---------------------------------------------------------------------------------------------------
// Data: the overview plus the connected wallet, in one place so every view reads the same way.
// ---------------------------------------------------------------------------------------------------

export function useAppData() {
  const wallet = useWallet();
  const q = useOverview();
  const all = q.data?.agreements ?? [];
  const now = q.data?.blockTime ?? 0n;
  return { wallet, q, all, mine: agreementsFor(all, wallet.address), now, loaded: q.data !== undefined };
}

// ---------------------------------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------------------------------

export function PageHeader({ title, lead, action }: { title: string; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="enter flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-display-xl">{title}</h1>
        {lead && <div className="mt-3 max-w-2xl text-ink-2">{lead}</div>}
      </div>
      {action}
    </div>
  );
}

export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id={id} className="text-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-sunken ${className}`} />;
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading from Sepolia" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-start gap-1 border-dashed p-7">
      <p className="text-heading">{title}</p>
      {children && <div className="max-w-xl text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-start gap-3 border-danger p-6">
      <p className="flex items-center gap-2 text-heading"><TriangleAlert aria-hidden size={18} className="text-danger" />The Sepolia endpoints did not answer</p>
      <p className="text-ink-2">Nothing is wrong with your funds; this page just could not read the chain. Try again in a moment.</p>
      <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>
    </div>
  );
}

/** Shows loading rows, an error with retry, or the children once the overview has loaded. */
export function Loaded({ children, rows }: { children: ReactNode; rows?: number }) {
  const { q, loaded } = useAppData();
  if (!loaded) return q.isError ? <ErrorState retry={() => void q.refetch()} /> : <LoadingRows rows={rows} />;
  return <>{children}</>;
}

/** Asks for a wallet (or a network switch) where an action or a personal view needs one. Reading never does. */
export function WalletGate({ title, children, needSepolia = false }: { title: string; children: ReactNode; needSepolia?: boolean }) {
  const { ready, address, wrongNetwork } = useWallet();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  if (!ready) return <Skeleton className="h-40" />;
  if (!address) {
    const connector = connectors[0];
    return (
      <div className="card p-7">
        <p className="text-title">{title}</p>
        <p className="mt-2 max-w-xl text-ink-2">
          {connector
            ? "Connect a browser wallet to see what is yours. You can sign in with any account: Settlane never holds a key, and reading the chain needs no wallet at all."
            : "No browser wallet was detected. Install an extension wallet such as MetaMask or Rabby to use your own account, or keep exploring read-only."}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {connector && (
            <Button onClick={() => connect.mutate({ connector })} disabled={connect.isPending}>
              {connect.isPending ? "Waiting for your wallet…" : "Connect wallet"}
            </Button>
          )}
          <Link href="/explorer" className="inline-flex h-12 items-center gap-2 rounded-full border border-line px-6 text-[0.9375rem] font-medium hover:border-line-control hover:bg-surface">
            Browse the public explorer <ArrowRight aria-hidden size={16} />
          </Link>
        </div>
        {connect.isError && <p role="alert" className="mt-3 text-sm text-danger">The wallet did not connect. Approve the request in the wallet, then try again.</p>}
      </div>
    );
  }
  if (needSepolia && wrongNetwork) {
    return (
      <div role="alert" className="card border-danger p-7">
        <p className="text-title">Your wallet is on another network</p>
        <p className="mt-2 max-w-xl text-ink-2">Settlane runs on the Sepolia testnet. Transactions are blocked until the wallet is switched, so nothing can be sent to another network by mistake.</p>
        <div className="mt-5">
          <Button onClick={() => switchChain.mutate({ chainId: sepolia.id })} disabled={switchChain.isPending}>
            {switchChain.isPending ? "Switching…" : "Switch to Sepolia"}
          </Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------------------

const ROLE_DOT: Record<Role, string> = { client: "bg-funded", provider: "bg-paid", verifier: "bg-approved" };

export function RoleChip({ role }: { role: Role }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-transparent px-3 py-0.5 text-micro text-ink-2">
      <span aria-hidden className={`size-2 rounded-full ${ROLE_DOT[role]}`} />
      You are the {ROLE_LABEL[role].toLowerCase()}
    </span>
  );
}

export function StatTile({ label, value, note, tone }: { label: string; value: ReactNode; note?: string; tone?: "paid" | "refunded" | "funded" }) {
  const dot = tone === "paid" ? "bg-paid" : tone === "refunded" ? "bg-refunded" : tone === "funded" ? "border border-funded bg-funded-tint" : "bg-ink";
  return (
    <div className="card card-hover p-5">
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <span aria-hidden className={`size-2 rounded-full ${dot}`} />
        {label}
      </p>
      <p className="mt-3">{value}</p>
      {note && <p className="mt-2 text-micro text-ink-3">{note}</p>}
    </div>
  );
}

/** One agreement as a row: number, states, money, what happens next. Links to the workspace. */
export function AgreementRow({ a, who, now }: { a: Agreement; who: Address | undefined; now: bigint }) {
  const roles = rolesOf(a, who);
  const next = nextLine(a, who, now);
  const open = isOpen(a, now);
  return (
    <li>
      <Link
        href={`/app/agreements/${a.id}`}
        className="card card-hover group grid gap-x-6 gap-y-3 p-5 sm:grid-cols-[5.5rem_1fr_auto] sm:items-center"
      >
        <div>
          <p className="text-heading">#{a.id.toString()}</p>
          <p className="text-micro text-ink-3">{open ? "Open" : "Closed"}</p>
        </div>
        <div className="min-w-0 space-y-2">
          <MilestoneChips milestones={a.milestones} now={now} />
          <p className={`text-sm ${next.urgent ? "font-semibold text-ink" : "text-ink-2"}`}>{next.text}</p>
          {roles.length > 0 && <div><RoleChip role={roles[0]!} /></div>}
        </div>
        <div className="flex items-center gap-4 sm:justify-end">
          <div className="sm:text-right">
            <Amount wei={a.deposited} className="text-[0.9375rem]" />
            <p className="text-micro text-ink-3">{a.outstanding > 0n ? `${formatEth(a.outstanding)} ETH held` : "nothing held"}</p>
          </div>
          <ArrowRight aria-hidden size={18} className="text-ink-3 transition-transform duration-[var(--dur-hover)] group-hover:translate-x-0.5 group-hover:text-ink" />
        </div>
      </Link>
    </li>
  );
}

/** One thing waiting on the connected wallet. */
export function AttentionRow({ item, now }: { item: AttentionItem; now: bigint }) {
  return (
    <li>
      <Link
        href={`/app/agreements/${item.agreementId}#milestone-${item.m + 1}`}
        className="card card-hover group flex flex-wrap items-center justify-between gap-x-6 gap-y-2 p-4 sm:px-5"
      >
        <div className="min-w-0">
          <p className="text-heading">{ACTION_LABEL[item.action]}</p>
          <p className="text-sm text-ink-2">
            Agreement #{item.agreementId.toString()} · milestone {item.m + 1} · <Amount wei={item.amount} className="text-[0.875rem]" />
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {item.by !== null ? (
            <span className="text-ink-2">due {formatRelative(item.by, now)}</span>
          ) : (
            <span className="text-ink-2">{item.action === "claim" ? "no deadline" : "open now"}</span>
          )}
          <ArrowRight aria-hidden size={18} className="text-ink-3 transition-transform duration-[var(--dur-hover)] group-hover:translate-x-0.5 group-hover:text-ink" />
        </div>
      </Link>
    </li>
  );
}

"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { useOverview } from "@/chain/queries";
import { useWallet } from "@/chain/use-wallet";
import { useWalletActions } from "@/chain/wallet-actions";
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
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-page">{title}</h1>
        {lead && <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-ink-2">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="mt-9">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={id} className="text-heading">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Says whose data a block shows. Example content is never presented as anyone's real data. */
export function ScopeTag({ kind }: { kind: "public" | "yours" | "example" }) {
  const copy = {
    public: { label: "Public · every agreement on Sepolia", dot: "bg-line-control", box: "border-line" },
    yours: { label: "Your account", dot: "bg-cobalt", box: "border-line" },
    example: { label: "Example · not real data", dot: "border border-line-control", box: "border-dashed border-line-control" },
  }[kind];
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-micro text-ink-2 ${copy.box}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${copy.dot}`} />
      {copy.label}
    </span>
  );
}

/**
 * A one-line, page-specific wallet prompt. Renders nothing once a Sepolia wallet is connected; on another
 * network it offers the switch instead. Reading never needs a wallet, so this never hides the page.
 */
export function ConnectPrompt({ children }: { children: ReactNode }) {
  const { ready, address, wrongNetwork } = useWallet();
  const wallet = useWalletActions();
  if (!ready) return <Skeleton className="h-[3.25rem]" />;
  if (address && !wrongNetwork) return null;
  const waitingLabel = "Waiting for MetaMask…";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-2xl border border-line bg-surface py-2.5 pl-4 pr-2.5">
      <p className="flex min-w-0 items-start gap-2.5 text-sm text-ink-2">
        <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${wrongNetwork ? "bg-danger" : "border border-line-control"}`} />
        <span>
          {wrongNetwork ? (
            <>Your wallet is on another network. Switch to Sepolia to sign; nothing can be sent elsewhere.</>
          ) : wallet.hasConnector ? (
            children
          ) : (
            <>{children} No browser wallet was found: install an extension wallet to use your own account.</>
          )}
        </span>
      </p>
      {wrongNetwork ? (
        <Button size="sm" variant="danger" onClick={() => void wallet.switchToSepolia()} disabled={wallet.waiting !== null}>
          {wallet.waiting?.kind === "switch" ? waitingLabel : "Switch to Sepolia"}
        </Button>
      ) : wallet.hasConnector ? (
        <Button size="sm" onClick={() => void wallet.connect()} disabled={wallet.waiting !== null}>
          {wallet.waiting?.kind === "connect" ? waitingLabel : "Connect wallet"}
        </Button>
      ) : null}
    </div>
  );
}

const EXAMPLES: Record<"provider" | "verifier", { title: string; steps: [string, string][] }> = {
  provider: {
    title: "What a provider does here",
    steps: [
      ["Submit evidence", "A link, note or file hash, before the delivery deadline. Resubmit as often as needed until then."],
      ["Wait for the verifier", "The verifier approves the exact revision, or asks for another one."],
      ["Claim the payout", "Approved work is yours to claim at any time, to any address you choose."],
    ],
  },
  verifier: {
    title: "What a verifier does here",
    steps: [
      ["Read the submission", "Each submission shows its evidence hash and revision number."],
      ["Decide before the review deadline", "Approve that exact revision, or request a revision. A decision on an older revision is refused."],
      ["Never touch the money", "A verifier cannot move funds or change the parties; the provider claims, the client refunds."],
    ],
  },
};

/** A static, labelled illustration of a role's workflow, for visitors without a wallet. */
export function RoleExample({ role }: { role: "provider" | "verifier" }) {
  const ex = EXAMPLES[role];
  return (
    <div className="rounded-2xl border border-dashed border-line-control/60 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-heading">{ex.title}</p>
        <ScopeTag kind="example" />
      </div>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {ex.steps.map(([title, text], i) => (
          <li key={title} className="flex gap-3">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-micro font-semibold text-ink-2">{i + 1}</span>
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-0.5 text-sm text-ink-2">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
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

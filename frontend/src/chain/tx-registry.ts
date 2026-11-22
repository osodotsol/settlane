import type { Address, Hex } from "viem";
import type { TxProblem } from "./errors";
import type { ChainCheck, Snapshot, TxAction } from "./tx-effect";

// Every wallet request the application makes is tracked here, by ACTION (one key per milestone, one for
// create), so the same action cannot be requested twice while an earlier request may still be open in the
// wallet. The registry outlives the component that started the request (it is module state), and requests
// that may still be open are also kept in localStorage, so a reload or a navigation does not forget them.
//
// The states, and what the interface may say about each:
//   checking   simulating against the contract; nothing has been asked of the wallet
//   awaiting   handed to the wallet for signature; no answer yet (NOT cancelled by a timeout: the wallet may still ask)
//   pending    the wallet returned a transaction hash: it was broadcast; waiting for a block
//   confirmed  receipt with status success
//   found      the chain shows the action took effect (found by "Check the chain" after the page lost track)
//   rejected   the user declined in the wallet: nothing was sent
//   cancelled  the wallet replaced the transaction with a cancellation: the action did not happen
//   reverted   mined, but the contract reverted it: nothing changed, the fee was paid
//   failed     refused before anything was sent (simulation, network, account, balance)
//   unknown    the page cannot say: it stopped waiting, the wallet returned an ambiguous error, the receipt did
//              not arrive in time, or the page was reloaded while a request was open

export type TxPhase =
  | { phase: "checking" }
  | { phase: "awaiting"; since: number }
  | { phase: "pending"; hash: Hex; since: number }
  | { phase: "confirmed"; hash: Hex; blockNumber: bigint; createdId?: bigint }
  | { phase: "found"; createdId?: bigint }
  | { phase: "rejected" }
  | { phase: "cancelled"; hash: Hex }
  | { phase: "reverted"; hash: Hex }
  | { phase: "failed"; problem: TxProblem }
  | { phase: "unknown"; reason: "stopped" | "wallet-error" | "receipt-timeout" | "reloaded" | "replaced"; problem?: TxProblem; hash?: Hex };

export type TxEntry = {
  key: string;
  label: string;
  action: TxAction;
  account: Address;
  startedAt: number;
  attempt: number;
  state: TxPhase;
  /** A promise for this attempt is still attached in this tab: a late wallet answer will be applied. */
  live: boolean;
  /** The account's confirmed nonce and the contract state just before the wallet was asked. */
  nonceBefore?: number;
  before?: Snapshot;
  /** Last "Check the chain" result. */
  check?: ChainCheck & { at: number };
  /** After a check found nothing sent and nothing pending, a new request may be started. */
  cleared?: boolean;
  /** Hashes returned late by an earlier attempt that the page had already given up on. */
  lateHashes: Hex[];
};

export const TERMINAL: TxPhase["phase"][] = ["confirmed", "found", "rejected", "cancelled", "reverted", "failed"];
export const isTerminal = (s: TxPhase) => TERMINAL.includes(s.phase);

/** May a new request for this action be started now? */
export function canStart(entry: TxEntry | undefined): boolean {
  if (!entry) return true;
  if (isTerminal(entry.state)) return true;
  return entry.state.phase === "unknown" && entry.cleared === true;
}

/** Why not, in plain words (undefined when a request may be started). */
export function blockReason(entry: TxEntry | undefined): string | undefined {
  if (canStart(entry)) return undefined;
  switch (entry!.state.phase) {
    case "checking":
      return "Checking with the contract.";
    case "awaiting":
      return "A request for this action is waiting in your wallet. Approve or reject it there.";
    case "pending":
      return "The transaction for this action was sent and is waiting for a block.";
    default:
      return "An earlier request for this action may still be open in your wallet. Check the chain before sending another.";
  }
}

export const actionKey = (action: TxAction) => (action.fn === "create" ? "create" : `milestone:${action.id}:${action.m}`);

// ---------------------------------------------------------------------------------------------------------
// Persistence: only requests that may still be open are stored. Bigints are stored as strings.
// ---------------------------------------------------------------------------------------------------------

export const STORAGE_KEY = "settlane:tx-requests:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? { $big: x.toString() } : x));
const fromJson = (s: string) => JSON.parse(s, (_k, x) => (x && typeof x === "object" && typeof x.$big === "string" ? BigInt(x.$big) : x));

/** Entries worth keeping across a reload, as stored. */
export function serialize(entries: TxEntry[]): string {
  return toJson(entries.filter((e) => !isTerminal(e.state) && !(e.state.phase === "unknown" && e.cleared)).map((e) => ({ ...e, live: false })));
}

/**
 * What a reload means for each stored entry: nothing in this tab is waiting for the wallet any more, so an
 * open request becomes "unknown (reloaded)"; a known hash is kept so the receipt can still be looked up.
 */
export function deserialize(raw: string | null, now: number): TxEntry[] {
  if (!raw) return [];
  let list: TxEntry[];
  try {
    list = fromJson(raw);
    if (!Array.isArray(list)) return [];
  } catch {
    return [];
  }
  return list
    .filter((e) => e && typeof e.key === "string" && now - e.startedAt < MAX_AGE_MS)
    .map((e) => {
      const hash = e.state.phase === "pending" ? e.state.hash : e.state.phase === "unknown" ? e.state.hash : undefined;
      const state: TxPhase = e.state.phase === "unknown" ? { ...e.state, reason: e.state.reason === "stopped" || e.state.reason === "wallet-error" ? e.state.reason : "reloaded" } : { phase: "unknown", reason: "reloaded", hash };
      return { ...e, live: false, state, lateHashes: e.lateHashes ?? [] };
    });
}

type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function createRegistry(storage: () => Storage | undefined, now: () => number = Date.now) {
  let entries = new Map<string, TxEntry>();
  let loaded = false;
  const listeners = new Set<() => void>();
  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      for (const e of deserialize(storage()?.getItem(STORAGE_KEY) ?? null, now())) entries.set(e.key, e);
    } catch {
      /* storage unavailable: the registry still works in memory */
    }
  };
  const save = () => {
    try {
      storage()?.setItem(STORAGE_KEY, serialize([...entries.values()]));
    } catch {
      /* ignore */
    }
  };
  const emit = () => {
    save();
    listeners.forEach((l) => l());
  };
  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get(key: string): TxEntry | undefined {
      load();
      return entries.get(key);
    },
    all(): TxEntry[] {
      load();
      return [...entries.values()];
    },
    set(entry: TxEntry) {
      load();
      entries = new Map(entries).set(entry.key, entry);
      emit();
    },
    /** Applies `patch` only while `attempt` is still the current attempt for `key`. Returns whether it applied. */
    update(key: string, attempt: number, patch: (e: TxEntry) => TxEntry): boolean {
      load();
      const e = entries.get(key);
      if (!e || e.attempt !== attempt) return false;
      entries = new Map(entries).set(key, patch(e));
      emit();
      return true;
    },
    remove(key: string) {
      load();
      entries = new Map(entries);
      entries.delete(key);
      emit();
    },
  };
}

export type Registry = ReturnType<typeof createRegistry>;

const browserStorage = () => (typeof window === "undefined" ? undefined : window.localStorage);
export const registry: Registry = createRegistry(browserStorage);

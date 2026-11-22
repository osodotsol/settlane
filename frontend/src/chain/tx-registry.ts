import type { Address, Hex } from "viem";
import { CHAIN, SETTLANE_ADDRESS } from "@/config/chain";
import type { TxProblem } from "./errors";
import type { Snapshot, TxAction } from "./tx-effect";
import type { Verdict } from "./tx-recovery";

// Every wallet request the application makes is tracked here, by ACTION (one key per milestone, one for
// create) WITHIN ONE SCOPE: chain id, contract address and wallet account (R2-B). The same action cannot be requested
// twice by the same account while an earlier request may still be open in the wallet; another account's records never
// block or unlock it, and records made for another chain or contract are kept aside and never consulted. The registry outlives the component that started the request (it is module state), and requests
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
  /** The original transaction's nonce, once the node has shown the transaction. */
  txNonce?: number;
  /** The last recovery verdict ("Check the chain"), tx-recovery.ts. */
  recovery?: { verdict: Verdict; at: number };
  /** The user confirmed the request is no longer open in their wallet (only accepted when the chain shows nothing). */
  attested?: boolean;
  /** Set only by a "released" recovery verdict: a new request may be started. */
  cleared?: boolean;
  /** The tab that holds the live wallet request, and when it last said so (cross-tab safety). */
  ownerTab?: string;
  heartbeatAt?: number;
  /** Hashes returned late by an earlier attempt that the page had already given up on. */
  lateHashes: Hex[];
  /** Scope (R2-B): the chain and contract this request was made for. The key also encodes them and the account. */
  chainId?: number;
  contract?: Address;
  /** The earlier attempt this one replaced while its outcome was still unproven (it is never forgotten silently). */
  previous?: { startedAt: number; reason: string };
};

export const TERMINAL: TxPhase["phase"][] = ["confirmed", "found", "rejected", "cancelled", "reverted", "failed"];
export const isTerminal = (s: TxPhase) => TERMINAL.includes(s.phase);

/** May a new request for this action be started now? */
export function canStart(entry: TxEntry | undefined, now: number = Date.now()): boolean {
  if (!entry) return true;
  if (isTerminal(entry.state)) return true;
  if (entry.state.phase !== "unknown") return false;
  // the stated policy bound (not a proof): an unresolved record expires MAX_AGE_MS after its request started, exactly as
  // a stored one is dropped on load; before that only a release or an override lets a new request start
  return entry.cleared === true || now - entry.startedAt >= MAX_AGE_MS;
}

/** Why not, in plain words (undefined when a request may be started). */
export function blockReason(entry: TxEntry | undefined, now: number = Date.now()): string | undefined {
  if (canStart(entry, now)) return undefined;
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

/** The scope every record belongs to: this chain, this contract, one account (lower-cased). */
export const scopeOf = (account: Address, chainId: number = CHAIN.id, contract: Address = SETTLANE_ADDRESS) => `${chainId}:${contract.toLowerCase()}:${account.toLowerCase()}`;
/** The registry key of one action for one account on this deployment. */
export const requestKey = (account: Address, base: string) => `${scopeOf(account)}|${base}`;
/** The action part of a registry key (`create`, `milestone:<id>:<m>`). */
export const baseOf = (key: string) => key.slice(key.indexOf("|") + 1);
/** Does this record belong to this deployment and the account its key names? */
export const inScope = (e: Pick<TxEntry, "key" | "account">) => typeof e.account === "string" && e.key.startsWith(`${scopeOf(e.account)}|`);

// ---------------------------------------------------------------------------------------------------------
// Persistence: only requests that may still be open are stored. Bigints are stored as strings.
// ---------------------------------------------------------------------------------------------------------

export const STORAGE_KEY = "settlane:tx-requests:v2";
/** Before R2-B records were keyed by action only. They were made for this deployment (the only one this site has served). */
export const LEGACY_STORAGE_KEY = "settlane:tx-requests:v1";
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? { $big: x.toString() } : x));
const fromJson = (s: string) => JSON.parse(s, (_k, x) => (x && typeof x === "object" && typeof x.$big === "string" ? BigInt(x.$big) : x));

/** Entries worth keeping across a reload, as stored. */
export function serialize(entries: TxEntry[]): string {
  // `live` is per tab; other tabs learn that a request is open from ownerTab + a fresh heartbeatAt
  return toJson(entries.filter((e) => !isTerminal(e.state) && !(e.state.phase === "unknown" && e.cleared)).map((e) => ({ ...e, live: false, ownerTab: e.live ? e.ownerTab : undefined })));
}

/** How recent a heartbeat must be for another tab to count a request as still open there. */
export const HEARTBEAT_FRESH_MS = 15_000;
export const openInAnotherTab = (e: TxEntry, tabId: string, now: number) => !e.live && e.ownerTab !== undefined && e.ownerTab !== tabId && e.heartbeatAt !== undefined && now - e.heartbeatAt < HEARTBEAT_FRESH_MS;

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
    .filter((e) => e && typeof e.key === "string" && inScope(e) && now - e.startedAt < MAX_AGE_MS)
    .map((e) => {
      const hash = e.state.phase === "pending" ? e.state.hash : e.state.phase === "unknown" ? e.state.hash : undefined;
      const state: TxPhase = e.state.phase === "unknown" ? { ...e.state, reason: e.state.reason === "stopped" || e.state.reason === "wallet-error" ? e.state.reason : "reloaded" } : { phase: "unknown", reason: "reloaded", hash };
      return { ...e, live: false, state, lateHashes: e.lateHashes ?? [] };
    });
}

/** Stored records that belong to another chain or contract: never consulted here, but written back untouched. */
export function foreignEntries(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const list = fromJson(raw);
    return Array.isArray(list) ? list.filter((e) => e && typeof e.key === "string" && !inScope(e)) : [];
  } catch {
    return [];
  }
}

/** Converts pre-R2-B records (keyed by action only) to scoped records of this deployment. */
export function migrateLegacy(raw: string | null): TxEntry[] {
  if (!raw) return [];
  try {
    const list = fromJson(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((e) => e && typeof e.key === "string" && typeof e.account === "string" && !e.key.includes("|"))
      .map((e) => ({ ...e, key: requestKey(e.account, e.key), chainId: CHAIN.id, contract: SETTLANE_ADDRESS }));
  } catch {
    return [];
  }
}

type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void };

export function createRegistry(storage: () => Storage | undefined, now: () => number = Date.now, tabId: string = Math.random().toString(36).slice(2)) {
  let entries = new Map<string, TxEntry>();
  let loaded = false;
  const listeners = new Set<() => void>();
  /** Entries this tab holds a live wallet request for: they are never replaced by another tab's copy. */
  const liveHere = () => [...entries.values()].filter((e) => e.live);
  let foreign: unknown[] = [];
  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const s = storage();
      let raw = s?.getItem(STORAGE_KEY) ?? null;
      const legacy = s?.getItem(LEGACY_STORAGE_KEY) ?? null;
      if (legacy) {
        // one-time migration: legacy records keep blocking exactly what they blocked, now under their account's scope
        const merged = [...(raw ? (fromJson(raw) as TxEntry[]) : []), ...migrateLegacy(legacy)];
        raw = toJson(merged);
        s?.setItem(STORAGE_KEY, raw);
        s?.removeItem?.(LEGACY_STORAGE_KEY);
      }
      foreign = foreignEntries(raw);
      for (const e of deserialize(raw, now())) entries.set(e.key, e);
    } catch {
      /* storage unavailable: the registry still works in memory */
    }
  };
  const save = () => {
    try {
      const mine = fromJson(serialize([...entries.values()])) as unknown[];
      storage()?.setItem(STORAGE_KEY, toJson([...foreign, ...mine]));
    } catch {
      /* ignore */
    }
  };
  const emit = () => {
    save();
    listeners.forEach((l) => l());
  };
  /** Another tab changed the stored requests: adopt its view, keeping what is live in this tab. */
  const syncFromStorage = () => {
    try {
      const raw = storage()?.getItem(STORAGE_KEY) ?? null;
      foreign = foreignEntries(raw);
      const stored = deserialize(raw, now());
      const next = new Map<string, TxEntry>();
      for (const e of stored) next.set(e.key, e);
      for (const e of liveHere()) next.set(e.key, e);
      // a finished request shown in this tab (not stored, by design) stays until it is dismissed here
      for (const e of entries.values()) if (isTerminal(e.state) && !next.has(e.key)) next.set(e.key, e);
      entries = next;
      listeners.forEach((l) => l());
    } catch {
      /* ignore */
    }
  };
  /** Keeps other tabs informed that this tab still holds its live requests. */
  const heartbeat = () => {
    const mine = liveHere();
    if (mine.length === 0) return;
    entries = new Map(entries);
    for (const e of mine) entries.set(e.key, { ...e, ownerTab: tabId, heartbeatAt: now() });
    save();
  };

  return {
    tabId,
    syncFromStorage,
    heartbeat,
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
    /** The current map; replaced (never mutated) on every change, so it is a stable snapshot for React. */
    snapshot(): ReadonlyMap<string, TxEntry> {
      load();
      return entries;
    },
    set(entry: TxEntry) {
      load();
      entries = new Map(entries).set(entry.key, entry.live ? { ...entry, ownerTab: tabId, heartbeatAt: now() } : entry);
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

/**
 * This tab's identity. Kept in sessionStorage so it SURVIVES a reload of the same tab (a reloaded page must not see its
 * own earlier request as "open in another tab") while other tabs get their own. Falls back to a fresh id.
 */
export function tabIdentity(session: { getItem(k: string): string | null; setItem(k: string, v: string): void } | undefined): string {
  try {
    const existing = session?.getItem("settlane:tab-id");
    if (existing) return existing;
    const id = Math.random().toString(36).slice(2);
    session?.setItem("settlane:tab-id", id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export const registry: Registry = createRegistry(browserStorage, Date.now, tabIdentity(typeof window === "undefined" ? undefined : window.sessionStorage));

// Cross-tab: adopt other tabs' changes as they happen, and keep announcing this tab's live requests.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (ev.key === STORAGE_KEY) registry.syncFromStorage();
  });
  setInterval(registry.heartbeat, 5_000);
}

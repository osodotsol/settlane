import type { Page } from "@playwright/test";

// A stand-in for a browser wallet extension (EIP-1193 + EIP-6963), for the local-chain end-to-end tests ONLY.
// It holds no key. Every request is forwarded to the local Anvil node, whose unlocked development accounts
// sign `eth_sendTransaction`; that is how the real application code (wagmi, viem, simulation, receipts) runs
// unchanged against a real EVM executing the production bytecode. It records every RPC method the page
// called (`window.__calls`) so tests can prove what was, and was not, sent.

export type WalletOptions = { rpc: string; account: string; chainId?: number; authorized?: boolean };

export async function installWallet(page: Page, opts: WalletOptions) {
  await page.addInitScript(
    ({ rpc, account, chainId, authorized }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__account = account;
      w.__chainId = chainId;
      w.__calls = [] as string[];
      w.__reject = false;
      w.__authorized = authorized; // false: like a wallet that has not yet approved this site (no account until requested)
      // Held requests reproduce a wallet that does not answer (as MetaMask did in the real-wallet run): the request is
      // recorded when the page makes it and answered only when the test calls release.
      w.__holdSign = false;
      w.__held = [] as { tx: unknown; res: (v: unknown) => void; rej: (e: unknown) => void }[];
      w.__sent = [] as unknown[];
      w.__holdConnect = false;
      w.__heldConnect = null as null | (() => void);
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const hex = (n: number) => `0x${n.toString(16)}`;
      const forward = async (method: string, params: unknown[]) => {
        const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
        return j.result;
      };
      const provider = {
        isMetaMask: true,
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          (w.__calls as string[]).push(method);
          switch (method) {
            case "eth_requestAccounts":
              if (w.__holdConnect) {
                if (w.__heldConnect) throw Object.assign(new Error("Request of type 'wallet_requestPermissions' already pending"), { code: -32002 });
                return new Promise((res) => {
                  w.__heldConnect = () => {
                    w.__authorized = true;
                    w.__heldConnect = null;
                    res([w.__account]);
                  };
                });
              }
              w.__authorized = true;
              return [w.__account];
            case "eth_accounts":
              return w.__authorized ? [w.__account] : [];
            case "eth_chainId":
              return hex(w.__chainId as number);
            case "net_version":
              return String(w.__chainId);
            case "wallet_switchEthereumChain": {
              w.__chainId = parseInt((params[0] as { chainId: string }).chainId, 16);
              (listeners.chainChanged ?? []).forEach((l) => l(hex(w.__chainId as number)));
              return null;
            }
            case "eth_sendTransaction": {
              if (w.__reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
              // signed by the account the request was made for, even if the user switches account before answering
              const tx = { ...(params[0] as Record<string, unknown>), from: w.__account };
              (w.__sent as unknown[]).push(tx);
              if (w.__holdSign) return new Promise((res, rej) => (w.__held as { tx: unknown; res: (v: unknown) => void; rej: (e: unknown) => void }[]).push({ tx, res, rej }));
              return forward(method, [tx]);
            }
            default:
              return forward(method, params);
          }
        },
        on: (e: string, l: (...a: unknown[]) => void) => void (listeners[e] = [...(listeners[e] ?? []), l]),
        removeListener: (e: string, l: (...a: unknown[]) => void) => void (listeners[e] = (listeners[e] ?? []).filter((x) => x !== l)),
        emit: (e: string, ...a: unknown[]) => (listeners[e] ?? []).forEach((l) => l(...a)),
      };
      w.__release = async () => {
        const h = (w.__held as { tx: unknown; res: (v: unknown) => void; rej: (e: unknown) => void }[]).shift();
        if (!h) return null;
        try {
          const r = await forward("eth_sendTransaction", [h.tx]);
          h.res(r);
          return r;
        } catch (e) {
          h.rej(e);
          return null;
        }
      };
      w.ethereum = provider;
      w.__walletEmit = provider.emit;
      const info = { uuid: "00000000-0000-4000-8000-000000000001", name: "Test wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=", rdns: "test.wallet" };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { rpc: opts.rpc, account: opts.account, chainId: opts.chainId ?? 11155111, authorized: opts.authorized ?? true },
  );
}

/** Switches the page's wallet to another account, as a user would in the extension. */
export async function switchAccount(page: Page, account: string) {
  await page.evaluate((a) => {
    const w = window as unknown as Record<string, unknown> & { __walletEmit: (e: string, ...a: unknown[]) => void };
    w.__account = a;
    w.__walletEmit("accountsChanged", [a]);
  }, account);
}

export const walletCalls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
export const setWalletChain = (page: Page, chainId: number) =>
  page.evaluate((c) => {
    const w = window as unknown as Record<string, unknown> & { __walletEmit: (e: string, ...a: unknown[]) => void };
    w.__chainId = c;
    w.__walletEmit("chainChanged", `0x${c.toString(16)}`);
  }, chainId);
export const rejectNextSignature = (page: Page, on = true) => page.evaluate((v) => void ((window as unknown as { __reject: boolean }).__reject = v), on);

/** From now on, signature requests are held unanswered until `releaseSignature`. */
export const holdSignatures = (page: Page, on = true) => page.evaluate((v) => void ((window as unknown as { __holdSign: boolean }).__holdSign = v), on);
/** Answers the oldest held signature request: the transaction is sent to the node and its hash returned to the page. */
export const releaseSignature = (page: Page) => page.evaluate(() => (window as unknown as { __release: () => Promise<string | null> }).__release());
/** Every transaction the page asked the wallet to send, as the wallet received it. */
export const sentTransactions = (page: Page) => page.evaluate(() => (window as unknown as { __sent: Record<string, string>[] }).__sent);
/** From now on, a connection request is held unanswered (a second one gets -32002, as MetaMask does). */
export const holdConnection = (page: Page, on = true) => page.evaluate((v) => void ((window as unknown as { __holdConnect: boolean }).__holdConnect = v), on);
export const releaseConnection = (page: Page) => page.evaluate(() => (window as unknown as { __heldConnect: null | (() => void) }).__heldConnect?.());

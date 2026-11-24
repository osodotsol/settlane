import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createPublicClient, createWalletClient, getAddress, http, isAddress, keccak256, parseEther, stringToBytes, type Address } from "viem";
import { sepolia } from "viem/chains";
import { settlaneAbi } from "../src/contract/abi";
import { holdConnection, holdSignatures, installWallet, rejectNextSignature, releaseConnection, releaseSignature, sentTransactions as sentParams, setWalletChain, switchAccount, walletCalls } from "./wallet";

// The application, end to end, with a stand-in wallet (e2e/wallet.ts) against a throw-away local Anvil that runs
// the PRODUCTION bytecode (chain id 11155111, simulated ETH). The wallet holds no key: Anvil's unlocked accounts
// sign. Everything else is the real application: wagmi, viem, simulation, receipts, the contract's own reverts.
// Agreements 1 (paid) and 2 (funded) exist at the start; the tests run in order and build on each other.
const ANVIL = process.env.ANVIL_URL!;
const SETTLANE = process.env.SETTLANE as Address;
const ACCOUNTS = JSON.parse(process.env.ANVIL_ACCOUNTS ?? "[]") as Address[];
if (ACCOUNTS.length < 6) throw new Error("e2e/run.mjs must pass six Anvil accounts in ANVIL_ACCOUNTS");
const [CLIENT, PROVIDER, VERIFIER, PAYEE, STRANGER] = ACCOUNTS as [Address, Address, Address, Address, Address];
const chain = { ...sepolia, rpcUrls: { default: { http: [ANVIL] } } };
const pub = createPublicClient({ chain, transport: http(ANVIL) });
const wallet = (account: Address) => createWalletClient({ account, chain, transport: http(ANVIL) });
const rpc = (method: string, params: unknown[] = []) =>
  fetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());

async function chainSend(account: Address, functionName: string, args: unknown[], value = 0n) {
  const hash = await wallet(account).writeContract({ address: SETTLANE, abi: settlaneAbi, functionName, args, value } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  expect(r.status).toBe("success");
}
const milestone = (id: bigint, m = 0) => pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "getMilestone", args: [id, m] });
const now = async () => (await pub.getBlock()).timestamp;
const sentTransactions = async (page: Page) => (await walletCalls(page)).filter((c) => c === "eth_sendTransaction").length;

/** Opens `path` with the stand-in wallet installed as `account`, connected through the real Connect button. */
async function openAs(page: Page, account: Address, path: string, chainId = 11155111) {
  await installWallet(page, { rpc: ANVIL, account, chainId });
  await page.goto(path);
  // A wallet that already exposes an account is restored by wagmi on load; otherwise press the real Connect button.
  const connected = page.getByRole("button", { name: /^Connected as/ });
  const connect = page.getByRole("button", { name: "Connect wallet", exact: true }).first();
  const wrong = page.getByRole("button", { name: "Switch to Sepolia" }).first();
  // give wagmi's automatic restore a moment first, so the click never races it
  await expect(connected.or(wrong)).toBeVisible({ timeout: 8_000 }).catch(() => {});
  if (chainId !== 11155111) return expect(wrong).toBeVisible(); // a mainnet wallet shows the switch button instead of the account
  if (!(await connected.isVisible())) await connect.click();
  await expect(connected).toBeVisible();
}
const loaded = (page: Page) => expect(page.locator('[role="status"][aria-label="Loading from Sepolia"]')).toHaveCount(0, { timeout: 30_000 });
const panel = (page: Page, n = 1) => page.getByRole("group", { name: `Actions for milestone ${n}` });
const confirmed = (page: Page) => expect(page.getByText(/Confirmed in block \d+/)).toBeVisible({ timeout: 45_000 });

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

// Isolation between repetitions (E2E_REPEAT): the tests are a serial story on one chain (agreement #3 is created by the
// first test, later tests advance the clock). Each repetition after the first reverts the node to the baseline e2e/run.mjs
// snapshotted after seeding, and snapshots it again (a snapshot is consumed by its revert), so every full run starts from
// the same chain. A test never depends on what an earlier repetition left behind.
// The current snapshot id lives in a file, not in this module: Playwright restarts the worker after a failure, and a
// restarted worker must revert to the live snapshot, not to the one already consumed.
const BASELINE_FILE = process.env.ANVIL_BASELINE_FILE;
let repetition = 0;
test.beforeEach(async ({}, info) => {
  if (info.repeatEachIndex === repetition) return;
  repetition = info.repeatEachIndex;
  if (!BASELINE_FILE) throw new Error("e2e/run.mjs must pass ANVIL_BASELINE_FILE (the seeded chain's snapshot) to repeat this suite");
  expect((await rpc("evm_revert", [readFileSync(BASELINE_FILE, "utf8").trim()])).result, "revert to the seeded baseline").toBe(true);
  writeFileSync(BASELINE_FILE, (await rpc("evm_snapshot")).result as string);
  await expect.poll(async () => {
    try {
      await pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "getAgreement", args: [3n] });
      return "agreement 3 exists";
    } catch {
      return "clean";
    }
  }, { message: "agreement 3 (created by the first test) is gone after the revert" }).toBe("clean");
});

test("create: the form enforces the contract's rules, then creates and funds an agreement through the wallet", async ({ page }) => {
  await openAs(page, CLIENT, "/app/create");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create Agreement");
  await page.getByLabel("Provider", { exact: true }).fill(CLIENT); // the client cannot be the provider
  await page.getByLabel("Verifier", { exact: true }).fill(VERIFIER);
  await page.getByLabel("Amount (ETH)").fill("0.01");
  await page.getByLabel("Deliver within").fill("10");
  await page.getByLabel("Milestone 1 deadline unit").selectOption("minutes");
  await page.getByLabel("Specification").fill("Three logo concepts as a Figma link");
  await page.getByRole("button", { name: "Review and create" }).click();
  // the field's own error, and the summary that links to it
  await expect(page.getByText("The provider must be a different account from you, the client.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Fix 1 field before signing" })).toBeFocused();
  expect(await sentTransactions(page)).toBe(0);

  await page.getByLabel("Provider", { exact: true }).fill(PROVIDER);
  await expect(page.getByText("The provider must be a different account")).toHaveCount(0);
  await page.getByRole("button", { name: "Review and create" }).click();
  await expect(page.getByText("You are about to lock")).toContainText("0.01 ETH");
  const t0 = await now();
  await page.getByRole("button", { name: "Create and sign" }).click();
  await confirmed(page);
  await expect(page.getByRole("link", { name: "Open agreement #3" })).toBeVisible();
  expect(await sentTransactions(page)).toBe(1);
  // only now, with the agreement confirmed, is the draft cleared (archived), so it cannot be created twice by accident (R2-B)
  await expect(page.getByText("Agreement #3 was created. The draft was cleared so it cannot be created twice by accident.")).toBeVisible();
  await expect(page.getByLabel("Specification")).toHaveValue("");

  // what the chain actually holds equals what the form said
  const head = await pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "getAgreement", args: [3n] });
  expect(head.slice(0, 3)).toEqual([CLIENT, PROVIDER, VERIFIER].map((a) => expect.stringMatching(new RegExp(`^${a}$`, "i"))));
  expect(head[3]).toBe(86_400n); // review period default: 1 day
  const m = await milestone(3n);
  expect(m[0]).toBe(1); // Funded
  expect(m[1]).toBe(parseEther("0.01"));
  expect(m[2]).toBeGreaterThanOrEqual(t0 + 595n);
  expect(m[2]).toBeLessThanOrEqual(t0 + 660n);
  expect(m[4]).toBe(BigInt(keccak256(stringToBytes("Three logo concepts as a Figma link"))));
  expect(await pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "getAccounting", args: [3n] })).toEqual([parseEther("0.01"), 0n, 0n, parseEther("0.01")]);

  // the new agreement is in the application straight away
  await page.getByRole("link", { name: "Open agreement #3" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agreement #3");
  await expect(page.getByText("You are the client")).toBeVisible();
  await expect(page.locator("#milestone-1").getByText("Funded", { exact: true }).first()).toBeVisible();
  // the agreement just created on the local chain (no snapshot there) has a complete, state-verified history
  await expect(page.getByText("History complete", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
});

test("roles: only the party that may act is offered an action", async ({ page }) => {
  // the client cannot submit evidence on their own agreement, and a stranger is offered nothing
  await openAs(page, CLIENT, "/app/agreements/3");
  await loaded(page);
  await expect(page.getByText("You are the client")).toBeVisible();
  await expect(panel(page)).toHaveCount(0); // funded and not expired: nothing for the client to do
  await switchAccount(page, STRANGER);
  await expect(page.getByText("You are the client")).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  // client-side navigation keeps the switched account (a full reload would restore the wallet's initial one)
  await page.getByRole("navigation", { name: "Application", exact: true }).getByRole("link", { name: "My Agreements" }).click();
  await expect(page.getByText("This account has no agreements yet")).toBeVisible();
});

test("provider submits evidence; the hash on-chain is the keccak256 of what was typed", async ({ page }) => {
  await openAs(page, PROVIDER, "/app/agreements/3");
  await loaded(page);
  await expect(page.getByText("You are the provider")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Submit evidence" })).toBeDisabled(); // empty evidence is refused
  await panel(page).getByLabel("Evidence").fill("https://example.com/logos-v1");
  await expect(panel(page).getByText("This becomes revision 1.")).toBeVisible();
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await confirmed(page);
  const m = await milestone(3n);
  expect(m[0]).toBe(2); // Submitted
  expect(m[5]).toBe(BigInt(keccak256(stringToBytes("https://example.com/logos-v1"))));
  expect(m[7]).toBe(1n); // revision
  await expect(page.locator("#milestone-1").getByText("In review", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  // the provider can replace the submission until the deadline; the offer says so
  await expect(panel(page).getByText("Replace your submission")).toBeVisible();
});

test("verifier requests a revision; the provider resubmits as revision 2", async ({ page }) => {
  await openAs(page, VERIFIER, "/app/agreements/3");
  await loaded(page);
  await expect(page.getByText("You are the verifier")).toBeVisible();
  await expect(panel(page).getByText("Decide on this submission")).toBeVisible();
  await expect(panel(page).getByText("Submission revision")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Approve revision 1" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Request a revision" }).click();
  await expect(panel(page).getByText("The milestone returns to Funded")).toBeVisible();
  await panel(page).getByRole("button", { name: "Request revision and sign" }).click();
  await confirmed(page);
  let m = await milestone(3n);
  expect(m[0]).toBe(1); // back to Funded
  expect(m[6]).toBe(1n); // one revision request
  expect(m[5]).toBe(0n); // evidence cleared

  await switchAccount(page, PROVIDER);
  await expect(page.getByText("You are the provider")).toBeVisible();
  await panel(page).getByLabel("Evidence").fill("https://example.com/logos-v2");
  await expect(panel(page).getByText("This becomes revision 2.")).toBeVisible();
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await confirmed(page);
  m = await milestone(3n);
  expect([m[0], m[7]]).toEqual([2, 2n]);
});

test("a stale decision is refused by the contract before anything is signed; the fresh one is approved", async ({ page }) => {
  await openAs(page, VERIFIER, "/app/agreements/3");
  await loaded(page);
  await expect(panel(page).getByText("Decide on this submission")).toBeVisible(); // the page now shows revision 2
  // while the verifier is reading, the provider resubmits (revision 3) outside this page
  await chainSend(PROVIDER, "submit", [3n, 0, BigInt(keccak256(stringToBytes("https://example.com/logos-v3")))]);
  await panel(page).getByRole("button", { name: /^Approve revision/ }).click();
  await panel(page).getByRole("button", { name: "Approve and sign" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The provider submitted newer evidence." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("evidence does not match the submitted evidence")).toBeVisible();
  expect(await sentTransactions(page)).toBe(0); // the simulation caught it: the wallet was never asked to sign
  expect((await milestone(3n))[0]).toBe(2); // still Submitted, nothing changed

  await page.reload();
  await loaded(page);
  await expect(panel(page).getByText("3", { exact: true }).first()).toBeVisible();
  await panel(page).getByRole("button", { name: "Approve revision 3" }).click();
  await panel(page).getByRole("button", { name: "Approve and sign" }).click();
  await confirmed(page);
  const m = await milestone(3n);
  expect(m[0]).toBe(3); // Approved
  expect(m[5]).toBe(BigInt(keccak256(stringToBytes("https://example.com/logos-v3"))));
  // an approved milestone offers the verifier nothing more
  await expect(panel(page)).toHaveCount(1); // only the confirmation panel remains until dismissed
  await panel(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(panel(page)).toHaveCount(0);
});

test("the provider's dashboard and navigation show the payout waiting, and the claim pays exactly the stored amount to the chosen address", async ({ page }) => {
  await openAs(page, PROVIDER, "/app");
  await loaded(page);
  const queue = page.locator('section[aria-labelledby="actions"]');
  await expect(queue.getByText("Claim payout")).toBeVisible();
  await expect(queue.getByText("Agreement #3 · milestone 1")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Application", exact: true });
  await expect(nav.getByRole("link", { name: "Payments" }).getByLabel("1 waiting for you")).toBeVisible(); // the claim
  await expect(nav.getByRole("link", { name: "My Work" }).getByLabel("1 waiting for you")).toBeVisible(); // agreement 2 still awaits evidence
  await expect(nav.getByRole("link", { name: "Verifications" }).getByLabel(/waiting for you/)).toHaveCount(0);
  await queue.getByRole("link", { name: /Claim payout/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agreement #3");

  const before = await pub.getBalance({ address: PAYEE });
  await panel(page).getByLabel("Send the ETH to").fill(PAYEE);
  await panel(page).getByRole("button", { name: "Claim payout" }).click();
  await expect(panel(page).getByText("0.01 ETH will be sent from the contract to")).toBeVisible();
  await panel(page).getByRole("button", { name: "Claim and sign" }).click();
  await confirmed(page);
  expect((await pub.getBalance({ address: PAYEE })) - before).toBe(parseEther("0.01"));
  expect((await milestone(3n))[0]).toBe(4); // Paid
  expect(await pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "getAccounting", args: [3n] })).toEqual([parseEther("0.01"), parseEther("0.01"), 0n, 0n]);
  await panel(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(panel(page)).toHaveCount(0); // paid: no claim button can be pressed twice
  await expect(page.getByText("Closed: every milestone is settled")).toBeVisible({ timeout: 30_000 });
  // the payment shows in Payments with its transaction
  await page.goto("/app/payments");
  await loaded(page);
  await expect(page.getByText("Claimed · agreement #3, milestone 1")).toBeVisible({ timeout: 30_000 });
});

test("a duplicate claim from a stale page is refused by the contract and sends nothing", async ({ page }) => {
  const t = await now();
  await chainSend(CLIENT, "create", [PROVIDER, VERIFIER, 3600n, 1, [parseEther("0.02"), 0n, 0n], [t + 900n, 0n, 0n], [0x61n, 0n, 0n]], parseEther("0.02"));
  await chainSend(PROVIDER, "submit", [4n, 0, 0xe4n]);
  await chainSend(VERIFIER, "approve", [4n, 0, 0xe4n, 1n]);
  await openAs(page, PROVIDER, "/app/agreements/4");
  await loaded(page);
  await expect(panel(page).getByText("Claim 0.02 ETH")).toBeVisible();
  await chainSend(PROVIDER, "claim", [4n, 0, PROVIDER]); // claimed behind the page's back
  await panel(page).getByRole("button", { name: "Claim payout" }).click();
  await panel(page).getByRole("button", { name: "Claim and sign" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This milestone is not approved." })).toBeVisible({ timeout: 30_000 });
  expect(await sentTransactions(page)).toBe(0);
  expect(await pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "getAccounting", args: [4n] })).toEqual([parseEther("0.02"), parseEther("0.02"), 0n, 0n]);
});

test("deadlines: no refund before the deadline, no submission after it, and the client's refund pays back exactly once", async ({ page }) => {
  const t = await now();
  await chainSend(CLIENT, "create", [PROVIDER, VERIFIER, 3600n, 1, [parseEther("0.03"), 0n, 0n], [t + 600n, 0n, 0n], [0x71n, 0n, 0n]], parseEther("0.03"));
  // before the deadline: the client is offered no refund, the provider is offered a submission
  const provider = await page.context().newPage();
  await openAs(provider, PROVIDER, "/app/agreements/5");
  await loaded(provider);
  await expect(panel(provider).getByText("Submit your evidence")).toBeVisible();
  await openAs(page, CLIENT, "/app/agreements/5");
  await loaded(page);
  await expect(panel(page)).toHaveCount(0);

  // the deadline passes
  await rpc("evm_increaseTime", [700]);
  await rpc("evm_mine");

  // the provider's page is stale (still offers a submission): the contract refuses it and nothing is sent
  await provider.getByRole("group", { name: "Actions for milestone 1" }).getByLabel("Evidence").fill("too late");
  await provider.getByRole("group", { name: "Actions for milestone 1" }).getByRole("button", { name: "Submit evidence" }).click();
  await expect(provider.getByRole("alert").filter({ hasText: "The delivery deadline has passed." })).toBeVisible({ timeout: 30_000 });
  expect(await sentTransactions(provider)).toBe(0);
  await provider.reload();
  await loaded(provider);
  await expect(provider.getByRole("group", { name: "Actions for milestone 1" })).toHaveCount(0); // a fresh read offers nothing
  await provider.close();

  // the client's fresh read offers the refund
  await page.reload();
  await loaded(page);
  await expect(page.getByText("Expired · refundable").first()).toBeVisible();
  const before = await pub.getBalance({ address: PAYEE });
  await panel(page).getByLabel("Send the ETH to").fill(PAYEE);
  await panel(page).getByRole("button", { name: "Refund to client" }).click();
  await panel(page).getByRole("button", { name: "Refund and sign" }).click();
  await confirmed(page);
  expect((await pub.getBalance({ address: PAYEE })) - before).toBe(parseEther("0.03"));
  expect((await milestone(5n))[0]).toBe(5); // Refunded
  await panel(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(panel(page)).toHaveCount(0); // a second refund cannot be pressed
});

// ---- Create form initialization (input-loss race) ----
// The form must never replace what the user has typed with a draft loaded later. The init script seeds a saved draft
// (as a previous visit in this tab would), then types into Provider at the first moment React has hydrated the field
// (its props are attached), before any later initialization can run. Deterministic: no timing guess in the test.
const savedDraft = (provider: string, spec: string) => ({
  provider,
  verifier: "",
  review: "1",
  reviewUnit: "days",
  milestones: [{ amount: "0.07", every: "3", unit: "days", spec }],
});

async function typeAtHydration(page: Page, seed: object, typed: string) {
  await page.addInitScript(
    ({ seed, typed }) => {
      if (sessionStorage.getItem("e2e:seeded")) return; // first load only; a reload must not seed or type again
      sessionStorage.setItem("e2e:seeded", "1");
      sessionStorage.setItem("settlane:create-draft", JSON.stringify(seed));
      const w = window as unknown as { __typedEarly?: boolean; __specWhenTyped?: string };
      const ch = new MessageChannel();
      const tick = () => {
        const el = document.querySelector<HTMLInputElement>('input[id$="-provider"]');
        if (el && Object.keys(el).some((k) => k.startsWith("__reactProps$"))) {
          // what the form showed when the user typed: the empty form, or the saved draft if it was already restored
          w.__specWhenTyped = document.querySelector<HTMLTextAreaElement>('textarea[id$="-s0"]')?.value ?? "";
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, typed);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          w.__typedEarly = true;
          return;
        }
        ch.port2.postMessage(0);
      };
      ch.port1.onmessage = tick;
      tick();
    },
    { seed, typed },
  );
}

test("create form: typing at the first hydrated moment is never overwritten by a later draft initialization", async ({ page }) => {
  await installWallet(page, { rpc: ANVIL, account: CLIENT, authorized: false });
  await typeAtHydration(page, savedDraft(VERIFIER, "an older saved draft"), PROVIDER);
  await page.goto("/app/create");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __typedEarly?: boolean }).__typedEarly === true)).toBe(true);
  await expect(page.getByRole("button", { name: "Check draft" })).toBeVisible();
  await page.waitForTimeout(500); // well past any initialization effect
  // The form ends exactly as the user saw it when typing, plus what was typed: the typed Provider always stays, and
  // the other fields keep what was on screen then (empty, or the saved draft if it was already shown). Initialization
  // never replaces typed text, and a draft the user never saw is never mixed in.
  const seen = await page.evaluate(() => (window as unknown as { __specWhenTyped?: string }).__specWhenTyped);
  expect(["", "an older saved draft"]).toContain(seen);
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue(PROVIDER);
  await expect(page.getByLabel("Specification")).toHaveValue(seen!);
  await expect(page.getByLabel("Amount (ETH)")).toHaveValue(seen === "" ? "" : "0.07");
  // fast typing after that continues on the same draft, and a reload restores exactly it
  await page.getByLabel("Specification").fill("typed after the early input");
  await page.reload();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue(PROVIDER);
  await expect(page.getByLabel("Specification")).toHaveValue("typed after the early input");
  expect(await sentTransactions(page)).toBe(0);
});

test("create form: with nothing typed, the saved draft is restored, and it survives connecting and switching accounts", async ({ page }) => {
  await installWallet(page, { rpc: ANVIL, account: CLIENT, authorized: false });
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("e2e:seeded")) return;
    sessionStorage.setItem("e2e:seeded", "1");
    sessionStorage.setItem("settlane:create-draft", JSON.stringify(seed));
  }, savedDraft(PROVIDER, "restored from this tab"));
  await page.goto("/app/create");
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue(PROVIDER);
  await expect(page.getByLabel("Specification")).toHaveValue("restored from this tab");
  await expect(page.getByLabel("Amount (ETH)")).toHaveValue("0.07");
  await page.getByRole("button", { name: "Connect wallet to sign" }).click();
  await expect(page.getByRole("button", { name: /^Connected as/ })).toBeVisible();
  await expect(page.getByLabel("Specification")).toHaveValue("restored from this tab");
  await switchAccount(page, STRANGER);
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue(PROVIDER);
  await expect(page.getByLabel("Amount (ETH)")).toHaveValue("0.07");
  // a reload keeps the same draft (restored once, then kept in sync)
  await page.reload();
  await expect(page.getByLabel("Specification")).toHaveValue("restored from this tab");
  expect(await sentTransactions(page)).toBe(0);
});

test("a draft made without a wallet survives connecting, is re-checked against the account, and is blocked on another network", async ({ page }) => {
  await installWallet(page, { rpc: ANVIL, account: CLIENT, authorized: false });
  await page.goto("/app/create");
  await expect(page.getByRole("button", { name: "Connect wallet to sign" })).toBeVisible();
  await page.getByLabel("Provider", { exact: true }).fill(PROVIDER);
  await page.getByLabel("Verifier", { exact: true }).fill(VERIFIER);
  await page.getByLabel("Amount (ETH)").fill("0.04");
  await page.getByLabel("Deliver within").fill("2");
  await page.getByLabel("Specification").fill("Kept across connecting");
  await page.getByRole("button", { name: "Check draft" }).click();
  await expect(page.getByText("The draft passes every rule the form can check.")).toBeVisible();
  expect(await sentTransactions(page)).toBe(0);

  // connecting keeps every field
  await page.getByRole("button", { name: "Connect wallet to sign" }).click();
  await expect(page.getByRole("button", { name: /^Connected as/ })).toBeVisible();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue(PROVIDER);
  await expect(page.getByLabel("Specification")).toHaveValue("Kept across connecting");
  await expect(page.getByRole("button", { name: "Review and create" })).toBeVisible();

  // the roles are re-checked against the connected account: the provider cannot be the client
  await switchAccount(page, PROVIDER);
  await page.getByRole("button", { name: "Review and create" }).click();
  await expect(page.getByText("The provider must be a different account from you, the client.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create and sign" })).toHaveCount(0);
  await switchAccount(page, CLIENT);
  await expect(page.getByText("Fix 1 field before signing")).toHaveCount(0);

  // another network: the draft stays, signing is blocked behind the switch
  await setWalletChain(page, 1);
  await expect(page.getByText("Signing is blocked until it is on Sepolia.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review and create" })).toHaveCount(0);
  await expect(page.getByLabel("Amount (ETH)")).toHaveValue("0.04");
  await page.getByLabel("Summary").getByRole("button", { name: "Switch to Sepolia" }).click();
  await expect(page.getByRole("button", { name: "Review and create" })).toBeVisible();
  expect(await sentTransactions(page)).toBe(0);
});

test("a wallet on the wrong network cannot transact until it is switched to Sepolia", async ({ page }) => {
  await openAs(page, CLIENT, "/app/create", 1); // an Ethereum mainnet wallet
  await expect(page.getByLabel("Provider", { exact: true })).toBeVisible(); // drafting is allowed
  await expect(page.getByText("Signing is blocked until it is on Sepolia.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review and create" })).toHaveCount(0);
  // personal pages say so in one line, and still show the account's data
  await page.getByRole("navigation", { name: "Application", exact: true }).getByRole("link", { name: "My Agreements" }).click();
  await expect(page.getByText("Your wallet is on another network.")).toBeVisible();
  expect(await sentTransactions(page)).toBe(0);
  await page.getByRole("button", { name: "Switch to Sepolia" }).last().click();
  await expect(page.getByText("Your wallet is on another network.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Connected as/ })).toBeVisible();
  expect(await sentTransactions(page)).toBe(0);
});

test("declining the signature in the wallet sends nothing and says so", async ({ page }) => {
  const count = await pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "totalOutstanding" });
  await openAs(page, CLIENT, "/app/create");
  await page.getByLabel("Provider", { exact: true }).fill(PROVIDER);
  await page.getByLabel("Verifier", { exact: true }).fill(VERIFIER);
  await page.getByLabel("Amount (ETH)").fill("0.01");
  await page.getByLabel("Deliver within").fill("2");
  await page.getByLabel("Specification").fill("Declined test");
  await rejectNextSignature(page);
  await page.getByRole("button", { name: "Review and create" }).click();
  await page.getByRole("button", { name: "Create and sign" }).click();
  await expect(page.getByText("You declined the request in MetaMask.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Nothing was sent. You can try again when you are ready.")).toBeVisible();
  await expect(page.getByText(/Confirmed in block/)).toHaveCount(0);
  await expect(page.getByLabel("Specification")).toHaveValue("Declined test"); // a refused request keeps the draft (R2-B)
  await expect(page.locator("[data-draft-archived]")).toHaveCount(0);
  expect(await pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "totalOutstanding" })).toBe(count);
});

test("a balance too small for the agreement is caught before signing", async ({ page }) => {
  await openAs(page, PAYEE, "/app/create");
  const balance = await pub.getBalance({ address: PAYEE });
  await page.getByLabel("Provider", { exact: true }).fill(PROVIDER);
  await page.getByLabel("Verifier", { exact: true }).fill(VERIFIER);
  await page.getByLabel("Amount (ETH)").fill(String(Number(balance / 10n ** 18n) + 1));
  await page.getByLabel("Deliver within").fill("2");
  await page.getByLabel("Specification").fill("Too expensive");
  await page.getByRole("button", { name: "Review and create" }).click();
  await page.getByRole("button", { name: "Create and sign" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Get test ETH from a Sepolia faucet" })).toBeVisible({ timeout: 30_000 });
  expect(await sentTransactions(page)).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------
// Wallet reliability (R1). The stand-in wallet holds requests unanswered to reproduce what MetaMask did in the
// real-wallet run (docs/ACCEPTANCE_REAL_WALLET.md, section 8). These are SIMULATIONS of that behavior with the
// real application code; they do not exercise MetaMask itself.
// ---------------------------------------------------------------------------------------------------------

/** Number of agreements (ids are consecutive from 1). */
async function agreementTotal(): Promise<number> {
  let n = 0;
  for (;;) {
    try {
      await pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "getAgreement", args: [BigInt(n + 1)] });
      n++;
    } catch {
      return n;
    }
  }
}
/** A new funded agreement (Client, Provider, Verifier); optionally submitted and approved. Returns its id. */
async function newAgreement(stage: "funded" | "approved"): Promise<bigint> {
  const t = await now();
  await chainSend(CLIENT, "create", [PROVIDER, VERIFIER, 3600n, 1, [parseEther("0.01"), 0n, 0n], [t + 3600n, 0n, 0n], [0x99n, 0n, 0n]], parseEther("0.01"));
  const id = BigInt(await agreementTotal());
  if (stage === "approved") {
    await chainSend(PROVIDER, "submit", [id, 0, 0xe9n]);
    await chainSend(VERIFIER, "approve", [id, 0, 0xe9n, 1n]);
  }
  return id;
}
const nonceOf = (a: Address) => pub.getTransactionCount({ address: a });

test("an unanswered signature: elapsed guidance, no duplicate, Stop waiting keeps it open, a late approval still lands", async ({ page }) => {
  test.setTimeout(120_000);
  const id = await newAgreement("approved");
  const estimate = await pub.estimateContractGas({ address: SETTLANE, abi: settlaneAbi, functionName: "claim", args: [id, 0, PROVIDER], account: PROVIDER });
  const nonceBefore = await nonceOf(PROVIDER);
  await openAs(page, PROVIDER, `/app/agreements/${id}`);
  await loaded(page);
  await holdSignatures(page);
  await panel(page).getByRole("button", { name: "Claim payout" }).click();
  await panel(page).getByRole("button", { name: "Claim and sign" }).click();
  await expect(panel(page).getByText(/Waiting for your signature in MetaMask · \d+ s/)).toBeVisible({ timeout: 15_000 });
  // nothing to press twice: the action's button is disabled while the request is open
  await expect(panel(page).getByRole("button", { name: "Claim payout" })).toBeDisabled();
  // after 15 s: the page says what it knows, and what to do in MetaMask
  await expect(panel(page).getByText("MetaMask has not answered yet. Nothing has been sent.")).toBeVisible({ timeout: 20_000 });
  await expect(panel(page).getByText(/press Try again in MetaMask/)).toBeVisible();
  await panel(page).getByText("What this page asked the wallet").click();
  await expect(panel(page).getByText(/eth_sendTransaction: handed to the wallet \d+ s ago, no answer yet/)).toBeVisible();
  // the gas limit handed to the wallet is the estimate plus 25%, and no fee field is set
  const [sent] = await sentParams(page);
  expect(BigInt(sent!.gas!)).toBe((estimate * 125n + 99n) / 100n);
  expect(sent!.maxFeePerGas).toBeUndefined();
  expect(sent!.maxPriorityFeePerGas).toBeUndefined();

  // Stop waiting: the page says the outcome is unknown, NOT that the request was cancelled, and refuses a second one
  await panel(page).getByRole("button", { name: "Stop waiting" }).click();
  await expect(panel(page).getByText("Outcome not known yet")).toBeVisible();
  await expect(panel(page).getByText(/The page stopped waiting. The request may still be open in MetaMask/)).toBeVisible();
  await expect(panel(page).getByText(/may still be open in your wallet. Check the chain before sending another/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Claim payout" })).toBeDisabled();
  expect((await walletCalls(page)).filter((c) => c === "eth_sendTransaction")).toHaveLength(1);
  // Check the chain cannot bypass the open request (R2 M6)
  await panel(page).getByRole("button", { name: "Check the chain" }).click();
  await expect(panel(page).getByText(/MetaMask still has this request open from this tab/)).toBeVisible({ timeout: 20_000 });
  await expect(panel(page).getByRole("button", { name: "It is no longer in MetaMask" })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Claim payout" })).toBeDisabled();

  // the user approves in MetaMask much later: the page still follows it to the receipt
  await releaseSignature(page);
  await confirmed(page);
  expect((await milestone(id))[0]).toBe(4); // Paid
  expect(await nonceOf(PROVIDER)).toBe(nonceBefore + 1); // exactly one transaction
  const receipt = await pub.getTransactionReceipt({ hash: (await pub.getBlock({ includeTransactions: true })).transactions.at(-1)!.hash });
  expect(receipt.gasUsed).toBeLessThanOrEqual(estimate);
});

test("a double click sends one request", async ({ page }) => {
  const id = await newAgreement("funded");
  await openAs(page, PROVIDER, `/app/agreements/${id}`);
  await loaded(page);
  await holdSignatures(page);
  await panel(page).getByLabel("Evidence").fill("double click");
  await panel(page).getByRole("button", { name: "Submit evidence" }).dblclick();
  await expect(panel(page).getByText(/Waiting for your signature in MetaMask/)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_000);
  expect((await walletCalls(page)).filter((c) => c === "eth_sendTransaction")).toHaveLength(1);
  await releaseSignature(page);
  await confirmed(page);
  expect((await milestone(id))[7]).toBe(1n); // revision 1: submitted once
});

test("account and network changes while a request is open neither resend it nor lose it; the request stays with its own account (R2-B)", async ({ page }) => {
  const id = await newAgreement("funded");
  const nonceBefore = await nonceOf(PROVIDER);
  await openAs(page, PROVIDER, `/app/agreements/${id}`);
  await loaded(page);
  await holdSignatures(page);
  await panel(page).getByLabel("Evidence").fill("switch while open");
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await expect(panel(page).getByText(/Waiting for your signature in MetaMask/)).toBeVisible({ timeout: 15_000 });
  await switchAccount(page, CLIENT);
  // the client sees that another account has a request open here, and it neither blocks nor belongs to the client
  await expect(panel(page).getByText(/0x7099…79C8 has an unfinished request for this action in this browser/)).toBeVisible();
  await expect(panel(page).getByText(/Waiting for your signature/)).toHaveCount(0);
  await switchAccount(page, PROVIDER);
  await expect(panel(page).getByText(/Waiting for your signature in MetaMask/)).toBeVisible();
  await expect(panel(page).locator("[data-other-accounts]")).toHaveCount(0);
  await setWalletChain(page, 1);
  await expect(page.getByText("Your wallet switched network while this request was open.", { exact: false })).toBeVisible();
  await setWalletChain(page, 11155111);
  expect((await walletCalls(page)).filter((c) => c === "eth_sendTransaction")).toHaveLength(1);
  await releaseSignature(page);
  await confirmed(page);
  expect(await nonceOf(PROVIDER)).toBe(nonceBefore + 1);
  expect((await milestone(id))[0]).toBe(2); // Submitted, by the provider it was requested for
});

test("after a reload the open request is remembered, a duplicate is refused, and Check the chain finds the late result", async ({ page }) => {
  const id = await newAgreement("funded");
  await openAs(page, PROVIDER, `/app/agreements/${id}`);
  await loaded(page);
  await holdSignatures(page);
  await panel(page).getByLabel("Evidence").fill("reload while open");
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await expect(panel(page).getByText(/Waiting for your signature in MetaMask/)).toBeVisible({ timeout: 15_000 });
  await page.reload(); // the page's own promise is gone; the wallet could still answer
  await loaded(page);
  await expect(panel(page).getByText("Outcome not known yet")).toBeVisible();
  await expect(panel(page).getByText(/This page was reloaded or reopened while a request for this action was open/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Submit evidence" })).toBeDisabled();
  // MetaMask sends it after all (simulated outside the page)
  await chainSend(PROVIDER, "submit", [id, 0, BigInt(keccak256(stringToBytes("reload while open")))]);
  await panel(page).getByRole("button", { name: "Check the chain" }).click();
  // R2-C: the exact call is found among the account's transactions, so the page names the transaction itself
  await expect(panel(page).getByText(/Confirmed in block \d+/)).toBeVisible({ timeout: 20_000 });
  await panel(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(panel(page).getByText("Replace your submission")).toBeVisible({ timeout: 20_000 });
});

test("after a reload, when nothing was sent, the SAME submission may be sent again on the user's word; the old outcome stays unknown (R2-B, R2-C)", async ({ page }) => {
  const id = await newAgreement("funded");
  const nonceBefore = await nonceOf(PROVIDER);
  await openAs(page, PROVIDER, `/app/agreements/${id}`);
  await loaded(page);
  await holdSignatures(page);
  await panel(page).getByLabel("Evidence").fill("lost request");
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await expect(panel(page).getByText(/Waiting for your signature in MetaMask/)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await loaded(page);
  await panel(page).getByRole("button", { name: "Check the chain" }).click();
  // the chain shows nothing, but the request may still be open in MetaMask: the page asks, it does not assume (R2 M1/M6)
  await expect(panel(page).getByText(/The chain shows this action has not happened and nothing from 0x7099…79C8 is pending/)).toBeVisible({ timeout: 20_000 });
  await expect(panel(page).getByRole("button", { name: "Submit evidence" })).toBeDisabled();
  await panel(page).getByRole("button", { name: "It is no longer in MetaMask" }).click();
  // the user's word is a decision, not proof: the outcome stays unknown and the page says what a late approval would do
  await expect(panel(page).getByText(/That is your decision, not proof: the outcome stays unknown/)).toBeVisible({ timeout: 20_000 });
  await expect(panel(page).getByText(/You may submit the SAME evidence again/)).toBeVisible();
  await expect(panel(page).getByText("Outcome not known yet")).toBeVisible();
  await panel(page).getByLabel("Evidence").fill("lost request"); // the same evidence: a late original would only repeat it
  await expect(panel(page).getByRole("checkbox")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await confirmed(page);
  await expect(panel(page).locator("[data-previous-unproven]")).toContainText("was never proven closed");
  expect(await nonceOf(PROVIDER)).toBe(nonceBefore + 1);
});

test("a lost create is never unlocked by the user's word; another account is not blocked; only the create found on-chain clears the draft (R2-B)", async ({ page }) => {
  test.setTimeout(150_000);
  const outstanding = () => pub.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "totalOutstanding" });
  const before = await outstanding();
  await openAs(page, CLIENT, "/app/create");
  await page.getByLabel("Provider", { exact: true }).fill(PROVIDER);
  await page.getByLabel("Verifier", { exact: true }).fill(VERIFIER);
  await page.getByLabel("Amount (ETH)").fill("0.01");
  await page.getByLabel("Deliver within").fill("2");
  await page.getByLabel("Specification").fill("Lost create");
  await holdSignatures(page);
  await page.getByRole("button", { name: "Review and create" }).click();
  await page.getByRole("button", { name: "Create and sign" }).click();
  await expect(page.getByText(/Waiting for your signature in MetaMask/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Review and create" })).toBeDisabled();
  const [asked] = await sentParams(page); // exactly what MetaMask was asked to sign
  // another account in this browser is neither blocked nor shown the client's request as its own
  await switchAccount(page, STRANGER);
  await expect(page.getByText(/0xf39F…2266 has an unfinished request for this action in this browser/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review and create" })).toBeEnabled();
  await switchAccount(page, CLIENT);
  await expect(page.getByText(/Waiting for your signature in MetaMask/)).toBeVisible();
  // a reload: the page's promise is gone, the wallet could still answer
  await page.reload();
  await expect(page.getByRole("button", { name: /^Connected as/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Outcome not known yet")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Check the chain" }).click();
  // R2-C: held at once; there is no "it is gone" button that could unlock a create, and time does not either
  await expect(page.getByText(/A new create from 0xf39F…2266 stays blocked until the chain settles it; time passing does not/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "It is no longer in MetaMask" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review and create" })).toBeDisabled();
  await expect(page.getByLabel("Specification")).toHaveValue("Lost create"); // the draft is kept
  expect(await outstanding()).toBe(before);
  // a DIFFERENT agreement by the same client (another device) does not settle it (R2-C: matched on the request's terms)
  const t = await now();
  await chainSend(CLIENT, "create", [PROVIDER, VERIFIER, 86_400n, 1, [parseEther("0.01"), 0n, 0n], [t + 7_200n, 0n, 0n], [BigInt(keccak256(stringToBytes("Lost create"))), 0n, 0n]], parseEther("0.01"));
  // wait for THIS check to finish (its verdict time changes): the earlier check's "held" must not satisfy it, and nothing
  // may happen on-chain while it is still reading (it would then judge a chain that changed under it)
  const previousCheck = await page.locator("[data-recovery]").getAttribute("data-recovery-at");
  await page.getByRole("button", { name: "Check the chain" }).click();
  await expect(page.locator("[data-recovery]")).not.toHaveAttribute("data-recovery-at", previousCheck!, { timeout: 20_000 });
  await expect(page.locator("[data-recovery]")).toHaveAttribute("data-recovery", "create-held");
  await expect(page.getByRole("button", { name: "Review and create" })).toBeDisabled();
  // the old request is approved in MetaMask after all: exactly the call it was asked to sign (simulated outside the page)
  await wallet(CLIENT).sendTransaction({ to: SETTLANE, data: asked!.data as `0x${string}`, value: BigInt(asked!.value ?? "0x0") });
  await page.getByRole("button", { name: "Check the chain" }).click();
  // found by its exact call among the account's transactions: the page now knows the transaction itself
  await expect(page.getByText(/Confirmed in block \d+/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/was created\. The draft was cleared so it cannot be created twice by accident\./)).toBeVisible();
  await expect(page.getByLabel("Specification")).toHaveValue("");
  await page.getByRole("button", { name: "Start a new draft from these terms" }).click();
  await expect(page.getByLabel("Specification")).toHaveValue("Lost create");
  expect(await outstanding()).toBe(before + parseEther("0.02")); // the different one, and the original: never a third
});

test("an unanswered connection request: guidance, Stop waiting, MetaMask's 'already pending', and a late approval connects", async ({ page }) => {
  await installWallet(page, { rpc: ANVIL, account: CLIENT, authorized: false });
  await page.goto("/app");
  await holdConnection(page);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Waiting for MetaMask…" }).first()).toBeVisible();
  await expect(page.getByText(/MetaMask hasn't answered the connection request · \d+ s/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Stop waiting" }).click();
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click(); // MetaMask still has the first one
  await expect(page.getByText("MetaMask already has a request from this page waiting.", { exact: false })).toBeVisible();
  await releaseConnection(page); // the user approves the first request in MetaMask
  await expect(page.getByRole("button", { name: /^Connected as/ })).toBeVisible();
});

test("a mistyped payee address (checksum fails) is refused before anything is simulated or signed (R2 M2)", async ({ page }) => {
  const id = await newAgreement("approved");
  await openAs(page, PROVIDER, `/app/agreements/${id}`);
  await loaded(page);
  // PAYEE (checksummed) with its last character changed, capitalization kept: the EIP-55 checksum no longer matches
  const good = getAddress(PAYEE);
  const typo = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
  expect(isAddress(typo, { strict: true })).toBe(false);
  await panel(page).getByLabel("Send the ETH to").fill(typo);
  await expect(panel(page).getByText(/fails its checksum \(EIP-55\)/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Claim payout" })).toBeDisabled();
  // the same address in lowercase is accepted, with a warning that no checksum protects it
  await panel(page).getByLabel("Send the ETH to").fill(PAYEE.toLowerCase());
  await expect(panel(page).getByText(/carries no checksum/)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Claim payout" })).toBeEnabled();
  expect(await sentTransactions(page)).toBe(0);
});

test("payments: personal totals say what the account claimed or refunded in its role, not what it received (R2-B)", async ({ page }) => {
  await openAs(page, PROVIDER, "/app/payments");
  await expect(page.getByText("Claimed as provider", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Sent to the address chosen at each claim")).toBeVisible();
  await expect(page.getByText("Paid out to you")).toHaveCount(0);
});

test("made-up agreement ids get a 404 from one shared count, malformed ids never reach the chain, real ids open (R2-B)", async ({ request }) => {
  const t0 = Date.now();
  const made = await Promise.all(Array.from({ length: 40 }, (_, i) => request.get(`/agreements/${900_000 + i * 7}`)));
  expect(made.map((r) => r.status())).toEqual(Array(40).fill(404));
  expect(Date.now() - t0).toBeLessThan(20_000);
  for (const bad of ["0", "01", "abc", "1".repeat(25)]) expect((await request.get(`/agreements/${bad}`)).status()).toBe(404);
  expect((await request.get("/agreements/1")).status()).toBe(200);
});

// R2-C. These two move the local chain's clock forward, so they run last.

test("R2-C Decision 2: a late duplicate submit DOES replace newer evidence while the delivery window is open; the page demands consent and warns, and the window closing ends the risk", async ({ page }) => {
  test.setTimeout(150_000);
  const id = await newAgreement("funded"); // delivery deadline: one hour from now
  await openAs(page, PROVIDER, `/app/agreements/${id}`);
  await loaded(page);
  await holdSignatures(page);
  await panel(page).getByLabel("Evidence").fill("version A");
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await expect(panel(page).getByText(/Waiting for your signature in MetaMask/)).toBeVisible({ timeout: 15_000 });
  const [askedA] = await sentParams(page);
  await page.reload();
  await loaded(page);
  await panel(page).getByRole("button", { name: "Check the chain" }).click();
  await panel(page).getByRole("button", { name: "It is no longer in MetaMask" }).click({ timeout: 20_000 });
  await expect(panel(page).getByText(/That is your decision, not proof/)).toBeVisible({ timeout: 20_000 });
  // different evidence: the page refuses to send it without explicit consent to the late-replacement risk
  await panel(page).getByLabel("Evidence").fill("version B");
  const ack = panel(page).getByRole("checkbox");
  await expect(ack).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Submit evidence" })).toBeDisabled();
  await ack.check();
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await confirmed(page);
  const hashB = BigInt(keccak256(stringToBytes("version B")));
  expect((await milestone(id)).slice(5)).toEqual([hashB, 0n, 1n]); // evidence B, revision 1
  // REPRODUCTION: MetaMask sends the old request A after all, inside the delivery window. The contract accepts it as a
  // resubmission (LIFECYCLE T2) and A replaces the newer B at revision 2.
  await wallet(PROVIDER).sendTransaction({ to: SETTLANE, data: askedA!.data as `0x${string}` });
  const hashA = BigInt(keccak256(stringToBytes("version A")));
  expect((await milestone(id)).slice(5)).toEqual([hashA, 0n, 2n]);
  // the page says so, plainly, to the provider
  await page.reload();
  await loaded(page);
  await expect(panel(page).locator("[data-late-replaced]")).toContainText("replaced your newer evidence", { timeout: 20_000 });
  // once the delivery window has closed (by block time), the same late request is refused by the contract
  await rpc("evm_increaseTime", [3_700]);
  await rpc("evm_mine");
  await expect(pub.call({ account: PROVIDER, to: SETTLANE, data: askedA!.data as `0x${string}` })).rejects.toThrow(/delivery window is closed/);
});

test("R2-C Decision 1: a lost create signed late that REVERTS is found by its exact call, and only then may the client create again", async ({ page }) => {
  test.setTimeout(150_000);
  await openAs(page, CLIENT, "/app/create");
  await page.getByLabel("Provider", { exact: true }).fill(PROVIDER);
  await page.getByLabel("Verifier", { exact: true }).fill(VERIFIER);
  await page.getByLabel("Amount (ETH)").fill("0.01");
  await page.getByLabel("Deliver within").fill("6"); // the form requires at least 5 minutes
  await page.getByLabel("Milestone 1 deadline unit").selectOption("minutes");
  await page.getByLabel("Specification").fill("Create that reverts");
  await holdSignatures(page);
  await page.getByRole("button", { name: "Review and create" }).click();
  await page.getByRole("button", { name: "Create and sign" }).click();
  await expect(page.getByText(/Waiting for your signature in MetaMask/)).toBeVisible({ timeout: 15_000 });
  const [asked] = await sentParams(page);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Connected as/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Check the chain" }).click();
  await expect(page.locator("[data-recovery]")).toHaveAttribute("data-recovery", "create-held", { timeout: 20_000 });
  // much later (past the deadline it was built with) the user approves the old prompt: it is mined and reverts
  await rpc("evm_increaseTime", [900]);
  await rpc("evm_mine");
  const hash = await wallet(CLIENT).sendTransaction({ to: SETTLANE, data: asked!.data as `0x${string}`, value: BigInt(asked!.value ?? "0x0"), gas: 600_000n });
  expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("reverted");
  await page.getByRole("button", { name: "Check the chain" }).click();
  await expect(page.getByText("Mined, but the contract reverted it.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Specification")).toHaveValue("Create that reverts"); // a reverted create keeps the draft
  await expect(page.getByRole("button", { name: "Review and create" })).toBeEnabled(); // the one request is settled
});

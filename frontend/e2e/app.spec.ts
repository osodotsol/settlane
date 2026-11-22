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

test("account and network changes while a request is open neither resend it nor lose it", async ({ page }) => {
  const id = await newAgreement("funded");
  const nonceBefore = await nonceOf(PROVIDER);
  await openAs(page, PROVIDER, `/app/agreements/${id}`);
  await loaded(page);
  await holdSignatures(page);
  await panel(page).getByLabel("Evidence").fill("switch while open");
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await expect(panel(page).getByText(/Waiting for your signature in MetaMask/)).toBeVisible({ timeout: 15_000 });
  await switchAccount(page, CLIENT);
  await expect(page.getByText(/This request belongs to 0x7099…79C8\. You are now connected as 0xf39F…2266/)).toBeVisible();
  await setWalletChain(page, 1);
  await expect(page.getByText("Your wallet switched network while this request was open.", { exact: false })).toBeVisible();
  await setWalletChain(page, 11155111);
  await switchAccount(page, PROVIDER);
  await expect(page.getByText(/This request belongs to/)).toHaveCount(0);
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
  await expect(panel(page).getByText("Done on-chain: the contract shows this action took effect.")).toBeVisible({ timeout: 20_000 });
  await panel(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(panel(page).getByText("Replace your submission")).toBeVisible({ timeout: 20_000 });
});

test("after a reload, when nothing was sent, one new request is allowed only after the user confirms the old one is gone", async ({ page }) => {
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
  await expect(panel(page).getByText(/You confirmed the request is no longer open in your wallet/)).toBeVisible({ timeout: 20_000 });
  await panel(page).getByLabel("Evidence").fill("sent again");
  await panel(page).getByRole("button", { name: "Submit evidence" }).click();
  await confirmed(page);
  expect(await nonceOf(PROVIDER)).toBe(nonceBefore + 1);
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

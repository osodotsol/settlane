import { expect, test, type Page } from "@playwright/test";
import { createPublicClient, createWalletClient, http, parseEther, type Address } from "viem";
import { sepolia } from "viem/chains";
import { settlaneAbi } from "../src/contract/abi";

// Against a throw-away local Anvil (chain id 11155111, simulated ETH, unlocked dev accounts) running the
// production bytecode; e2e/run.mjs sets it up with agreements 1 and 2. This covers what cannot be done
// on Sepolia without broadcasting: new agreements and events appearing, deadlines passing, RPC failure.
const ANVIL = process.env.ANVIL_URL!;
const SETTLANE = process.env.SETTLANE as Address;
const ACCOUNTS = JSON.parse(process.env.ANVIL_ACCOUNTS ?? "[]") as Address[];
if (ACCOUNTS.length < 3) throw new Error("e2e/run.mjs must pass three Anvil accounts in ANVIL_ACCOUNTS");
const [CLIENT, PROVIDER, VERIFIER] = ACCOUNTS as [Address, Address, Address];
const abi = settlaneAbi;
const chain = { ...sepolia, rpcUrls: { default: { http: [ANVIL] } } };
const pub = createPublicClient({ chain, transport: http(ANVIL) });
const wallet = (account: Address) => createWalletClient({ account, chain, transport: http(ANVIL) });
const rpc = (method: string, params: unknown[] = []) =>
  fetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());

async function send(account: Address, functionName: string, args: unknown[], value = 0n) {
  const hash = await wallet(account).writeContract({ address: SETTLANE, abi, functionName, args, value } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
}

/** Reloads `path` until `check` passes; returns the seconds it took. */
async function until(page: Page, path: string, check: () => Promise<void>, limitSeconds = 40): Promise<number> {
  const start = Date.now();
  for (;;) {
    await page.goto(path);
    try {
      await check();
      return (Date.now() - start) / 1000;
    } catch (e) {
      if ((Date.now() - start) / 1000 > limitSeconds) throw e;
      await page.waitForTimeout(1500);
    }
  }
}

test.describe.configure({ mode: "serial" });

test("a newly created agreement appears in the explorer and its page within seconds", async ({ page }) => {
  await page.goto("/explorer");
  await expect(page.locator("main").getByRole("link", { name: "#2" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "#3" })).toHaveCount(0);
  const before = await page.goto("/agreements/3");
  expect(before?.status()).toBe(404); // not created yet

  const block = await pub.getBlock();
  const t = block.timestamp;
  await send(CLIENT, "create", [PROVIDER, VERIFIER, 3600n, 2, [parseEther("0.1"), parseEther("0.2"), 0n], [t + 600n, t + 1200n, 0n], [0x51n, 0x52n, 0n]], parseEther("0.3"));

  const seconds = await until(page, "/explorer", async () => expect(page.locator("main").getByRole("link", { name: "#3" })).toBeVisible());
  console.log(`agreement 3 visible in the explorer after ${seconds.toFixed(1)} s`);
  expect(seconds).toBeLessThan(30);

  const res = await page.goto("/agreements/3");
  expect(res?.status()).toBe(200);
  await expect(page.locator('section[aria-labelledby="ledger-title"]').getByText("0.3 = 0 + 0 + 0.3", { exact: false })).toBeVisible();
  // one state chip per milestone in the milestones section (the lanes repeat the state as a label)
  await expect(page.locator("#milestones").locator("..").getByText("Funded", { exact: true })).toHaveCount(2);
});

test("a new event is added to the history exactly once, in order", async ({ page }) => {
  await until(page, "/agreements/3", async () => expect(page.locator("#history").locator("..").getByRole("listitem")).toHaveCount(1));
  await send(PROVIDER, "submit", [3n, 0, 0xabcn]);
  await until(page, "/agreements/3", async () => {
    const items = page.locator("#history").locator("..").getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(1)).toContainText("Provider submitted evidence");
    await expect(items.nth(1)).toContainText("revision 1");
  });
  await expect(page.locator("#milestones").locator("..").getByText("In review", { exact: true })).toHaveCount(1);
  // a later reload, after further incremental scans, still shows each event once
  await page.waitForTimeout(12_000);
  await page.goto("/agreements/3");
  await expect(page.locator("#history").locator("..").getByRole("listitem")).toHaveCount(2);
});

test("after a deadline passes, the lane and the state show the refund eligibility", async ({ page }) => {
  // milestone 2 (still Funded) passes its delivery deadline; milestone 1 (Submitted) is still in review
  await rpc("evm_increaseTime", [1300]);
  await rpc("evm_mine");
  await until(page, "/agreements/3", async () => expect(page.getByText("Expired · refundable", { exact: true }).first()).toBeVisible());
  const text = page.locator("figure ol.sr-only");
  await expect(text).toContainText("Milestone 2: Expired · refundable");
  await expect(text).toContainText("The client may refund from");
  await expect(text).toContainText("Milestone 1: In review");
  await expect(page.getByText("Expired since", { exact: false })).toBeVisible();
});

test("when the RPC fails, cached pages show the last data with a notice; uncached pages fail gracefully", async ({ page }) => {
  await page.goto("/explorer");
  await page.goto("/agreements/3");
  process.kill(Number(process.env.ANVIL_PID), "SIGTERM");
  await page.waitForTimeout(12_000); // past the cache TTL, so the next request tries the RPC again

  const explorer = await page.goto("/explorer");
  expect(explorer?.status()).toBe(200);
  await expect(page.getByText("Showing the last data read from Sepolia")).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "#3" })).toBeVisible();

  const detail = await page.goto("/agreements/3");
  expect(detail?.status()).toBe(200);
  await expect(page.getByText("Showing the last data read from Sepolia")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agreement #3");

  // never read before, and the RPC is down: an explicit message, not a crash and not a false 404
  const fresh = await page.goto("/agreements/7");
  expect(fresh?.status()).toBe(200);
  await expect(page.getByText("The Sepolia endpoints did not answer")).toBeVisible();
});

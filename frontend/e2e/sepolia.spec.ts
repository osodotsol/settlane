import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Against the real Sepolia deployment (read-only). A1 and A2 are terminal, so their values are fixed.
// Playwright runs from frontend/ (e2e/run.mjs sets the working directory).
const SHOTS = path.resolve("e2e/screenshots") + "/";
mkdirSync(SHOTS, { recursive: true });

const PAGES = ["/", "/explorer", "/agreements/1", "/agreements/2", "/contract"];
const WIDTHS = [360, 390, 768, 1024, 1440];

test("agreement 1: paid in full, exact wei, history in chain order", async ({ page }) => {
  const res = await page.goto("/agreements/1");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agreement #1");
  await expect(page.getByText("Closed: every milestone is settled")).toBeVisible();
  const ledger = page.locator("#ledger-title").locator("..");
  await expect(ledger.getByText("0.001 = 0.001 + 0 + 0", { exact: false })).toBeVisible();
  await expect(ledger.locator('[title="1000000000000000 wei"]').first()).toBeVisible();
  await expect(ledger.getByText("Each figure equals the sum")).toBeVisible();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  const history = page.locator("#history").locator("..").getByRole("listitem");
  await expect(history).toHaveCount(4);
  await expect(history.nth(0)).toContainText("Agreement created and funded with 0.001 ETH");
  await expect(history.nth(1)).toContainText("revision 1");
  await expect(history.nth(2)).toContainText("Verifier approved milestone 1, revision 1");
  await expect(history.nth(3)).toContainText("Provider claimed 0.001 ETH for milestone 1");
  await expect(history.nth(3)).toContainText("Block 12176195");
});

test("agreement 2: refunded in full after its delivery deadline", async ({ page }) => {
  await page.goto("/agreements/2");
  await expect(page.locator("#ledger-title").locator("..").getByText("0.001 = 0 + 0.001 + 0", { exact: false })).toBeVisible();
  await expect(page.getByText("Refunded", { exact: true }).first()).toBeVisible();
  const history = page.locator("#history").locator("..").getByRole("listitem");
  await expect(history).toHaveCount(2);
  await expect(history.nth(1)).toContainText("Client refunded 0.001 ETH for milestone 1");
  // the lane's text equivalent states the refund event and that no refund is still possible
  await expect(page.locator("figure ol.sr-only")).toContainText("Refunded to the client at 2026-11-20");
  await expect(page.locator("figure ol.sr-only")).toContainText("It cannot be refunded.");
});

test("explorer discovers agreements on-chain and filters them", async ({ page }) => {
  await page.goto("/explorer");
  const rows = page.locator("table tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("link", { name: "#1" })).toBeVisible();
  await page.getByLabel("Agreement number or address").fill("2");
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("link", { name: "#2" })).toBeVisible();
  await page.getByLabel("Agreement number or address").fill("");
  await page.getByText("Open", { exact: true }).click();
  // A1 and A2 are settled; only agreements created later could be open
  await expect(page.getByRole("link", { name: "#1" })).toHaveCount(0);
});

test("contract page: deployed code matches the pinned build", async ({ page }) => {
  await page.goto("/contract");
  await expect(page.getByText("matches the build")).toBeVisible();
  await expect(page.getByText("fe 26.6.0 (5b3f96a)").first()).toBeVisible();
  await expect(page.getByText("Contract deployed")).toBeVisible();
  expect(await page.locator("#transactions").locator("..").getByRole("listitem").count()).toBeGreaterThanOrEqual(7);
});

test("unknown and malformed agreement ids are real 404s with a complete page", async ({ page }) => {
  for (const id of ["99999999999", "0", "abc", "-1", "1.5"]) {
    const res = await page.goto(`/agreements/${id}`);
    expect(res?.status(), id).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing settles here");
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("explorer and agreement pages are complete in the HTML", async ({ page }) => {
    await page.goto("/explorer");
    await expect(page.getByRole("link", { name: "#1" })).toBeVisible();
    await page.goto("/agreements/1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agreement #1");
    await expect(page.locator("#history").locator("..").getByRole("listitem")).toHaveCount(4);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    test(`accessibility (axe, WCAG 2.2 AA) on every page`, async ({ page }) => {
      for (const path of PAGES) {
        await page.goto(path);
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(serious.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.help}`)).toEqual([]);
      }
    });
    test(`no horizontal overflow, and screenshots at ${WIDTHS.join("/")}`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of PAGES) {
          await page.goto(path);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
          if ([390, 1440].includes(width)) {
            const name = `${scheme}-${width}-${path === "/" ? "home" : path.slice(1).replace(/\//g, "-")}.png`;
            await page.screenshot({ path: SHOTS + name, fullPage: true });
          }
        }
      }
    });
  });
}

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
  const ledger = page.locator('section[aria-labelledby="ledger-title"]');
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
  await expect(page.locator('section[aria-labelledby="ledger-title"]').getByText("0.001 = 0 + 0.001 + 0", { exact: false })).toBeVisible();
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
  await expect(page.locator("main").getByRole("link", { name: "#1" })).toBeVisible();
  await page.getByLabel("Agreement number or address").fill("2");
  await expect(rows).toHaveCount(1);
  await expect(page.locator("main").getByRole("link", { name: "#2" })).toBeVisible();
  await page.getByLabel("Agreement number or address").fill("");
  await page.getByRole("group", { name: "Show agreements" }).getByText("Open", { exact: true }).click();
  // A1 and A2 are settled; only agreements created later could be open
  await expect(page.locator("main").getByRole("link", { name: "#1" })).toHaveCount(0);
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
    await expect(page.locator("main").getByRole("link", { name: "#1" })).toBeVisible();
    await page.goto("/agreements/1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agreement #1");
    await expect(page.locator("#history").locator("..").getByRole("listitem")).toHaveCount(4);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme, reducedMotion: "reduce" });
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

// ---- Design behaviours (motion, story, header, focus) ----

test.describe("with motion enabled", () => {
  test.use({ reducedMotion: "no-preference", viewport: { width: 1440, height: 900 } });

  test("nothing stays hidden: every scroll reveal is fully visible once scrolled into view", async ({ page }) => {
    for (const path of ["/", "/agreements/1", "/contract", "/explorer"]) {
      await page.goto(path);
      const hidden = await page.evaluate(async () => {
        const stuck: string[] = [];
        const targets = [...document.querySelectorAll<HTMLElement>(".reveal, .reveal-stagger > *, .grow-x, .pop-in")];
        for (const el of targets) {
          el.scrollIntoView({ block: "center", behavior: "instant" });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const cs = getComputedStyle(el);
          if (Number(cs.opacity) < 0.99) stuck.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} opacity ${cs.opacity}`);
        }
        return stuck;
      });
      expect(hidden, path).toEqual([]);
    }
  });

  test("the hero replays the real agreement step by step, and the tabs switch to the refunded one", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("[data-replay]");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.getByText("Replayed from Sepolia")).toBeVisible();
    await expect(panel.getByText("Agreement #1", { exact: true })).toBeVisible();
    // mid-play: a current step exists, and not every step is done yet
    await page.waitForTimeout(1300);
    await expect(panel.locator('li[aria-current="step"]')).toHaveCount(1);
    // after the run: the last step is current and the outcome is stated
    await expect(panel.getByText("0.001 ETH paid to the provider.")).toBeVisible({ timeout: 8000 });
    await expect(panel.locator("li").last()).toHaveAttribute("aria-current", "step");
    await expect(panel.locator("li")).toHaveCount(4);
    // the refunded agreement: a deadline step from the stored deliver_by, then the refund
    await panel.getByRole("button", { name: "Refunded" }).click();
    await expect(panel.getByRole("button", { name: "Refunded" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("Agreement #2", { exact: true })).toBeVisible();
    await expect(panel.getByText("Deadline passed")).toBeVisible();
    await expect(panel.getByText("0.001 ETH refunded to the client.")).toBeVisible({ timeout: 8000 });
    await expect(panel.getByRole("link", { name: /Open agreement #2/ })).toHaveAttribute("href", "/agreements/2");
  });

  test("scrolling the story changes the milestone card", async ({ page }) => {
    await page.goto("/");
    const steps = page.locator("#how-it-settles ol > li");
    await expect(steps).toHaveCount(5);
    await steps.nth(2).scrollIntoViewIfNeeded();
    await steps.nth(2).evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(page.locator("#how-it-settles [data-story-card]").getByText("Verifier (trusted)")).toBeVisible();
    await steps.nth(4).evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(page.locator("#how-it-settles [data-story-card]").getByText("Refunded to the client")).toBeVisible();
    await expect(page.locator("#how-it-settles [data-story-card]").getByText("Expired").first()).toBeVisible();
  });

  test("the header gains depth once the page scrolls and the progress line follows", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header).not.toHaveAttribute("data-scrolled", /.*/);
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: "instant" }));
    await expect(header).toHaveAttribute("data-scrolled", "true");
    const scale = await page.locator(".scroll-progress").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    expect(scale).toBeGreaterThan(0);
  });

  test("a keyboard-focused control is never hidden under the sticky header", async ({ page }) => {
    await page.goto("/");
    const clearance = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop));
    const header = await page.locator("header").first().boundingBox();
    expect(clearance).toBeGreaterThanOrEqual(header!.height);
    // tab down the page to a control far below the fold: it must land below the header
    const link = page.locator("footer").getByRole("link", { name: "Limitations" });
    await link.focus();
    const box = await link.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(header!.height);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  test("shows every final state at once: the replay is complete and nothing animates", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("[data-replay]");
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    for (const t of ["Agreement created", "Evidence submitted", "Approved", "Claimed"]) await expect(panel.getByText(t, { exact: true })).toBeVisible();
    await expect(panel.getByText("0.001 ETH paid to the provider.")).toBeVisible();
    await expect(panel.locator("li").last()).toHaveAttribute("aria-current", "step");
    // switching tabs jumps straight to the final state too
    await panel.getByRole("button", { name: "Refunded" }).click();
    await expect(panel.getByText("0.001 ETH refunded to the client.")).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

test.describe("phone layout", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  test("every navigation item fits on screen and the story card is replaced by the plain list", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main (compact)" });
    for (const name of ["Explorer", "Contract", "How it settles"]) {
      const box = await nav.getByRole("link", { name }).boundingBox();
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(390);
      expect(box!.height, name).toBeGreaterThanOrEqual(40);
    }
    await expect(page.locator("#how-it-settles [data-story-card]")).toBeHidden();
    await expect(page.locator("#how-it-settles ol > li")).toHaveCount(5);
  });
});

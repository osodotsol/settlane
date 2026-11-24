import { expect, test } from "@playwright/test";

// A partial log-node outage like Sepolia's on 2026-11-24 (e2e/run.mjs, stage 5). The history's nodes, in order: one that
// refuses every log range ("pruned history unavailable"), one that never answers, then a healthy one. Contract state is
// read from the healthy node. The seeded chain holds agreement 1 (created, submitted, approved, claimed) and agreement 2
// (created): five events. The history must still be COMPLETE and on time, and the hanging node must not be walked again on
// every refresh (the old fixed-order fallback paid its full timeout every time).

const hits = async () => ((await (await fetch(process.env.OUTAGE_STATS!)).json()) as { hole: number }).hole;

test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });

test("server: the agreement history is complete within budget, and a refresh does not wait on the dead node again", async ({ request }) => {
  test.setTimeout(120_000);
  const timed = async () => {
    const t0 = Date.now();
    const res = await request.get("/agreements/1", { timeout: 60_000 });
    return { status: res.status(), seconds: (Date.now() - t0) / 1000, html: await res.text() };
  };
  const first = await timed();
  expect(first.status).toBe(200);
  expect(first.html).toContain("History complete");
  expect(first.html).not.toContain("History may be incomplete");
  expect(first.seconds, "the first refresh hedges past the hanging node instead of waiting for its timeout").toBeLessThan(10);
  const afterFirst = await hits();

  await new Promise((r) => setTimeout(r, 11_000)); // past the server's 10 s history cache: the next request refreshes
  // a new block, so the refresh must read a new log range (with no new block there is nothing to ask any node for)
  await fetch(process.env.ANVIL_URL!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }) });
  const second = await timed();
  expect(second.status).toBe(200);
  expect(second.html).toContain("History complete");
  expect(await hits(), "within its cooldown the hanging node is not asked again").toBe(afterFirst);
  expect(second.seconds, "the refresh goes straight to the node that answered").toBeLessThan(4);
});

test("browser: agreement and activity pages show the complete history, in order", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/agreements/1");
  const history = page.locator("#history").locator("..").getByRole("listitem");
  await expect(history).toHaveCount(4);
  await expect(history.nth(0)).toContainText("Agreement created and funded with 1 ETH");
  await expect(history.nth(3)).toContainText("Provider claimed 1 ETH for milestone 1");
  await expect(page.locator('[data-history="complete"]').first()).toBeVisible();

  await page.goto("/app/activity");
  await expect(page.locator('[data-history="complete"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main ol > li")).toHaveCount(5);
  await expect(page.locator('[data-history="incomplete"]')).toHaveCount(0);

  await page.goto("/explorer");
  await expect(page.locator("main").getByRole("link", { name: "#1" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "#2" })).toBeVisible();
});

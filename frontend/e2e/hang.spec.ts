import { expect, test } from "@playwright/test";

// Every RPC endpoint is a socket that accepts the connection and never answers (e2e/run.mjs, stage 4): a GENUINE hang,
// not a refused connection. R2 audit H1 (server) and H2 (browser). The verified history snapshot is still available
// (it is part of the build), so history pages can show it, labelled as not refreshed.

test.use({ viewport: { width: 1280, height: 900 } });

test("server pages answer within their time budget, with a clear unavailable state", async ({ request }) => {
  test.setTimeout(180_000);
  const timed = async (path: string) => {
    const t0 = Date.now();
    const res = await request.get(path, { timeout: 60_000 });
    return { res, seconds: (Date.now() - t0) / 1000, html: await res.text() };
  };
  const home = await timed("/");
  expect(home.res.status()).toBe(200);
  expect(home.seconds).toBeLessThan(15);
  expect(home.html).toContain("Illustration of the rules"); // the real replay could not be verified, so the labelled illustration
  const explorer = await timed("/explorer");
  expect(explorer.res.status()).toBe(200);
  expect(explorer.seconds).toBeLessThan(15);
  const agreement = await timed("/agreements/1");
  expect(agreement.res.status()).toBe(200);
  expect(agreement.seconds).toBeLessThan(15);
  expect(agreement.html).toContain("did not answer");
  const contract = await timed("/contract");
  expect(contract.res.status()).toBe(200);
  expect(contract.seconds).toBeLessThan(15);
  expect(contract.html).toContain("History may be incomplete"); // the snapshot's transactions, marked not refreshed
  expect(contract.html).toContain("0x48c9");
});

test("browser pages reach a clear failure state within the budget instead of loading forever", async ({ page }) => {
  test.setTimeout(180_000);
  for (const path of ["/app", "/app/agreements/1"]) {
    const t0 = Date.now();
    await page.goto(path, { waitUntil: "commit" });
    await expect(page.getByText("The Sepolia endpoints did not answer").first()).toBeVisible({ timeout: 45_000 });
    expect((Date.now() - t0) / 1000, path).toBeLessThan(45);
    await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
  }
});

test("Activity shows the verified snapshot at once, never claiming it is complete", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app/activity", { waitUntil: "commit" });
  await expect(page.locator("ol > li")).toHaveCount(12, { timeout: 20_000 }); // the snapshot's twelve events
  await expect(page.getByText("History may be incomplete").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-history="complete"]')).toHaveCount(0);
  // stay on the page past the point where a render loop once crashed it (React #185 at about 45 s, fixed in R2-A)
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForTimeout(45_000);
  expect(errors).toEqual([]);
  await expect(page.getByText("This page couldn")).toHaveCount(0);
  await expect(page.locator("ol > li")).toHaveCount(12);
});

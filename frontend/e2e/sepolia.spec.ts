import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { settlaneAbi } from "../src/contract/abi";
import { history } from "../src/contract/history-instance";

// Live expectations come from the chain itself (other agreements may be created on the deployment at any time):
// the network's totals and its event list, read read-only from a public endpoint.
const chain = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 20_000, retryCount: 3 }) });
const SETTLANE = "0xf79d229a039bf5c84ecc7327060f8bbc888d2182" as const;
async function networkTotals() {
  let paid = 0n, refunded = 0n;
  for (let id = 1n; ; id++) {
    try {
      const acc = await chain.readContract({ address: SETTLANE, abi: settlaneAbi, functionName: "getAccounting", args: [id] });
      paid += acc[1];
      refunded += acc[2];
    } catch {
      return { paid, refunded };
    }
  }
}
/**
 * The network's events as Settlane itself reads them: the verified snapshot plus the live scan through the application's own
 * history engine and its fallback log sources (public nodes prune old logs, so one node cannot be asked directly). Nothing is
 * assumed: the history must report itself COMPLETE (no gap, no conflict, no refresh error), and its payouts are checked against
 * the contract's own accounting views, which are an independent source.
 */
async function networkEvents() {
  const h = await history.refresh();
  const problems = [...h.status.gaps.map((g) => `gap ${g.from}-${g.to}: ${g.error}`), ...h.status.conflicts, ...(h.status.refreshError ? [h.status.refreshError] : []), ...(h.status.snapshot.problem ? [h.status.snapshot.problem] : [])];
  expect(h.status.complete, `the event history is incomplete: ${problems.join("; ") || "not refreshed"}`).toBe(true);
  const sum = (kind: string) => h.events.filter((e) => e.kind === kind).reduce((t, e) => t + (e.amount ?? 0n), 0n);
  const totals = await networkTotals();
  expect(sum("claimed"), "claimed amounts in the history equal the contract's paid totals").toBe(totals.paid);
  expect(sum("refunded"), "refunded amounts in the history equal the contract's refunded totals").toBe(totals.refunded);
  return h.events.map((e) => e.kind);
}

// Against the real Sepolia deployment (read-only). A1 and A2 are terminal, so their values are fixed.
// Playwright runs from frontend/ (e2e/run.mjs sets the working directory).
const SHOTS = path.resolve("e2e/screenshots") + "/";
mkdirSync(SHOTS, { recursive: true });

const APP_PAGES = ["/app", "/app/agreements", "/app/create", "/app/work", "/app/verifications", "/app/payments", "/app/activity", "/app/agreements/1"];
const PAGES = ["/", "/explorer", "/agreements/1", "/agreements/2", "/contract", ...APP_PAGES];

/** Application pages read the chain in the browser: wait until their loading states are gone. */
async function visit(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  if (path.startsWith("/app")) {
    // the data arrives from Sepolia after hydration: wait until no loading placeholder is left, then let layout settle
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('[role="status"][aria-label="Loading from Sepolia"]')).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(300);
  }
}
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
  // the history is verified against the contract's own state: complete is claimed only when the counts match
  await expect(page.locator('[data-history="complete"]').first()).toContainText("History complete");
  await expect(page.locator('[data-history="incomplete"]')).toHaveCount(0);
});

test("agreements 3 and 4: their real-wallet histories are complete and in chain order", async ({ page }) => {
  await page.goto("/agreements/3");
  const h3 = page.locator("#history").locator("..").getByRole("listitem");
  await expect(h3).toHaveCount(2);
  await expect(h3.nth(0)).toContainText("Agreement created and funded with 0.0002 ETH");
  await expect(h3.nth(1)).toContainText("Client refunded 0.0002 ETH for milestone 1");
  await expect(h3.nth(1)).toContainText("Block 12186149");
  await expect(page.locator('[data-history="complete"]').first()).toBeVisible();
  await page.goto("/agreements/4");
  const h4 = page.locator("#history").locator("..").getByRole("listitem");
  await expect(h4).toHaveCount(4);
  await expect(h4.nth(1)).toContainText("revision 1");
  await expect(h4.nth(2)).toContainText("Verifier approved milestone 1, revision 1");
  await expect(h4.nth(3)).toContainText("Provider claimed 0.0002 ETH");
  await expect(h4.nth(3)).toContainText("Block 12186326");
  await expect(page.locator('[data-history="incomplete"]')).toHaveCount(0);
});

test("agreement 2: refunded in full after its delivery deadline", async ({ page }) => {
  await page.goto("/agreements/2");
  await expect(page.locator('section[aria-labelledby="ledger-title"]').getByText("0.001 = 0 + 0.001 + 0", { exact: false })).toBeVisible();
  await expect(page.getByText("Refunded", { exact: true }).first()).toBeVisible();
  const history = page.locator("#history").locator("..").getByRole("listitem");
  await expect(history).toHaveCount(2);
  await expect(history.nth(1)).toContainText("Client refunded 0.001 ETH for milestone 1");
  // the lane's text equivalent states the refund event and that no refund is still possible
  await expect(page.locator("figure ol.sr-only")).toContainText("Refunded by the client at 2026-11-20");
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
      test.setTimeout(480_000);
      for (const path of PAGES) {
        await visit(page, path);
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(serious.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.help}`)).toEqual([]);
      }
    });
    test(`no horizontal overflow, and screenshots at ${WIDTHS.join("/")}`, async ({ page }) => {
      test.setTimeout(600_000);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        // application pages read the chain in the browser (slower): three representative widths
        for (const path of PAGES.filter((p) => !p.startsWith("/app") || [360, 768, 1440].includes(width))) {
          await visit(page, path);
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

  test("the hero plays both real agreements in a continuous loop, and Pause stops it", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("[data-replay]");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.getByText("Replayed from Sepolia")).toBeVisible();
    await expect(panel.getByText("Agreement #1", { exact: true })).toBeVisible();
    await expect(panel.locator('li[aria-current="step"]')).toHaveCount(1);
    await expect(panel.locator("li")).toHaveCount(4);
    // agreement #1 runs to its outcome, then the loop moves on to agreement #2 by itself
    await expect(panel.getByText("0.001 ETH paid to the provider.")).toBeVisible({ timeout: 8000 });
    await expect(panel.getByRole("button", { name: "Refunded" })).toHaveAttribute("aria-pressed", "true", { timeout: 6000 });
    await expect(panel.getByText("Agreement #2", { exact: true })).toBeVisible();
    await expect(panel.getByText("Deadline passed")).toBeVisible();
    await expect(panel.getByText("0.001 ETH refunded to the client.")).toBeVisible({ timeout: 8000 });
    await expect(panel.getByRole("link", { name: /Open agreement #2/ })).toHaveAttribute("href", "/agreements/2");
    // ... and back to agreement #1: it never stops on its own
    await expect(panel.getByRole("button", { name: "Paid" })).toHaveAttribute("aria-pressed", "true", { timeout: 6000 });
    // a tab jumps to that agreement from its first step and keeps playing
    await panel.getByRole("button", { name: "Refunded" }).click();
    await expect(panel.getByLabel("Step 1 of 3")).toBeVisible();
    await expect(panel.getByLabel("Step 2 of 3")).toBeVisible({ timeout: 3000 });
    // Pause holds the current step (WCAG 2.2.2); Play resumes
    await panel.getByRole("button", { name: "Pause" }).click();
    const held = await panel.locator('[aria-label^="Step "]').getAttribute("aria-label");
    await page.waitForTimeout(3200);
    await expect(panel.locator('[aria-label^="Step "]')).toHaveAttribute("aria-label", held!);
    await panel.getByRole("button", { name: "Play" }).click();
    await expect(panel.locator('[aria-label^="Step "]')).not.toHaveAttribute("aria-label", held!, { timeout: 4000 });
  });

  test("scrolling the story changes the milestone card", async ({ page }) => {
    await page.goto("/");
    const steps = page.locator("#how-it-works ol > li");
    await expect(steps).toHaveCount(5);
    await steps.nth(2).scrollIntoViewIfNeeded();
    await steps.nth(2).evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(page.locator("#how-it-works [data-story-card]").getByText("Verifier (trusted)")).toBeVisible();
    await steps.nth(4).evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(page.locator("#how-it-works [data-story-card]").getByText("Refunded to the client")).toBeVisible();
    await expect(page.locator("#how-it-works [data-story-card]").getByText("Expired").first()).toBeVisible();
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
    const link = page.locator("footer").getByRole("link", { name: "Security & Limitations" });
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
    // nothing advances on its own: the button offers Play, not Pause
    await expect(panel.getByRole("button", { name: "Play" })).toBeVisible();
    await page.waitForTimeout(1600);
    await expect(panel.getByLabel("Step 4 of 4")).toBeVisible();
    // switching tabs jumps straight to the final state too
    await panel.getByRole("button", { name: "Refunded" }).click();
    await expect(panel.getByText("0.001 ETH refunded to the client.")).toBeVisible();
    // a 0.01 ms transition (reduced motion) is gone after the next frame; wait two so a loaded machine cannot flake
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

test.describe("phone layout", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  test("every navigation item fits on screen and the story card is replaced by the plain list", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main (compact)" });
    for (const name of ["Home", "How It Works", "Explorer", "Developers"]) {
      const box = await nav.getByRole("link", { name }).boundingBox();
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(390);
      expect(box!.height, name).toBeGreaterThanOrEqual(40);
    }
    await expect(page.locator("#how-it-works [data-story-card]")).toBeHidden();
    await expect(page.locator("#how-it-works ol > li")).toHaveCount(5);
  });
});

// ---- Public site: navigation, footer, hero motion, settlement timeline (premium pass, DESIGN.md §15) ----
test.describe("public site structure", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });

  test("every header and footer link resolves: pages answer 200 and every in-page anchor exists", async ({ page, request }) => {
    await page.goto("/contract");
    await expect(page.locator("header").getByRole("link", { name: "Settlane, home" })).toHaveAttribute("href", "/");
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(nav.getByRole("link")).toHaveText(["Home", "How It Works", "Explorer", "Developers"]);
    await expect(nav.getByRole("link", { name: "Developers" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("header").getByRole("link", { name: "Limitations" })).toHaveCount(0);
    const footer = page.locator("footer");
    for (const name of ["How It Works", "Launch App", "Explore Agreements", "Fe Smart Contract", "GitHub Repository", "Testing & Verification", "Documentation", "Security & Limitations", "Sepolia Explorer"]) {
      await expect(footer.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveCount(1);
    }
    await expect(footer.getByText("Sepolia testnet · Test ETH only · Trusted verifier · Unaudited prototype.")).toBeVisible();
    const hrefs = new Set<string>();
    for (const a of await page.locator("header a[href], footer a[href]").all()) hrefs.add((await a.getAttribute("href"))!);
    for (const href of hrefs) {
      if (/^https?:/.test(href)) {
        expect(href, "external links point at the repository or Etherscan").toMatch(/^https:\/\/(github\.com\/osodotsol\/settlane|sepolia\.etherscan\.io\/address\/0x[0-9a-fA-F]{40})/);
        continue;
      }
      const [path, hash] = href.split("#");
      const res = await request.get(path || "/");
      expect(res.status(), href).toBe(200);
      if (hash) {
        await page.goto(href);
        await expect(page.locator(`[id="${hash}"]`), href).toHaveCount(1);
      }
    }
  });

  test("the homepage tells the story in order and keeps limitations off the promotional page", async ({ page }) => {
    await page.goto("/");
    const headings = await page.locator("main h2").allTextContents();
    const order = ["Today, one side always goes first.", "Fund. Submit. Verify. Settle.", "Every window is set before the work starts.", "Paid and refunded, on Sepolia.", "Escrow rules the compiler helps enforce.", "See value move by the rules."];
    expect(headings.filter((h) => order.includes(h))).toEqual(order);
    await expect(page.getByText("What Settlane does not do")).toHaveCount(0);
    await expect(page.getByText("Illustration, not a live clock.", { exact: false })).toBeVisible();
    // the real evidence: two historical agreements, every transaction link a real Sepolia transaction
    const evidence = page.locator("#evidence article");
    await expect(evidence).toHaveCount(2);
    await expect(evidence.nth(0)).toContainText("Agreement #1");
    await expect(evidence.nth(1)).toContainText("Agreement #2");
    await expect(evidence.nth(1)).not.toContainText("Approved");
    for (const a of await evidence.locator('a[href*="etherscan"]').all()) expect(await a.getAttribute("href")).toMatch(/^https:\/\/sepolia\.etherscan\.io\/tx\/0x[0-9a-f]{64}$/);
    expect(await evidence.locator('a[href*="etherscan"]').count()).toBe(6);
  });

  test("the hero coin flow is decorative and still under reduced motion", async ({ page }) => {
    await page.goto("/");
    const flow = page.locator("[data-eth-flow]");
    await expect(flow).toHaveAttribute("data-eth-flow", "still");
    await expect(flow).toHaveAttribute("aria-hidden", "true");
    expect(await flow.locator("animate, animateMotion").count()).toBe(0);
    // decoration never takes a click: the hero buttons are reachable
    await expect(page.locator("main").getByRole("link", { name: "Explore Real Settlements" })).toBeVisible();
  });

  test("settlement timeline: paid shows its four real steps, refunded shows only what happened, deadlines stay one click away", async ({ page }) => {
    await page.goto("/agreements/1");
    const paid = page.locator('[data-timeline="0"]');
    for (const t of ["Funded", "Evidence submitted", "Approved", "Paid to the provider"]) await expect(paid.getByText(t, { exact: false }).first()).toBeVisible();
    await expect(paid.locator('[aria-current="step"]')).toHaveCount(0);
    await expect(paid.locator('a[href^="https://sepolia.etherscan.io/tx/0x"]')).toHaveCount(4);
    await page.goto("/agreements/2");
    const refunded = page.locator('[data-timeline="0"]');
    await expect(refunded.getByText("Refunded to the client")).toBeVisible();
    await expect(refunded.getByText("Evidence submitted")).toHaveCount(0);
    await expect(refunded.getByText("Approved")).toHaveCount(0);
    await expect(page.locator("figure")).toBeHidden();
    await page.getByText("View deadline details").click();
    await expect(page.locator("figure").getByText("Deadline lanes")).toBeVisible();
  });
});

test.describe("public site with motion", () => {
  test.use({ reducedMotion: "no-preference", viewport: { width: 1440, height: 900 } });
  test("the hero coin flow moves, and pauses when scrolled away", async ({ page }) => {
    await page.goto("/");
    const flow = page.locator("[data-eth-flow]");
    await expect(flow).toHaveAttribute("data-eth-flow", "moving");
    expect(await flow.locator("animateMotion").count()).toBeGreaterThanOrEqual(5);
    await page.evaluate(() => window.scrollTo({ top: 4000, behavior: "instant" }));
    await expect.poll(() => flow.evaluate((el) => (el as SVGSVGElement).animationsPaused())).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => flow.evaluate((el) => (el as SVGSVGElement).animationsPaused())).toBe(false);
  });
});

// ---- The application (/app): read-only against the real deployment, no wallet ----
test.describe("application, no wallet", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });

  test("Launch App is in the landing header and hero and leads to the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header").getByRole("link", { name: "Launch App" })).toHaveAttribute("href", "/app");
    await page.locator("main").getByRole("link", { name: "Launch App" }).first().click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Network overview");
  });

  test("the dashboard shows the real totals and agreements without a wallet", async ({ page }) => {
    await visit(page, "/app");
    // without a wallet the dashboard is a labelled network overview, with one compact, specific prompt
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Network overview");
    await expect(page.getByText("Connect a wallet to turn this into your dashboard")).toBeVisible();
    const funds = page.locator('section[aria-labelledby="funds"]');
    await expect(funds.getByText("Public · every agreement on Sepolia")).toBeVisible();
    const totals = await networkTotals(); // A1, A2 and any later agreements
    expect(totals.paid).toBeGreaterThanOrEqual(1_000_000_000_000_000n);
    await expect(funds.locator(`[title="${totals.paid} wei"]`).first()).toBeVisible();
    await expect(funds.locator(`[title="${totals.refunded} wei"]`).first()).toBeVisible();
    await expect(funds.getByText("Deposited equals paid plus refunded plus held")).toBeVisible();
    await expect(page.locator('section[aria-labelledby="actions"]')).toHaveCount(0); // no personal section without an account
    const list = page.locator('section[aria-labelledby="mine"]');
    await expect(list.getByRole("link", { name: /#1/ })).toBeVisible();
    await expect(list.getByRole("link", { name: /#2/ })).toBeVisible();
    await expect(page.locator('section[aria-labelledby="recent"]')).toContainText(/Agreement #\d+/);
    await expect(page.getByRole("heading", { name: "Recent network activity" })).toBeVisible();
  });

  test("every section is reachable from the sidebar and asks for a wallet only where it is personal", async ({ page }) => {
    await visit(page, "/app");
    const nav = page.getByRole("navigation", { name: "Application", exact: true });
    // each section has its own disconnected experience: a specific one-line prompt plus real, labelled content
    const sections: [string, string, RegExp | null][] = [
      ["My Agreements", "My Agreements", /Connect a wallet to list only your agreements/],
      ["Create Agreement", "Create Agreement", null],
      ["My Work", "My Work", /Connect a wallet to see the milestones you deliver/],
      ["Verifications", "Verifications", /Connect a wallet to see the submissions waiting for your decision/],
      ["Payments", "Payments", /Connect a wallet to see what you can claim or refund/],
      ["Activity", "Activity", /Connect a wallet to filter this history/],
    ];
    for (const [link, heading, prompt] of sections) {
      await nav.getByRole("link", { name: link }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(nav.getByRole("link", { name: link })).toHaveAttribute("aria-current", "page");
      if (prompt) await expect(page.getByText(prompt)).toBeVisible();
      await expect(page.getByText("Connect a wallet to see what is yours")).toHaveCount(0); // the old generic card is gone
    }
    await visit(page, "/app/agreements");
    await expect(page.getByText("Public · every agreement on Sepolia")).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: /#1/ })).toBeVisible();
    await expect(page.getByRole("group", { name: "Filter agreements" }).getByRole("button", { name: "As client" })).toHaveCount(0);
    for (const path of ["/app/work", "/app/verifications"]) {
      await visit(page, path);
      await expect(page.getByText("Example · not real data")).toBeVisible();
      await expect(page.getByText("Public · every agreement on Sepolia")).toBeVisible();
    }
    await visit(page, "/app/payments");
    // the payout list comes from the event scan, which reads Sepolia in the browser
    await expect(page.getByText("Claimed by the provider · agreement #1, milestone 1")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Refunded by the client · agreement #2, milestone 1")).toBeVisible();
    // Activity is public: every real event, newest first, filterable
    await visit(page, "/app/activity");
    const events = await networkEvents();
    await expect(page.locator("ol > li")).toHaveCount(events.length);
    await page.getByRole("group", { name: "Kind of event" }).getByRole("button", { name: "Claimed" }).click();
    await expect(page.locator("ol > li")).toHaveCount(events.filter((e) => e === "claimed").length);
    await expect(page.locator("ol > li").last()).toContainText("Agreement #1 · Provider claimed 0.001 ETH"); // newest first: A1's claim is the oldest
  });

  test("the agreement workspace shows parties, accounting, milestones and history from the chain", async ({ page }) => {
    await visit(page, "/app/agreements/1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agreement #1");
    await expect(page.getByText("Closed: every milestone is settled")).toBeVisible();
    await expect(page.getByText("0.001 = 0.001 + 0 + 0")).toBeVisible();
    await expect(page.getByText("Settled. No further action is possible.")).toBeVisible();
    await expect(page.locator("#history").locator("..").getByRole("listitem")).toHaveCount(4, { timeout: 30_000 }); // the event scan reads Sepolia in the browser
    await visit(page, "/app/agreements/999");
    await expect(page.getByText("There is no agreement #999")).toBeVisible();
  });

  test("the create form works without a wallet: draft, check, accessible errors, kept across a reload", async ({ page }) => {
    await visit(page, "/app/create");
    await expect(page.getByLabel("Provider", { exact: true })).toBeVisible();
    await page.getByLabel("Provider", { exact: true }).fill("0x1234");
    await page.getByLabel("Verifier", { exact: true }).fill("0x00000000000000000000000000000000000000a3");
    await page.getByLabel("Amount (ETH)").fill("0.25");
    await page.getByLabel("Deliver within").fill("3");
    await page.getByRole("button", { name: "Check draft" }).click();
    // a focused summary links to each invalid field, and each field keeps its own error
    const summary = page.getByRole("alert").filter({ hasText: "Fix 2 fields before signing" });
    await expect(summary).toBeFocused();
    await expect(page.getByLabel("Provider", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await summary.getByRole("link", { name: /Milestone 1 specification/ }).click();
    await expect(page.getByLabel("Specification")).toBeFocused();
    await page.getByLabel("Specification").fill("Three logo concepts as a Figma link");
    await page.getByLabel("Provider", { exact: true }).fill("0x00000000000000000000000000000000000000b2");
    await page.getByRole("button", { name: "Check draft" }).click();
    await expect(page.getByText("The draft passes every rule the form can check.")).toBeVisible();
    await expect(page.getByLabel("Summary").locator('[title="250000000000000000 wei"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect wallet to sign" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review and create" })).toHaveCount(0); // signing needs a Sepolia wallet
    await page.reload();
    await expect(page.getByLabel("Specification")).toHaveValue("Three logo concepts as a Figma link");
    await expect(page.getByLabel("Amount (ETH)")).toHaveValue("0.25");
  });
});

test.describe("application on a phone", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  test("every section is one tap away in the compact navigation", async ({ page }) => {
    await visit(page, "/app");
    const nav = page.getByRole("navigation", { name: "Application (compact)" });
    for (const name of ["Dashboard", "My Agreements", "Create Agreement", "My Work", "Verifications", "Payments", "Activity"]) {
      await expect(nav.getByRole("link", { name })).toHaveCount(1);
    }
    await nav.getByRole("link", { name: "Activity" }).scrollIntoViewIfNeeded();
    await nav.getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/app\/activity$/);
  });
});

test.describe("application when the nodes hang, then recover", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
  test("a bounded failure state, then live data again when a node answers (R2 H2)", async ({ page }) => {
    test.setTimeout(150_000);
    const RPC = /publicnode|tenderly|ethpandaops/;
    await page.route(RPC, () => {}); // requests are held and never answered: a genuine hang
    const t0 = Date.now();
    await page.goto("/app");
    await expect(page.getByText("The Sepolia endpoints did not answer").first()).toBeVisible({ timeout: 45_000 });
    expect((Date.now() - t0) / 1000).toBeLessThan(45);
    await page.unroute(RPC);
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expect(page.locator('section[aria-labelledby="funds"]').getByText("Deposited", { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("The Sepolia endpoints did not answer")).toHaveCount(0);
  });
});

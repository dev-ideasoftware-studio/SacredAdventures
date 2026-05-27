/**
 * Verifies the guide cards (QUESTS / GATHER / FISH / OBSERVE / JOURNAL)
 * render compact-style at tablet-landscape viewports.
 *
 * Regression context: the .card-desc descriptors ("Follow path",
 * "Collect resources", etc.) were showing AND overlapping the title
 * label on viewport widths between 1024 and 1366 px because the
 * tablet-landscape media query capped at 1024. Bumping the breakpoint
 * to 1366 extends the existing compact-card rules to cover iPad Pro
 * sizes and DevTools tablet simulations.
 */
const { test, expect } = require("@playwright/test");

test.use({ baseURL: undefined });

const TABLET_WIDTHS = [1024, 1180, 1280, 1366];

for (const width of TABLET_WIDTHS) {
  test(`guide cards: .card-desc HIDDEN + cards compact at ${width}×800`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:5505/index.html");
    await page.waitForFunction(() => !document.getElementById("v4-loading-iframe"), { timeout: 30000 });
    await page.waitForTimeout(1500);

    const panel = await page.$("iframe#v4-panel-frame");
    expect(panel, "v4-panel-frame iframe must exist").toBeTruthy();
    const frame = await panel.contentFrame();

    // Wait for guide cards to mount
    await frame.waitForSelector(".guide-card", { timeout: 8000 });

    const state = await frame.evaluate(() => {
      const cards = [...document.querySelectorAll(".guide-card")];
      const descs = [...document.querySelectorAll(".card-desc")];
      return {
        cardCount: cards.length,
        cardSize: cards[0] ? cards[0].getBoundingClientRect() : null,
        descsVisible: descs.map((d) => {
          const cs = getComputedStyle(d);
          return cs.display !== "none" && d.offsetParent !== null;
        }),
      };
    });

    expect(state.cardCount, "5 guide cards expected").toBe(5);
    // Compact card target: width and height both ≤ ~70 px after the fix
    expect(state.cardSize.width, `card width at ${width}px must be ≤ 70 (compact)`).toBeLessThanOrEqual(70);
    expect(state.cardSize.height, `card height at ${width}px must be ≤ 70 (compact)`).toBeLessThanOrEqual(70);
    // No descriptor text should be visible (mobile-style layout)
    const anyDescVisible = state.descsVisible.some((v) => v);
    expect(anyDescVisible, `no .card-desc should be visible at ${width}px (mobile-style hidden)`).toBe(false);

    await page.screenshot({ path: `backups/panel-cards-${width}.png`, fullPage: false });
    await ctx.close();
  });
}

// Sanity: at desktop width (≥ 1440 — typical desktop monitors), the
// descriptor IS shown — original design behavior preserved.
test("guide cards: .card-desc visible at desktop width (1440×900)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:5505/index.html");
  await page.waitForFunction(() => !document.getElementById("v4-loading-iframe"), { timeout: 30000 });
  await page.waitForTimeout(1500);
  const panel = await page.$("iframe#v4-panel-frame");
  const frame = await panel.contentFrame();
  await frame.waitForSelector(".guide-card", { timeout: 8000 });
  const descsVisible = await frame.evaluate(() => {
    return [...document.querySelectorAll(".card-desc")].map((d) => {
      const cs = getComputedStyle(d);
      return cs.display !== "none";
    });
  });
  expect(descsVisible.every((v) => v), "all .card-desc visible at desktop 1440").toBe(true);
  await ctx.close();
});

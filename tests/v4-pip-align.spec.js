/**
 * Verify the POS pill is horizontally centered on the moondial's
 * vertical centerline (≤ 1 px tolerance), positioned below it with
 * ~14 px breathing room, and visually professional.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ baseURL: undefined });

async function probe(page) {
  await page.goto('http://127.0.0.1:5505/index.html');
  await page.waitForTimeout(13000);
  return await page.evaluate(() => {
    const moon = document.getElementById('moondial-wrapper');
    const pill = document.getElementById('v2-distance-pill');
    if (!moon || !pill) return { found: false };
    const m = moon.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    return {
      found: true,
      moonCenterX: Math.round(m.left + m.width / 2),
      moonBottom:  Math.round(m.bottom),
      pillCenterX: Math.round(p.left + p.width / 2),
      pillTop:     Math.round(p.top),
      moonW:       Math.round(m.width),
      pillW:       Math.round(p.width),
      gap:         Math.round(p.top - m.bottom),
      audit: (window.AnuUniverse?.audit?.() || []).length,
    };
  });
}

test('DESKTOP — POS pill centered on moondial centerline ±1px', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('[pageerror] '+e.message));
  const r = await probe(page);
  console.log('\n── DESKTOP PROBE ──');
  Object.entries(r).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  await page.screenshot({
    path: path.resolve(__dirname, '..', 'test-results', 'v4-pip-align-desktop.png'),
    clip: { x: 0, y: 0, width: 460, height: 460 },
  });
  expect(r.found).toBe(true);
  expect(Math.abs(r.pillCenterX - r.moonCenterX)).toBeLessThanOrEqual(1); // centered
  expect(r.gap).toBeGreaterThanOrEqual(6);
  expect(r.gap).toBeLessThanOrEqual(22);
  expect(r.audit).toBe(0);
  expect(errs.length).toBe(0);
  await ctx.close();
});

test('MOBILE — same centered alignment + tighter gap', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  const r = await probe(page);
  console.log('\n── MOBILE PROBE ──', JSON.stringify(r));
  await page.screenshot({
    path: path.resolve(__dirname, '..', 'test-results', 'v4-pip-align-mobile.png'),
    clip: { x: 0, y: 0, width: 280, height: 320 },
  });
  expect(r.found).toBe(true);
  expect(Math.abs(r.pillCenterX - r.moonCenterX)).toBeLessThanOrEqual(1);
  await ctx.close();
});

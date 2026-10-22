/**
 * Compass dial (May-10 design restored 2026-10-22):
 *  - N/S/E/W and the 8 moon phases sit on their track midlines (≤ 1 px),
 *  - the POS pill sits just under the outer ring and is centred on the dial when it fits,
 *  - nothing is pushed off-screen (ring, pointer tab, pill).
 * Element ids: #pip-compass-wrapper (renamed from #moondial-wrapper on 2026-05-31).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ baseURL: undefined });

async function probe(page) {
  await page.goto('http://127.0.0.1:5505/index.html');
  await page.waitForTimeout(18000);
  return await page.evaluate(() => {
    const moon = document.getElementById('pip-compass-wrapper');
    const pill = document.getElementById('v2-distance-pill');
    const ring = document.querySelector('#pip-compass-wrapper .compass-outer-ring');
    const tab = document.querySelector('#pip-compass-wrapper .pip-heading-bracket');
    if (!moon || !pill || !ring) return { found: false };
    const m = moon.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    const cx = m.left + m.width / 2, cy = m.top + m.height / 2;
    const scale = m.width / moon.offsetWidth;
    const R = (moon.clientWidth / 2) * scale;
    const dist = (el) => { const e = el.getBoundingClientRect(); return Math.hypot(e.left + e.width / 2 - cx, e.top + e.height / 2 - cy); };
    // Track midlines in unscaled px: letters R+18, moons R-5 (see UIModule.js geometry comment).
    const letterErr = [...moon.querySelectorAll('.compass-marker')].map((el) => Math.abs((dist(el) - R) / scale - 18));
    const moonErr = [...moon.querySelectorAll('.lunar-phase-slot')].map((el) => Math.abs((dist(el) - R) / scale + 5));
    const ringOuter = R + 28 * scale; // outer ring radius on screen
    return {
      found: true,
      moonCenterX: Math.round(cx),
      pillCenterX: Math.round(p.left + p.width / 2),
      pillLeft: Math.round(p.left),
      pillW: Math.round(p.width),
      gapBelowRing: Math.round(p.top - (cy + ringOuter)),
      ringLeft: Math.round(cx - ringOuter),
      tabTop: tab ? Math.round(tab.getBoundingClientRect().top) : -1,
      worstLetterErr: Math.max(...letterErr),
      worstMoonErr: Math.max(...moonErr),
      moonCount: moonErr.length,
      audit: (window.AnuUniverse?.audit?.() || []).filter(x => x.id !== 'pip-full-rate').length,
    };
  });
}

test('DESKTOP — tracks centred, POS pill centred under the dial', async ({ browser }) => {
  test.setTimeout(60000);
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
  expect(r.moonCount).toBe(8);
  expect(r.worstLetterErr).toBeLessThanOrEqual(1);
  expect(r.worstMoonErr).toBeLessThanOrEqual(1);
  expect(Math.abs(r.pillCenterX - r.moonCenterX)).toBeLessThanOrEqual(1); // centered (fits at 1280)
  expect(r.gapBelowRing).toBeGreaterThanOrEqual(4);
  expect(r.gapBelowRing).toBeLessThanOrEqual(16);
  expect(r.ringLeft).toBeGreaterThanOrEqual(0);
  expect(r.tabTop).toBeGreaterThanOrEqual(0);
  expect(r.audit).toBe(0);
  expect(errs.length).toBe(0);
  await ctx.close();
});

test('MOBILE — tracks centred, nothing clipped', async ({ browser }) => {
  test.setTimeout(60000);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  const r = await probe(page);
  console.log('\n── MOBILE PROBE ──', JSON.stringify(r));
  await page.screenshot({
    path: path.resolve(__dirname, '..', 'test-results', 'v4-pip-align-mobile.png'),
    clip: { x: 0, y: 0, width: 280, height: 320 },
  });
  expect(r.found).toBe(true);
  expect(r.worstLetterErr).toBeLessThanOrEqual(1);
  expect(r.worstMoonErr).toBeLessThanOrEqual(1);
  expect(r.pillLeft).toBeGreaterThanOrEqual(0);   // pill never clipped; it may sit right of centre on narrow screens
  expect(r.ringLeft).toBeGreaterThanOrEqual(0);
  await ctx.close();
});

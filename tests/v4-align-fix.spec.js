/**
 * Verify:
 *  1. PIP top buffer = 20 (matches left buffer) — no clipping
 *  2. POS pill still center-aligned to moondial centerline (Δ ≤ 1 px)
 *  3. Welcome guide centered horizontally on viewport (Δ ≤ 1 px)
 *  4. Welcome guide top is in upper third of viewport
 *  5. Welcome guide z-index is highest among HUD layers
 *  6. Anu audit clean / 0 errors
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ baseURL: undefined });

async function probe(page) {
  await page.addInitScript(() => { try { localStorage.removeItem('sanctuary.welcomeGuide.seenV2'); } catch {} });
  await page.goto('http://127.0.0.1:5505/index.html');
  // 18s — boot finishes after warm-up passes; WelcomeGuide + Panels load
  // near the end (~13-14s) so we need 17+ for the elements to exist.
  await page.waitForTimeout(18000);
  return await page.evaluate(() => {
    const moon  = document.getElementById('moondial-wrapper');
    const pill  = document.getElementById('v2-distance-pill');
    const guide = document.getElementById('sanctuary-welcome-guide');
    const pip   = document.getElementById('sanctuary-panels-root');
    const hud   = document.getElementById('v2-orchestrator-hud');
    const m = moon?.getBoundingClientRect();
    const p = pill?.getBoundingClientRect();
    const g = guide?.getBoundingClientRect();
    const zOf = (el) => el ? parseInt(getComputedStyle(el).zIndex, 10) || 0 : 0;
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      moonTop:   m ? Math.round(m.top)   : null,
      moonLeft:  m ? Math.round(m.left)  : null,
      moonCx:    m ? Math.round(m.left + m.width / 2) : null,
      pillCx:    p ? Math.round(p.left + p.width / 2) : null,
      guideCx:   g ? Math.round(g.left + g.width / 2) : null,
      guideTop:  g ? Math.round(g.top)   : null,
      guideZ:    zOf(guide),
      hudZ:      zOf(hud),
      pipPanelsZ:zOf(pip),
      moonZ:     zOf(moon),
      audit: (window.AnuUniverse?.audit?.() || []).length,
    };
  });
}

test('DESKTOP — alignment + center + z-order', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('[pageerror] '+e.message));
  const r = await probe(page);
  console.log('\n── DESKTOP ──');
  Object.entries(r).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  await page.screenshot({ path: path.resolve(__dirname, '..', 'test-results', 'v4-align-fix.png') });

  // PIP top/left match → standard alignment
  expect(r.moonLeft).toBe(20);
  expect(r.moonTop).toBe(20);
  // Pill still centered on moondial
  expect(Math.abs(r.pillCx - r.moonCx)).toBeLessThanOrEqual(1);
  // Welcome guide center === viewport center (±1)
  expect(Math.abs(r.guideCx - r.vw / 2)).toBeLessThanOrEqual(1);
  // Guide top in upper 1/2 (since moved below 320px PIP)
  expect(r.guideTop).toBeLessThanOrEqual(r.vh / 2);
  // Guide z-index higher than every other HUD layer
  expect(r.guideZ).toBeGreaterThan(r.hudZ);
  expect(r.guideZ).toBeGreaterThan(r.pipPanelsZ);
  expect(r.guideZ).toBeGreaterThan(r.moonZ);
  expect(r.audit).toBe(0);
  expect(errs.length).toBe(0);
  await ctx.close();
});

test('MOBILE — same center-top-1/3 + z-order', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  const r = await probe(page);
  console.log('\n── MOBILE ──');
  Object.entries(r).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  expect(Math.abs(r.guideCx - r.vw / 2)).toBeLessThanOrEqual(1);
  expect(r.guideTop).toBeLessThanOrEqual(r.vh / 3);
  expect(r.guideZ).toBeGreaterThan(r.hudZ);
  await ctx.close();
});

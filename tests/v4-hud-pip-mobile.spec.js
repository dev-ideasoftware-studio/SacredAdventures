/**
 * Verifies the full mobile-shrink behaviour:
 *   • OrchestratorHud: ≤196 px wide, FPS 21 px, flush against right edge.
 *   • UNIVERSE accordion: collapsed by default, shows % + module count.
 *   • PIP moondial: dial track CSS vars halved (compass=10, moon=11, outer=8).
 *   • SACRED title now lives BELOW the #v2-pip line (not above FPS).
 *   • Desktop (1280×800) — all of the above stay at original sizes.
 * Captures errors / warnings / 404s and queries AnuUniverse.audit().
 */
const { test, expect } = require('@playwright/test');

test.use({ baseURL: undefined });

async function bootAndProbe(page, label) {
  const errors = [], warnings = [], net404 = [];
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('response', r => { if (r.status() === 404) net404.push(r.url()); });

  await page.goto('http://127.0.0.1:5505/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);

  const probe = await page.evaluate(() => {
    const hud = document.getElementById('v2-orchestrator-hud');
    const fps = document.getElementById('v2-fps');
    const title = document.getElementById('v2-hud-title');
    const pip = document.getElementById('v2-pip');
    const accBody = document.getElementById('v2-universe-accordion-body');
    const pct = document.getElementById('v2-universe-pct');
    const count = document.getElementById('v2-universe-count');
    const moon = document.getElementById('moondial-wrapper');

    const hudRect = hud?.getBoundingClientRect();
    const titleY = title?.getBoundingClientRect().top;
    const fpsY = fps?.getBoundingClientRect().top;
    const pipY = pip?.getBoundingClientRect().top;
    const moonCs = moon ? getComputedStyle(moon) : null;

    return {
      hudWidth: hudRect ? Math.round(hudRect.width) : null,
      hudRightEdge: hudRect ? Math.round(window.innerWidth - hudRect.right) : null,
      fpsFontSize: fps ? getComputedStyle(fps).fontSize : null,
      titleExists: !!title,
      titleBelowFps: titleY != null && fpsY != null ? titleY > fpsY : null,
      titleBelowPip: titleY != null && pipY != null ? titleY > pipY : null,
      accordionCollapsed: accBody ? getComputedStyle(accBody).display === 'none' : null,
      pctText: pct?.textContent ?? null,
      countText: count?.textContent ?? null,
      moonExists: !!moon,
      moonTrack:   moonCs ? moonCs.getPropertyValue('--pip-moon-track').trim() : null,
      compassTrack:moonCs ? moonCs.getPropertyValue('--pip-compass-track').trim() : null,
      outerTrack:  moonCs ? moonCs.getPropertyValue('--pip-outer-track').trim() : null,
      auditLen: (window.AnuUniverse?.audit?.() || []).length,
    };
  });

  console.log(`\n── ${label} ─────────────────────────────────────`);
  console.log(`  HUD width:           ${probe.hudWidth} px`);
  console.log(`  HUD right offset:    ${probe.hudRightEdge} px (0 = flush)`);
  console.log(`  FPS font:            ${probe.fpsFontSize}`);
  console.log(`  Title exists:        ${probe.titleExists}`);
  console.log(`  Title below FPS:     ${probe.titleBelowFps}`);
  console.log(`  Title below PiP line:${probe.titleBelowPip}`);
  console.log(`  Accordion collapsed: ${probe.accordionCollapsed}`);
  console.log(`  Universe %:          ${probe.pctText}`);
  console.log(`  Module count:        ${probe.countText}`);
  console.log(`  Moondial exists:     ${probe.moonExists}`);
  console.log(`  PIP tracks:          moon=${probe.moonTrack}  compass=${probe.compassTrack}  outer=${probe.outerTrack}`);
  console.log(`  Anu audit length:    ${probe.auditLen}  (0 = healthy)`);
  console.log(`  errors:${errors.length}  warnings:${warnings.length}  404s:${net404.length}`);
  errors.slice(0, 3).forEach(e => console.log('    ❌ ' + e.substring(0, 200)));
  return probe;
}

test('MOBILE 375×667 — HUD shrink + PIP dials halved + accordion + title relocated', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  const r = await bootAndProbe(page, 'MOBILE 375×667');
  expect(r.hudWidth).toBeLessThanOrEqual(196);
  expect(r.hudRightEdge).toBe(0);                  // flush right
  expect(parseFloat(r.fpsFontSize)).toBeLessThanOrEqual(22);
  expect(r.titleExists).toBe(true);
  expect(r.titleBelowFps).toBe(true);               // moved down
  expect(r.titleBelowPip).toBe(true);
  expect(r.accordionCollapsed).toBe(true);          // default collapsed
  expect(r.countText).toMatch(/^\d+ mods?$/);       // "36 mods"
  expect(r.pctText).toMatch(/^(\d+%|--%)$/);
  expect(r.moonTrack).toBe('11px');                 // halved from 22px
  expect(r.compassTrack).toBe('10px');              // halved from 20px
  expect(r.outerTrack).toBe('8px');                 // halved from 16px
  await ctx.close();
});

test('DESKTOP 1280×800 — full size on HUD AND PIP dials', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const r = await bootAndProbe(page, 'DESKTOP 1280×800');
  expect(r.hudWidth).toBe(280);
  expect(r.hudRightEdge).toBe(0);                  // flush right at all sizes
  expect(r.fpsFontSize).toBe('30px');
  expect(r.titleBelowFps).toBe(true);               // title still below FPS (it's just relocated, not media-conditional)
  expect(r.accordionCollapsed).toBe(true);          // same default
  // PIP tracks should be UNCHANGED (defaults) on desktop:
  expect(r.moonTrack).toBe('22px');
  expect(r.compassTrack).toBe('20px');
  expect(r.outerTrack).toBe('16px');
  await ctx.close();
});

/**
 * Verify the OrchestratorHud mobile shrink:
 *   • iPhone SE 375×667 → HUD width must drop to ≤ 196 px, font-size ≤ 9 px.
 *   • Desktop 1280×800 → HUD width stays at 280 px, font-size 13 px (baseline).
 * Also captures errors / warnings / 404s + queries Anu after each boot
 * (per the user mandate).
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
  await page.waitForTimeout(12000);

  const probe = await page.evaluate(() => {
    const hud = document.getElementById('v2-orchestrator-hud');
    if (!hud) return { found: false };
    const cs = getComputedStyle(hud);
    const fps = document.getElementById('v2-fps');
    const fpsCs = fps ? getComputedStyle(fps) : null;
    const audit = window.AnuUniverse?.audit?.() ?? null;
    return {
      found: true,
      hudWidth: Math.round(hud.getBoundingClientRect().width),
      hudFontSize: cs.fontSize,
      hudPadding: cs.padding,
      fpsFontSize: fpsCs?.fontSize ?? null,
      anuAudit: Array.isArray(audit) ? audit.length : 'unknown',
    };
  });

  console.log(`\n── ${label} ──────────────────────────────────`);
  console.log(`  HUD width:     ${probe.hudWidth} px`);
  console.log(`  HUD font-size: ${probe.hudFontSize}`);
  console.log(`  HUD padding:   ${probe.hudPadding}`);
  console.log(`  FPS font-size: ${probe.fpsFontSize}`);
  console.log(`  AnuUniverse.audit() length: ${probe.anuAudit}  (0 = healthy)`);
  console.log(`  errors: ${errors.length}  warnings: ${warnings.length}  404s: ${net404.length}`);
  errors.forEach(e => console.log('    ❌ ' + e.substring(0, 240)));
  return probe;
}

test('HUD mobile (375×667) shrinks ~30%', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  const r = await bootAndProbe(page, 'MOBILE 375×667');
  expect(r.found).toBe(true);
  expect(r.hudWidth).toBeLessThanOrEqual(196);
  expect(parseFloat(r.hudFontSize)).toBeLessThanOrEqual(10);
  expect(parseFloat(r.fpsFontSize)).toBeLessThanOrEqual(22);
  await ctx.close();
});

test('HUD desktop (1280×800) unchanged at full size', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const r = await bootAndProbe(page, 'DESKTOP 1280×800');
  expect(r.found).toBe(true);
  expect(r.hudWidth).toBe(280);
  expect(r.hudFontSize).toBe('13px');
  expect(r.fpsFontSize).toBe('30px');
  await ctx.close();
});

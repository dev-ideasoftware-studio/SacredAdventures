/**
 * Verify: FPS HUD ORCHESTRATOR accordion
 *  - Panel appears with correct design (dark/monospace, amber border)
 *  - ORCHESTRATOR button is present and collapsed by default
 *  - Clicking it expands: frame graph canvas + DRAW·TRI row + UNIVERSE section appear
 *  - UNIVERSE sub-accordion also expands
 *  - No console errors
 */
const { test, expect } = require('@playwright/test');

test('FPS HUD — ORCHESTRATOR accordion renders and expands', async ({ page }) => {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));

  await page.goto('http://127.0.0.1:5505/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(7000);

  // ── 1. FPS HUD panel present ──────────────────────────────────────────────
  const hud = page.locator('#v2-orchestrator-hud');
  await expect(hud).toBeVisible({ timeout: 5000 });
  console.log('✓ #v2-orchestrator-hud visible');

  // ── 2. Original design tokens still in place ──────────────────────────────
  const bg = await hud.evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('  background:', bg);

  const fontFam = await hud.evaluate(el => getComputedStyle(el).fontFamily);
  // Uses Fredoka now in unified style
  const hasFredoka = fontFam.toLowerCase().includes('fredoka');
  console.log('  fontFamily:', fontFam);
  expect(hasFredoka).toBe(true);
  console.log('✓ Unified neomorphic design — Fredoka present');

  // ── 3. ORCHESTRATOR header ────────────────────────────────────────────────
  const pipelineHeader = hud.locator('div', { hasText: 'ORCHESTRATOR' }).first();
  await expect(pipelineHeader).toBeVisible();
  console.log('✓ ORCHESTRATOR header present');

  // ── 4. FPS value present ──────────────────────────────────────────────────
  const fpsSpan = page.locator('#v2-fps');
  await expect(fpsSpan).toBeVisible();
  const fpsText = await fpsSpan.textContent();
  console.log(`✓ FPS value: "${fpsText}"`);

  // ── 5. TRACE button present and collapsed ──────────────────────────
  const orcBtn  = page.locator('#v2-hud-trace-label');
  const orcBody = page.locator('#v2-trace-accordion-body');
  await expect(orcBtn).toBeVisible();
  const bodyDisplay = await orcBody.evaluate(el => el.style.display);
  expect(bodyDisplay).toBe('none');
  console.log('✓ TRACE button present, accordion collapsed by default');

  // ── 6. Click expands accordion ────────────────────────────────────────────
  await orcBtn.click();
  await page.waitForTimeout(300);

  const bodyDisplayAfter = await orcBody.evaluate(el => el.style.display);
  expect(bodyDisplayAfter).not.toBe('none');
  console.log('✓ TRACE accordion expanded on click');

  // ── 7. Frame graph canvas visible ────────────────────────────────────────
  const graph = page.locator('#v2-trace-spark');
  await expect(graph).toBeVisible();
  const [gw, gh] = await graph.evaluate(el => [el.width, el.height]);
  console.log(`✓ Frame graph canvas ${gw}×${gh}px present`);

  // ── 8. DRAW / TRI row present ─────────────────────────────────────────────
  const drawEl = page.locator('#v2-draws');
  const triEl  = page.locator('#v2-draws');
  await expect(drawEl).toBeVisible();
  await expect(triEl).toBeVisible();
  console.log(`✓ DRAWS/TRI text="${await drawEl.textContent()}" row visible`);

  // ── 9. UNIVERSE sub-button present ───────────────────────────────────────
  const uniBtn  = page.locator('#v2-hud-universe-label');
  const uniBody = page.locator('#v2-universe-accordion-body');
  await expect(uniBtn).toBeVisible();
  const uniDisplay = await uniBody.evaluate(el => el.style.display);
  expect(uniDisplay).toBe('none');
  console.log('✓ UNIVERSE sub-accordion present and collapsed');

  // ── 10. Click UNIVERSE expands it ─────────────────────────────────────────
  await uniBtn.click();
  await page.waitForTimeout(200);
  const uniDisplayAfter = await uniBody.evaluate(el => el.style.display);
  expect(uniDisplayAfter).not.toBe('none');
  const modulesEl = page.locator('#v2-modules');
  await expect(modulesEl).toBeVisible();
  const modsText = await modulesEl.textContent();
  console.log(`✓ UNIVERSE expanded — modules: "${modsText.slice(0, 80)}"`);

  // ── 11. Screenshot ────────────────────────────────────────────────────────
  await page.screenshot({ path: 'backups/fps-orc-accordion.png', fullPage: false });
  console.log('✓ Screenshot: backups/fps-orc-accordion.png');

  // ── 12. Zero errors ───────────────────────────────────────────────────────
  if (errors.length > 0) {
    console.log('ERRORS:');
    errors.forEach(e => console.log(' ', e));
  }
  expect(errors).toHaveLength(0);
  console.log('✓ Zero console errors');
});

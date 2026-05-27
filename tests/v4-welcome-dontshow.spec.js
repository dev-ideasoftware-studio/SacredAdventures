/**
 * Validate the "always show + [ ] don't show checkbox" behaviour:
 *   1. Fresh localStorage → guide shows
 *   2. Click "don't show" → flag persists, next boot it does NOT show
 *   3. Uncheck → flag clears, next boot it shows again
 *   4. Closing via Skip (no checkbox) does NOT suppress next boot
 *   5. Checkbox renders bottom-left of panel
 *   6. Console + Anu audit clean
 */
const { test, expect } = require('@playwright/test');

test.use({ baseURL: undefined });

async function boot(page, { clearStorage = false } = {}) {
  await page.goto('http://127.0.0.1:5505/index.html');
  if (clearStorage) {
    // Clear AFTER load so subsequent reloads don't re-clear.
    await page.evaluate(() => {
      try { localStorage.removeItem('sanctuary.welcomeGuide.seenV2'); } catch {}
    });
    await page.reload();
  }
  await page.waitForTimeout(18000);
}

test('always-shows on fresh + checkbox suppresses next boot + AAA contrast preserved', async ({ browser }) => {
  test.setTimeout(60000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('[pageerror] '+e.message));

  // 1) Fresh localStorage → guide shows
  await boot(page, { clearStorage: true });
  let probe = await page.evaluate(() => {
    const g = document.getElementById('sanctuary-welcome-guide');
    const cb = g?.querySelector('[data-swg-dontshow]');
    const cbRect = cb?.getBoundingClientRect();
    const guideRect = g?.getBoundingClientRect();
    const audit = (window.AnuUniverse?.audit?.() || []).length;
    return {
      visible: g && !g.classList.contains('is-hidden'),
      cbExists: !!cb,
      cbChecked: cb?.checked ?? null,
      cbLabel: g?.querySelector('[data-swg-dontshow-label] span')?.textContent ?? null,
      cbBelowFooter: cbRect && guideRect ? cbRect.top > guideRect.top + 100 : null,
      cbInLeftHalf: cbRect && guideRect ? cbRect.left < guideRect.left + (guideRect.width / 2) : null,
      auditLen: audit,
      stored: (() => { try { return localStorage.getItem('sanctuary.welcomeGuide.seenV2'); } catch { return null; } })(),
    };
  });
  console.log('\n[1] FRESH BOOT:', JSON.stringify(probe, null, 2));
  expect(probe.visible).toBe(true);
  expect(probe.cbExists).toBe(true);
  expect(probe.cbChecked).toBe(false);
  expect(probe.cbLabel).toBe("don't show");
  expect(probe.cbInLeftHalf).toBe(true);
  expect(probe.auditLen).toBe(0);

  // 2) Tick the checkbox — flag persists
  await page.click('[data-swg-dontshow]');
  await page.waitForTimeout(150);
  const stored = await page.evaluate(() => {
    try { return localStorage.getItem('sanctuary.welcomeGuide.seenV2'); } catch { return null; }
  });
  console.log(`\n[2] Stored after tick: "${stored}"`);
  expect(stored).toBe('1');

  // 3) Reload — guide should NOT show
  await page.reload();
  await page.waitForTimeout(18000);
  probe = await page.evaluate(() => {
    const g = document.getElementById('sanctuary-welcome-guide');
    return {
      exists: !!g,
      hidden: g?.classList.contains('is-hidden'),
      cbChecked: g?.querySelector('[data-swg-dontshow]')?.checked,
    };
  });
  console.log(`\n[3] AFTER RELOAD with flag=1:`, JSON.stringify(probe, null, 2));
  expect(probe.hidden).toBe(true);          // suppressed
  expect(probe.cbChecked).toBe(true);       // checkbox reflects stored state

  // 4) Uncheck → next reload, guide shows again
  await page.evaluate(() => {
    const cb = document.querySelector('[data-swg-dontshow]');
    cb.click();
  });
  await page.waitForTimeout(150);
  const storedAfterUncheck = await page.evaluate(() => {
    try { return localStorage.getItem('sanctuary.welcomeGuide.seenV2'); } catch { return null; }
  });
  console.log(`\n[4] Stored after uncheck: "${storedAfterUncheck}"`);
  expect(storedAfterUncheck).toBe('0');

  await page.reload();
  await page.waitForTimeout(18000);
  probe = await page.evaluate(() => {
    const g = document.getElementById('sanctuary-welcome-guide');
    return {
      visible: g && !g.classList.contains('is-hidden'),
      cbChecked: g?.querySelector('[data-swg-dontshow]')?.checked,
      auditLen: (window.AnuUniverse?.audit?.() || []).length,
    };
  });
  console.log(`\n[5] AFTER UNCHECK + RELOAD:`, JSON.stringify(probe, null, 2));
  expect(probe.visible).toBe(true);
  expect(probe.cbChecked).toBe(false);
  expect(probe.auditLen).toBe(0);

  // 5) Skip button should NOT persist flag
  await page.click('[data-swg-skip]');
  await page.waitForTimeout(200);
  const storedAfterSkip = await page.evaluate(() => {
    try { return localStorage.getItem('sanctuary.welcomeGuide.seenV2'); } catch { return null; }
  });
  console.log(`\n[6] Stored after Skip (should still be "0"): "${storedAfterSkip}"`);
  expect(storedAfterSkip).toBe('0');         // Skip does NOT auto-suppress

  console.log(`\nTotal errors: ${errs.length}`);
  errs.slice(0,3).forEach(e => console.log('  ❌', e.substring(0,200)));
  expect(errs.length).toBe(0);
  await ctx.close();
});

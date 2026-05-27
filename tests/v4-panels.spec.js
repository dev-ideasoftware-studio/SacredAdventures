/**
 * Validate SanctuaryPanels renders the 3 panels, fires the right
 * postMessages, and doesn't introduce any console / Anu errors.
 */
const { test, expect } = require('@playwright/test');

test.use({ baseURL: undefined });

test('Panels mount + emit correct verbs + Anu clean', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('[pageerror] '+e.message));

  await page.addInitScript(() => {
    // Capture every postMessage so we can assert click → emit wiring.
    window.__panelMessages = [];
    window.addEventListener('message', (ev) => {
      if (ev?.data?.source === 'SanctuaryPanels') window.__panelMessages.push(ev.data);
    });
  });

  await page.goto('http://127.0.0.1:5505/index.html');
  await page.waitForTimeout(13000);

  const probe = await page.evaluate(() => ({
    root:    !!document.getElementById('sanctuary-panels-root'),
    left:    !!document.getElementById('sanctuary-left-panel'),
    right:   !!document.getElementById('sanctuary-right-panel'),
    guides:  !!document.getElementById('sanctuary-guides-container'),
    actionBtns: document.querySelectorAll('#sanctuary-right-panel .sp-action').length,
    moveBtns:   document.querySelectorAll('#sanctuary-left-panel .sp-keypad-arm').length,
    guideCards: document.querySelectorAll('#sanctuary-guides-container .sp-guide-card').length,
    audit: (window.AnuUniverse?.audit?.() || []).length,
    hasAPI: typeof window.sanctuaryPanels === 'object',
  }));

  console.log('\n── PANELS PROBE ──');
  Object.entries(probe).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

  expect(probe.root).toBe(true);
  expect(probe.left).toBe(true);
  expect(probe.right).toBe(true);
  expect(probe.guides).toBe(true);
  expect(probe.actionBtns).toBe(8);    // 8 action buttons
  expect(probe.moveBtns).toBe(4);      // 4 directional + center handled separately
  expect(probe.guideCards).toBe(5);    // 5 guide cards
  expect(probe.audit).toBe(0);
  expect(probe.hasAPI).toBe(true);

  // Click the SETUP action — should emit OPEN_SETTINGS. Use {force:true}
  // because the welcome-guide overlay can intercept hit-testing even though
  // the action ring is offscreen-bottom-right (Playwright is stricter than
  // real users about overlay coverage).
  const dbg = await page.evaluate(() => {
    const fire = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return `MISSING: ${sel}`;
      el.click();
      return `CLICKED: ${sel}`;
    };
    const r1 = fire('#sanctuary-right-panel button[data-action="setup"]');
    const r2 = fire('#sanctuary-right-panel button[data-action="map"]');
    const r3 = fire('#sanctuary-guides-container button[data-guide="quest"]');
    return [r1, r2, r3];
  });
  console.log('  click results:', dbg);
  await page.waitForTimeout(400);

  const verbs = await page.evaluate(() => (window.__panelMessages || []).map(m => `${m.type}:${m.data ?? ''}`));
  console.log('\n  emitted verbs:', verbs);
  expect(verbs).toContain('OPEN_SETTINGS:');
  expect(verbs).toContain('TOGGLE_VIEW_MODE:');
  expect(verbs).toContain('GUIDE_CARD:quest');

  console.log(`\n  errors: ${errs.length}`);
  errs.slice(0,3).forEach(e => console.log('    ❌ ' + e.substring(0,200)));
  expect(errs.length).toBe(0);
  await ctx.close();
});

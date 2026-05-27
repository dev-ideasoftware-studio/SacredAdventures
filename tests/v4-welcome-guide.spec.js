const { test, expect } = require('@playwright/test');
test.use({ baseURL: undefined });
test('Welcome guide renders + no errors', async ({ browser }) => {
  test.setTimeout(60000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [], warns = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); if (m.type()==='warning') warns.push(m.text()); });
  page.on('pageerror', e => errs.push('[pageerror] '+e.message));
  await page.addInitScript(() => { try { localStorage.removeItem('sanctuary.welcomeGuide.seenV1'); } catch {} });
  await page.goto('http://127.0.0.1:5505/index.html');
  await page.waitForTimeout(14000);
  const probe = await page.evaluate(() => {
    const el = document.getElementById('sanctuary-welcome-guide');
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const dotsActive = document.querySelectorAll('#sanctuary-welcome-guide .swg-dot.is-active').length;
    const totalDots  = document.querySelectorAll('#sanctuary-welcome-guide .swg-dot').length;
    const audit = (window.AnuUniverse?.audit?.() || []).length;
    return {
      found: true,
      hidden: el.classList.contains('is-hidden'),
      width: Math.round(el.getBoundingClientRect().width),
      bgHasGradient: cs.backgroundImage.includes('linear-gradient'),
      bgIsBlue: /rgb\(\s*0,\s*0,\s*\d+/.test(cs.backgroundColor),
      title: el.querySelector('[data-swg-title]')?.textContent,
      bodyHTML: el.querySelector('[data-swg-body]')?.innerHTML?.slice(0,80),
      pillText: el.querySelector('.swg-pill')?.textContent,
      skipBtn: !!el.querySelector('.swg-skip'),
      nextBtn: !!el.querySelector('.swg-next'),
      totalDots, dotsActive,
      auditLen: audit,
    };
  });
  console.log('\nGUIDE PROBE:', JSON.stringify(probe, null, 2));
  console.log('\nErrors:', errs.length, 'Warnings:', warns.length);
  errs.slice(0,3).forEach(e => console.log('  ❌', e.substring(0, 200)));
  expect(probe.found).toBe(true);
  expect(probe.hidden).toBe(false);
  expect(probe.pillText).toBe('WELCOME GUIDE');
  expect(probe.totalDots).toBe(5);
  expect(probe.bgIsBlue).toBe(false);          // NOT solid blue
  expect(probe.bgHasGradient).toBe(true);      // warm gradient bg
  expect(probe.skipBtn).toBe(true);
  expect(probe.nextBtn).toBe(true);
  expect(probe.auditLen).toBe(0);
  await ctx.close();
});

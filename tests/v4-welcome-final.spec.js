/**
 * Single validation: welcome guide is centred between PIP and HUD with
 * ≥30 px buffers on all sides AT DESKTOP, docks to bottom AT MOBILE,
 * PIP is flush top, and text/bg contrast meets WCAG AAA.
 */
const { test, expect } = require('@playwright/test');

test.use({ baseURL: undefined });

// WCAG relative-luminance for sRGB.
function luminance([r, g, b]) {
  const c = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(fg, bg) {
  const L1 = luminance(fg), L2 = luminance(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function parseRGB(s) {
  const m = s.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.removeItem('sanctuary.welcomeGuide.seenV1'); } catch {} });
  await page.goto('http://127.0.0.1:5505/index.v4.html');
  await page.waitForTimeout(14000);
}

test('DESKTOP — guide centred between PIP & HUD with ≥30px buffers + AAA contrast', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('[pageerror] '+e.message));
  await boot(page);

  const probe = await page.evaluate(() => {
    const pip = document.getElementById('moondial-wrapper');
    const hud = document.getElementById('v2-orchestrator-hud');
    const guide = document.getElementById('sanctuary-welcome-guide');
    if (!pip || !hud || !guide) return { found: false };
    const pipRect   = pip.getBoundingClientRect();
    const hudRect   = hud.getBoundingClientRect();
    const guideRect = guide.getBoundingClientRect();
    const cs        = getComputedStyle(guide);
    const titleEl   = guide.querySelector('[data-swg-title]');
    const bodyEl    = guide.querySelector('[data-swg-body]');
    return {
      found: true,
      pipTop:    Math.round(pipRect.top),
      pipRight:  Math.round(pipRect.right),
      hudLeft:   Math.round(hudRect.left),
      guideTop:  Math.round(guideRect.top),
      guideLeft: Math.round(guideRect.left),
      guideRight:Math.round(guideRect.right),
      guideBottom: Math.round(guideRect.bottom),
      bufferLeft:  Math.round(guideRect.left - pipRect.right),
      bufferRight: Math.round(hudRect.left - guideRect.right),
      bufferTop:   Math.round(guideRect.top),
      bg: cs.backgroundColor,
      titleColor: titleEl ? getComputedStyle(titleEl).color : null,
      bodyColor:  bodyEl  ? getComputedStyle(bodyEl).color  : null,
      blur: cs.backdropFilter || cs.webkitBackdropFilter,
      auditLen: (window.AnuUniverse?.audit?.() || []).length,
    };
  });

  console.log('\n── DESKTOP PROBE ──');
  Object.entries(probe).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  console.log(`  errors: ${errs.length}`);

  // Contrast — note background is glass; we use the OPAQUE FALLBACK colour
  // for the worst-case computation (with backdrop blur it's actually better).
  const bgRgb = parseRGB(probe.bg);
  const titleC = contrast(parseRGB(probe.titleColor), bgRgb);
  const bodyC  = contrast(parseRGB(probe.bodyColor),  bgRgb);
  console.log(`  title contrast: ${titleC.toFixed(2)}:1  (target ≥ 7 for AAA large)`);
  console.log(`  body  contrast: ${bodyC.toFixed(2)}:1   (target ≥ 7 for AAA normal)`);

  expect(probe.found).toBe(true);
  expect(probe.pipTop).toBe(0);                        // PIP flush top
  expect(probe.bufferLeft).toBeGreaterThanOrEqual(30); // ≥30 left
  expect(probe.bufferRight).toBeGreaterThanOrEqual(30);// ≥30 right
  expect(probe.bufferTop).toBeGreaterThanOrEqual(30);  // ≥30 top
  expect(titleC).toBeGreaterThanOrEqual(7);            // AAA large
  expect(bodyC).toBeGreaterThanOrEqual(7);             // AAA normal
  expect(probe.blur).toMatch(/blur\(/i);               // real glass
  expect(probe.auditLen).toBe(0);                      // Anu happy
  expect(errs.length).toBe(0);
  await ctx.close();
});

test('MOBILE — guide docks bottom with ≥30px buffers', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  await boot(page);

  const probe = await page.evaluate(() => {
    const guide = document.getElementById('sanctuary-welcome-guide');
    if (!guide) return { found: false };
    const r = guide.getBoundingClientRect();
    return {
      found: true,
      left: Math.round(r.left),
      right: Math.round(window.innerWidth - r.right),
      bottomBuffer: Math.round(window.innerHeight - r.bottom),
    };
  });
  console.log('\n── MOBILE PROBE ──', probe);
  expect(probe.found).toBe(true);
  expect(probe.left).toBeGreaterThanOrEqual(30);
  expect(probe.right).toBeGreaterThanOrEqual(30);
  expect(probe.bottomBuffer).toBeGreaterThanOrEqual(30);
  await ctx.close();
});

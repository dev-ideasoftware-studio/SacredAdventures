/**
 * Full validation: boot → console capture → consult Anu.
 * Implements user mandate. Captures Anu's console output during query
 * AND inspects the public Anu API surfaces.
 */
const { test } = require('@playwright/test');

test.use({ baseURL: undefined });

test('v4 sanctuary — boot + console + Anu universe check', async ({ page }) => {
  const errors = [], warnings = [], network404 = [];
  const anuConsole = [];
  let anuConsoleEnabled = false;

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(text);
    if (msg.type() === 'warning') warnings.push(text);
    // After boot we'll start capturing Anu's output
    if (anuConsoleEnabled) anuConsole.push(`[${msg.type()}] ${text.slice(0, 240)}`);
  });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('response', r => { if (r.status() === 404) network404.push(r.url()); });

  await page.goto('http://127.0.0.1:5505/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  v4 — BOOT + CONSOLE + ANU CHECK                     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log(`ERRORS:    ${errors.length}`);
  errors.forEach(e => console.log('  ❌ ' + e.substring(0, 300)));
  console.log(`WARNINGS:  ${warnings.length}`);
  warnings.forEach(w => console.log('  ⚠️  ' + w.substring(0, 300)));
  console.log(`404s:      ${network404.length}`);
  network404.forEach(u => console.log('  🔴 ' + u));

  // ── Inspect Anu surfaces ──────────────────────────────────────────
  console.log('\n────────────────────────────────────────');
  console.log(' 🕊  ANU SURFACE INSPECTION');
  console.log('────────────────────────────────────────\n');

  const surfaces = await page.evaluate(() => {
    const inspect = (obj) => {
      if (!obj) return null;
      const keys = [];
      try { for (const k of Object.keys(obj)) keys.push(`${k}:${typeof obj[k]}`); } catch {}
      return keys;
    };
    return {
      AnuUniverse: inspect(window.AnuUniverse),
      anuOrchestrator: inspect(window.anuOrchestrator),
      hasHelp: typeof window.AnuUniverse?.help === 'function',
      hasReport: typeof window.AnuUniverse?.report === 'function',
    };
  });

  console.log(`AnuUniverse.help() exists?   ${surfaces.hasHelp ? '✅' : '❌'}`);
  console.log(`AnuUniverse.report() exists? ${surfaces.hasReport ? '✅' : '❌'}`);
  console.log(`\nAnuUniverse keys (${surfaces.AnuUniverse?.length || 0}):`);
  (surfaces.AnuUniverse || []).slice(0, 30).forEach(k => console.log('    ' + k));
  console.log(`\nanuOrchestrator keys (${surfaces.anuOrchestrator?.length || 0}):`);
  (surfaces.anuOrchestrator || []).slice(0, 30).forEach(k => console.log('    ' + k));

  // ── Now actually CALL Anu and capture console output ──────────────
  anuConsoleEnabled = true;
  anuConsole.length = 0;
  await page.evaluate(() => {
    try { window.AnuUniverse?.report?.(); } catch (e) { console.error('AnuUniverse.report() threw:', e.message); }
    try { window.anuOrchestrator?.report?.(); } catch (e) { console.error('anuOrchestrator.report() threw:', e.message); }
  });
  await page.waitForTimeout(800);
  anuConsoleEnabled = false;

  console.log('\n────────────────────────────────────────');
  console.log(' 🕊  ANU SAYS (console output from .report() calls)');
  console.log('────────────────────────────────────────\n');
  if (anuConsole.length === 0) {
    console.log('  (no console output from Anu calls)');
  } else {
    anuConsole.slice(0, 80).forEach(l => console.log('  │ ' + l));
  }

  console.log('\n────────────────────────────────────────\n');
});

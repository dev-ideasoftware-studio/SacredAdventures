/**
 * v2-console.spec.js
 * Boot index.v2.html in a headless Chromium, collect every console message
 * and network failure for 15 seconds, then report. No assertions — pure
 * signal capture so we can see exactly what the browser sees on boot.
 */
const { test, expect } = require('@playwright/test');

test('v2 sanctuary — console + network audit (15 s boot window)', async ({ page }) => {
  const errors   = [];
  const warnings = [];
  const infos    = [];
  const network404 = [];
  const networkFail = [];

  // Capture all console output
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error')        errors.push(text);
    else if (type === 'warning') warnings.push(text);
    else                         infos.push(`[${type}] ${text}`);
  });

  // Capture uncaught page errors
  page.on('pageerror', err => {
    errors.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
  });

  // Capture network failures
  page.on('response', resp => {
    if (resp.status() === 404) network404.push(`404 → ${resp.url()}`);
  });
  page.on('requestfailed', req => {
    networkFail.push(`FAIL → ${req.url()} (${req.failure()?.errorText || '?'})`);
  });

  await page.goto('/index.v2.html', { waitUntil: 'domcontentloaded' });

  // Wait 15 s for the orchestrator + all modules to boot
  await page.waitForTimeout(15000);

  // ── Print full report ─────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  v2 SANCTUARY CONSOLE AUDIT                          ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log(`ERRORS   (${errors.length}):`);
  errors.forEach(e => console.log('  ❌ ' + e.substring(0, 300)));

  console.log(`\nWARNINGS (${warnings.length}):`);
  warnings.forEach(w => console.log('  ⚠️  ' + w.substring(0, 300)));

  console.log(`\n404s     (${network404.length}):`);
  network404.forEach(n => console.log('  🔴 ' + n));

  console.log(`\nNET FAIL (${networkFail.length}):`);
  networkFail.forEach(n => console.log('  💀 ' + n));

  console.log(`\nINFO     (${infos.length} messages — last 20):`);
  infos.slice(-20).forEach(i => console.log('  ℹ️  ' + i.substring(0, 200)));

  console.log('\nAudit complete.\n');
});

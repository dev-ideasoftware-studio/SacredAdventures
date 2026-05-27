/**
 * v4-console.spec.js
 * Boot index.html in a headless Chromium, collect every console message
 * and network failure for 12 seconds, then report. No assertions — pure
 * signal capture so we can see exactly what the browser sees on boot.
 */
const { test, expect } = require('@playwright/test');

test('v4 sanctuary — console + network audit (12 s boot window)', async ({ page }) => {
  const errors   = [];
  const warnings = [];
  const infos    = [];
  const network404 = [];
  const networkFail = [];
  const pageCrash  = [];

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

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

  // Wait 12 s for the orchestrator + all modules to boot
  await page.waitForTimeout(12000);

  // ── Print full report ─────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  v4 SANCTUARY CONSOLE AUDIT                          ║');
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

  // Fail the test only if there are hard errors or 404s on critical assets
  const criticalErrors = errors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('ERR_NAME_NOT_RESOLVED') // offline CDN misses are expected
  );
  const critical404s = network404.filter(u =>
    !u.includes('favicon') &&
    (u.includes('.js') || u.includes('.glb') || u.includes('.html'))
  );

  if (criticalErrors.length > 0 || critical404s.length > 0) {
    throw new Error(
      `Boot failures:\n` +
      criticalErrors.map(e => '  ERROR: ' + e.substring(0, 200)).join('\n') + '\n' +
      critical404s.map(n => '  404:   ' + n).join('\n')
    );
  }

  console.log('\n✅ No critical errors or 404s — sanctuary boots clean.\n');
});

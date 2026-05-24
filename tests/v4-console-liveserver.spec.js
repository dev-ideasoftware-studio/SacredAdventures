/**
 * Audit the user's live-server at 127.0.0.1:5505/index.v4.html (NOT the
 * Playwright-managed Python server). 12 s boot window, full console capture.
 *
 * Run with no webServer override; we hit an external URL.
 */
const { test } = require('@playwright/test');

test.use({ baseURL: undefined });

test('v4 sanctuary — live-server console audit (5505)', async ({ page }) => {
  const errors    = [];
  const warnings  = [];
  const infos     = [];
  const network404 = [];
  const networkFail = [];

  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error')        errors.push(text);
    else if (type === 'warning') warnings.push(text);
    else                         infos.push(`[${type}] ${text}`);
  });
  page.on('pageerror', err => {
    errors.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
  });
  page.on('response', resp => {
    if (resp.status() === 404) network404.push(`404 → ${resp.url()}`);
  });
  page.on('requestfailed', req => {
    networkFail.push(`FAIL → ${req.url()} (${req.failure()?.errorText || '?'})`);
  });

  await page.goto('http://127.0.0.1:5505/index.v4.html', {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForTimeout(12000);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  v4 LIVE-SERVER (5505) CONSOLE AUDIT                 ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log(`ERRORS   (${errors.length}):`);
  errors.forEach(e => console.log('  ❌ ' + e.substring(0, 400)));

  console.log(`\nWARNINGS (${warnings.length}):`);
  warnings.forEach(w => console.log('  ⚠️  ' + w.substring(0, 400)));

  console.log(`\n404s     (${network404.length}):`);
  network404.forEach(n => console.log('  🔴 ' + n));

  console.log(`\nNET FAIL (${networkFail.length}):`);
  networkFail.forEach(n => console.log('  💀 ' + n));

  console.log(`\nINFO     (${infos.length} messages — last 12):`);
  infos.slice(-12).forEach(i => console.log('  ℹ️  ' + i.substring(0, 220)));

  const criticalErrors = errors.filter(e => !e.includes('favicon'));
  const critical404s = network404.filter(u =>
    !u.includes('favicon') &&
    (u.includes('.js') || u.includes('.glb') || u.includes('.html') ||
     u.includes('.wasm') || u.includes('.mp4'))
  );

  if (criticalErrors.length > 0 || critical404s.length > 0) {
    throw new Error(
      `Live-server failures:\n` +
      criticalErrors.map(e => '  ERROR: ' + e.substring(0, 200)).join('\n') + '\n' +
      critical404s.map(n => '  404:   ' + n).join('\n')
    );
  }

  console.log('\n✅ Live-server boots clean — no critical errors or 404s.\n');
});

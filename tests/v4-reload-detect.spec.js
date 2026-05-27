/**
 * Detect if the v4 sanctuary page reloads itself. Watches for 45 s.
 * Counts every `framenavigated` event on the main frame.
 * If we see > 1 main-frame navigation after the initial goto, it's reloading.
 */
const { test } = require('@playwright/test');

test.use({ baseURL: undefined });

test('v4 sanctuary — reload-loop detector (45 s watch)', async ({ page }) => {
  const navigations = [];
  const errors = [];

  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      navigations.push({ at: Date.now(), url: frame.url() });
    }
  });
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
  });

  const start = Date.now();
  await page.goto('http://127.0.0.1:5505/index.html', {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForTimeout(45000);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  RELOAD DETECTOR — 45 s watch                        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log(`Main-frame navigations: ${navigations.length}`);
  navigations.forEach((n, i) => {
    const t = ((n.at - start) / 1000).toFixed(1);
    console.log(`  [${i + 1}] +${t}s → ${n.url}`);
  });

  console.log(`\nErrors during window: ${errors.length}`);
  errors.slice(0, 10).forEach(e => console.log('  ❌ ' + e.substring(0, 200)));

  // 1 navigation = initial load only (expected). >1 = reload loop.
  if (navigations.length > 1) {
    throw new Error(
      `RELOAD LOOP DETECTED: ${navigations.length} navigations in 45 s. ` +
      `Spacing: ${navigations.slice(1).map((n, i) =>
        `${((n.at - navigations[i].at) / 1000).toFixed(1)}s`).join(', ')}`,
    );
  }

  console.log('\n✅ No reload loop — single navigation only.\n');
});

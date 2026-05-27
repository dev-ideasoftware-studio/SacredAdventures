const { test } = require('@playwright/test');

test('v4 Tipi Draco Diagnosis', async ({ page }) => {
  page.on('console', msg => {
    console.log(`[Browser Console] [${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.error('Page error:', err.message, err.stack);
  });

  console.log("Navigating to root index.html...");
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(8000);
});

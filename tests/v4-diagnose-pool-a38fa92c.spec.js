const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.use({ baseURL: undefined });

test('diagnostic audit for v4 pool', async ({ page }) => {
  const errors = [];
  const warnings = [];
  const logs = [];

  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    logs.push({ type, text });
    if (type === 'error') {
      errors.push(text);
    } else if (type === 'warning') {
      warnings.push(text);
    }
  });

  page.on('pageerror', err => {
    errors.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
  });

  console.log("Navigating to http://127.0.0.1:5505/index.v4.html...");
  await page.goto('http://127.0.0.1:5505/index.v4.html', { waitUntil: 'load' });

  console.log("Waiting 6 seconds...");
  await page.waitForTimeout(6000);

  console.log("Checking window.__consoleErrors, iframe status and state...");
  const pageResult = await page.evaluate(() => {
    const ifr = document.getElementById('v4-loading-iframe');
    const welcome = document.getElementById('sanctuary-welcome-guide');
    return {
      windowErrors: window.__consoleErrors || [],
      waterY: window.__sanctuaryWaterY,
      timeUniform: window._poolTimeUniform ? window._poolTimeUniform.value : null,
      iframeExists: !!ifr,
      iframeOpacity: ifr ? window.getComputedStyle(ifr).opacity : null,
      iframePointerEvents: ifr ? window.getComputedStyle(ifr).pointerEvents : null,
      welcomeExists: !!welcome,
      welcomeOpacity: welcome ? window.getComputedStyle(welcome).opacity : null,
      welcomeHiddenClass: welcome ? welcome.classList.contains('is-hidden') : null
    };
  });

  console.log("Page evaluations:", JSON.stringify(pageResult, null, 2));

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);

  const screenshotPath = '/Users/Me/.gemini/antigravity/brain/a38fa92c-a9c8-4756-8f87-37cad531f0b2/screenshot.png';
  console.log(`Taking screenshot...`);
  await page.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  const results = {
    errors,
    warnings,
    logs,
    pageResult,
    screenshotPath
  };

  const reportPath = '/Users/Me/.gemini/antigravity/brain/a38fa92c-a9c8-4756-8f87-37cad531f0b2/diagnostic_report.json';
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log("Diagnostic report written successfully.");
});

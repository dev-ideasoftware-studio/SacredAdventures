const { test, expect } = require('@playwright/test');

test('screenshot trees and check errors', async ({ page }) => {
  console.log("Navigating to http://127.0.0.1:5505/index.html...");
  await page.goto('http://127.0.0.1:5505/index.html');
  
  console.log("Waiting 6 seconds...");
  await page.waitForTimeout(6000);
  
  console.log("Evaluating window.__consoleErrors...");
  const errors = await page.evaluate(() => {
    return window.__consoleErrors || [];
  });
  console.log("Errors:", JSON.stringify(errors, null, 2));
  
  console.log("Taking screenshot...");
  await page.screenshot({ path: (require('fs').mkdirSync('test-results', { recursive: true }), require('path').join('test-results', 'screenshot.png')) });
  console.log("Screenshot saved!");
});

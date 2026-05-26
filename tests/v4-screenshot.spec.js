const { test, expect } = require('@playwright/test');

test('screenshot trees and check errors', async ({ page }) => {
  console.log("Navigating to http://127.0.0.1:5505/index.v4.html...");
  await page.goto('http://127.0.0.1:5505/index.v4.html');
  
  console.log("Waiting 6 seconds...");
  await page.waitForTimeout(6000);
  
  console.log("Evaluating window.__consoleErrors...");
  const errors = await page.evaluate(() => {
    return window.__consoleErrors || [];
  });
  console.log("Errors:", JSON.stringify(errors, null, 2));
  
  console.log("Taking screenshot...");
  await page.screenshot({ path: '/Users/Me/.gemini/antigravity/brain/7a17a1b8-29f9-4806-bb89-615712158a57/screenshot.png' });
  console.log("Screenshot saved!");
});

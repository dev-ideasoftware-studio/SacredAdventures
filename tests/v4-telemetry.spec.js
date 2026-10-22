const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('sanctuary pool telemetry and screenshot check', async ({ page }) => {
  const errors = [];
  const warnings = [];
  const telemetryLogs = [];
  const allLogs = [];

  // Capture all console output
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    allLogs.push({ type, text });

    if (type === 'error') {
      errors.push(text);
    } else if (type === 'warning') {
      warnings.push(text);
    }

    if (text.includes('[Telemetry]')) {
      telemetryLogs.push(text);
    }
  });

  // Capture uncaught page errors
  page.on('pageerror', err => {
    errors.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
  });

  console.log("Navigating to http://127.0.0.1:5505/index.html...");
  await page.goto('http://127.0.0.1:5505/index.html', { waitUntil: 'load' });

  console.log("Waiting 8 seconds for fully loading...");
  await page.waitForTimeout(8000);

  // Take high-res screenshot
  const screenshotPath = (require('fs').mkdirSync('test-results', { recursive: true }), require('path').join('test-results', 'sanctuary_pool_highres.png'));
  console.log(`Taking high-res screenshot...`);
  
  // Set larger viewport just in case and take screenshot
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ 
    path: screenshotPath,
    fullPage: false
  });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  // Write logs out to a file so the node runner can capture it
  const reportPath = (require('fs').mkdirSync('test-results', { recursive: true }), require('path').join('test-results', 'telemetry-results.json'));
  const reportData = {
    errors,
    warnings,
    telemetryLogs,
    allLogs,
    screenshotPath
  };
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log("Telemetry results written to scratch successfully.");

  // Output summary to stdout so it appears in the task log
  console.log("--- TELEMETRY TEST SUMMARY ---");
  console.log(`Errors found: ${errors.length}`);
  console.log(`Warnings found: ${warnings.length}`);
  console.log(`Telemetry logs captured: ${telemetryLogs.length}`);
  telemetryLogs.forEach(log => console.log(`  ${log}`));
});

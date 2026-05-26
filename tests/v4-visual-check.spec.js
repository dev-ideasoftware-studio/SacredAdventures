const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('Visual check of restored terrain and animated water ripples', async ({ page }) => {
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

    if (text.includes('[Telemetry]') || text.includes('[Performance]') || text.includes('[Loader]')) {
      telemetryLogs.push(text);
    }
  });

  // Capture uncaught page errors
  page.on('pageerror', err => {
    errors.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
  });

  console.log("Navigating to http://127.0.0.1:5505/index.v4.html...");
  await page.goto('http://127.0.0.1:5505/index.v4.html', { waitUntil: 'load' });

  console.log("Waiting 7 seconds for the scene to fully load and compile...");
  await page.waitForTimeout(7000);

  // Set high-resolution viewport (1920x1080)
  console.log("Setting viewport to 1920x1080...");
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Wait a small moment for rendering to catch up to the viewport change
  await page.waitForTimeout(500);

  const screenshotPath = '/Users/Me/.gemini/antigravity/brain/407e6ee5-54c9-49b6-ab39-abd82ab17b24/screenshot_v4.png';
  console.log(`Taking high-resolution (1920x1080) screenshot...`);
  await page.screenshot({ 
    path: screenshotPath,
    fullPage: false
  });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  // Write logs out to a file in the brain folder
  const reportPath = '/Users/Me/.gemini/antigravity/brain/407e6ee5-54c9-49b6-ab39-abd82ab17b24/telemetry_logs.json';
  const reportData = {
    errors,
    warnings,
    telemetryLogs,
    allLogs,
    screenshotPath
  };
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log("Telemetry logs written to brain folder successfully.");

  // Output summary to stdout so it appears in the task log
  console.log("--- VISUAL CHECK SUMMARY ---");
  console.log(`Errors found: ${errors.length}`);
  console.log(`Warnings found: ${warnings.length}`);
  console.log(`Telemetry logs captured: ${telemetryLogs.length}`);
  
  if (errors.length > 0) {
    console.log("ERRORS DETECTED:");
    errors.forEach(err => console.log(`  - ${err}`));
  } else {
    console.log("No console errors verified!");
  }

  console.log("TELEMETRY LOG DETAILS:");
  telemetryLogs.forEach(log => console.log(`  ${log}`));
});

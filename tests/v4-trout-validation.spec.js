/**
 * tests/v4-trout-validation.spec.js
 * 
 * 1. Navigate to http://127.0.0.1:5505/index.html.
 * 2. Wait 12 seconds for the scene to boot and run.
 * 3. Capture all console errors and warnings (from console listeners, page errors, and window.__consoleErrors).
 * 4. Verify window.anuOrchestrator._activeModuleInstances.SanctuaryFishJumps is active and has no issues.
 * 5. Hide HUD panels / welcome guides to clear the view.
 * 6. Set up a beautiful cinematic camera view overlooking the pool and the fish dock.
 * 7. Manually trigger a gorgeous trout jump in the center of the pool next to the dock and capture it at the peak.
 * 8. Save the beautiful screenshot to the artifact directory.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.use({ baseURL: undefined });

test('Validate Sanctuary Trout Jumps, Console Errors and Take Beautiful Screenshot', async ({ page }) => {
  const errors = [];
  const warnings = [];
  const allLogs = [];

  // Capture all console output
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    allLogs.push({ type, text });
    if (type === 'error') {
      errors.push(`[console.error] ${text}`);
    } else if (type === 'warning') {
      warnings.push(`[console.warning] ${text}`);
    }
  });

  // Capture uncaught page errors
  page.on('pageerror', err => {
    errors.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
  });

  // 1. Navigate to the requested URL
  console.log("Navigating to http://127.0.0.1:5505/index.html...");
  await page.goto('http://127.0.0.1:5505/index.html', { waitUntil: 'load' });

  // 2. Wait 12 seconds for the scene to boot and run.
  console.log("Waiting 12 seconds for the scene to fully load, boot, and run...");
  await page.waitForTimeout(12000);

  // Set high-resolution viewport (1920x1080) for a beautiful shot
  console.log("Setting viewport to 1920x1080...");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);

  // 3. Capture all console errors and warnings. Check window.__consoleErrors or page errors.
  console.log("Extracting errors from window.__consoleErrors...");
  const windowErrors = await page.evaluate(() => {
    return window.__consoleErrors || [];
  });
  windowErrors.forEach(err => {
    errors.push(`[window.__consoleErrors] ${typeof err === 'object' ? JSON.stringify(err) : err}`);
  });

  // 4. Check that window.anuOrchestrator._activeModuleInstances.SanctuaryFishJumps is active and has no issues.
  console.log("Verifying SanctuaryFishJumps module active status and properties...");
  const fishJumpsStatus = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    if (!orc) return { exists: false, error: "window.anuOrchestrator not found" };
    
    const fishJumps = orc._activeModuleInstances?.SanctuaryFishJumps;
    if (!fishJumps) return { exists: false, error: "SanctuaryFishJumps module instance not found in _activeModuleInstances" };

    return {
      exists: true,
      name: fishJumps.name,
      active: !!fishJumps._root,
      elapsed: fishJumps._elapsed,
      nextJumpAtS: fishJumps._nextJumpAtS,
      hasActiveJump: !!fishJumps._active,
      waterY: fishJumps._waterY,
      keys: Object.keys(fishJumps)
    };
  });

  console.log("SanctuaryFishJumps module status:", JSON.stringify(fishJumpsStatus, null, 2));

  // 5. Hide HUD panels / welcome guides to clear the view.
  console.log("Dismissing HUD overlays...");
  await page.evaluate(() => {
    if (window.sanctuaryWelcome && typeof window.sanctuaryWelcome.close === 'function') {
      window.sanctuaryWelcome.close();
    }
    if (typeof window._v4SetPanelOpen === 'function') {
      window._v4SetPanelOpen(false);
    }
  });
  await page.waitForTimeout(500);

  // 6. Set up a beautiful cinematic camera view overlooking the pool and the fish dock.
  console.log("Configuring cinematic camera overlooking pool and dock...");
  await page.evaluate(() => {
    // Disable SanctuaryKeyboardLook from overriding the camera
    const kbd = window.anuOrchestrator?._activeModuleInstances?.SanctuaryKeyboardLook;
    if (kbd) {
      kbd._camera = null; // suspend camera overrides
    }
    // Set camera to look at the pool from a gorgeous angle!
    // Pool is at (0,0), radius 12. Dock tip is at (-6.6, 0).
    // Let's place the camera south-east of the pool looking at the center/dock area.
    const orc = window.anuOrchestrator;
    if (orc && orc.camera) {
      orc.camera.position.set(6, 4.5, -14); // elevated south-east view
      orc.camera.lookAt(-2.5, -0.2, 0); // look at the dock-to-center region
      orc.camera.fov = 42; // slightly zoomed-in lens for rich composition
      orc.camera.updateProjectionMatrix();
    }
  });
  await page.waitForTimeout(500);

  // 7. Manually trigger a gorgeous trout jump in the center of the pool next to the dock.
  console.log("Triggering beautiful trout jump next to the dock tip...");
  await page.evaluate(() => {
    const mod = window.anuOrchestrator?._activeModuleInstances?.SanctuaryFishJumps;
    if (mod) {
      mod._startJump();
      if (mod._active) {
        // Position jump right next to the dock
        mod._active.x = -5.5; // starts near dock tip
        mod._active.z = 0;
        mod._active.dirX = 4.0; // jumps eastwards towards center
        mod._active.dirZ = 0;
        mod._active.t0 = mod._elapsed; // Reset jump time anchor
        
        // Also force jumper mesh rotation to look realistic
        mod._active.mesh.position.set(mod._active.x, mod._waterY, mod._active.z);
      }
    }
  });

  // Wait 425 milliseconds for the fish jump to reach its peak (t = 0.5 where duration is 0.85s)
  console.log("Waiting 425 milliseconds for trout to reach its peak elevation in mid-air...");
  await page.waitForTimeout(425);

  // 8. Take a beautiful screenshot of the sanctuary pool scene
  const screenshotPath = '/Users/Me/.gemini/antigravity/brain/407e6ee5-54c9-49b6-ab39-abd82ab17b24/sanctuary_trout.png';
  console.log(`Taking high-resolution screenshot and saving to ${screenshotPath}...`);
  await page.screenshot({ 
    path: screenshotPath,
    fullPage: false
  });
  console.log("Screenshot taken and saved successfully!");

  // Output all logs/errors summaries
  console.log("\n--- CONSOLE ERRORS & WARNINGS SUMMARY ---");
  console.log(`Errors count: ${errors.length}`);
  errors.forEach(e => console.log(`  ❌ ${e}`));
  console.log(`Warnings count: ${warnings.length}`);
  warnings.forEach(w => console.log(`  ⚠️ ${w}`));
  console.log("-----------------------------------------\n");

  // Output verification assertions
  expect(fishJumpsStatus.exists).toBe(true);
  expect(fishJumpsStatus.active).toBe(true);
  
  // Save results data report as JSON to the artifact folder
  const resultsReportPath = '/Users/Me/.gemini/antigravity/brain/407e6ee5-54c9-49b6-ab39-abd82ab17b24/validation_results.json';
  const reportData = {
    fishJumpsStatus,
    errors,
    warnings,
    allLogs: allLogs.slice(-100), // last 100 logs
    screenshotPath
  };
  fs.writeFileSync(resultsReportPath, JSON.stringify(reportData, null, 2));
  console.log(`Validation results report saved to: ${resultsReportPath}`);
});

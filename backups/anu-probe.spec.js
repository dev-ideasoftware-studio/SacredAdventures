/**
 * backups/anu-probe.spec.js  — SCRATCH, not committed
 * Boots index.v4.html, waits for Anu to warm up, then calls
 * AnuUniverse.report() + anuOrchestrator.report() and captures all output.
 */
const { test } = require('@playwright/test');

test('Anu live report', async ({ page }) => {
  const lines = [];
  page.on('console', msg => {
    lines.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    lines.push(`[pageerror] ${err.message}`);
  });

  await page.goto('/index.v4.html', { waitUntil: 'domcontentloaded' });

  // Wait for Anu to fully boot (modules activate sequentially)
  await page.waitForFunction(
    () => window.AnuUniverse && window.AnuUniverse.isLiveSacredOrchestratorBound?.(),
    { timeout: 20000 }
  );

  // Let FPS EMA warm up a bit
  await page.waitForTimeout(3000);

  // Call report() — captures to console which we're intercepting above
  const report = await page.evaluate(() => {
    const result = {};

    try { result.audit     = AnuUniverse.audit(); }           catch(e) { result.auditErr = e.message; }
    try { result.rendering = AnuUniverse.rendering.getRenderingSnapshot(); } catch(e) { result.renderErr = e.message; }
    try { result.budget    = AnuUniverse.budget.snapshot(); } catch(e) { result.budgetErr = e.message; }
    try { result.sensorium = AnuUniverse.getWorldSensoriumSnapshot(); } catch(e) { result.sensorErr = e.message; }
    try { result.scene     = AnuUniverse.getSceneInventory(); }          catch(e) { result.sceneErr = e.message; }
    try { result.fuzzy     = AnuUniverse.getFuzzyPipelineSnapshot(); }   catch(e) { result.fuzzyErr = e.message; }
    try { result.smoothFPS = window.anuOrchestrator?.smoothFPS; }        catch(e) {}
    try { result.rawFPS    = window.anuOrchestrator?.rawFPS; }           catch(e) {}
    try { result.peakFPS   = window.anuOrchestrator?._peakFPS; }         catch(e) {}
    try { result.activeModules = [...(window.anuOrchestrator?._activeModules?.keys() ?? [])]; } catch(e) {}

    return result;
  });

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ANU LIVE REPORT                                     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log('FPS:', report.smoothFPS?.toFixed?.(1), 'smooth |', report.rawFPS?.toFixed?.(1), 'raw | peak:', report.peakFPS?.toFixed?.(1));
  console.log('\nACTIVE MODULES:', JSON.stringify(report.activeModules, null, 2));
  console.log('\nAUDIT ALERTS:', JSON.stringify(report.audit, null, 2));
  console.log('\nRENDERING:', JSON.stringify(report.rendering, null, 2));
  console.log('\nFRAME BUDGET:', JSON.stringify(report.budget, null, 2));
  console.log('\nSCENE INVENTORY:', JSON.stringify(report.scene, null, 2));
  console.log('\nWORLD SENSORIUM:', JSON.stringify(report.sensorium, null, 2));
  console.log('\nFUZZY PIPELINE:', JSON.stringify(report.fuzzy, null, 2));

  console.log('\n── CONSOLE LOG CAPTURE ──');
  lines.forEach(l => console.log(l));
});

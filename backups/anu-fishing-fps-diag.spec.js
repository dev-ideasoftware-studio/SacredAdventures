/**
 * Anu Fishing FPS Diagnostic
 * Queries anuOrchestrator + AnuUniverse for rendering state during fishing
 * Lives in backups/ — scratch probe, not committed.
 */
const { test, expect } = require('@playwright/test');

test('Anu fishing FPS diagnostic', async ({ page }) => {
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const report = await page.evaluate(async () => {
    const orc = window.anuOrchestrator;
    const anu = window.AnuUniverse;

    // Orchestrator report
    const orcReport = orc?.report?.() ?? 'anuOrchestrator unavailable';

    // Rendering governor snapshot
    let renderSnap = 'unavailable';
    try {
      const { getRenderingSnapshot } = await import('./js/v2/anu/RenderingGovernor.js');
      renderSnap = getRenderingSnapshot();
    } catch(e) { renderSnap = { error: e.message }; }

    // AnuUniverse audit
    const audit = anu?.audit?.() ?? [];

    // Scene draw call estimate
    let sceneStats = {};
    if (orc?.scene) {
      let meshCount = 0, visibleMesh = 0;
      orc.scene.traverse(o => {
        if (o.isMesh) { meshCount++; if (o.visible) visibleMesh++; }
      });
      sceneStats = { totalMesh: meshCount, visibleMesh };
    }

    // PIP state
    const pipState = {
      pipStride: orc?._pipStride ?? 'n/a',
      pipRenderer: !!orc?._pipRenderer,
      fishingActive: window.__sanctuaryFishingActive ?? false,
      bobberPos: window.__sanctuaryBobberPos
        ? { x: window.__sanctuaryBobberPos.x.toFixed(2), z: window.__sanctuaryBobberPos.z.toFixed(2) }
        : null,
      fishingCullStash: typeof window.__sanctuaryFishingCullCount !== 'undefined'
        ? window.__sanctuaryFishingCullCount
        : 'no global exposed',
    };

    // Active modules
    const modules = orc?.getModules?.()?.map(m => m.name) ?? [];

    return { orcReport, renderSnap, audit: audit.length, sceneStats, pipState, modules };
  });

  console.log('\n=== ANU FISHING FPS DIAGNOSTIC ===\n');
  console.log('Scene mesh counts:', JSON.stringify(report.sceneStats, null, 2));
  console.log('\nPIP state:', JSON.stringify(report.pipState, null, 2));
  console.log('\nActive modules:', report.modules?.join(', '));
  console.log('\nAnu audit violations:', report.audit);
  console.log('\nRendering snapshot:', JSON.stringify(report.renderSnap, null, 2));
  console.log('\nOrchestrator report:\n', JSON.stringify(report.orcReport, null, 2));

  expect(report.sceneStats.totalMesh).toBeGreaterThan(0);
});

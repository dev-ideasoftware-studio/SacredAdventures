/**
 * v4-fps-deep-dive.spec.js
 * Forensic deep dive into the v4 rendering engine under un-throttled tree/branch conditions
 * with the new 3D green turtle and the prioritized shadow/stride scheduler.
 */
const { test } = require('@playwright/test');
const fs = require('fs');

test('v4 sanctuary — FPS forensic deep dive', async ({ page }) => {
  const allConsoleLogs = [];
  const telemetryLogs = [];

  page.on('console', msg => {
    const text = msg.text();
    allConsoleLogs.push(`[${msg.type()}] ${text}`);
    if (text.includes('[Telemetry]') || text.includes('[Sanctuary]') || text.includes('[Anu]')) {
      telemetryLogs.push(text);
    }
  });

  page.on('pageerror', err => {
    console.error('Page error:', err);
  });

  // Large viewport for premium rendering
  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log("Navigating to index.html on standard webServer...");
  await page.goto('/index.html', { waitUntil: 'load' });

  console.log("Allowing scene to settle and run simulation for 25 seconds...");
  await page.waitForTimeout(25000);

  console.log("Extracting Anu and SacredOrchestrator performance snapshots...");
  const report = await page.evaluate(() => {
    const A = window.AnuUniverse;
    const orc = window.anuOrchestrator;
    const out = {};

    // ── FPS / frame budget ─────────────────────────────────────────
    try {
      if (orc) {
        out.orchestratorFps = {
          smoothFPS: orc.smoothFPS,
          rawFPS: orc.rawFPS,
          _peakFPS: orc._peakFPS,
          _fpsReady: orc._fpsReady,
        };
      }
    } catch (e) { out.orcError = e.message; }

    try {
      const fb = A?.budget?.snapshot?.() ?? (window.AnuUniverse?.getFrameBudgetSnapshot ? window.AnuUniverse.getFrameBudgetSnapshot() : null);
      out.budget = fb;
    } catch (e) { out.budgetError = e.message; }

    try {
      out.stressLevel = window.AnuUniverse?.getSystemStressLevel ? window.AnuUniverse.getSystemStressLevel() : null;
    } catch (e) { out.stressError = e.message; }

    // ── Adaptive DPR / stress ──────────────────────────────────────
    try {
      out.adaptive = A?.adaptive?.debug?.() ?? (A?.adaptiveDpr ? A.adaptiveDpr.snapshot() : null);
    } catch (e) { out.adaptiveError = e.message; }

    // ── Rendering governor (PiP cadence + stride) ──────────────────
    try {
      out.rendering = A?.rendering?.getRenderingSnapshot?.() ?? (A?.renderingGovernor ? A.renderingGovernor.getRenderingSnapshot() : null);
    } catch (e) { out.renderingError = e.message; }

    // ── Renderer.info (live tris + draw calls per frame) ────────────
    try {
      const r = orc?.renderer?.info?.render;
      const m = orc?.renderer?.info?.memory;
      out.rendererInfo = r ? {
        calls: r.calls,
        triangles: r.triangles,
        points: r.points,
        lines: r.lines,
        frame: orc.renderer.info.render.frame || 0,
      } : null;
      out.gpuMemory = m ?? null;
    } catch (e) { out.gpuError = e.message; }

    // ── Active modules count (heavier = more update cost) ───────────
    try {
      out.activeModuleCount = (orc?._activeModules || []).length;
      out.activeModuleList  = (orc?._activeModules || []).map(m => m.name || m);
    } catch (e) { out.modulesError = e.message; }

    // ── Fuzzy bottleneck diagnosis (Anu's AI-readable pinpoint) ─────
    try {
      out.fuzzy = A?.getFuzzyPipelineSnapshot?.() ?? (window.AnuUniverse?.getFuzzyPipelineSnapshot ? window.AnuUniverse.getFuzzyPipelineSnapshot(orc) : null);
    } catch (e) { out.fuzzyError = e.message; }

    // ── DOM weight ──────────────────────────────────────────────────
    try {
      out.dom = {
        bodyChildren: document.body.children.length,
        styleSheets:  document.styleSheets.length,
        iframes:      document.querySelectorAll('iframe').length,
        canvases:     document.querySelectorAll('canvas').length,
        svgElements:  document.querySelectorAll('svg').length,
        backdropFilterUsers: Array.from(document.querySelectorAll('*'))
          .filter(el => {
            const cs = getComputedStyle(el);
            return (cs.backdropFilter && cs.backdropFilter !== 'none') ||
                   (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none');
          }).length,
        blurredElements: Array.from(document.querySelectorAll('*'))
          .filter(el => {
            const f = getComputedStyle(el).filter || '';
            return f.includes('blur(');
          }).length,
      };
    } catch (e) { out.domError = e.message; }

    return out;
  });

  // Save the report as an artifact JSON
  const reportPath = '/Users/Me/.gemini/antigravity/brain/407e6ee5-54c9-49b6-ab39-abd82ab17b24/forensic_fps_report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n══════════════════════════════════════════════════════');
  console.log('       FORENSIC FPS DEEP DIVE RESULTS');
  console.log('══════════════════════════════════════════════════════\n');

  console.log('── ORCHESTRATOR FPS COUNTERS ──');
  console.log(JSON.stringify(report.orchestratorFps, null, 2));

  console.log('\n── FRAME BUDGET SNAPSHOT ──');
  console.log(JSON.stringify(report.budget, null, 2));
  console.log(`System Stress Level: ${report.stressLevel}`);

  console.log('\n── ADAPTIVE DPR STATUS ──');
  console.log(JSON.stringify(report.adaptive, null, 2));

  console.log('\n── RENDERING (PiP / SHADOWS) GOVERNOR ──');
  console.log(JSON.stringify(report.rendering, null, 2));

  console.log('\n── GPU RENDERER STATISTICS ──');
  console.log(`Draw Calls: ${report.rendererInfo?.calls}`);
  console.log(`Triangles Rendered: ${report.rendererInfo?.triangles?.toLocaleString()}`);
  console.log(`GPU Geometries in Mem: ${report.gpuMemory?.geometries}`);
  console.log(`GPU Textures in Mem: ${report.gpuMemory?.textures}`);

  console.log('\n── ACTIVE SYSTEMS/MODULES ──');
  console.log(`Count: ${report.activeModuleCount}`);
  console.log(`List: ${(report.activeModuleList || []).join(', ')}`);

  console.log('\n── FUZZY BOTTLENECK ANALYSIS ──');
  if (report.fuzzy) {
    console.log('Primary Bottleneck:', JSON.stringify(report.fuzzy.primaryBottleneck, null, 2));
    console.log('Candidates Sorted:', JSON.stringify(report.fuzzy.candidates, null, 2));
  } else {
    console.log('(fuzzy snapshot not returned)');
  }

  console.log('\n── TELEMETRY LOGS EXTRACTED ──');
  telemetryLogs.slice(-20).forEach(log => console.log(`  ${log}`));

  console.log('\n✅ Deep dive forensic audit run completed and saved.\n');
});

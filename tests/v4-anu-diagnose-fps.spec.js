/**
 * Anu sensor sweep — pull EVERY perf signal the universe exposes so we
 * can pinpoint what's eating frames after recent DOM mods (welcome guide,
 * panels, journal bridge, fish realistic motion).
 */
const { test } = require('@playwright/test');
test.use({ baseURL: undefined });

test('Anu sensor sweep — FPS forensic', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5505/index.html');
  await page.waitForTimeout(22000); // let it warm up well past boot

  const report = await page.evaluate(() => {
    const A = window.AnuUniverse;
    const orc = window.anuOrchestrator;
    const out = {};

    // ── FPS / frame budget ─────────────────────────────────────────
    try {
      const fb = A?.budget?.snapshot?.() ?? null;
      out.budget = fb;
    } catch (_e) {}
    try { out.adaptive = A?.adaptive?.debug?.() ?? null; } catch (_e) {}

    // ── Rendering governor (PiP cadence + ladder) ───────────────────
    try { out.rendering = A?.rendering?.getRenderingSnapshot?.() ?? null; } catch (_e) {}

    // ── Renderer.info (live tris + draw calls per frame) ────────────
    try {
      const r = orc?.renderer?.info?.render;
      const m = orc?.renderer?.info?.memory;
      out.rendererInfo = r ? {
        calls: r.calls,
        triangles: r.triangles,
        points: r.points,
        lines: r.lines,
      } : null;
      out.gpuMemory = m ?? null;
    } catch (_e) {}

    // ── Active modules count (heavier = more update cost) ───────────
    try { out.activeModuleCount = (orc?._activeModules || []).length; } catch (_e) {}
    try { out.activeModuleList  = (orc?._activeModules || []).slice(); } catch (_e) {}

    // ── Anu audit + governance ──────────────────────────────────────
    try { out.audit = A?.audit?.() ?? null; } catch (_e) {}
    try {
      const g = A?.getGovernanceSnapshot?.();
      out.governance = g ? {
        state: g.state,
        checks: g.checks?.map(c => ({ id: c.id, ok: c.ok, state: c.state })) ?? null,
      } : null;
    } catch (_e) {}

    // ── Fuzzy bottleneck diagnosis (Anu's AI-readable pinpoint) ─────
    try { out.fuzzy = A?.getFuzzyPipelineSnapshot?.() ?? null; } catch (_e) {}

    // ── DOM weight (recent mods?) ───────────────────────────────────
    out.dom = {
      bodyChildren: document.body.children.length,
      styleSheets:  document.styleSheets.length,
      iframes:      document.querySelectorAll('iframe').length,
      canvases:     document.querySelectorAll('canvas').length,
      svgElements:  document.querySelectorAll('svg').length,
      animations:   document.getAnimations?.()?.length ?? null,
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

    return out;
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  ANU SENSOR SWEEP — FPS FORENSIC');
  console.log('══════════════════════════════════════════════════════\n');

  console.log('── FRAME BUDGET ──');
  console.log(JSON.stringify(report.budget, null, 2));
  console.log('\n── ADAPTIVE DPR / STRESS ──');
  console.log(JSON.stringify(report.adaptive, null, 2));
  console.log('\n── RENDERING (PiP) ──');
  console.log(JSON.stringify(report.rendering, null, 2));
  console.log('\n── RENDERER.INFO (per-frame) ──');
  console.log(JSON.stringify(report.rendererInfo, null, 2));
  console.log('\n── GPU MEMORY ──');
  console.log(JSON.stringify(report.gpuMemory, null, 2));
  console.log('\n── ACTIVE MODULES ──');
  console.log(`count: ${report.activeModuleCount}`);
  console.log((report.activeModuleList || []).join(', '));
  console.log('\n── AUDIT ──');
  console.log(JSON.stringify(report.audit, null, 2));
  console.log('\n── GOVERNANCE CHECKS ──');
  console.log(JSON.stringify(report.governance, null, 2));
  console.log('\n── DOM WEIGHT ──');
  console.log(JSON.stringify(report.dom, null, 2));
  console.log('\n── FUZZY BOTTLENECK (Anu’s read) ──');
  if (report.fuzzy) {
    console.log('primaryBottleneck:', JSON.stringify(report.fuzzy.primaryBottleneck, null, 2));
    console.log('boot:',              JSON.stringify(report.fuzzy.boot,              null, 2));
  } else {
    console.log('(unavailable)');
  }
});

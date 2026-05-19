/**
 * Anu deep-forensic snapshot — May-17 2026 cleanup audit.
 * Captures everything Anu exposes in one shot so the report has live
 * numbers next to the static code archaeology.
 */
import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--ignore-gpu-blocklist"],
});
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v2.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._fpsReady, { timeout: 90000 });
await page.waitForTimeout(8000);

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const r = orc?.renderer?.info?.render;

  const moduleBenches = [];
  if (orc?._registry) {
    for (const [name, e] of orc._registry) {
      moduleBenches.push({ name, active: e.active, fpsCost: e.fpsCost });
    }
  }

  const v2Globals = [];
  for (const k of Object.keys(window)) {
    if (k.startsWith("_v2") || k.startsWith("v2_")) v2Globals.push(k);
  }

  const canvases = Array.from(document.querySelectorAll("canvas")).map((c) => ({
    id: c.id || null,
    w: c.width, h: c.height,
    cssW: Math.round(c.getBoundingClientRect().width),
    cssH: Math.round(c.getBoundingClientRect().height),
  }));

  return {
    fps: {
      smooth: +orc.smoothFPS.toFixed(2),
      raw: +orc.rawFPS.toFixed(2),
      peak: +orc._peakFPS.toFixed(2),
      frameCount: orc._frameCount,
    },
    renderer: {
      dpr: orc.renderer.getPixelRatio?.(),
      antialias: orc.renderer.getContext?.()?.getContextAttributes?.()?.antialias,
      shadowMapEnabled: orc.renderer.shadowMap?.enabled,
      calls: r?.calls, triangles: r?.triangles, points: r?.points,
    },
    blueprint: Anu?.rendering?.blueprint,
    fuzzy: Anu?.getFuzzyPipelineSnapshot?.(orc),
    audit: Anu?.audit?.() ?? null,
    frameBudget: Anu?.budget?.snapshot?.() ?? null,
    governance: Anu?.getGovernanceSnapshot?.() ?? null,
    services: Anu?.services?.list?.() ?? null,
    servicesValidate: Anu?.services?.validate?.() ?? null,
    stress: Anu?.getStressSnapshot?.() ?? null,
    activeModules: [...(orc._activeModules ?? [])],
    moduleBenches,
    canvases,
    v2Globals: v2Globals.sort(),
    v2GlobalCount: v2Globals.length,
  };
});

console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

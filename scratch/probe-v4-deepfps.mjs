import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._fpsReady, { timeout: 90000 });
await page.waitForTimeout(5000);
const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const r = orc.renderer;
  const info = r.info;
  // Per-module update timings — instrument each active module by wrapping update().
  // Don't have that yet; instead expose what we DO have.
  return {
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2) },
    rendererInfo: {
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      programs: info.programs?.length ?? null,
      memory: { geometries: info.memory.geometries, textures: info.memory.textures },
    },
    rendererSettings: {
      pixelRatio: r.getPixelRatio(),
      shadowMapEnabled: r.shadowMap.enabled,
      shadowMapType: r.shadowMap.type,
      antialias: r.getContext().getContextAttributes().antialias,
      toneMapping: r.toneMapping,
      toneMappingExposure: r.toneMappingExposure,
    },
    bufferSize: { w: r.domElement.width, h: r.domElement.height, mp: +((r.domElement.width*r.domElement.height)/1e6).toFixed(2) },
    canvases: Array.from(document.querySelectorAll("canvas")).map(c => ({
      id: c.id, w: c.width, h: c.height, fullscreen: (c.clientWidth/window.innerWidth>0.9)
    })),
    // PIP stride check — should be 0 (disabled) in v4
    pipStride: typeof window.AnuUniverse?.rendering?.getRenderingSnapshot === 'function'
      ? window.AnuUniverse.rendering.getRenderingSnapshot().pipBaseline
      : null,
    frameBudget: window.AnuUniverse?.budget?.snapshot?.() ?? null,
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

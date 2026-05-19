import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("SanctuaryInventory"), { timeout: 90000 });
await page.waitForTimeout(5000);

await page.evaluate(async () => {
  const mod = await import("./js/sanctuary/SanctuaryGround.js");
  window.__y = mod.sanctuaryGroundY;
});

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const y = window.__y;
  // Sample the flat-ring expected zone (12-26m from origin)
  const samples = {
    pool_centre:  +y(0, 0).toFixed(2),
    pool_edge:    +y(12, 0).toFixed(2),
    flat_at_15:   +y(15, 0).toFixed(2),
    flat_at_18:   +y(18, 0).toFixed(2),
    flat_at_22:   +y(22, 0).toFixed(2),
    flat_at_25:   +y(0, 25).toFixed(2),
    flat_at_18_negZ: +y(0, -18).toFixed(2),
    hill_at_28:   +y(0, 28).toFixed(2),
    hill_at_32_E: +y(32, 0).toFixed(2),
    hill_at_40_W: +y(-40, 0).toFixed(2),
    valley_mouth_open: +y(0, 40).toFixed(2),
  };
  return {
    samples,
    rendered: { tris: orc.renderer.info.render.triangles, calls: orc.renderer.info.render.calls },
    fps: +orc.smoothFPS.toFixed(2),
    rendererSettings: {
      toneMapping: orc.renderer.toneMapping,
      exposure: +orc.renderer.toneMappingExposure.toFixed(2),
      outputColorSpace: orc.renderer.outputColorSpace,
    },
    audit: Anu.audit?.(),
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck?.level ?? null,
  };
});
console.log(JSON.stringify({ errors: errors.slice(0,4), ...out }, null, 2));
await browser.close();

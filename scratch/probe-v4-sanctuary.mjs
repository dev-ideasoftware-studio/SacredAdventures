import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.AnuUniverse && !!window.anuOrchestrator?._fpsReady, { timeout: 90000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const r = orc.renderer.info.render;
  let terrain=false, sky=false, water=false, basin=false, rim=false;
  let lilyPads=0, lilyFlowers=0, fishCount=0, planks=0, posts=0, rails=0;
  let endcap=false, fishingRing=false, perimRing=false, ripples=0;
  orc.scene.traverse((o) => {
    const k = o.userData?.anuKind;
    if (o.name === "sanctuary_terrain") terrain = true;
    if (o.name === "sanctuary_sky") sky = true;
    if (o.name === "sanctuary_pool_water") water = true;
    if (o.name === "sanctuary_pool_basin_floor") basin = true;
    if (o.name === "sanctuary_pool_moss_rim") rim = true;
    if (k === "sanctuary_lily_pad") lilyPads++;
    if (k === "sanctuary_lily_flower") lilyFlowers++;
    if (k === "sanctuary_fish") fishCount++;
    if (k === "sanctuary_dock_plank") planks++;
    if (k === "sanctuary_dock_post") posts++;
    if (k === "sanctuary_dock_rail") rails++;
    if (k === "sanctuary_dock_endcap") endcap = true;
    if (o.name === "sanctuary_fishing_spot_ring") fishingRing = true;
    if (o.name === "sanctuary_pool_perimeter_ring") perimRing = true;
    if (k === "sanctuary_ripple") ripples++;
  });
  const sensorium = Anu.getWorldSensoriumSnapshot?.()?.domains || {};
  return {
    activeModules: [...orc._activeModules],
    presence: { terrain, sky, water, basin, rim, lilyPads, lilyFlowers, fishCount,
                planks, posts, rails, endcap, fishingRing, perimRing, ripples },
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2) },
    rendered: { tris: r.triangles, calls: r.calls },
    primaryBottleneck: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck ?? null,
    audit: Anu.audit?.() ?? null,
    frameBudget: Anu.budget?.snapshot?.() ?? null,
    sensorium: Object.fromEntries(
      Object.entries(sensorium).map(([k, v]) => [k, `${v.drawables} drawables, ${v.trianglesEstimate} tris, ${v.interactables} inter`])
    ),
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

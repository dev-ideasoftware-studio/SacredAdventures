import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v3.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._fpsReady, { timeout: 90000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const r = orc.renderer.info.render;
  let tipi1 = false, tipi2 = false, pool2 = false, fishing = false, avatar = false, stag = false;
  let dockSurfaces = 0, fishCount = 0;
  orc.scene.traverse((o) => {
    if (o.name === "structure_tipi_1_center") tipi1 = true;
    if (o.name === "structure_tipi_2_bhg") tipi2 = true;
    if (o.name === "pool2_water") pool2 = true;
    if (o.userData?.anuKind === "nature_spirit_deer_hologram") stag = true;
    if (o.userData?.anuKind === "fishing_rod" || o.name?.includes("fishing")) fishing = true;
    if (o.userData?.anuId === "player.avatar.figurine" || o.name?.includes("avatar")) avatar = true;
    if (o.name?.startsWith("pool2_fish_")) fishCount++;
  });
  return {
    activeModules: [...orc._activeModules],
    contents: { tipi1, tipi2, pool2, fishing, avatar, stag, fishCount },
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2), frameCount: orc._frameCount },
    rendered: { triangles: r.triangles, calls: r.calls },
    primaryBottleneck: Anu?.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck ?? null,
    frameBudget: Anu?.budget?.snapshot?.() ?? null,
    audit: Anu?.audit?.() ?? null,
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

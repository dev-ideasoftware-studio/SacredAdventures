import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto("http://127.0.0.1:5500/index.v2.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("TraderJosh"), { timeout: 60000 });
await page.waitForTimeout(3500);
const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const W = orc?._activeModuleInstances?.World;
  const cache = W?._npcLodCache;
  const npcs = {};
  orc.scene.traverse(o => {
    if (o.name === "population_npc_brings_happiness_girl_tipi2_seated") npcs.bhg = { vis: o.visible, x: +o.position.x.toFixed(2), z: +o.position.z.toFixed(2) };
    if (o.name === "population_npc_yellow_butterfly_tipi1_seated")      npcs.yb  = { vis: o.visible, x: +o.position.x.toFixed(2), z: +o.position.z.toFixed(2) };
    if (o.name === "population_trader_josh")                            npcs.josh= { vis: o.visible, x: +o.position.x.toFixed(2), z: +o.position.z.toFixed(2) };
  });
  const playerBody = W?._body?.position;
  const cacheReport = {
    ready: cache?.ready,
    bhgRoot: !!cache?.bhgRoot,
    ybRoot: !!cache?.ybRoot,
    joshRoot: !!cache?.joshRoot,
  };
  // Simulate near-village (0,0) and re-LOD
  if (W?._updateNpcDistanceLod) W._updateNpcDistanceLod(0, 0);
  const afterNear = {};
  orc.scene.traverse(o => {
    if (o.name === "population_npc_brings_happiness_girl_tipi2_seated") afterNear.bhg = o.visible;
    if (o.name === "population_npc_yellow_butterfly_tipi1_seated") afterNear.yb = o.visible;
    if (o.name === "population_trader_josh") afterNear.josh = o.visible;
  });
  return { npcs, player: { x: +playerBody.x.toFixed(2), z: +playerBody.z.toFixed(2) }, cacheReport, afterNear };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

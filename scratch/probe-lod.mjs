import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto("http://127.0.0.1:5500/index.v2.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("TraderJosh"), { timeout: 60000 });
await page.waitForTimeout(3000);
const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const W = orc?._activeModuleInstances?.World;
  // Near case (default spawn at z=-32.58 — far enough that NPCs at z~0/-6 are 32m+):
  const near = { px: W._cameraSmooth?.x ?? 0, pz: W._cameraSmooth?.z ?? -32 };
  let bhgVisAtSpawn = null, ybVisAtSpawn = null, joshVisAtSpawn = null;
  orc.scene.traverse(o => {
    if (o.name === "population_npc_brings_happiness_girl_tipi2_seated") bhgVisAtSpawn = o.visible;
    if (o.name === "population_npc_yellow_butterfly_tipi1_seated") ybVisAtSpawn = o.visible;
    if (o.name === "population_trader_josh") joshVisAtSpawn = o.visible;
  });
  // Simulate moving player close to village (force a position):
  if (W?._body?.position) {
    W._body.position.x = 0; W._body.position.z = 0;
    W._updateNpcDistanceLod(0, 0);
  }
  let bhgVisNear = null, ybVisNear = null, joshVisNear = null;
  orc.scene.traverse(o => {
    if (o.name === "population_npc_brings_happiness_girl_tipi2_seated") bhgVisNear = o.visible;
    if (o.name === "population_npc_yellow_butterfly_tipi1_seated") ybVisNear = o.visible;
    if (o.name === "population_trader_josh") joshVisNear = o.visible;
  });
  return { spawn: { bhgVisAtSpawn, ybVisAtSpawn, joshVisAtSpawn }, near_village: { bhgVisNear, ybVisNear, joshVisNear } };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v2.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("TraderJosh"), { timeout: 90000 });
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const josh = orc?._activeModuleInstances?.TraderJosh;
  let root = null;
  let tris = 0;
  orc?.scene?.traverse?.((o) => {
    if (o.name === "population_trader_josh") root = o;
    const g = o.geometry;
    if (g && o.userData?.anuKind === "npc_trader_josh_mesh") {
      if (g.index) tris += Math.floor(g.index.count / 3);
      else if (g.attributes?.position) tris += Math.floor(g.attributes.position.count / 3);
    }
  });
  // Sample render height by Box3 over the loaded model.
  let height = null;
  if (root) {
    const THREE = window.THREE || null;
    let minY = Infinity, maxY = -Infinity;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.computeBoundingBox?.();
        const bb = o.geometry?.boundingBox;
        if (!bb) return;
        const v = bb.clone();
        v.applyMatrix4(o.matrixWorld);
        if (v.min.y < minY) minY = v.min.y;
        if (v.max.y > maxY) maxY = v.max.y;
      }
    });
    height = +(maxY - minY).toFixed(2);
  }
  return {
    found: !!root,
    position: root ? { x: +root.position.x.toFixed(2), y: +root.position.y.toFixed(2), z: +root.position.z.toFixed(2) } : null,
    scale: root ? +root.scale.x.toFixed(2) : null,
    height,
    tris,
    clipNames: josh?._clipNames ?? null,
    hasIdleAction: !!josh?._idleAction,
    hasWalkAction: !!josh?._walkAction,
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

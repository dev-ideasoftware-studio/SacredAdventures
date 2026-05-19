import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v2.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("TraderJosh"), { timeout: 90000 });
await page.waitForTimeout(3000);
const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  let josh = null;
  let tris = 0;
  orc?.scene?.traverse?.((o) => {
    if (o.name === "population_trader_josh") josh = o;
    if (josh && o !== josh && o.isMesh && josh.children.some(c => c.children.some(d => d === o) || c === o.parent)) {}
  });
  if (!josh) return { found: false };
  josh.traverse((o) => {
    const g = o.geometry;
    if (g) {
      if (g.index) tris += Math.floor(g.index.count / 3);
      else if (g.attributes?.position) tris += Math.floor(g.attributes.position.count / 3);
    }
  });
  return {
    found: true,
    position: { x: +josh.position.x.toFixed(2), y: +josh.position.y.toFixed(2), z: +josh.position.z.toFixed(2) },
    tris,
    anuId: josh.userData.anuId,
    domain: josh.userData.anuSimulationDomain,
    children: josh.children.length,
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

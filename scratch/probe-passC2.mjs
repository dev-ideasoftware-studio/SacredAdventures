import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("SanctuaryInventory"), { timeout: 90000 });
await page.waitForTimeout(7000);

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  // Tipis present
  let tipi1 = false, tipi2 = false;
  orc.scene.traverse(o => {
    if (o.name === "sanctuary_tipi_1") tipi1 = true;
    if (o.name === "sanctuary_tipi_2") tipi2 = true;
  });
  // Cursor element
  const cursor = !!document.getElementById('v4-tool-cursor');
  // Mute button
  const muteBtn = document.getElementById('v4-btn-mute');
  const dnBtn   = document.getElementById('v4-btn-day-night');
  // Inventory
  const inv = !!document.getElementById('v4-inventory');
  const grantFn = typeof window.sanctuaryGrant === 'function';
  // Try a programmatic grant
  if (grantFn) window.sanctuaryGrant('berry', 3);
  const invSnapshot = window.sanctuaryInventory?.() ?? null;
  return {
    tipis: { tipi1, tipi2 },
    ui: { cursor, muteBtn: !!muteBtn, dnBtn: !!dnBtn, inv },
    tipiAnchors: {
      v: window.__sanctuaryTipi1Anchor, w: window.__sanctuaryTipi2Anchor,
    },
    inventory: invSnapshot,
    fps: +orc.smoothFPS.toFixed(2),
    rendered: { tris: orc.renderer.info.render.triangles, calls: orc.renderer.info.render.calls },
    audit: Anu.audit?.(),
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck?.level ?? null,
    activeModuleCount: orc._activeModules.length,
  };
});
console.log(JSON.stringify({ errors: errors.slice(0,4), ...out }, null, 2));
await browser.close();

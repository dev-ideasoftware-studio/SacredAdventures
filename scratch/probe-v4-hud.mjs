import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._fpsReady, { timeout: 60000 });
await page.waitForTimeout(4000);
const out = await page.evaluate(() => {
  const hud = document.getElementById('v2-orchestrator-hud') || document.getElementById('v2-frame-graph')?.parentElement;
  if (!hud) {
    // try finding by content
    return { found: false, search: "no element with id v2-orchestrator-hud" };
  }
  const r = hud.getBoundingClientRect();
  return {
    found: true,
    id: hud.id,
    rect: { top: Math.round(r.top), right: Math.round(window.innerWidth - r.right), w: Math.round(r.width), h: Math.round(r.height) },
    text: hud.innerText.slice(0, 200),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

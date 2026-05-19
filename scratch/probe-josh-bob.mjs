import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v2.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("TraderJosh"), { timeout: 90000 });
await page.waitForTimeout(2000);

// Sample Josh's Y over 1.5s to verify the bob is animating.
const samples = [];
for (let i = 0; i < 6; i++) {
  const y = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    let root = null;
    orc?.scene?.traverse?.((o) => { if (o.name === "population_trader_josh") root = o; });
    return root ? +root.position.y.toFixed(4) : null;
  });
  samples.push(y);
  await page.waitForTimeout(250);
}

// Programmatically set _smoothSpeed and observe walking-bob amplitude.
const movingSamples = [];
await page.evaluate(() => {
  const josh = window.anuOrchestrator?._activeModuleInstances?.TraderJosh;
  if (josh) josh._smoothSpeed = 0.8; // simulate "walking" speed
});
for (let i = 0; i < 6; i++) {
  const y = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    let root = null;
    orc?.scene?.traverse?.((o) => { if (o.name === "population_trader_josh") root = o; });
    return root ? +root.position.y.toFixed(4) : null;
  });
  movingSamples.push(y);
  await page.waitForTimeout(120);
}

const min = (a) => Math.min(...a);
const max = (a) => Math.max(...a);
console.log(JSON.stringify({
  errors,
  idleSamples: samples,
  idleRange: +(max(samples) - min(samples)).toFixed(4),
  movingSamples,
  movingRange: +(max(movingSamples) - min(movingSamples)).toFixed(4),
}, null, 2));
await browser.close();

import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });

// Verify the modal iframe is present before the orchestrator boots.
await page.waitForTimeout(800);
const modalEarly = await page.evaluate(() => {
  const ifr = document.getElementById('v4-loading-iframe');
  return { present: !!ifr, src: ifr?.getAttribute('src') ?? null };
});

await page.waitForFunction(() => !!window.anuOrchestrator?._fpsReady, { timeout: 90000 });
// Modal should fade out within ~2s after _fpsReady. Wait through.
await page.waitForTimeout(5000);

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const r = orc.renderer;
  const info = r.info.render;
  return {
    modalRemoved: !document.getElementById('v4-loading-iframe'),
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2) },
    rendered: { tris: info.triangles, calls: info.calls },
    pixelRatio: r.getPixelRatio(),
    shadowMapSize: r.shadowMap.enabled ? (Array.from(orc.scene.children).flatMap(c => {
      const out = [];
      c.traverse(o => { if (o.isDirectionalLight && o.castShadow) out.push(o.shadow.mapSize.x); });
      return out;
    }))[0] : 0,
    bufferMP: +((r.domElement.width * r.domElement.height) / 1e6).toFixed(2),
    frameBudget: Anu.budget?.snapshot?.(),
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck,
    audit: Anu.audit?.(),
  };
});
console.log("=== modal early ===");
console.log(JSON.stringify(modalEarly, null, 2));
console.log("=== final state ===");
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

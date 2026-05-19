import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
await page.goto("http://127.0.0.1:5500/index.v2.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._fpsReady, { timeout: 60000 });
await page.waitForTimeout(5000);
const data = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const r = orc?.renderer;
  return {
    dpr: window.devicePixelRatio,
    rendererPixelRatio: r?.getPixelRatio?.(),
    rendererSize: r ? { w: r.domElement.width, h: r.domElement.height } : null,
    canvasCss: r ? { w: r.domElement.clientWidth, h: r.domElement.clientHeight } : null,
    antialias: r?.capabilities?.isWebGL2,
    contextAttrs: r?.getContext?.()?.getContextAttributes?.(),
    shadowMapEnabled: r?.shadowMap?.enabled,
    shadowMapType: r?.shadowMap?.type,
    toneMapping: r?.toneMapping,
    smoothFPS: orc?.smoothFPS,
    extraCanvases: Array.from(document.querySelectorAll('canvas')).map(c => ({
      id: c.id, w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight,
    })),
  };
});
console.log(JSON.stringify({ errors, data }, null, 2));
await browser.close();

// Online simulation: CDN three -> local vendor copy; lucide -> stub (or blocked when MODE=offline).
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [out, port, mode, w, h] = process.argv.slice(2);
  const vw = +w || 390, vh = +h || 844;
  const b = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), 
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const ctx = await b.newContext(vw < 800 ? { viewport: { width: vw, height: vh }, userAgent: UA, isMobile: true, hasTouch: true } : { viewport: { width: vw, height: vh } });
  const base = `http://127.0.0.1:${port}`;
  if (mode === "online") {
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)$/, async (route) => {
      const rest = route.request().url().match(/three@0\.160\.0\/(.*)$/)[1].replace(/^build\//, "");
      const r = await fetch(`${base}/vendor/three/${rest}`);
      route.fulfill({ status: r.status, contentType: "application/javascript", body: Buffer.from(await r.arrayBuffer()) });
    });
    await ctx.route(/unpkg\.com\/lucide/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "window.lucide={createIcons(){}};" }));
  }
  await ctx.addInitScript(() => {
    try { localStorage.setItem("sanctuary.welcomeGuide.seenV2", "1"); } catch (_) {}
    window.__gl = [];
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const c = gc.call(this, type, ...rest);
      if (c && /webgl/.test(type) && !this.__counted) { this.__counted = true; (window.top.__glAll = window.top.__glAll || []).push({ frame: window === window.top ? "top" : (window.frameElement && window.frameElement.id) || "iframe", canvas: this }); }
      return c;
    };
    window.__gpuTex = [];
    const wrap = (proto) => {
      const ts = proto.texStorage2D;
      proto.texStorage2D = function (t, l, f, w, h) { window.__gpuTex.push({ w, h, l, id: this.canvas.id }); return ts.apply(this, arguments); };
      const ti = proto.texImage2D;
      proto.texImage2D = function () { const a = arguments; let w = 0, h = 0;
        if (a.length >= 9) { w = a[3]; h = a[4]; } else if (a.length === 6 && a[5]) { w = a[5].width || a[5].videoWidth || 0; h = a[5].height || a[5].videoHeight || 0; }
        if (a[1] === 0 && w > 1 && h > 1) window.__gpuTex.push({ w, h, l: 1, id: this.canvas.id }); return ti.apply(this, a); };
    };
    if (window.WebGL2RenderingContext) wrap(WebGL2RenderingContext.prototype);
    if (window.WebGLRenderingContext) wrap(WebGLRenderingContext.prototype);
  });
  const page = await ctx.newPage();
  const glbs = [], errs = [];
  page.on("response", (r) => { if (/\.glb/.test(r.url())) glbs.push(r.url().split("/Assets/")[1] + " " + r.status() + " " + (r.headers()["content-length"] || "?")); });
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.anuOrchestrator && !document.getElementById("v4-loading-iframe"), null, { timeout: 240000, polling: 1000 }).catch(() => errs.push("BOOT TIMEOUT"));
  await page.waitForTimeout(15000); // let the panel icons load their avatar
  const res = await page.evaluate(() => {
    const pf = document.getElementById("v4-panel-frame");
    const pw = pf && pf.contentWindow;
    const fnState = pw ? Object.fromEntries(["handleActionClick", "toggleFish", "toggleGather", "toggleLogbook", "toggleObserve", "initPanelIcons", "icons", "THREE", "lucide"].map((k) => [k, typeof pw[k]])) : null;
    const gl = (window.__glAll || []).map((g) => { const r = g.canvas.getBoundingClientRect(); return { frame: g.frame, id: g.canvas.id || "(no id)", backing: [g.canvas.width, g.canvas.height], css: [Math.round(r.width), Math.round(r.height)] }; });
    const sum = (arr) => ({ n: arr.length, estMB: +(arr.reduce((s, t) => s + t.w * t.h * 4 * (t.l > 1 ? 1.333 : 1), 0) / 1048576).toFixed(1), maxDim: arr.length ? Math.max(...arr.map((t) => Math.max(t.w, t.h))) : 0 });
    const topTex = window.__gpuTex || [], panelTex = (pw && pw.__gpuTex) || [];
    const by = {}; for (const t of topTex.concat(panelTex)) (by[t.id || "(none)"] = by[t.id || "(none)"] || []).push(t);
    return { panelFns: fnState, webglContexts: gl, gpuByCanvas: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, sum(v)])) };
  });
  const result = { mode, viewport: [vw, vh], ...res, glbs, errors: [...new Set(errs)] };
  fs.writeFileSync(`${out}/online_${mode}_${vw}.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  await b.close();
})();

// Phase 0 measurement probe. Usage: node p0probe.js <outDir> <profile> <port>
const { chromium } = require("playwright");
const fs = require("fs");
const PROFILES = {
  phoneS: { viewport: { width: 320, height: 568 }, ua: "iphone" },
  phoneM: { viewport: { width: 360, height: 740 }, ua: "android" },
  phoneL: { viewport: { width: 390, height: 844 }, ua: "iphone" },
  phoneLand: { viewport: { width: 844, height: 390 }, ua: "iphone" },
  tablet: { viewport: { width: 768, height: 1024 }, ua: "ipad" },
  desktop: { viewport: { width: 1280, height: 800 }, ua: null },
};
const UAS = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
};
(async () => {
  const [out, name, port] = process.argv.slice(2);
  const prof = PROFILES[name];
  const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), 
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctxOpts = { viewport: prof.viewport };
  if (prof.ua) Object.assign(ctxOpts, { userAgent: UAS[prof.ua], isMobile: prof.ua !== "ipad", hasTouch: true });
  const ctx = await browser.newContext(ctxOpts);
  if (prof.ua === "ipad") await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 }));
  await ctx.addInitScript(() => {
    try { localStorage.setItem("sanctuary.welcomeGuide.seenV2", "1"); } catch (_) {}
    // GPU allocation log: every texStorage2D / sized texImage2D upload, by context.
    window.__gpuTex = [];
    const wrap = (proto) => {
      const ts = proto.texStorage2D;
      if (ts) proto.texStorage2D = function (t, levels, fmt, w, h) { window.__gpuTex.push({ k: "storage", w, h, levels, ctx: this.canvas && this.canvas.id }); return ts.apply(this, arguments); };
      const ti = proto.texImage2D;
      proto.texImage2D = function () {
        const a = arguments; let w = 0, h = 0;
        if (a.length >= 9) { w = a[3]; h = a[4]; } else if (a.length === 6 && a[5]) { const s = a[5]; w = s.width || s.videoWidth || 0; h = s.height || s.videoHeight || 0; }
        if (a[1] === 0 && w > 1 && h > 1) window.__gpuTex.push({ k: "image", w, h, levels: 1, ctx: this.canvas && this.canvas.id });
        return ti.apply(this, a);
      };
    };
    if (window.WebGL2RenderingContext) wrap(WebGL2RenderingContext.prototype);
    if (window.WebGLRenderingContext) wrap(WebGLRenderingContext.prototype);
  });
  const page = await ctx.newPage();
  const net = [], errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => net.push({ url: r.url(), failed: r.failure()?.errorText || "failed" }));
  page.on("response", async (r) => {
    let bytes = null;
    try { const h = r.headers()["content-length"]; bytes = h ? +h : null; } catch (_) {}
    net.push({ url: r.url(), status: r.status(), bytes });
  });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load", timeout: 120000 });
  let booted = true;
  try {
    await page.waitForFunction(() => window.anuOrchestrator && document.getElementById("v2-orchestrator-hud") && !document.getElementById("v4-loading-iframe"), null, { timeout: 240000, polling: 1000 });
  } catch (_) { booted = false; }
  const bootMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  const m = await page.evaluate(() => {
    const o = window.anuOrchestrator;
    const res = { orch: !!o };
    if (!o) return res;
    // scene triangles + textures (CPU-side image dims) + owners
    let tris = 0, meshes = 0;
    const tex = new Map();
    const ownerOf = (obj) => { let p = obj, last = obj; while (p && p.parent && p.parent.type !== "Scene") { last = p; p = p.parent; } return (p && (p.name || p.userData?.anuKind)) || (last && last.name) || "?"; };
    o.scene.traverse((m) => {
      if (!m.isMesh || !m.geometry) return;
      meshes++;
      const g = m.geometry;
      const n = ((g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3) * (m.isInstancedMesh ? m.count : 1);
      tris += n;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat) continue;
        for (const k of Object.keys(mat)) {
          const t = mat[k];
          if (t && t.isTexture && t.image) {
            const img = t.image; const w = img.width || img.videoWidth || 0, h = img.height || img.videoHeight || 0;
            if (!tex.has(t.uuid)) tex.set(t.uuid, { slot: k, w, h, name: t.name || (img.src ? img.src.split("/").pop().slice(0, 60) : ""), owner: ownerOf(m), tris: 0 });
          }
        }
      }
    });
    const texList = [...tex.values()].map((t) => ({ ...t, cpuMB: +(t.w * t.h * 4 / 1048576).toFixed(2) })).sort((a, b) => b.cpuMB - a.cpuMB);
    const gpu = window.__gpuTex || [];
    const mainId = o.renderer.domElement.id;
    const sumMB = (arr) => +(arr.reduce((s, t) => s + t.w * t.h * 4 * (t.levels > 1 ? 1.333 : 1), 0) / 1048576).toFixed(1);
    const byCtx = {};
    for (const t of gpu) { const k = t.ctx || "(offscreen)"; (byCtx[k] = byCtx[k] || []).push(t); }
    const gpuSummary = Object.fromEntries(Object.entries(byCtx).map(([k, arr]) => [k, { allocations: arr.length, estMB: sumMB(arr), maxDim: Math.max(...arr.map((t) => Math.max(t.w, t.h))), over1024: arr.filter((t) => Math.max(t.w, t.h) > 1024).length }]));
    const r = o.renderer;
    // UI surfaces: visible fixed/absolute elements that are direct-ish overlays
    const vw = innerWidth, vh = innerHeight;
    const surfaces = [];
    for (const e of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(e);
      if (cs.position !== "fixed") continue;
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
      const b = e.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      if (e.id === "v4-canvas" || e.tagName === "CANVAS" && b.width >= vw - 1) continue;
      const label = e.id ? "#" + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : "");
      surfaces.push({ el: label.slice(0, 60), x: Math.round(b.left), y: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), outside: b.left < -0.5 || b.top < -0.5 || b.right > vw + 0.5 || b.bottom > vh + 0.5 });
    }
    // small tap targets among visible interactive elements in the top document
    const small = [];
    for (const e of document.querySelectorAll("button, a[href], [role=button], input, select, textarea, summary")) {
      const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") continue;
      const b = e.getBoundingClientRect(); if (b.width < 1 || b.height < 1) continue;
      if (b.width < 44 || b.height < 44) small.push({ el: (e.id ? "#" + e.id : e.tagName.toLowerCase() + "." + String(e.className).trim().split(/\s+/)[0]).slice(0, 50), w: Math.round(b.width), h: Math.round(b.height) });
    }
    // pairwise overlaps between surfaces
    const overlaps = [];
    for (let i = 0; i < surfaces.length; i++) for (let j = i + 1; j < surfaces.length; j++) {
      const a = surfaces[i], c = surfaces[j];
      const ow = Math.min(a.r, c.r) - Math.max(a.x, c.x), oh = Math.min(a.b, c.b) - Math.max(a.y, c.y);
      if (ow > 0 && oh > 0) overlaps.push(`${a.el} ∩ ${c.el}: ${ow}x${oh}`);
    }
    return {
      orch: true, isMobileFlag: o._isMobile, dpr: r.getPixelRatio(), drawingBuffer: [r.domElement.width, r.domElement.height],
      shadows: r.shadowMap.enabled, maxTextureSize: r.capabilities.maxTextureSize,
      lastFrame: { calls: r.info.render.calls, triangles: r.info.render.triangles },
      memory: { geometries: r.info.memory.geometries, textures: r.info.memory.textures },
      sceneTris: Math.round(tris), meshes, textures: texList.length,
      cpuImageMB: +texList.reduce((s, t) => s + t.cpuMB, 0).toFixed(1),
      topTextures: texList.slice(0, 15),
      gpu: gpuSummary, mainCanvasId: mainId,
      pip: { renderer2ndCtx: !!o._pipRenderer, mobileRT: !!o._pipRT, rtSize: o._pipRT ? [o._pipRT.width, o._pipRT.height] : null, renderedLast: o._pipRenderedLastFrame },
      frames: o._frameCount,
      viewport: [vw, vh], hScroll: document.documentElement.scrollWidth > vw,
      surfaces, overlaps, smallTargets: small,
    };
  });
  const origin = `http://127.0.0.1:${port}`;
  const glbs = net.filter((n) => /\.glb(\?|$)/.test(n.url)).map((n) => ({ file: n.url.replace(origin + "/", ""), status: n.status, bytes: n.bytes, failed: n.failed }));
  const external = net.filter((n) => !n.url.startsWith(origin) && !n.url.startsWith("data:") && !n.url.startsWith("blob:"));
  const jsFiles = [...new Set(net.filter((n) => n.url.startsWith(origin) && /\.m?js(\?|$)/.test(n.url) && n.status).map((n) => n.url.replace(origin + "/", "").split("?")[0]))].sort();
  const failedLocal = net.filter((n) => n.url.startsWith(origin) && (n.failed || n.status >= 400)).map((n) => n.url.replace(origin + "/", "") + " " + (n.status || n.failed));
  const result = { profile: name, booted, bootMs, ...m, glbs, glbMB: +(glbs.reduce((s, g) => s + (g.bytes || 0), 0) / 1048576).toFixed(1),
    external: [...new Map(external.map((e) => [e.url, e])).values()], jsFiles, failedLocal: [...new Set(failedLocal)], errors: [...new Set(errs)] };
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(result, null, 1));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, "booted", booted, "bootMs", bootMs, "sceneTris", result.sceneTris, "gpu", JSON.stringify(result.gpu), "glbMB", result.glbMB);
  await browser.close();
})().catch((e) => { console.error("PROBE FAIL", e.message); process.exit(1); });

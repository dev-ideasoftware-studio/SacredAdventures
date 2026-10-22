const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  for (const [label, q, opts] of [["desktop+?device=mobile", "?device=mobile", { viewport: { width: 1280, height: 800 } }],
                                  ["iphone+?device=desktop", "?device=desktop", { viewport: { width: 390, height: 844 }, userAgent: UA, isMobile: true, hasTouch: true }],
                                  ["desktop+?device=bogus", "?device=bogus", { viewport: { width: 1280, height: 800 } }]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(() => { try { localStorage.setItem("sanctuary.welcomeGuide.seenV2", "1"); } catch (_) {} });
    const page = await ctx.newPage(); const glbs = [];
    page.on("response", (r) => { if (/\.glb/.test(r.url())) glbs.push(r.url().split("/Assets/")[1]); });
    await page.goto("http://127.0.0.1:8771/index.html" + q);
    await page.waitForFunction(() => window.anuOrchestrator && !document.getElementById("v4-loading-iframe"), null, { timeout: 240000, polling: 1000 });
    const r = await page.evaluate(() => { const o = window.anuOrchestrator; return { profile: window.SacredDeviceProfile, _isMobile: o._isMobile, dpr: o.renderer.getPixelRatio(), shadows: o.renderer.shadowMap.enabled, maxTex: o.renderer.capabilities.maxTextureSize, dprCeil: window.AnuUniverse?.adaptiveDpr?.snapshot?.()?.deviceCap ?? null }; });
    console.log(label, JSON.stringify(r), "| mobile GLBs:", glbs.filter((g) => g.includes(".mobile.")).length, "/", glbs.length);
    await ctx.close();
  }
  await b.close();
})();

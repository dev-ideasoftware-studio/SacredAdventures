const { chromium } = require("playwright");
(async () => {
  const out = process.argv[2];
  const b = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  for (const [label, port] of [["before", 8772], ["after", 8771]]) {
    const base = `http://127.0.0.1:${port}`;
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)$/, async (route) => {
      const rest = route.request().url().match(/three@0\.160\.0\/(.*)$/)[1].replace(/^build\//, "");
      const r = await fetch(`${base}/vendor/three/${rest}`);
      route.fulfill({ status: r.status, contentType: "application/javascript", body: Buffer.from(await r.arrayBuffer()) });
    });
    await ctx.route(/unpkg\.com\/lucide/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "window.lucide={createIcons(){}};" }));
    await ctx.addInitScript(() => { try { localStorage.setItem("sanctuary.welcomeGuide.seenV2", "1"); } catch (_) {} });
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => window.anuOrchestrator && !document.getElementById("v4-loading-iframe"), null, { timeout: 240000, polling: 1000 });
    // hide the sandbox-only CDN error bar so it doesn't cover the view
    await page.addStyleTag({ content: "#__boot_err{display:none!important}" });
    await page.waitForTimeout(20000);
    await page.screenshot({ path: `${out}/shot_${label}_full.png` });
    // avatar badge in the panel iframe, located in top-page coordinates
    const badge = await page.evaluate(() => { const f = document.getElementById("v4-panel-frame"); const fr = f.getBoundingClientRect(); const e = f.contentDocument.getElementById("avatar-pip-target"); if (!e) return null; const r = e.getBoundingClientRect(); return { x: fr.left + r.left, y: fr.top + r.top, w: r.width, h: r.height }; });
    console.log(label, "badge", JSON.stringify(badge));
    if (badge && badge.w > 0) await page.screenshot({ path: `${out}/shot_${label}_badge.png`, clip: { x: Math.max(0, badge.x - 8), y: Math.max(0, badge.y - 8), width: badge.w + 16, height: badge.h + 16 } });
    await ctx.close();
  }
  await b.close();
})();

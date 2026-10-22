const { chromium } = require("playwright");
const fs = require("fs");
const PROFILES = { phoneS: [320, 568, "iphone"], phoneM: [360, 740, "android"], phoneL: [390, 844, "iphone"], phoneLand: [844, 390, "iphone"], tablet: [768, 1024, "ipad"], desktop: [1280, 800, null] };
const UAS = { iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" };
(async () => {
  const [out, port] = process.argv.slice(2);
  const base = `http://127.0.0.1:${port}`;
  const b = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const all = {};
  for (const [name, [w, h, ua]] of Object.entries(PROFILES)) {
    const o = { viewport: { width: w, height: h } };
    if (ua) Object.assign(o, { userAgent: UAS[ua], isMobile: ua !== "ipad", hasTouch: true });
    const ctx = await b.newContext(o);
    if (ua === "ipad") await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 }));
    await ctx.addInitScript(() => { try { localStorage.setItem("sanctuary.welcomeGuide.seenV2", "1"); } catch (_) {} });
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)$/, async (route) => {
      const rest = route.request().url().match(/three@0\.160\.0\/(.*)$/)[1].replace(/^build\//, "");
      const r = await fetch(`${base}/vendor/three/${rest}`);
      route.fulfill({ status: r.status, contentType: "application/javascript", body: Buffer.from(await r.arrayBuffer()) });
    });
    await ctx.route(/unpkg\.com\/lucide/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "window.lucide={createIcons(){}};" }));
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => window.anuOrchestrator && !document.getElementById("v4-loading-iframe"), null, { timeout: 240000, polling: 1000 }).catch(() => {});
    await page.waitForTimeout(5000);
    const r = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const visible = (e, win) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const cs = win.getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false; } return true; };
      const docs = [{ doc: document, win: window, off: [0, 0], tag: "top" }];
      for (const id of ["v4-panel-frame", "v4-journal-frame"]) {
        const f = document.getElementById(id);
        if (f && f.contentDocument && visible(f, window)) { const fr = f.getBoundingClientRect(); docs.push({ doc: f.contentDocument, win: f.contentWindow, off: [fr.left, fr.top], tag: id }); }
      }
      const panels = [], small = [];
      for (const { doc, win, off, tag } of docs) {
        for (const e of doc.querySelectorAll("body *")) {
          const cs = win.getComputedStyle(e);
          if (cs.position !== "fixed" && cs.position !== "absolute") continue;
          if (!e.id) continue;
          const bb = e.getBoundingClientRect();
          const x = bb.left + off[0], y = bb.top + off[1], r2 = x + bb.width, b2 = y + bb.height;
          if (bb.width < 20 || bb.height < 16) continue;
          if (bb.width >= vw - 1 && bb.height >= vh - 1) continue;           // full-screen containers
          if (!visible(e, win)) continue;
          // effective visibility: is any point of it actually on top?
          panels.push({ doc: tag, el: "#" + e.id, x: Math.round(x), y: Math.round(y), r: Math.round(r2), b: Math.round(b2), z: cs.zIndex,
            outside: x < -0.5 || y < -0.5 || r2 > vw + 0.5 || b2 > vh + 0.5 });
        }
        for (const e of doc.querySelectorAll("button, a[href], [role=button], input, select, textarea, summary, [onclick]")) {
          if (!visible(e, win)) continue;
          const bb = e.getBoundingClientRect(); if (bb.width < 1 || bb.height < 1) continue;
          if (bb.right + off[0] < 0 || bb.left + off[0] > vw || bb.bottom + off[1] < 0 || bb.top + off[1] > vh) continue;
          if (bb.width < 44 || bb.height < 44) {
            const label = e.id ? "#" + e.id : (e.getAttribute("aria-label") || e.textContent || e.className || e.tagName).toString().trim().replace(/\s+/g, " ").slice(0, 32);
            small.push({ doc: tag, el: label, w: Math.round(bb.width), h: Math.round(bb.height) });
          }
        }
      }
      // keep outermost panels only
      const outer = panels.filter((p) => !panels.some((q) => q !== p && q.doc === p.doc && q.x <= p.x && q.y <= p.y && q.r >= p.r && q.b >= p.b && !(q.x === p.x && q.y === p.y && q.r === p.r && q.b === p.b)));
      const overlaps = [];
      for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++) {
        const a = outer[i], c = outer[j];
        const ow = Math.min(a.r, c.r) - Math.max(a.x, c.x), oh = Math.min(a.b, c.b) - Math.max(a.y, c.y);
        if (ow > 0 && oh > 0) overlaps.push(`${a.el}(${a.doc}) ∩ ${c.el}(${c.doc}) ${ow}x${oh}`);
      }
      return { viewport: [vw, vh], panels: outer, overlaps, smallTargets: small, hScroll: document.documentElement.scrollWidth > vw };
    });
    all[name] = r;
    await page.screenshot({ path: `${out}/panels_${name}.png` });
    console.log(name, "panels", r.panels.length, "outside", r.panels.filter((p) => p.outside).length, "overlaps", r.overlaps.length, "small", r.smallTargets.length);
    await ctx.close();
  }
  fs.writeFileSync(`${out}/panels.json`, JSON.stringify(all, null, 1));
  await b.close();
})();

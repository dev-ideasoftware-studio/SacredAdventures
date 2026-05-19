import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("SanctuaryPipOverlay"), { timeout: 90000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(async () => {
  // PIP overlay canvas + DOM
  const overlay = document.getElementById('v4-pip-overlay');
  const overlayCanvas = overlay?.querySelector('canvas');
  const overlayCtx = overlayCanvas?.getContext('2d');
  // Sample a pixel near the centre to confirm the overlay drew something
  let centerPixel = null;
  if (overlayCtx) {
    const d = overlayCtx.getImageData(110, 30, 1, 1).data; // near top center where N label sits
    centerPixel = [d[0], d[1], d[2], d[3]];
  }
  // Panel iframe
  const panel = document.getElementById('v4-panel-frame');
  const panelOpenInitially = panel?.classList.contains('open');
  // Toggle via P
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
  await new Promise(s => setTimeout(s, 60));
  const panelOpenAfterP = !!document.getElementById('v4-panel-frame')?.classList.contains('open');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
  await new Promise(s => setTimeout(s, 60));
  const panelOpenAfterP2 = !!document.getElementById('v4-panel-frame')?.classList.contains('open');
  // Journal still toggles via J
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
  await new Promise(s => setTimeout(s, 60));
  const journalOpenAfterJ = !!window._v4JournalOpen;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await new Promise(s => setTimeout(s, 60));
  const journalOpenAfterEsc = !!window._v4JournalOpen;
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const r = orc.renderer.info.render;
  return {
    overlay: {
      present: !!overlay,
      canvasSize: overlayCanvas ? `${overlayCanvas.width}x${overlayCanvas.height}` : null,
      centerPixelNonZero: centerPixel && (centerPixel[0] + centerPixel[1] + centerPixel[2] + centerPixel[3]) > 0,
    },
    panel: { present: !!panel, panelOpenInitially, panelOpenAfterP, panelOpenAfterP2 },
    journal: { openOnJ: journalOpenAfterJ, closedOnEsc: !journalOpenAfterEsc },
    fps: +orc.smoothFPS.toFixed(2),
    rendered: { tris: r.triangles, calls: r.calls },
    audit: Anu.audit?.() ?? null,
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck?.level ?? null,
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

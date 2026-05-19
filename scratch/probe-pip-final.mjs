import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const failures = [];
page.on("response", r => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
const errors = [];
page.on("pageerror", e => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", m => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("PanelsPIP"), { timeout: 90000 });
await page.waitForTimeout(7000);
// Open panel + journal to trigger their loads too
await page.evaluate(() => { window._v4TogglePanel?.(); });
await page.waitForTimeout(2000);
await page.evaluate(() => { window._v4ToggleJournal?.(); });
await page.waitForTimeout(2000);

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  // v2 moondial elements
  const moondial = document.getElementById('moondial-wrapper');
  const pipCanvas = document.getElementById('pipCanvas');
  const pipOverlay = document.getElementById('pipOverlay');
  const compassRing = document.querySelector('.compass-outer-ring');
  const seasonRing = document.getElementById('season-ring');
  const lunarSlots = document.querySelectorAll('.lunar-phase-slot');
  const seasonButtons = document.querySelectorAll('.season-btn');
  return {
    activeModuleCount: orc._activeModules.length,
    moondialDom: {
      wrapper: !!moondial,
      pipCanvas: !!pipCanvas,
      pipOverlay: !!pipOverlay,
      compass: !!compassRing,
      seasonRing: !!seasonRing,
      lunarSlots: lunarSlots.length,
      seasonBtns: seasonButtons.length,
    },
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2) },
    rendered: { tris: orc.renderer.info.render.triangles, calls: orc.renderer.info.render.calls },
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck?.level,
    audit: Anu.audit?.(),
  };
});
console.log(JSON.stringify({ http404s: failures, jsErrors: errors.slice(0,4), ...out }, null, 2));
await browser.close();

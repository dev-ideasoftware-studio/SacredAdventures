/**
 * Smoke probe for the May-17 2026 fishing redesign:
 *  • ENTER key tap (not space)
 *  • Camera 10 ft above + 45° down
 *  • Player circle → fish circle on EQUIPPED
 *  • Movement suppressed for entire fishing session
 *  • HUD is corner-FPV layout (no centred modal)
 */
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(`[console err] ${m.text()}`); });

await page.goto("http://127.0.0.1:5500/index.v2.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("Fishing"), { timeout: 90000 });
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const fishing = orc?._activeModuleInstances?.Fishing;
  const hud = document.getElementById("v2-fishing-hud");
  const status = document.getElementById("v2-fishing-status");
  const catchChip = document.getElementById("v2-fishing-catch");
  const panel = document.getElementById("v2-fishing-panel");
  const hint = document.getElementById("v2-fishing-hint");
  const needle = document.getElementById("v2-fishing-needle");

  // Programmatically push the fishing module into FIGHTING so we can
  // observe the corner-HUD layout in its full state.
  let fightingPanelLayout = null;
  if (fishing) {
    try { fishing._enter("EQUIPPED"); } catch (_) {}
    try { fishing._enter("FIGHTING"); } catch (_) {}
    if (panel) {
      const r = panel.getBoundingClientRect();
      fightingPanelLayout = {
        display: panel.style.display,
        right: Math.round(window.innerWidth - r.right),
        bottom: Math.round(window.innerHeight - r.bottom),
        width: Math.round(r.width),
      };
    }
  }

  // After FIGHTING entry, also check hint + engaged flag
  return {
    hudFound: !!hud,
    statusFound: !!status,
    catchChipFound: !!catchChip,
    panelFound: !!panel,
    hintFound: !!hint,
    needleFound: !!needle,
    fightingPanelLayout,
    engagedFlag: window._v2FishingEngaged,
    fishingActiveFlag: window._v2FishingActive,
    catchPos: catchChip ? (() => { const r = catchChip.getBoundingClientRect(); return { top: Math.round(r.top), rightOffset: Math.round(window.innerWidth - r.right) }; })() : null,
    statusPos: status ? (() => { const r = status.getBoundingClientRect(); return { top: Math.round(r.top), centeredX: Math.round((r.left + r.right) / 2 - window.innerWidth / 2) }; })() : null,
    cameraConstants: {
      FISHING_CAM_HEIGHT_M: fishing?.constructor?.name === "Object" ? "n/a" : "(constants are module-private)",
    },
    tapKeyWasDown: fishing?._tapKeyWasDown,
  };
});

console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("SanctuaryDayNight"), { timeout: 90000 });
// Wait long enough that at least one fish jump could fire (8s minimum)
await page.waitForTimeout(11000);

const out = await page.evaluate(async () => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  // Pad
  let padFound = false, padStones = 0, padGlow = false, padAnchor = null;
  orc.scene.traverse(o => {
    if (o.name === "sanctuary_village_pad") padFound = true;
    if (o.userData?.anuKind === "sanctuary_village_pad_stone") padStones++;
    if (o.userData?.anuKind === "sanctuary_village_pad_glow") padGlow = true;
  });
  padAnchor = window.__sanctuaryVillagePad ?? null;
  // Fish jumps — module presence + at least one cycle scheduled
  const jumpMod = orc._activeModuleInstances?.SanctuaryFishJumps;
  const jumpState = jumpMod ? {
    elapsed: +jumpMod._elapsed.toFixed(1),
    nextJumpAtS: +jumpMod._nextJumpAtS.toFixed(1),
    hasActive: !!jumpMod._active,
  } : null;
  // Day-night button + toggle
  const btn = document.getElementById('v4-btn-day-night');
  const dnInitial = btn?.textContent?.trim() ?? null;
  const dnMod = orc._activeModuleInstances?.SanctuaryDayNight;
  const dnNightBefore = dnMod?._isNight;
  btn?.click();
  await new Promise(s => setTimeout(s, 100));
  const dnNightAfter = dnMod?._isNight;
  const dnLabelAfter = btn?.textContent?.trim() ?? null;
  return {
    pad: { found: padFound, stones: padStones, glow: padGlow, anchor: padAnchor },
    jumps: jumpState,
    dayNight: { initialLabel: dnInitial, nightBefore: dnNightBefore, nightAfter: dnNightAfter, labelAfter: dnLabelAfter },
    fps: +orc.smoothFPS.toFixed(2),
    rendered: { tris: orc.renderer.info.render.triangles, calls: orc.renderer.info.render.calls },
    audit: Anu.audit?.() ?? null,
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck?.level ?? null,
  };
});
console.log(JSON.stringify({ errors: errors.slice(0,4), ...out }, null, 2));
await browser.close();

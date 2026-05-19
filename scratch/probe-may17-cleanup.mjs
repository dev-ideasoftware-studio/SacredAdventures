/**
 * May-17 2026 cleanup probe — verifies after the 6-step cleanup:
 *   • Trees / Fauna / QuietGlade / DistantPeaks not active
 *   • BuildMode does not restore seeds (small trees gone)
 *   • Two-range terrain: inner rolling hills + south-open outer wall
 *   • PiP stride uplifted to 8
 */
import { chromium } from "playwright";

const ROOT = "http://127.0.0.1:5500/index.v2.html";
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(`[console err] ${m.text()}`); });

// Pre-seed BuildMode storage with some saved trees, then load — to
// prove the new `_restoreFromStorage` skips them.
await page.goto(ROOT, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  const fakeSeeds = {
    seeds: [
      { x: 5, z: -5, plantedAt: 100, baseScale: 1, rotY: 0 },
      { x: -3, z: 4, plantedAt: 200, baseScale: 1, rotY: 0 },
    ],
    buildings: [],
    rocks: [],
    reeds: [],
  };
  try {
    window.localStorage.setItem("v2.build.scene0", JSON.stringify(fakeSeeds));
  } catch (_) {}
});
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._fpsReady, { timeout: 90000 });
await page.waitForTimeout(2500);

await page.evaluate(async () => {
  const mod = await import("./js/v2/WorldTerrain.js");
  window._probeTerrainY = mod.terrainY;
});

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const y = window._probeTerrainY;

  const activeModules = orc?._activeModules ? [...orc._activeModules] : [];
  const buildMode = orc?._activeModuleInstances?.BuildMode;
  const seedsAfterBoot = buildMode?._seeds?.length ?? null;
  const stored = window.localStorage.getItem("v2.build.scene0");
  const storedParsed = stored ? JSON.parse(stored) : null;

  // Terrain samples across all eight compass points + the south "gap"
  // arc to verify the outer wall opens south.
  const samples = {};
  for (const [label, gx, gz] of [
    ["inner_N",  0,  65], ["inner_S",  0, -65],
    ["inner_E", 65,   0], ["inner_W",-65,   0],
    ["outer_N",  0, 105], ["outer_NE", 75, 75], ["outer_NW",-75, 75],
    ["outer_E",105,   0], ["outer_W",-105,  0],
    ["outer_SE", 75,-75], ["outer_SW",-75,-75],
    ["outer_S",  0,-105],
    ["behind_pond", 10, 78],
  ]) {
    samples[label] = +y(gx, gz).toFixed(2);
  }

  const fuzzy = Anu?.getFuzzyPipelineSnapshot?.(orc);
  const renderInfo = orc?.renderer?.info?.render;

  return {
    activeModules,
    seedsAfterBoot,
    storedSeedCount: storedParsed?.seeds?.length ?? null,
    smoothFPS: orc?.smoothFPS,
    rendererInfo: renderInfo ? { calls: renderInfo.calls, triangles: renderInfo.triangles } : null,
    samples,
    fuzzyTopBottleneck: fuzzy?.primaryBottleneck?.id ?? null,
    fuzzyTopLevel: fuzzy?.primaryBottleneck?.level ?? null,
    pipBaseline: fuzzy?.currentState?.rendering?.pipBaseline ?? null,
    pipEffectiveStride: fuzzy?.currentState?.rendering?.pipEffectiveStride ?? null,
  };
});

console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

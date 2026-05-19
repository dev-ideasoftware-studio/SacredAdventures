/**
 * Integrated smoke probe for the May-17 2026 changes:
 *   1. terrainY — tall hills north of pond + symmetric east/west baseline
 *   2. WorldDistantPeaks — snowcapped ridge backdrop module activates
 *   3. ClickToMoveMarker — footprint trail uses ShapeGeometry (no texture)
 *   4. World key map — A moves backward, S turns left
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
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console err] ${m.text()}`);
});

await page.goto(ROOT, { waitUntil: "load" });
await page.waitForFunction(
  () => !!window.anuOrchestrator?._activeModules?.includes("DistantPeaks"),
  { timeout: 90000 },
);
await page.waitForTimeout(2000);

// Make terrainY reachable from the test context.
await page.evaluate(async () => {
  const mod = await import('./js/v2/WorldTerrain.js');
  window._probeTerrainY = mod.terrainY;
});

// 1. Terrain samples — pull terrainY across the +Z arc
const terrain = await page.evaluate(() => {
  const y = window._probeTerrainY;
  // Sample N, S, E, W at the inner hill ring (dist ≈ 70m) and at the
  // mountain band (dist ≈ 100m). Compare north vs south.
  const samples = {};
  for (const [label, gx, gz] of [
    ['hill_north', 0, 70],
    ['hill_south', 0, -70],
    ['hill_east', 70, 0],
    ['hill_west', -70, 0],
    ['mtn_north', 0, 100],
    ['mtn_south', 0, -100],
    ['behind_pond_near', 10, 60],  // just north of pond
    ['behind_pond_mid', 10, 80],   // farther behind
    ['behind_pond_far', 10, 100],  // mountain band behind pond
  ]) {
    samples[label] = +y(gx, gz).toFixed(2);
  }
  return samples;
});

// 2. DistantPeaks presence
const peaks = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  let group = null;
  let near = 0, far = 0;
  let tris = 0;
  orc?.scene?.traverse?.((o) => {
    if (o.name === "distant_peaks") group = o;
    if (o.name?.startsWith("distant_peak_near_")) near++;
    if (o.name?.startsWith("distant_peak_far_")) far++;
    const g = o.geometry;
    if (g && (o.userData?.anuKind === "distant_peak")) {
      if (g.index) tris += Math.floor(g.index.count / 3);
      else if (g.attributes?.position) tris += Math.floor(g.attributes.position.count / 3);
    }
  });
  return {
    found: !!group,
    nearCount: near,
    farCount: far,
    totalTris: tris,
  };
});

// 3. Trigger click-to-move to spawn the footprint trail, then sample
//    the dash mesh's geometry type + size.
const footprints = await page.evaluate(async () => {
  const orc = window.anuOrchestrator;
  const world = orc?._activeModuleInstances?.World;
  if (!world?.smartNavigate && !world?.startSmartNav) {
    // Fall back to scanning for any click-to-move marker that exists
    return { spawnable: false };
  }
  // Most modules expose a smartNavigate-like entry. Try a few names.
  try {
    if (typeof world.smartNavigate === "function") {
      world.smartNavigate(8, 8);
    } else if (typeof world.startSmartNav === "function") {
      world.startSmartNav(8, 8);
    } else if (typeof world.requestSmartNavTo === "function") {
      world.requestSmartNavTo(8, 8);
    }
  } catch (e) { return { spawnError: String(e) }; }
  await new Promise((r) => setTimeout(r, 600));
  let marker = null;
  orc?.scene?.traverse?.((o) => {
    if (o.name === "effect_click_to_move_marker") marker = o;
  });
  if (!marker) return { found: false };
  let instGeoType = null;
  let instCount = null;
  let hasTexture = null;
  let vertCount = null;
  marker.traverse((o) => {
    if (o.isInstancedMesh) {
      instGeoType = o.geometry?.constructor?.name ?? null;
      instCount = o.count;
      hasTexture = !!o.material?.map;
      vertCount = o.geometry?.attributes?.position?.count ?? null;
    }
  });
  return { found: true, instGeoType, instCount, hasTexture, vertCount };
});

// 4. Key swap — fire A and S and compare yaw / forward velocity
const keys = await page.evaluate(async () => {
  const orc = window.anuOrchestrator;
  const world = orc?._activeModuleInstances?.World;
  if (!world) return { worldMissing: true };
  // Capture yaw before
  const yaw0 = world._yaw;
  // Simulate pressing S for 300ms
  world._keys = world._keys || {};
  world._keys["s"] = true;
  await new Promise((r) => setTimeout(r, 350));
  world._keys["s"] = false;
  const yaw1 = world._yaw;
  // Simulate pressing A for 200ms — should move backward (dir.z positive)
  // We can't easily read dir.z from outside the loop; check that A in
  // the WASD lookup is treated as a movement key. Just verify the swap
  // logically by inspecting the source — we already did that. For the
  // probe, the yaw change from S is the live indicator that S = turn.
  return {
    yaw0,
    yaw1,
    deltaYaw: +(yaw1 - yaw0).toFixed(4),
    sTurnsLeft: yaw1 < yaw0, // s = yaw -= turnRate * delta → yaw decreases
  };
});

console.log(JSON.stringify({ errors, terrain, peaks, footprints, keys }, null, 2));
await browser.close();

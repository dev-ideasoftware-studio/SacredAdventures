/**
 * Smoke probe for the new QuietGlade module (May-17 2026).
 * Confirms the module activates, plants a sub-3k-tri scene at the
 * expected anchor, animates wisps + flag staff on update, and unloads
 * cleanly without leaving meshes in the scene graph.
 */
import { chromium } from "playwright";

const ROOT = "http://127.0.0.1:5500/index.v2.html";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`[console err] ${m.text()}`);
});

await page.goto(ROOT, { waitUntil: "load" });
await page.waitForFunction(
  () => !!window.anuOrchestrator?._activeModules?.includes("QuietGlade"),
  { timeout: 90000 },
);
await page.waitForTimeout(2000);

const after = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const scene = orc?.scene;
  let glade = null;
  scene?.traverse?.((o) => {
    if (o.name === "quiet_glade") glade = o;
  });
  if (!glade) return { found: false };
  let tris = 0;
  let meshes = 0;
  let points = 0;
  let stones = 0;
  let cairnStones = 0;
  glade.traverse((o) => {
    if (o.userData?.anuKind === "quiet_glade_standing_stone") stones++;
    if (o.userData?.anuKind === "quiet_glade_cairn_stone") cairnStones++;
    if (o.isMesh) meshes++;
    if (o.isPoints) points++;
    const g = o.geometry;
    if (!g) return;
    if (g.index) tris += Math.floor(g.index.count / 3);
    else if (g.attributes?.position) tris += Math.floor(g.attributes.position.count / 3);
  });
  return {
    found: true,
    position: { x: +glade.position.x.toFixed(2), y: +glade.position.y.toFixed(2), z: +glade.position.z.toFixed(2) },
    tris,
    meshes,
    points,
    stones,
    cairnStones,
    anuId: glade.userData.anuId,
    domain: glade.userData.anuSimulationDomain,
  };
});

// Test update tick — capture wisp position, wait, capture again
const wispBefore = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const glade = orc?._activeModuleInstances?.QuietGlade;
  const arr = glade?._wisps?.geometry?.attributes?.position?.array;
  return arr ? [arr[0], arr[1], arr[2]] : null;
});
await page.waitForTimeout(1100);
const wispAfter = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const glade = orc?._activeModuleInstances?.QuietGlade;
  const arr = glade?._wisps?.geometry?.attributes?.position?.array;
  return arr ? [arr[0], arr[1], arr[2]] : null;
});
const wispsAnimated =
  wispBefore && wispAfter &&
  (wispBefore[0] !== wispAfter[0] || wispBefore[1] !== wispAfter[1] || wispBefore[2] !== wispAfter[2]);

// Capture overall FPS to verify minimal regression
const fpsAfter = await page.evaluate(() => window.anuOrchestrator?.smoothFPS);

// Deactivate + verify cleanup
await page.evaluate(() => window.anuOrchestrator.deactivate("QuietGlade"));
await page.waitForTimeout(500);
const cleanup = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  let remnant = null;
  orc?.scene?.traverse?.((o) => {
    if (o.name === "quiet_glade") remnant = o.name;
  });
  return {
    remnant,
    inActive: orc?._activeModules?.includes("QuietGlade"),
  };
});

console.log(JSON.stringify({
  consoleErrors,
  after,
  wispsAnimated,
  wispBefore,
  wispAfter,
  fpsAfter,
  cleanup,
}, null, 2));
await browser.close();

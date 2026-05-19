/**
 * FPS forensic probe — May 12 2026.
 *
 * User report: "FPS IS BACK to horrible". This probe boots index.v2.html,
 * waits 8 seconds past full activation for the FPS EMA to stabilize, then
 * captures:
 *
 *   1. Engine smoothFPS / rawFPS / peakFPS from anuOrchestrator
 *   2. Per-module fpsCost numbers (the orchestrator's bench results)
 *   3. window.icons._liteStride — confirms Tier-B is still active
 *   4. window.icons.scenes.length — number of active icon slots
 *   5. Number of <canvas> elements + their sizes (fill-rate proxy)
 *   6. AnuUniverse.audit() — live pipeline risk alerts
 *   7. AnuUniverse.getFuzzyPipelineSnapshot() — current pipeline view
 *   8. PiP render strategy + render-every-N-frames
 *   9. Counts of expensive scene objects (skinned meshes, mixers)
 */
import { chromium } from "playwright";

const ROOT = "http://127.0.0.1:5500/index.v2.html";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--enable-features=Vulkan",
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

// Wait until V2Panel is active and icons renderer is online.
await page.waitForFunction(
  () => !!window.icons && !!document.getElementById("v2-hud-dock"),
  { timeout: 90000 },
);

// 8 seconds for the orchestrator's FPS EMA to warm + benches to land.
await page.waitForTimeout(8000);

const snapshot = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;

  const out = {};

  // ── 1. FPS ─────────────────────────────────────────────────────────────
  out.fps = {
    smooth: orc?.smoothFPS ?? null,
    raw: orc?.rawFPS ?? null,
    peak: orc?._peakFPS ?? null,
    fpsReady: orc?._fpsReady ?? null,
    frameCount: orc?._frameCount ?? null,
  };

  // ── 2. Per-module bench (cost-of-activation in FPS delta) ──────────────
  const reg = orc?._registry;
  if (reg) {
    out.moduleBench = [];
    for (const [name, entry] of reg) {
      out.moduleBench.push({
        name,
        active: entry.active,
        fpsCost: entry.fpsCost, // null if not benched yet
      });
    }
  }

  // ── 3. Tier-B icon renderer ────────────────────────────────────────────
  const icons = window.icons;
  out.icons = {
    constructor: icons?.constructor?.name ?? null,
    liteStride: icons?._liteStride ?? null,
    sceneCount: icons?.scenes?.length ?? null,
    rendererDomElementInDom: icons?.renderer?.domElement?.isConnected ?? null,
  };

  // ── 4. Canvas inventory (fill-rate proxy) ──────────────────────────────
  const W = window.innerWidth;
  const H = window.innerHeight;
  out.canvases = Array.from(document.querySelectorAll("canvas")).map((c) => {
    const r = c.getBoundingClientRect();
    return {
      id: c.id || null,
      width: c.width,
      height: c.height,
      cssRect: { w: Math.round(r.width), h: Math.round(r.height) },
      fullscreen: r.width >= W * 0.9 && r.height >= H * 0.9,
      visible: r.width > 0 && r.height > 0,
    };
  });
  out.canvases.totalCount = document.querySelectorAll("canvas").length;

  // ── 5. Anu audit ───────────────────────────────────────────────────────
  try {
    out.audit = Anu?.audit?.() ?? null;
  } catch (e) {
    out.audit = { error: String(e) };
  }
  try {
    out.fuzzy = Anu?.getFuzzyPipelineSnapshot?.(orc) ?? null;
  } catch (e) {
    out.fuzzy = { error: String(e) };
  }

  // ── 6. Scene-level heavy-object inventory ──────────────────────────────
  // Bucket triangles by top-level scene-group ancestor + by simulation
  // domain (set on userData.anuSimulationDomain). This pinpoints the
  // single largest contributor without instrumenting each module.
  const scene = orc?.scene;
  let skinnedMeshes = 0;
  let meshes = 0;
  let particleSystems = 0;
  let opaqueCount = 0;
  let transparentCount = 0;
  let totalTriangles = 0;
  const triByTopGroup = {};
  const triByDomain = {};
  const triByName = []; // top-N per-mesh costs

  function countMeshTris(o) {
    const g = o.geometry;
    if (!g) return 0;
    if (g.index) return Math.floor(g.index.count / 3);
    if (g.attributes?.position) return Math.floor(g.attributes.position.count / 3);
    return 0;
  }
  function topGroupNameOf(o) {
    let cur = o;
    while (cur && cur.parent && cur.parent.parent) cur = cur.parent;
    return cur?.name || cur?.userData?.anuId || "<unnamed>";
  }
  function domainOf(o) {
    let cur = o;
    while (cur) {
      const d = cur.userData?.anuSimulationDomain;
      if (d) return d;
      cur = cur.parent;
    }
    return "untagged";
  }

  // Visibility-aware tri counts — Three.js skips invisible subtrees in
  // the render pass, so the "visible only" total is the honest GPU load.
  let visibleTriangles = 0;
  function isVisibleChain(o) {
    let cur = o;
    while (cur) {
      if (cur.visible === false) return false;
      cur = cur.parent;
    }
    return true;
  }

  if (scene) {
    scene.traverse?.((o) => {
      if (o.isSkinnedMesh) skinnedMeshes++;
      if (o.isMesh || o.isInstancedMesh) {
        meshes++;
        const tris = countMeshTris(o);
        const instCount = o.isInstancedMesh ? o.count ?? 1 : 1;
        const totalTris = tris * instCount;
        totalTriangles += totalTris;
        const vis = isVisibleChain(o);
        if (vis) visibleTriangles += totalTris;

        const top = topGroupNameOf(o);
        triByTopGroup[top] = (triByTopGroup[top] || 0) + totalTris;

        const dom = domainOf(o);
        triByDomain[dom] = (triByDomain[dom] || 0) + totalTris;

        triByName.push({
          name: o.name || top,
          isInst: !!o.isInstancedMesh,
          isSkinned: !!o.isSkinnedMesh,
          visible: vis,
          tris,
          instCount,
          total: totalTris,
        });

        if (Array.isArray(o.material)) {
          for (const m of o.material) {
            if (m?.transparent) transparentCount++;
            else opaqueCount++;
          }
        } else if (o.material?.transparent) transparentCount++;
        else if (o.material) opaqueCount++;
      }
      if (o.isPoints) particleSystems++;
    });
  }
  triByName.sort((a, b) => b.total - a.total);

  // Three.js renderer.info.render — what was *actually* drawn last frame.
  // calls = draw calls submitted; triangles = tris actually rasterized
  // (mixes main pass + PiP pass if both ran).
  const r = orc?.renderer?.info?.render;
  const rendererInfo = r
    ? {
        calls: r.calls,
        triangles: r.triangles,
        points: r.points,
        lines: r.lines,
        frame: r.frame,
      }
    : null;

  out.scene = {
    skinnedMeshes,
    meshes,
    opaqueCount,
    transparentCount,
    particleSystems,
    totalTriangles,
    visibleTriangles,
    invisibleTriangles: totalTriangles - visibleTriangles,
    rendererInfoRender: rendererInfo,
    top10Meshes: triByName.slice(0, 10),
    triByTopGroup: Object.entries(triByTopGroup)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, v]) => ({ name: k, tris: v })),
    triByDomain: Object.entries(triByDomain)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ domain: k, tris: v })),
  };

  // Inventory rabbit family + spirit specifically (user-attributed costs).
  const rabbits = [];
  scene?.traverse?.((o) => {
    if (typeof o.name === "string" && o.name.startsWith("fauna_rabbit_")) {
      let tris = 0;
      o.traverse?.((c) => {
        if (c.isMesh || c.isSkinnedMesh) tris += countMeshTris(c);
      });
      rabbits.push({
        name: o.name,
        position: { x: +o.position.x.toFixed(2), z: +o.position.z.toFixed(2) },
        tris,
        visible: o.visible,
      });
    }
  });
  out.fauna = { rabbitCount: rabbits.length, rabbits };

  // Spirit specifically — its 748k-tri model lives in the scene even
  // while invisible during WAIT_TO_APPEAR / COOLDOWN. Confirm visibility.
  const ns = window.natureSpiritSystem;
  let spiritTris = 0;
  ns?.root?.traverse?.((c) => {
    if (c.isMesh || c.isSkinnedMesh) spiritTris += countMeshTris(c);
  });
  out.spiritDetail = {
    state: ns?.state ?? null,
    rootVisible: ns?.root?.visible ?? null,
    bloomVisible: ns?._bloom?.group?.visible ?? null,
    footCircleVisible: ns?._footCircle?.group?.visible ?? null,
    sceneTris: spiritTris,
    opacity: ns?._opacity ?? null,
  };

  // ── 7. PiP info ────────────────────────────────────────────────────────
  out.pip = {
    renderedLastFrame: orc?._pipRenderedLastFrame ?? null,
    strategy: orc?._pipStrategy?.getSnapshot?.() ?? null,
  };


  return out;
});

console.log(JSON.stringify({ consoleErrors, ...snapshot }, null, 2));
await browser.close();

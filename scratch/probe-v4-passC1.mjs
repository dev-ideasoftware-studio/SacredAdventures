import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("SanctuaryZoom"), { timeout: 90000 });
await page.waitForTimeout(6000);

const out = await page.evaluate(async () => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;

  // (1) Cloud check
  let clouds = 0, cloudSprites = 0, baselineOpacities = [];
  orc.scene.traverse(o => {
    if (o.userData?.anuKind === "sanctuary_cloud") {
      clouds++;
      if (o.userData.cloudMat) baselineOpacities.push(+o.userData.baseOpacity.toFixed(2));
    }
    if (o.userData?.anuKind === "sanctuary_cloud_billboard") cloudSprites++;
  });

  // (2) Avatar shell material is now PBR
  let shellMatType = null;
  let shellHasEmissive = null;
  let avatarMatHasEmissive = null;
  orc.scene.traverse(o => {
    if (o.name === "sanctuary_avatar_skin_fill" && o.children?.[0]?.material) {
      shellMatType = o.children[0].material.constructor.name;
      shellHasEmissive = o.children[0].material.emissive
        ? (o.children[0].material.emissive.r + o.children[0].material.emissive.g + o.children[0].material.emissive.b) > 0
        : false;
    }
    if (o.userData?.anuKind === "sanctuary_avatar_mesh") {
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mat?.emissive) {
        avatarMatHasEmissive = (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0;
      }
    }
  });

  // (3) Zoom factor + top-down height registered on window
  const zoomState = {
    fpvFactor: window.__sanctuaryZoomFactor,
    topDownY: window.__sanctuaryTopDownHeight,
  };

  // (4) Journal overlay + j-key wired
  const journal = {
    overlayPresent: !!document.getElementById('v4-journal-overlay'),
    framePresent: !!document.getElementById('v4-journal-frame'),
    toggleFn: typeof window._v4ToggleJournal === 'function',
    initiallyClosed: !window._v4JournalOpen,
  };

  // Simulate j-key + verify journal opens
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
  await new Promise(s => setTimeout(s, 50));
  const journalAfterJ = window._v4JournalOpen;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await new Promise(s => setTimeout(s, 50));
  const journalAfterEsc = window._v4JournalOpen;

  return {
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2) },
    rendered: { tris: orc.renderer.info.render.triangles, calls: orc.renderer.info.render.calls },
    clouds: { count: clouds, sprites: cloudSprites, baselineOpacities },
    avatar: { shellMatType, shellHasEmissive, avatarMatHasEmissive },
    zoom: zoomState,
    journal: { ...journal, openedOnJ: journalAfterJ, closedOnEsc: !journalAfterEsc },
    audit: Anu.audit?.(),
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck,
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

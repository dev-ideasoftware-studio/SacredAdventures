import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("AnuAdaptiveDpr"), { timeout: 90000 });
await page.waitForTimeout(7000);

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const r = orc.renderer.info.render;

  // (1) Dock railings — count balusters
  let balusters = 0, topRails = 0, midRails = 0;
  orc.scene.traverse((o) => {
    if (o.userData?.anuKind === "sanctuary_dock_baluster") balusters++;
    if (o.name === "sanctuary_dock_rail_top") topRails++;
    if (o.name === "sanctuary_dock_rail_mid") midRails++;
  });

  // (2) Avatar present + shell present + transparency check
  let avatarFound = false, shellFound = false, transparentMats = 0, opaqueMats = 0;
  orc.scene.traverse((o) => {
    if (o.name === "sanctuary_avatar") avatarFound = true;
    if (o.name === "sanctuary_avatar_skin_fill") shellFound = true;
    if ((o.isMesh || o.isSkinnedMesh) && o.userData?.anuKind === "sanctuary_avatar_mesh") {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.transparent === true || (typeof m.opacity === 'number' && m.opacity < 1)) transparentMats++;
        else opaqueMats++;
      }
    }
  });

  // (3) Controls UI present
  const ui = {
    controlsBar: !!document.getElementById('v4-controls'),
    btnTop: !!document.getElementById('v4-btn-top'),
    btnReset: !!document.getElementById('v4-btn-reset'),
    btnSave: !!document.getElementById('v4-btn-save'),
    confirmModal: !!document.getElementById('v4-confirm'),
  };

  // (4) AnuAdaptiveDpr surface
  const dpr = Anu?.adaptiveDpr?.snapshot?.() ?? null;

  // (5) Mutations registry surface
  const mutations = {
    hasPublish: typeof window.SanctuaryMutations?.publish === 'function',
    hasReset: typeof window.SanctuaryMutations?.applyReset === 'function',
    hasSave: typeof window.SanctuaryMutations?.serialize === 'function',
    tools: window.SanctuaryMutations?.TOOLS ?? null,
  };

  return {
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2) },
    rendered: { tris: r.triangles, calls: r.calls },
    activeModules: [...orc._activeModules],
    dockRail: { balusters, topRails, midRails },
    avatar: { found: avatarFound, shell: shellFound, transparentMats, opaqueMats },
    ui,
    adaptiveDpr: dpr,
    mutations,
    audit: Anu?.audit?.() ?? null,
    primary: Anu?.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck ?? null,
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("SanctuaryPip"), { timeout: 90000 });
await page.waitForTimeout(8000);

const out = await page.evaluate(async () => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const r = orc.renderer.info.render;

  // Test each mold tool
  const before = {};
  const after = {};
  const probes = [
    { tool: "plant_bush",   x: -8,  z: -14, kind: "sanctuary_mold_bush" },
    { tool: "plant_lily",   x:  2,  z:  2,  kind: "sanctuary_mold_lily" },
    { tool: "plant_rock",   x:  18, z:  0,  kind: "sanctuary_mold_rocks" },
  ];
  for (const p of probes) {
    let count = 0;
    orc.scene.traverse(o => { if (o.userData?.anuKind === p.kind) count++; });
    before[p.tool] = count;
    window.SanctuaryMutations?.publish(p.tool, p.x, p.z);
    count = 0;
    orc.scene.traverse(o => { if (o.userData?.anuKind === p.kind) count++; });
    after[p.tool] = count;
  }

  // Keyboard look — simulate W press via the module's _keys map
  const kbd = orc._activeModuleInstances?.SanctuaryKeyboardLook;
  const avBefore = window.__sanctuaryAvatar ? { x: +window.__sanctuaryAvatar.position.x.toFixed(2), z: +window.__sanctuaryAvatar.position.z.toFixed(2) } : null;
  if (kbd) {
    kbd._keys = { w: true };
    await new Promise(s => setTimeout(s, 500));
    kbd._keys = {};
  }
  const avAfter = window.__sanctuaryAvatar ? { x: +window.__sanctuaryAvatar.position.x.toFixed(2), z: +window.__sanctuaryAvatar.position.z.toFixed(2) } : null;

  // Pip presence
  const pip = !!document.getElementById('v4-pip');

  // Butterflies
  let butterflies = 0;
  orc.scene.traverse(o => { if (o.userData?.anuKind === "sanctuary_butterfly") butterflies++; });

  // Instanced flora pieces
  let instancedFlora = 0;
  orc.scene.traverse(o => { if (o.isInstancedMesh && o.userData?.anuKind?.startsWith("sanctuary_") &&
                              ["sanctuary_wildflower_stems","sanctuary_wildflower_blossoms","sanctuary_mushroom_stems","sanctuary_mushroom_caps","sanctuary_grass_tufts"].includes(o.userData.anuKind)) instancedFlora++; });

  return {
    activeModuleCount: orc._activeModules.length,
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2) },
    rendered: { tris: r.triangles, calls: r.calls },
    instancedFloraNodes: instancedFlora,
    butterflies,
    pipPresent: pip,
    moldTests: probes.map(p => ({ tool: p.tool, before: before[p.tool], after: after[p.tool] })),
    keyboardTest: { avatarBefore: avBefore, avatarAfter: avAfter },
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck ?? null,
    audit: Anu.audit?.() ?? null,
    sensorium: Object.fromEntries(
      Object.entries(Anu.getWorldSensoriumSnapshot?.()?.domains || {})
        .map(([k, v]) => [k, `${v.drawables}d / ${v.trianglesEstimate}t / ${v.interactables}i`]),
    ),
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

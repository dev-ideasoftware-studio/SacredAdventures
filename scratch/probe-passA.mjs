import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("SanctuaryToolPalette"), { timeout: 90000 });
await page.waitForTimeout(7000);

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const r = orc.renderer.info.render;
  // Scene presence
  let clouds = 0, birds = 0, flowers = 0, mushrooms = 0, grass = 0;
  orc.scene.traverse(o => {
    const k = o.userData?.anuKind;
    if (k === "sanctuary_cloud") clouds++;
    if (k === "sanctuary_bird") birds++;
    if (k === "sanctuary_wildflower_cluster") flowers++;
    if (k === "sanctuary_mushroom_cluster") mushrooms++;
    if (k === "sanctuary_grass_tuft") grass++;
  });
  // Trigger a tree + flower mutation
  let treesBefore = 0;
  orc.scene.traverse(o => { if (o.userData?.anuKind === "sanctuary_tree") treesBefore++; });
  window.SanctuaryMutations?.publish("plant_tree", 8, -18);
  window.SanctuaryMutations?.publish("plant_flower", -4, 10);
  let treesAfter = 0, moldFlowers = 0;
  orc.scene.traverse(o => {
    if (o.userData?.anuKind === "sanctuary_tree") treesAfter++;
    if (o.userData?.anuKind === "sanctuary_mold_flower") moldFlowers++;
  });
  // Tool palette + body class
  const palette = document.getElementById('v4-tool-palette');
  const paletteVisible = palette ? getComputedStyle(palette).display !== 'none' : false;
  // Force top-down to verify palette shows
  document.body.classList.add("v4-top-down-view");
  const paletteAfterTopDown = palette ? getComputedStyle(palette).display : null;
  document.body.classList.remove("v4-top-down-view");

  return {
    activeModules: [...orc._activeModules].length + " modules: " + [...orc._activeModules].join(", "),
    presence: { clouds, birds, flowers, mushrooms, grass },
    moldTest: { treesBefore, treesAfter, moldFlowers },
    palette: { paletteVisibleAtBoot: paletteVisible, paletteAfterTopDown },
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2) },
    rendered: { tris: r.triangles, calls: r.calls },
    sensorium: Object.fromEntries(
      Object.entries(Anu.getWorldSensoriumSnapshot?.()?.domains || {})
        .map(([k, v]) => [k, `${v.drawables}d / ${v.trianglesEstimate}t / ${v.interactables}i`]),
    ),
    audit: Anu.audit?.() ?? null,
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck ?? null,
    adaptiveDpr: Anu.adaptiveDpr?.snapshot?.()?.currentDpr,
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

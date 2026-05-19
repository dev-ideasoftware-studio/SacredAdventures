import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("MoldGrowHill"), { timeout: 90000 });
await page.waitForTimeout(7000);

// Sample terrain Y at compass points + hill ridges
await page.evaluate(async () => {
  const mod = await import("./js/sanctuary/SanctuaryGround.js");
  window.__y = mod.sanctuaryGroundY;
});

const out = await page.evaluate(() => {
  const orc = window.anuOrchestrator;
  const Anu = window.AnuUniverse;
  const r = orc.renderer.info.render;
  const y = window.__y;

  // Hill height samples — should be tall on N/E/W rim, lower on S (+Z gap)
  const samples = {
    pool_centre:     +y(0, 0).toFixed(2),
    inner_N_neg:     +y(0, -28).toFixed(2),  // -Z = "north" in math sense
    inner_E:         +y(28, 0).toFixed(2),
    inner_W:         +y(-28, 0).toFixed(2),
    inner_S_pos:     +y(0, 28).toFixed(2),   // +Z = valley mouth, should be lower
    outer_N_neg:     +y(0, -40).toFixed(2),
    outer_E:         +y(40, 0).toFixed(2),
    outer_W:         +y(-40, 0).toFixed(2),
    outer_S_pos:     +y(0, 40).toFixed(2),
    outer_NE:        +y(28, -28).toFixed(2),
    outer_NW:        +y(-28, -28).toFixed(2),
  };

  // Trigger one grow_hill mutation to verify the handler works
  let hillsBefore = 0, hillsAfter = 0;
  orc.scene.traverse(o => { if (o.userData?.anuKind === "sanctuary_mold_hill") hillsBefore++; });
  if (window.SanctuaryMutations?.publish) {
    window.SanctuaryMutations.publish("grow_hill", 6, 22);
  }
  orc.scene.traverse(o => { if (o.userData?.anuKind === "sanctuary_mold_hill") hillsAfter++; });

  return {
    activeModules: [...orc._activeModules],
    rendered: { tris: r.triangles, calls: r.calls },
    fps: { smooth: +orc.smoothFPS.toFixed(2), peak: +orc._peakFPS.toFixed(2) },
    samples,
    moldTest: { hillsBefore, hillsAfter },
    audit: Anu.audit?.() ?? null,
    primary: Anu.getFuzzyPipelineSnapshot?.(orc)?.primaryBottleneck ?? null,
    sensorium: Object.fromEntries(
      Object.entries(Anu.getWorldSensoriumSnapshot?.()?.domains || {})
        .map(([k, v]) => [k, `${v.drawables}d / ${v.trianglesEstimate}t / ${v.interactables}i`]),
    ),
    adaptiveDpr: Anu.adaptiveDpr?.snapshot?.() ?? null,
  };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

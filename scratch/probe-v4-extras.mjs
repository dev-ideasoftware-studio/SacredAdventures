import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("SanctuaryClickToMove"), { timeout: 60000 });
await page.waitForTimeout(5000);

const out = await page.evaluate(async () => {
  const orc = window.anuOrchestrator;
  // (1) HUD presence + new title
  const h = document.getElementById('v2-orchestrator-hud');
  const hud = h ? {
    found: true,
    top: Math.round(h.getBoundingClientRect().top),
    right: Math.round(window.innerWidth - h.getBoundingClientRect().right),
    title: h.querySelector('div')?.textContent?.trim() ?? null,
  } : { found: false };

  // (2) Hex shader applied
  let terrainMat = null;
  orc.scene.traverse(o => { if (o.name === 'sanctuary_terrain') terrainMat = o.material; });
  const hex = { hasOnBeforeCompile: !!terrainMat?.onBeforeCompile, vertexColors: terrainMat?.vertexColors ?? false };

  // (3) click-to-move present
  let dashes = null, xMark = null, root = null;
  orc.scene.traverse(o => {
    if (o.name === 'sanctuary_kid_footprints') dashes = o;
    if (o.name === 'sanctuary_click_to_move_x') xMark = o;
    if (o.name === 'sanctuary_click_to_move_root') root = o;
  });
  const click = { rootPresent: !!root, dashesCount: dashes?.count ?? 0, xMarkPresent: !!xMark };

  // (4) Simulate a click; wait; count visible prints
  const canvas = orc.renderer.domElement;
  const r = canvas.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height * 0.7;
  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, button: 0 }));
  await new Promise((s) => setTimeout(s, 400));

  const m = orc._activeModuleInstances?.SanctuaryClickToMove;
  let visiblePrints = 0;
  if (dashes?.instanceMatrix?.array) {
    const arr = dashes.instanceMatrix.array;
    for (let i = 0; i < dashes.count; i++) {
      const m00 = arr[i * 16 + 0], m11 = arr[i * 16 + 5], m22 = arr[i * 16 + 10];
      if (Math.abs(m00) + Math.abs(m11) + Math.abs(m22) > 0.01) visiblePrints++;
    }
  }
  const goalSet = !!m?._goal;
  const xVisible = !!xMark?.visible;

  return { hud, hex, click, postClick: { goalSet, xVisible, visiblePrints } };
});
console.log(JSON.stringify({ errors, ...out }, null, 2));
await browser.close();

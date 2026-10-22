// Movement probe: boots the real game in Chromium and checks that the avatar moves from
// (1) holding W and (2) clicking the ground. Prints WHY when it doesn't (module list, input
// flags, fishing phase, what element is under the click, page errors).
//
// Usage:  node tools/decision-engine/movement_probe.mjs <baseUrl> [desktop|phone] [chromiumPath]
//   e.g.  python3 -m http.server 5505 &   then   node tools/decision-engine/movement_probe.mjs http://127.0.0.1:5505 desktop
import { chromium } from "playwright";

const [baseUrl = "http://127.0.0.1:5505", mode = "desktop", exe, lucideMode = "network"] = process.argv.slice(2);
// lucideMode "vendored": answer the panel's unpkg lucide request with the repo copy (vendor/lucide/lucide.min.js).
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext(mode === "phone"
  ? { viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem("sanctuary.welcomeGuide.seenV2", "1"); } catch (_) {} });
const page = await ctx.newPage();
if (lucideMode === "vendored") {
  await page.route(/unpkg\.com\/lucide/, async (route) => {
    const r = await fetch(`${baseUrl}/vendor/lucide/lucide.min.js`);
    await route.fulfill({ status: 200, contentType: "application/javascript", body: await r.text() });
  });
}
const errors = [];
page.on("pageerror", (e) => errors.push("[pageerror] " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_CONNECTION|status of 404/.test(m.text())) errors.push(m.text().slice(0, 200)); });
const glbs = [];
page.on("response", (r) => { if (/\.glb/.test(r.url())) glbs.push(`${r.status()} ${r.url().split("/Assets/")[1]}`); });

await page.goto(`${baseUrl}/index.html`);
const booted = await page.waitForFunction(() => window.anuOrchestrator && !document.getElementById("v4-loading-iframe"), null, { timeout: 240000, polling: 1000 }).then(() => true, () => false);
await page.waitForTimeout(3000);

const state = () => page.evaluate(() => {
  const o = window.anuOrchestrator, act = o?._activeModules || [];
  const av = window.__sanctuaryAvatar;
  return {
    modulesActive: act.length,
    missing: ["SanctuaryAvatar", "SanctuaryClickToMove", "SanctuaryKeyboardLook", "SanctuaryFishing", "SanctuaryControls"].filter((n) => !act.includes(n)),
    lastActivated: act[act.length - 1],
    fishingPhase: o?._activeModuleInstances?.SanctuaryFishing?._phase,
    fishingActive: window.__sanctuaryFishingActive === true,
    v2InputSuppressed: !!window._v2InputSuppressed,
    v4InputSuppressed: !!window._v4InputSuppressed,
    journalOpen: !!window._v4JournalOpen,
    avatar: !!av,
    pos: av ? [+av.position.x.toFixed(2), +av.position.z.toFixed(2)] : null,
    ledgerErrors: (window.AnuUniverse?.getStressSnapshot?.().errors || []).slice(-3).map((e) => `${e.kind}:${e.moduleName || e.phase || ""}:${e.message}`),
  };
});

const s0 = await state();
// 1. Keyboard: hold W for 1.5 s
await page.keyboard.down("w"); await page.waitForTimeout(1500); await page.keyboard.up("w");
await page.waitForTimeout(300);
const s1 = await state();
// 2. Click the ground a little below screen centre
const vp = page.viewportSize();
const cx = Math.round(vp.width / 2), cy = Math.round(vp.height * 0.72);
const hit = await page.evaluate(([x, y]) => document.elementsFromPoint(x, y).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}#${e.id}`), [cx, cy]);
if (mode === "phone") await page.touchscreen.tap(cx, cy); else await page.mouse.click(cx, cy);
await page.waitForTimeout(3500);
const s2 = await state();

const moved = (a, b) => a.pos && b.pos ? +Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]).toFixed(2) : null;
console.log(JSON.stringify({
  mode, booted, lucideMode,
  keyboardMoved_m: moved(s0, s1),
  clickMoved_m: moved(s1, s2),
  clickPoint: [cx, cy], elementsUnderClick: hit,
  before: s0, after: s2,
  avatarGlb: glbs.filter((g) => /Avatar/i.test(g)),
  pageErrors: errors.slice(0, 8),
}, null, 1));
await browser.close();

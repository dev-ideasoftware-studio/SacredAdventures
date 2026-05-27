/**
 * Real mouse-click integration test for click-to-move.
 *
 * The existing v4-click-to-move spec calls _v4WalkTo() directly — that
 * bypasses the mousedown handler, raycasting, the iframe pointer-events
 * passthrough, and the dock-first hit-test. This spec exercises the
 * full click path so we catch regressions in:
 *   - iframe overlay blocking canvas mousedown
 *   - raycast misses (ground-plane hit too far / direction.y ~= 0)
 *   - _v2InputSuppressed stuck true
 *   - bad coordinate transforms
 */
const { test, expect } = require("@playwright/test");

test.use({ baseURL: undefined });

test("real canvas click drives walk movement", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto("http://127.0.0.1:5505/index.html");
  // Wait long enough for the boot loading iframe to fade + remove itself
  // (headless boot is slower than a real browser — see Component.LoadingModal.html)
  await page.waitForFunction(() => !document.getElementById("v4-loading-iframe"), { timeout: 30000 });
  await page.waitForTimeout(500);

  // Sanity: handler installed, no input-suppress lock stuck
  const guards = await page.evaluate(() => ({
    hasWalkTo: typeof window._v4WalkTo === "function",
    inputSuppressed: !!window._v2InputSuppressed,
    canvasExists: !!document.querySelector("canvas"),
    dockExtents: !!window.__sanctuaryDockExtents,
  }));
  console.log("[guards]", JSON.stringify(guards));
  expect(guards.hasWalkTo).toBe(true);
  expect(guards.inputSuppressed).toBe(false);
  expect(guards.canvasExists).toBe(true);

  // Find the main canvas + capture its bounding box
  const canvasBox = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log("[canvasBox]", JSON.stringify(canvasBox));

  // Read start position
  const startPos = await page.evaluate(() => {
    const b = window.__sanctuaryAvatar ?? window.anuOrchestrator?.camera;
    return b?.position ? { x: b.position.x, z: b.position.z } : null;
  });
  console.log("[startPos]", startPos);
  expect(startPos).not.toBeNull();

  // Click roughly centre-right of the canvas (avoiding the moondial top-left
  // and any HUD top-right) — that should raycast to a forward-right ground
  // hit that the player can walk to.
  const clickX = canvasBox.x + canvasBox.w * 0.72;
  const clickY = canvasBox.y + canvasBox.h * 0.60;
  console.log(`[click] at viewport ${clickX.toFixed(0)},${clickY.toFixed(0)}`);

  // Diagnostics: what's at the click point in BOTH the parent page AND inside the iframe?
  const targetParent = await page.evaluate(({x, y}) => {
    const el = document.elementFromPoint(x, y);
    return el ? `${el.tagName}#${el.id || ""}.${[...el.classList].join(".")}` : null;
  }, { x: clickX, y: clickY });
  console.log("[parent elementFromPoint]", targetParent);

  // Attach tunneling tap-counter inside the iframe so we can see if the
  // mousedown handler fires, and what it sees.
  const iframeHandle = await page.$("iframe#v4-panel-frame");
  const frame = await iframeHandle.contentFrame();
  await frame.evaluate(() => {
    window.__tapDiag = { mousedowns: 0, targets: [], tunneled: 0 };
    document.addEventListener("mousedown", (e) => {
      window.__tapDiag.mousedowns++;
      window.__tapDiag.targets.push(
        `${e.target?.tagName || "?"}#${e.target?.id || ""}.${[...(e.target?.classList || [])].join(".")}`
      );
    }, true); // capture phase so we see EVERY mousedown
    const orig = window.parent.postMessage;
    window.parent.postMessage = function (msg, target) {
      if (msg && msg.type === "CANVAS_CLICK") window.__tapDiag.tunneled++;
      return orig.call(this, msg, target);
    };
  });
  // Also count CANVAS_CLICKs the parent receives
  await page.evaluate(() => {
    window.__parentDiag = { canvasClicks: 0, canvasMousedowns: 0 };
    window.addEventListener("message", (e) => {
      if (e.data && e.data.type === "CANVAS_CLICK") window.__parentDiag.canvasClicks++;
    });
    document.getElementById("v4-canvas").addEventListener("mousedown", () => {
      window.__parentDiag.canvasMousedowns++;
    }, true);
  });

  await page.mouse.move(clickX, clickY);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);

  const tapDiag = await frame.evaluate(() => window.__tapDiag);
  const parentDiag = await page.evaluate(() => window.__parentDiag);
  console.log("[iframe diag]", JSON.stringify(tapDiag));
  console.log("[parent diag]", JSON.stringify(parentDiag));

  // Inspect what the ClickToMove module's internal goal got set to (if any)
  const goalAfter = await page.evaluate(() => {
    const m = window.__sanctuaryClickToMoveModule
            ?? window.anuOrchestrator?.modules?.find?.((x) => x?.name === "SanctuaryClickToMove");
    if (!m) return { found: false };
    return {
      found: true,
      hasGoal: !!m._goal,
      goalX: m._goal?.x,
      goalZ: m._goal?.z,
    };
  });
  console.log("[goalAfter]", JSON.stringify(goalAfter));

  // Wait for movement
  await page.waitForTimeout(1500);

  const endPos = await page.evaluate(() => {
    const b = window.__sanctuaryAvatar ?? window.anuOrchestrator?.camera;
    return b?.position ? { x: b.position.x, z: b.position.z } : null;
  });
  console.log("[endPos]", endPos);

  const moved = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
  console.log(`[moved] ${moved.toFixed(3)} m in 1.5 s`);

  await page.screenshot({ path: "backups/click-real-check.png", fullPage: false });

  expect(moved).toBeGreaterThan(2.0); // any real movement, not just drift

  if (errors.length) console.log("[errors]", errors);
  expect(errors.filter(e => !e.includes("favicon"))).toHaveLength(0);

  await ctx.close();
});

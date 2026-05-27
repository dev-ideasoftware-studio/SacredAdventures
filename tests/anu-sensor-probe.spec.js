/**
 * Anu sensor health + FPS HUD wiring probe.
 *
 * Per mandate: query AnuUniverse.report() + anuOrchestrator.report() in
 * page context on every change. This probe also dumps the FPS HUD's
 * current mount/visibility state so we can see what's wired vs missing.
 *
 * Lives in backups/ (gitignored) — throwaway probe, not a permanent test.
 */
const { test, expect } = require("@playwright/test");

test.use({ baseURL: undefined });

test("Anu sensors + FPS HUD state probe", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${e.message}`));

  await page.goto("http://127.0.0.1:5505/index.html");
  // Wait for loading veil to clear so orchestrator is up
  await page.waitForFunction(() => !document.getElementById("v4-loading-iframe"), { timeout: 30000 });
  await page.waitForTimeout(2000);

  // ── Anu sensor reports ─────────────────────────────────────────────
  const anuState = await page.evaluate(() => {
    const out = {};
    try {
      out.anuUniverseExists = !!window.AnuUniverse;
      out.anuUniverseReport = window.AnuUniverse?.report?.() ?? null;
    } catch (e) { out.anuUniverseError = String(e); }
    try {
      out.anuOrchestratorExists = !!window.anuOrchestrator;
      out.anuOrchestratorReport = window.anuOrchestrator?.report?.() ?? null;
    } catch (e) { out.anuOrchestratorError = String(e); }
    try {
      const o = window.anuOrchestrator;
      out.orchestratorRuntime = o ? {
        rawFPS: o.rawFPS,
        smoothFPS: o.smoothFPS,
        fpsReady: o._fpsReady,
        frameCount: o._frameCount ?? o.frameCount,
        hasPipRenderer: !!o._pipRenderer,
        pipW: o._pipW,
        moduleCount: o._modules?.length ?? o.modules?.length,
      } : null;
    } catch (e) { out.orchestratorRuntimeError = String(e); }
    try {
      out.adaptiveDpr = window.AnuUniverse?.adaptiveDpr ? {
        currentDpr: window.AnuUniverse.adaptiveDpr.getCurrentDpr?.(),
        minDpr: window.AnuUniverse.adaptiveDpr.getMinDpr?.(),
      } : null;
    } catch (e) { out.adaptiveDprError = String(e); }
    return out;
  });

  // ── FPS HUD mount state ─────────────────────────────────────────────
  const fpsHudState = await page.evaluate(() => {
    // Search for likely FPS HUD elements
    const candidates = [
      "#sanctuary-fps-hud",
      "#anu-fps-hud",
      "#v2-fps-hud",
      "#fps-hud",
      "#fps-panel",
      "#OrchestratorHud",
      "#orchestrator-hud",
    ];
    const found = {};
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        found[sel] = {
          exists: true,
          visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none",
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          text: (el.textContent || "").slice(0, 120),
        };
      }
    }
    // Also: any element whose id/class contains "fps"
    const fpsLike = [...document.querySelectorAll('[id*="fps" i], [class*="fps" i]')].slice(0, 10).map((el) => ({
      tag: el.tagName,
      id: el.id,
      classes: [...el.classList].join("."),
      visible: el.offsetParent !== null,
      text: (el.textContent || "").slice(0, 80),
    }));
    return { byId: found, fpsLike };
  });

  // ── Look for "FPS panel" in the iframe panel ────────────────────────
  const iframeHandle = await page.$("iframe#v4-panel-frame");
  let panelFpsState = null;
  if (iframeHandle) {
    const frame = await iframeHandle.contentFrame();
    panelFpsState = await frame.evaluate(() => {
      const fpsLike = [...document.querySelectorAll('[id*="fps" i], [class*="fps" i]')].slice(0, 10).map((el) => ({
        tag: el.tagName, id: el.id, classes: [...el.classList].join("."),
        text: (el.textContent || "").slice(0, 80),
      }));
      return { fpsLike };
    });
  }

  console.log("════════════ ANU STATE ════════════");
  console.log(JSON.stringify(anuState, null, 2));
  console.log("════════════ FPS HUD STATE ════════════");
  console.log(JSON.stringify(fpsHudState, null, 2));
  console.log("════════════ PANEL FPS STATE ════════════");
  console.log(JSON.stringify(panelFpsState, null, 2));
  console.log("════════════ CONSOLE ERRORS ════════════");
  console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");

  await page.screenshot({ path: "backups/anu-fps-probe.png", fullPage: false });
  await ctx.close();
});

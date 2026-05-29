/**
 * Anu sync-check — the canonical "am I in sync?" Playwright gate.
 *
 * Every AI session (and human) should be able to run this and trust
 * the result. It verifies four things:
 *
 *   1) Git: HEAD SHA matches build-info.json subject (banner accurate)
 *   2) Anu: both .report() methods return real structured objects
 *      (not undefined/null — the original 2026-05-27 stub bug)
 *   3) FPS: a single source of truth — no divergent sensor pills.
 *      orchestrator.smoothFPS and the on-screen FPS readout agree.
 *   4) Console: zero errors / pageerrors during boot.
 *
 * Prints a structured ANU SYNC REPORT at the end so AI sessions
 * can quote it directly when reporting back to the user.
 */
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

test.use({ baseURL: undefined });

test("Anu confirms sync — sensors alive, FPS unified, banner accurate", async ({ browser }) => {
  // ── Pre-check: git HEAD + build-info ────────────────────────────────
  const headSha = execSync("git rev-parse HEAD").toString().trim();
  const headSubject = execSync("git log -1 --pretty=%s").toString().trim();
  const buildInfo = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "build-info.json"), "utf8")
  );
  expect(buildInfo.subject).toBe(headSubject);

  // ── Boot page ───────────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto("http://127.0.0.1:5505/index.html");
  await page.waitForFunction(() => !document.getElementById("v4-loading-iframe"), { timeout: 60000 });
  await page.waitForTimeout(2000);

  // ── Anu sensor reports ──────────────────────────────────────────────
  const anuReports = await page.evaluate(() => {
    const out = { universe: null, orchestrator: null };
    try { out.universe = window.AnuUniverse?.report?.() ?? null; } catch (e) { out.universeError = String(e); }
    try { out.orchestrator = window.anuOrchestrator?.report?.() ?? null; } catch (e) { out.orchestratorError = String(e); }
    return out;
  });

  // Universe report shape sanity
  expect(anuReports.universe, "AnuUniverse.report() must return an object, not null").toBeTruthy();
  expect(anuReports.universe).toHaveProperty("audit");
  expect(anuReports.universe).toHaveProperty("rendering");
  expect(anuReports.universe).toHaveProperty("budget");
  expect(anuReports.universe).toHaveProperty("worldSensorium");

  // Orchestrator report shape sanity
  expect(anuReports.orchestrator, "anuOrchestrator.report() must return an object, not null").toBeTruthy();
  expect(anuReports.orchestrator).toHaveProperty("fps");
  expect(anuReports.orchestrator).toHaveProperty("modules");
  expect(anuReports.orchestrator.fps).toHaveProperty("smooth");
  expect(anuReports.orchestrator.fps).toHaveProperty("ready");

  // ── FPS single source of truth ──────────────────────────────────────
  const onScreenFps = await page.evaluate(() => {
    const el = document.querySelector("#v2-fps");
    if (!el) return null;
    const m = el.textContent?.match(/(\d+)\s*FPS/);
    return m ? parseInt(m[1], 10) : null;
  });
  const orcFps = Math.round(anuReports.orchestrator.fps.smooth);
  // Allow ±2 FPS variance for refresh timing between report() and DOM update
  expect(Math.abs(onScreenFps - orcFps)).toBeLessThanOrEqual(2);

  // No zombie #v4-fps-hud pill (the divergent sensor we retired)
  const zombiePill = await page.evaluate(() => !!document.getElementById("v4-fps-hud"));
  expect(zombiePill, "#v4-fps-hud pill should be removed (lives in OrchestratorHud now)").toBe(false);

  // ── Banner shows the right SHA ──────────────────────────────────────
  const bannerText = await page.evaluate(() => document.getElementById("build-badge")?.textContent ?? "");
  expect(bannerText).toContain(buildInfo.branch);
  expect(bannerText).toContain(buildInfo.subject.slice(0, 20));

  // ── Console clean ───────────────────────────────────────────────────
  const filteredErrors = errors.filter((e) => !e.includes("favicon"));
  expect(filteredErrors).toEqual([]);

  // ── Print the structured ANU SYNC REPORT ────────────────────────────
  console.log("\n════════════ ANU SYNC REPORT ════════════");
  console.log(`HEAD             : ${headSha.slice(0, 7)}`);
  console.log(`Branch           : ${buildInfo.branch}`);
  console.log(`SW cache         : ${buildInfo.swVersion}`);
  console.log(`Subject          : ${buildInfo.subject}`);
  console.log(`Commit time      : ${buildInfo.isoDate}`);
  console.log(`Dirty            : ${buildInfo.dirty}`);
  console.log(`---`);
  console.log(`FPS (smooth)     : ${anuReports.orchestrator.fps.smooth.toFixed(1)}`);
  console.log(`FPS (on-screen)  : ${onScreenFps}`);
  console.log(`FPS ready        : ${anuReports.orchestrator.fps.ready}`);
  console.log(`Frame count      : ${anuReports.orchestrator.frame}`);
  console.log(`Draw calls       : ${anuReports.orchestrator.draws}`);
  console.log(`Triangles        : ${anuReports.orchestrator.triangles}`);
  console.log(`Active modules   : ${anuReports.orchestrator.activeModules.length}`);
  console.log(`Anu incidents    : ${anuReports.universe.incidents?.length ?? 0}`);
  console.log(`Audit findings   : ${(anuReports.universe.audit || []).length}`);
  console.log(`Console errors   : ${filteredErrors.length}`);
  console.log("═════════════════════════════════════════\n");

  await ctx.close();
});

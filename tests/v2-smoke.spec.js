const { expect, test } = require("@playwright/test");

function watchFatalBrowserErrors(page) {
  const fatalConsole = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/favicon|Failed to load resource/i.test(text)) return;
    fatalConsole.push(text);
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  return { fatalConsole, pageErrors };
}

async function waitForV2Boot(page) {
  await page.goto("/index.v2.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      window.AnuUniverse?.isLiveSacredOrchestratorBound?.() === true &&
      ["Anu", "World", "Trees", "PanelsPIP"].every((name) =>
        window.anuOrchestrator?._activeModules?.includes(name),
      ),
    null,
    { timeout: 20_000 },
  );
}

test("v2 boots orchestrator, Anu, world services, and PiP shell", async ({ page }) => {
  const { fatalConsole, pageErrors } = watchFatalBrowserErrors(page);
  await waitForV2Boot(page);

  const snapshot = await page.evaluate(() => ({
    bound: window.AnuUniverse.isLiveSacredOrchestratorBound(),
    activeModules: [...window.anuOrchestrator._activeModules],
    services: window.AnuUniverse.getRuntimeServicesSnapshot().names,
    contractsOk: window.AnuUniverse.validateRuntimeServiceContracts().ok,
    pip: window.anuOrchestrator._pipStrategy.getSnapshot(),
    hasWorldPlayer: Boolean(window.WorldPlayer?.feet),
    hasWorldPhysics: typeof window.WorldPhysics?.getGroundY === "function",
    hasPipCanvas: Boolean(document.getElementById("pipCanvas")),
  }));

  expect(snapshot.bound).toBe(true);
  expect(snapshot.activeModules).toEqual(
    expect.arrayContaining(["Anu", "World", "Trees", "PanelsPIP"]),
  );
  expect(snapshot.services).toEqual(
    expect.arrayContaining(["WorldPhysics", "WorldPlayer"]),
  );
  expect(snapshot.contractsOk).toBe(true);
  expect(snapshot.pip.secondWebGlPass).toBe(true);
  expect(snapshot.hasWorldPlayer).toBe(true);
  expect(snapshot.hasWorldPhysics).toBe(true);
  expect(snapshot.hasPipCanvas).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(fatalConsole).toEqual([]);
});

test("World deactivate/reactivate cleans and restores Orchestrator-owned services", async ({ page }) => {
  const { fatalConsole, pageErrors } = watchFatalBrowserErrors(page);
  await waitForV2Boot(page);

  const deactivated = await page.evaluate(async () => {
    await window.anuOrchestrator.deactivate("World");
    return {
      activeModules: [...window.anuOrchestrator._activeModules],
      services: window.AnuUniverse.getRuntimeServicesSnapshot().names,
      contracts: window.AnuUniverse.validateRuntimeServiceContracts(),
      hasWorldPlayer: "WorldPlayer" in window,
      hasWorldPhysics: "WorldPhysics" in window,
    };
  });

  expect(deactivated.activeModules).not.toContain("World");
  expect(deactivated.services).not.toContain("WorldPhysics");
  expect(deactivated.services).not.toContain("WorldPlayer");
  expect(deactivated.contracts.ok).toBe(true);
  expect(deactivated.hasWorldPlayer).toBe(false);
  expect(deactivated.hasWorldPhysics).toBe(false);

  const reactivated = await page.evaluate(async () => {
    await window.anuOrchestrator.activate("World");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      activeModules: [...window.anuOrchestrator._activeModules],
      services: window.AnuUniverse.getRuntimeServicesSnapshot().names,
      contracts: window.AnuUniverse.validateRuntimeServiceContracts(),
    };
  });

  expect(reactivated.activeModules).toContain("World");
  expect(reactivated.services).toEqual(
    expect.arrayContaining(["WorldPhysics", "WorldPlayer"]),
  );
  expect(reactivated.contracts.ok).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(fatalConsole).toEqual([]);
});

test("orchestrator dispose stops runtime and clears world services", async ({ page }) => {
  const { fatalConsole, pageErrors } = watchFatalBrowserErrors(page);
  await waitForV2Boot(page);

  const disposed = await page.evaluate(() => {
    const orchestrator = window.anuOrchestrator;
    orchestrator.dispose();
    return {
      hasAnuUniverse: "AnuUniverse" in window,
      hasOrchestrator: "anuOrchestrator" in window,
      hasLegacyOrchestrator: "Orchestrator" in window,
      hasWorldPlayer: "WorldPlayer" in window,
      hasWorldPhysics: "WorldPhysics" in window,
      disposed: orchestrator._disposed,
      activeModules: [...orchestrator._activeModules],
      services: window.AnuUniverse?.getRuntimeServicesSnapshot?.().names ?? [],
    };
  });

  expect(disposed.disposed).toBe(true);
  expect(disposed.activeModules).toEqual([]);
  expect(disposed.services).toEqual([]);
  expect(disposed.hasAnuUniverse).toBe(false);
  expect(disposed.hasOrchestrator).toBe(false);
  expect(disposed.hasLegacyOrchestrator).toBe(false);
  expect(disposed.hasWorldPlayer).toBe(false);
  expect(disposed.hasWorldPhysics).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(fatalConsole).toEqual([]);
});

test("movement keys advance WorldPlayer distance without loop errors", async ({ page }) => {
  const { fatalConsole, pageErrors } = watchFatalBrowserErrors(page);
  await waitForV2Boot(page);

  const startFeet = await page.evaluate(() => window.WorldPlayer.distanceFeet);
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  await page.waitForFunction(
    (start) => window.WorldPlayer.distanceFeet > start + 1,
    startFeet,
    { timeout: 5_000 },
  );

  const movement = await page.evaluate(() => ({
    startFeet: window.__startFeet,
    distanceFeet: window.WorldPlayer.distanceFeet,
    stressErrors: window.AnuUniverse.getStressSnapshot().errors,
  }));

  expect(movement.distanceFeet).toBeGreaterThan(startFeet + 1);
  expect(movement.stressErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(fatalConsole).toEqual([]);
});

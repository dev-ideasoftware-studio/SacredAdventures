/**
 * Verify: 3D fishing gauge sits above the water surface.
 *
 * The gauge group (g.userData.isGauge3D = true) lives in the Three.js scene
 * from load() onwards, hidden until a fish is cast. We force-find it and
 * confirm that the dial face (local z ≈ 0.12 → world Y after rotation+scale)
 * is strictly above WATER_Y_M (-0.05 m).
 *
 * Expected math (GAUGE_3D_SCALE = 0.242, face localZ = 0.12):
 *   group.position.y = WATER_Y_M = -0.050  (sits atop water)
 *   face world Y     = -0.050 + 0.12 × 0.242 = -0.0210  (> -0.05 ✓)
 *   scale +10%: 0.22 → 0.242
 */
const { test, expect } = require('@playwright/test');

test('3D fishing gauge — dial face world Y above water surface', async ({ page }) => {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));

  await page.goto('http://127.0.0.1:5505/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  console.log('✓ Scene loaded');

  // ── Debug: what's in window ───────────────────────────────────────────────
  const debug = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    const scene = orc?.scene;
    let totalObjects = 0;
    let groupsWithRotX = 0;
    if (scene) {
      scene.traverse(obj => {
        totalObjects++;
        if (obj.isGroup && Math.abs(obj.rotation.x + Math.PI / 2) < 0.1) groupsWithRotX++;
      });
    }
    return {
      hasOrc: !!orc,
      hasScene: !!scene,
      totalObjects,
      groupsWithRotX,
      modules: orc?._activeModuleInstances ? Object.keys(orc._activeModuleInstances) : [],
    };
  });
  console.log('Debug:', JSON.stringify(debug, null, 2));

  // ── Inspect gauge in the Three.js scene ──────────────────────────────────
  const gaugeInfo = await page.evaluate(() => {
    const WATER_Y_M = -0.05;
    const FACE_LOCAL_Z = 0.12; // fish plane local Z

    const orc = window.anuOrchestrator;
    const scene = orc?.scene;
    if (!scene) return { error: `No scene. anuOrchestrator=${!!orc}` };

    // Find via userData tag
    let g = null;
    scene.traverse((obj) => { if (obj.userData?.isGauge3D) g = obj; });

    // Fallback: structural signature (≥14 children, rotX≈-PI/2, scale≈0.22)
    if (!g) {
      scene.traverse((obj) => {
        if (!g && obj.isGroup && obj.children.length >= 14 &&
            Math.abs(obj.rotation.x + Math.PI / 2) < 0.01 &&
            Math.abs(obj.scale.x - 0.22) < 0.01) {
          g = obj;
        }
      });
    }

    // Last resort: find by name
    if (!g) {
      scene.traverse((obj) => { if (!g && obj.name === 'fishingGauge3D') g = obj; });
    }

    // Widen fallback: any group with rotX≈-PI/2
    if (!g) {
      const candidates = [];
      scene.traverse((obj) => {
        if (obj.isGroup && Math.abs(obj.rotation.x + Math.PI / 2) < 0.1) {
          candidates.push({ name: obj.name, children: obj.children.length, posY: obj.position.y.toFixed(3), scaleX: obj.scale.x.toFixed(3), ud: JSON.stringify(obj.userData).slice(0,60) });
        }
      });
      return { error: 'Not found by any method', candidates };
    }

    const faceWorldY = g.position.y + FACE_LOCAL_Z * g.scale.x;
    return {
      groupPosY: g.position.y,
      scaleX: g.scale.x,
      faceLocalZ: FACE_LOCAL_Z,
      faceWorldY,
      WATER_Y_M,
      faceAboveWater: faceWorldY > WATER_Y_M,
      faceAboveByMM: Math.round((faceWorldY - WATER_Y_M) * 1000),
      childCount: g.children.length,
      visible: g.visible,
      name: g.name,
    };
  });

  console.log('Gauge info:', JSON.stringify(gaugeInfo, null, 2));

  if (gaugeInfo.error) {
    throw new Error(`Gauge not found: ${gaugeInfo.error}\nCandidates: ${JSON.stringify(gaugeInfo.candidates)}`);
  }

  // Core assertion: face must be above water
  expect(gaugeInfo.faceAboveWater).toBe(true);
  console.log(`✓ Dial face world Y = ${gaugeInfo.faceWorldY.toFixed(4)} m`);
  console.log(`  → ${gaugeInfo.faceAboveByMM} mm above water surface (WATER_Y_M = ${gaugeInfo.WATER_Y_M})`);
  console.log(`  group Y = ${gaugeInfo.groupPosY.toFixed(4)}, scale = ${gaugeInfo.scaleX.toFixed(3)}, children = ${gaugeInfo.childCount}`);
  console.log(`  visible = ${gaugeInfo.visible} (false = correct, shown only after cast)`);

  // ── Screenshot ────────────────────────────────────────────────────────────
  await page.screenshot({ path: 'backups/gauge-3d-check.png', fullPage: false });
  console.log('✓ Screenshot: backups/gauge-3d-check.png');

  // ── Zero errors ───────────────────────────────────────────────────────────
  if (errors.length > 0) console.log('ERRORS:', errors);
  expect(errors).toHaveLength(0);
  console.log('✓ Zero console errors');
});

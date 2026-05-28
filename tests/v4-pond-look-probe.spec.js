/**
 * Pond aesthetic probe — compares the current sanctuary pond against a
 * reference photo the user shared (crystal-clear water, pebble bottom,
 * lily pads at the edges, cattail reeds in clumps, large shore stones,
 * lush grass with tiny wildflowers).
 *
 * Captures:
 *   • A "low rim cam" screenshot from a similar vantage point so we
 *     can eyeball before/after each visual change.
 *   • A state inventory: water material settings, moss tuft count,
 *     lily pad count + distribution (centre vs edge), micro-pebble
 *     count, shore-stone count, wildflower count.
 *
 * Runs against http://127.0.0.1:5505 — user's live server.
 *
 * Output files:
 *   backups/pond-look-rimcam.png        — low camera at south rim
 *   backups/pond-look-topdown.png       — overhead for floor coverage
 */
const { test, expect } = require('@playwright/test');

test('pond aesthetic inventory + screenshots', async ({ page }) => {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));

  const cb = Date.now();
  await page.goto(`http://127.0.0.1:5505/index.html?cb=${cb}`, { waitUntil: 'load' });
  await page.waitForTimeout(8000);

  // Hide every HUD overlay we know about — they all sit above the canvas
  // and would dominate any DOM screenshot.
  await page.evaluate(() => {
    const hide = (sel) => {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    };
    if (typeof window.sanctuaryWelcome?.hide === 'function') window.sanctuaryWelcome.hide();
    hide('[id*="welcome" i], [class*="welcome" i]');
    hide('#v2-orchestrator-hud');
    hide('#v4-panel-frame');
    hide('#v4-controls');
    hide('#build-badge');
    hide('#v2-pip-canvas, #pip-click-zone');
    hide('[class*="action-ring" i]');
  });
  await page.waitForTimeout(200);

  // Strategy: stop the orchestrator's RAF loop so our custom camera
  // render isn't overwritten by the chase cam the next frame. Then
  // render with the custom camera AND use page.screenshot() — which
  // captures via the browser compositor, so we don't need
  // preserveDrawingBuffer on the WebGL context.
  await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    if (orc && orc._rafId) {
      cancelAnimationFrame(orc._rafId);
      orc._rafId = 0;
      orc._frozen = true;
    }
  });

  // ── Rim cam: hijack the main perspective cam, render once ────────────
  const rimRender = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    if (!orc?.renderer || !orc?.scene || !orc?.camera) {
      return { ok: false, why: `renderer=${!!orc?.renderer} scene=${!!orc?.scene} camera=${!!orc?.camera}` };
    }
    const cam = orc.camera;
    cam.position.set(0, 1.1, -13.5);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, -0.3, 2);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    orc.renderer.render(orc.scene, cam);
    return { ok: true, type: cam.type, camPos: { x: cam.position.x, y: cam.position.y, z: cam.position.z } };
  });
  console.log('Rim render:', JSON.stringify(rimRender));
  await page.screenshot({ path: 'backups/pond-look-rimcam.png', fullPage: false });

  // ── Top-down: hijack the PIP ortho cam (or main cam fallback) ─────────
  const topRender = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    if (!orc?.renderer || !orc?.scene) return { ok: false };
    // Prefer ortho for true top-down. Fall back to perspective if needed.
    const cam = orc._pipOrtho || orc.camera;
    if (cam.isOrthographicCamera) {
      const w = orc.renderer.domElement.width;
      const h = orc.renderer.domElement.height;
      const aspect = w / Math.max(1, h);
      const span = 28;
      cam.left = -span * aspect / 2; cam.right = span * aspect / 2;
      cam.top = span / 2; cam.bottom = -span / 2;
      cam.near = 0.1; cam.far = 200;
      cam.layers.set(0); // full scene, not the layer-2 PIP isolation
    }
    cam.position.set(0, 60, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    orc.renderer.render(orc.scene, cam);
    return { ok: true, type: cam.type };
  });
  console.log('Top render:', JSON.stringify(topRender));
  await page.screenshot({ path: 'backups/pond-look-topdown.png', fullPage: false });

  // ── Inventory the scene ──────────────────────────────────────────────
  const inv = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    const scene = orc?.scene;
    if (!scene) return { error: 'no scene' };

    const out = {
      waterSurface: null,
      basinFloor: null,
      moss: { count: 0, instanced: false, instanceCount: 0 },
      microPebbles: { count: 0, instanced: false, instanceCount: 0 },
      lilies: { count: 0, atCentre: 0, atEdge: 0, colors: {} },
      rocks: { count: 0, big: 0, small: 0 },
      shoreStones: { count: 0, partlyEmerged: 0 },
      reeds: { count: 0 },
      wildflowers: { count: 0 },
    };

    scene.traverse((obj) => {
      const n = obj.name || '';
      const k = obj.userData?.anuKind || '';

      if (n.includes('water_surface') || k === 'sanctuary_pool_water_surface' || n === 'sanctuary_pool_water') {
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (m) {
          out.waterSurface = {
            name: n,
            color: m.color ? '#' + m.color.getHexString() : null,
            opacity: m.opacity,
            transparent: m.transparent,
            transmission: m.transmission,
            emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
            emissiveIntensity: m.emissiveIntensity,
            roughness: m.roughness,
            metalness: m.metalness,
          };
        }
      }
      if (n === 'sanctuary_pool_basin_floor' || k === 'sanctuary_pool_basin_floor') {
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (m) {
          out.basinFloor = {
            color: m.color ? '#' + m.color.getHexString() : null,
            roughness: m.roughness,
          };
        }
      }
      if (n === 'sanctuary_pool_moss_tufts' || k === 'sanctuary_pool_moss_tuft') {
        out.moss.count++;
        if (obj.isInstancedMesh) {
          out.moss.instanced = true;
          out.moss.instanceCount = obj.count;
        }
      }
      if (n === 'sanctuary_pool_micro_pebbles' || k === 'sanctuary_pool_micro_pebble') {
        out.microPebbles.count++;
        if (obj.isInstancedMesh) {
          out.microPebbles.instanced = true;
          out.microPebbles.instanceCount = obj.count;
        }
      }
      if (k === 'sanctuary_lily_pad' || n.startsWith('sanctuary_lily_pad')) {
        out.lilies.count++;
        const r = Math.hypot(obj.position.x, obj.position.z);
        if (r < 4) out.lilies.atCentre++;
        else out.lilies.atEdge++;
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (m?.color) {
          const c = '#' + m.color.getHexString();
          out.lilies.colors[c] = (out.lilies.colors[c] || 0) + 1;
        }
      }
      if (k === 'sanctuary_pool_rock' || k === 'sanctuary_pool_boulder' || n.includes('pool_rock')) {
        out.rocks.count++;
        const s = Math.max(obj.scale.x, obj.scale.y, obj.scale.z);
        if (s > 0.3) out.rocks.big++;
        else out.rocks.small++;
      }
      if (k === 'sanctuary_pool_shore_stone' || n.includes('shore_stone')) {
        out.shoreStones.count++;
        if (obj.position.y > -0.4) out.shoreStones.partlyEmerged++;
      }
      if (k === 'sanctuary_pond_reed' || n.includes('reed') || k === 'sanctuary_reed') {
        out.reeds.count++;
      }
      if (k === 'sanctuary_wildflower' || n.includes('wildflower')) {
        out.wildflowers.count++;
      }
    });

    return out;
  });

  console.log('\n========== POND INVENTORY ==========');
  console.log(JSON.stringify(inv, null, 2));
  console.log('====================================\n');

  console.log('Screenshots saved:');
  console.log('  backups/pond-look-rimcam.png   (low cam, water-edge angle)');
  console.log('  backups/pond-look-topdown.png  (overhead, floor coverage)');

  if (errors.length) console.log('\nPAGE ERRORS:', errors);
});

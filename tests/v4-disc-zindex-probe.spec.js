/**
 * Probe: verify what renderOrder + depthTest + visible flags are ACTUALLY
 * live in the scene for the player travel disc / ring / arrow, the dock
 * parts, the fishing-spot disc, and the PIP fishing camera. Then trigger
 * fishing state and verify the border ring's `visible` toggles off.
 *
 * Runs against http://127.0.0.1:5505/index.html (user's live server) —
 * the same convention as tests/v4-gauge-3d.spec.js. Hard-reload bust:
 * we hit ?cb=<ts> so the Service Worker can't serve stale code.
 *
 * Output is intentionally verbose — this is for diagnosis, not pass/fail.
 */
const { test, expect } = require('@playwright/test');

test('disc + dock + PIP z-index live state', async ({ page }) => {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));

  const cb = Date.now();
  await page.goto(`http://127.0.0.1:5505/index.html?cb=${cb}`, { waitUntil: 'load' });
  await page.waitForTimeout(8000);

  const initial = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    const scene = orc?.scene;
    if (!scene) return { error: 'no scene' };

    const out = {
      discBody: null,
      ringOutline: null,
      facingArrow: null,
      dockParts: { plank: [], post: [], rail: [], baluster: [], step: [], cap: [] },
      fishingSpot: null,
      pipCamUp: null,
      fishingActive: !!window.__sanctuaryFishingActive,
    };

    scene.traverse((obj) => {
      const n = obj.name || '';
      const k = obj.userData?.anuKind || '';

      if (n === 'player_avatar_travel_circle' || k === 'avatar_travel_circle') {
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        out.discBody = {
          name: n,
          renderOrder: obj.renderOrder,
          visible: obj.visible,
          depthTest: m?.depthTest,
          depthWrite: m?.depthWrite,
          transparent: m?.transparent,
        };
      }
      if (n === 'player_avatar_circle_outline' || k === 'avatar_travel_circle_outline') {
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        out.ringOutline = {
          name: n,
          renderOrder: obj.renderOrder,
          visible: obj.visible,
          depthTest: m?.depthTest,
          depthWrite: m?.depthWrite,
          transparent: m?.transparent,
        };
      }
      if (n === 'player_avatar_facing_arrow' || k === 'avatar_facing_arrow') {
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        out.facingArrow = {
          name: n,
          renderOrder: obj.renderOrder,
          visible: obj.visible,
          depthTest: m?.depthTest,
          depthWrite: m?.depthWrite,
        };
      }
      if (k.startsWith('sanctuary_dock_')) {
        const bucket = k.replace('sanctuary_dock_', '');
        if (out.dockParts[bucket] && out.dockParts[bucket].length < 3) {
          out.dockParts[bucket].push({
            name: n,
            renderOrder: obj.renderOrder,
            visible: obj.visible,
          });
        }
      }
      if (k === 'sanctuary_fishing_spot_disc' || k === 'sanctuary_fishing_spot_ring_white') {
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        out.fishingSpot = {
          name: n,
          anuKind: k,
          renderOrder: obj.renderOrder,
          visible: obj.visible,
          depthTest: m?.depthTest,
          geometryType: obj.geometry?.type,
        };
      }
    });

    // Walk again to collect EVERY ring/circle mesh near the bobber spot
    // (window.__sanctuaryFishingSpot). Catches geometry without anuKind.
    const spot = window.__sanctuaryFishingSpot;
    out.allRingsAtSpot = [];
    if (spot && scene) {
      scene.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry) return;
        const t = obj.geometry.type;
        if (t !== 'RingGeometry' && t !== 'CircleGeometry') return;
        const dx = (obj.position.x - spot.x);
        const dz = (obj.position.z - spot.z);
        if (Math.hypot(dx, dz) > 2.0) return;
        const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        out.allRingsAtSpot.push({
          name: obj.name || '(unnamed)',
          anuKind: obj.userData?.anuKind || '',
          type: t,
          renderOrder: obj.renderOrder,
          color: m?.color ? '#' + m.color.getHexString() : null,
          posY: Number(obj.position.y.toFixed(3)),
          visible: obj.visible,
        });
      });
    }

    if (orc._pipOrtho) {
      out.pipCamUp = {
        x: orc._pipOrtho.up.x, y: orc._pipOrtho.up.y, z: orc._pipOrtho.up.z,
      };
    }
    return out;
  });

  console.log('INITIAL STATE:', JSON.stringify(initial, null, 2));

  await page.screenshot({ path: 'backups/disc-zindex-before.png', fullPage: false });

  // Force the fishing flag on so the per-frame loop's hide-border code runs.
  // We aren't going through the full _tryAction (avatar may not be on dock),
  // just flipping the state the per-frame loop reads.
  const flipped = await page.evaluate(() => {
    window.__sanctuaryFishingActive = true;
    const orc = window.anuOrchestrator;
    const mods = orc?._moduleInstances || orc?._activeModuleInstances || {};
    const fishing = mods.SanctuaryFishing || mods.Fishing || null;
    if (fishing) {
      // Bump phase off IDLE so isFishingActive is truthy in update()
      fishing._phase = 'waiting';
    }
    return {
      fishingFound: !!fishing,
      flag: window.__sanctuaryFishingActive,
    };
  });

  console.log('FLIPPED:', JSON.stringify(flipped, null, 2));

  await page.waitForTimeout(1500); // let per-frame loop catch up

  const afterFlip = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    const scene = orc?.scene;
    if (!scene) return { error: 'no scene' };
    const out = { ringOutline: null, discBody: null };
    scene.traverse((obj) => {
      const n = obj.name || '';
      if (n === 'player_avatar_circle_outline') {
        out.ringOutline = {
          visible: obj.visible,
          renderOrder: obj.renderOrder,
        };
      }
      if (n === 'player_avatar_travel_circle') {
        out.discBody = {
          visible: obj.visible,
          renderOrder: obj.renderOrder,
        };
      }
    });
    out.fishingActive = !!window.__sanctuaryFishingActive;
    return out;
  });

  console.log('AFTER FLIP (fishing active):', JSON.stringify(afterFlip, null, 2));

  await page.screenshot({ path: 'backups/disc-zindex-after.png', fullPage: false });

  console.log('\n========== VERDICT ==========');
  console.log('Disc body  renderOrder = ' + initial.discBody?.renderOrder + ' (expected 18)');
  console.log('Disc body  depthTest   = ' + initial.discBody?.depthTest + ' (expected false)');
  console.log('Ring       renderOrder = ' + initial.ringOutline?.renderOrder + ' (expected 9 from WorldAvatar.js)');
  console.log('Ring       depthTest   = ' + initial.ringOutline?.depthTest + ' (expected true)');
  console.log('Arrow      renderOrder = ' + initial.facingArrow?.renderOrder + ' (expected 19)');
  console.log('Dock posts renderOrder = ' + (initial.dockParts.post[0]?.renderOrder) + ' (expected 25)');
  console.log('Dock rails renderOrder = ' + (initial.dockParts.rail[0]?.renderOrder) + ' (expected 25)');
  console.log('Dock plank renderOrder = ' + (initial.dockParts.plank[0]?.renderOrder) + ' (expected 15)');
  console.log('Fishing spot renderOrder = ' + initial.fishingSpot?.renderOrder + ' (expected 18)');
  console.log('Fishing spot geo type    = ' + initial.fishingSpot?.geometryType + ' (expected CircleGeometry)');
  console.log('PIP cam up               = ' + JSON.stringify(initial.pipCamUp) + ' (expected x=1,y=0,z=0)');
  console.log('Ring visible after fishing on = ' + afterFlip.ringOutline?.visible + ' (expected false)');
  console.log('==============================');

  if (errors.length) console.log('PAGE ERRORS:', errors);
});

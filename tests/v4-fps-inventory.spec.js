/**
 * v4-fps-inventory.spec.js
 * Extracting the detailed scene inventory to find the highest-triangle meshes.
 */
const { test } = require('@playwright/test');

test('v4 sanctuary — Scene inventory forensic', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(15000); // Wait for boot and scene construction

  const inventory = await page.evaluate(() => {
    // Force a fresh capture
    const A = window.AnuUniverse;
    const orc = window.anuOrchestrator;
    if (A && orc) {
      // Force tick SceneModelInventory if possible, or just capture
      if (typeof A.getSceneInventorySnapshot === 'function') {
        const snap = A.getSceneInventorySnapshot();
        if (snap && snap.entries) {
          return {
            summary: snap.summary,
            topEntries: snap.entries.slice(0, 30),
          };
        }
      }
      
      // Fallback: manually traverse scene and classify meshes
      const entries = [];
      orc.scene.traverse((obj) => {
        if (obj.isMesh || obj.isSkinnedMesh || obj.isInstancedMesh) {
          let baseTri = 0;
          if (obj.geometry) {
            const idx = obj.geometry.index;
            const pos = obj.geometry.attributes?.position;
            if (idx) baseTri = Math.floor(idx.count / 3);
            else if (pos) baseTri = Math.floor(pos.count / 3);
          }
          const count = obj.count || 1;
          const totalTri = baseTri * count;
          entries.push({
            name: obj.name || "unnamed",
            type: obj.type,
            baseTri,
            count,
            totalTri,
            anuKind: obj.userData?.anuKind || "none",
            anuId: obj.userData?.anuId || "none",
            visible: obj.visible,
          });
        }
      });
      entries.sort((a, b) => b.totalTri - a.totalTri);
      return {
        summary: { object3DTotal: entries.length, trianglesEstimate: entries.reduce((s, e) => s + e.totalTri, 0) },
        topEntries: entries.slice(0, 30),
      };
    }
    return null;
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log('       FORENSIC SCENE INVENTORY RESULTS');
  console.log('══════════════════════════════════════════════════════\n');

  if (inventory) {
    console.log('── SUMMARY ──');
    console.log(JSON.stringify(inventory.summary, null, 2));
    
    console.log('\n── TOP 30 HEAVIEST GEOMETRIES BY TRIANGLE COUNT ──');
    inventory.topEntries.forEach((e, idx) => {
      console.log(`[${idx + 1}] ${e.name} (${e.type})`);
      console.log(`    Total Tris: ${e.totalTri.toLocaleString()} (Base: ${e.baseTri.toLocaleString()} × Count: ${e.count})`);
      console.log(`    anuKind: ${e.anuKind} | anuId: ${e.anuId} | visible: ${e.visible}`);
      console.log('------------------------------------------------');
    });
  } else {
    console.log('Anu or SacredOrchestrator not found on page.');
  }
});

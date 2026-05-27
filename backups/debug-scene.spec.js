const { test } = require('@playwright/test');

test('debug: scene contents', async ({ page }) => {
  await page.goto('http://127.0.0.1:5505/index.v4.html', { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  
  const info = await page.evaluate(() => {
    const orc = window.anuOrchestrator;
    const scene = orc?.scene;
    const groups = [];
    if (scene) {
      scene.traverse(obj => {
        if (obj.isGroup && obj.children.length >= 6 && Math.abs(obj.rotation.x + Math.PI/2) < 0.1) {
          groups.push({ name: obj.name, children: obj.children.length, posY: obj.position.y.toFixed(3), scaleX: obj.scale.x.toFixed(3), ud: JSON.stringify(obj.userData).slice(0,80) });
        }
      });
    }
    let totalObjects = 0;
    scene?.traverse(() => totalObjects++);
    return {
      hasOrc: !!orc,
      hasScene: !!scene,
      totalObjects,
      modules: orc?._activeModuleInstances ? Object.keys(orc._activeModuleInstances) : [],
      groups,
    };
  });
  console.log(JSON.stringify(info, null, 2));
});

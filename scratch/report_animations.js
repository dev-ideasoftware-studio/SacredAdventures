const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    const text = msg.text();
    // Only log essential engine loading events to avoid clutter
    if (text.includes('Loaded') || text.includes('Spawned') || text.includes('Placed Tipi')) {
       console.log('LOG:', text);
    }
  });

  await page.goto('http://127.0.0.1:5500/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 20000)); // 20s for huge 100MB GLBs to load
  
  const result = await page.evaluate(() => {
      const getActiveTracks = (id) => {
          const system = window.npcMaster?.npcs.get(id);
          if (!system) return { error: "Not initialized (System Missing)" };
          
          const tracks = [];
          
          // Check standard mapped actions
          if (system.actions) {
              for (const [actionName, action] of Object.entries(system.actions)) {
                  if (action && action.isRunning() && action.getEffectiveWeight() > 0) {
                      tracks.push({
                          actionName: actionName,
                          clipName: action._clip ? action._clip.name : 'Unknown Clip',
                          weight: action.getEffectiveWeight(),
                          timeScale: action.getEffectiveTimeScale()
                      });
                  }
              }
          }
          
          return {
              fsmState: system.state || "UNKNOWN",
              activeTracks: tracks,
              meshName: system.mesh ? (system.mesh.name || system.mesh.type) : "Missing",
              position: system.mesh ? system.mesh.position : null,
              worldPosition: (() => {
                  if(system.mesh) {
                      const wp = new window.THREE.Vector3();
                      system.mesh.getWorldPosition(wp);
                      return {x: wp.x, y: wp.y, z: wp.z};
                  }
                  return null;
              })()
          };
      };

      return {
          YB: getActiveTracks('NPC_YB'),
          BHG: getActiveTracks('NPC_BHG'),
          REG: getActiveTracks('NPC_Reg'),
          NatureSpirit: getActiveTracks('NatureSpirit')
      };
  });
  
  console.log("FINAL_REPORT: " + JSON.stringify(result, null, 2));
  await browser.close();
})();

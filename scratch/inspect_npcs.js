const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('LOG:', msg.text()));

  await page.goto('http://127.0.0.1:5500/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 6000));
  
  const result = await page.evaluate(() => {
      const states = window._npcStates || {};
      
      const inspectAction = (action) => {
          if (!action) return 'undefined';
          return {
              weight: action.weight,
              timeScale: action.timeScale,
              isRunning: action.isRunning(),
              clipName: action._clip ? action._clip.name : 'unknown'
          };
      };
      
      const getNPCInfo = (id, system) => {
          if (!system) return 'System missing';
          return {
              state: system.state,
              sit: inspectAction(system.actions?.sit),
              walk: inspectAction(system.actions?.walk),
              idle: inspectAction(system.actions?.idle),
              wave: inspectAction(system.actions?.wave),
          };
      };

      return {
          states: states,
          yb: getNPCInfo('NPC_YB', window.npcMaster?.npcs.get('NPC_YB')),
          bhg: getNPCInfo('NPC_BHG', window.npcMaster?.npcs.get('NPC_BHG')),
          reg: getNPCInfo('NPC_Reg', window.npcMaster?.npcs.get('NPC_Reg'))
      };
  });
  
  console.log("INSPECTION_RESULT: " + JSON.stringify(result, null, 2));
  await browser.close();
})();

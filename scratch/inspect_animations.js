const { chromium } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  
  const filePath = path.join(process.cwd(), urlPath);
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(9191, async () => {
  console.log('Temporary server running on http://127.0.0.1:9191');
  
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.goto('http://127.0.0.1:9191/index.html', { waitUntil: 'domcontentloaded' });
    
    const anims = await page.evaluate(async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');

      const loader = new GLTFLoader();
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
      loader.setDRACOLoader(dracoLoader);

      const gltf = await new Promise((resolve, reject) => {
        loader.load('Assets/Avatar3.glb', resolve, undefined, reject);
      });

      const model = gltf.scene;
      const clips = gltf.animations;
      
      let hips = null;
      let head = null;
      let lLeg = null;
      let rLeg = null;
      let lArm = null;
      let rArm = null;
      model.traverse(c => {
        if (c.isBone) {
          if (/hip|pelvis/i.test(c.name)) hips = c;
          if (/head/i.test(c.name)) head = c;
          if (/l_thigh|l_calf/i.test(c.name)) lLeg = c;
          if (/r_thigh|r_calf/i.test(c.name)) rLeg = c;
          if (/l_upperarm|l_forearm/i.test(c.name)) lArm = c;
          if (/r_upperarm|r_forearm/i.test(c.name)) rArm = c;
        }
      });

      const results = [];
      const mixer = new THREE.AnimationMixer(model);
      
      for (let idx = 0; idx < clips.length; idx++) {
        const clip = clips[idx];
        const action = mixer.clipAction(clip);
        
        let totalHipsPosDiff = 0;
        let totalHipsRotDiff = 0;
        let totalHeadRotDiff = 0;
        let totalLegRotDiff = 0;
        let totalArmRotDiff = 0;
        
        let prevHipsPos = new THREE.Vector3();
        let prevHipsRot = new THREE.Quaternion();
        let prevHeadRot = new THREE.Quaternion();
        let prevLegRot = new THREE.Quaternion();
        let prevArmRot = new THREE.Quaternion();

        action.reset().play();
        mixer.update(0);
        
        if (hips) { prevHipsPos.copy(hips.position); prevHipsRot.copy(hips.quaternion); }
        if (head) { prevHeadRot.copy(head.quaternion); }
        if (lLeg) { prevLegRot.copy(lLeg.quaternion); }
        if (lArm) { prevArmRot.copy(lArm.quaternion); }

        const steps = 30;
        const stepTime = clip.duration / steps;
        for (let s = 1; s <= steps; s++) {
          mixer.update(stepTime);
          if (hips) {
            totalHipsPosDiff += hips.position.distanceTo(prevHipsPos);
            totalHipsRotDiff += hips.quaternion.angleTo(prevHipsRot);
            prevHipsPos.copy(hips.position);
            prevHipsRot.copy(hips.quaternion);
          }
          if (head) {
            totalHeadRotDiff += head.quaternion.angleTo(prevHeadRot);
            prevHeadRot.copy(head.quaternion);
          }
          if (lLeg) {
            totalLegRotDiff += lLeg.quaternion.angleTo(prevLegRot);
            prevLegRot.copy(lLeg.quaternion);
          }
          if (lArm) {
            totalArmRotDiff += lArm.quaternion.angleTo(prevArmRot);
            prevArmRot.copy(lArm.quaternion);
          }
        }
        action.stop();
        
        results.push({
          index: idx,
          name: clip.name,
          duration: Math.round(clip.duration * 100) / 100,
          hipsPos: Math.round(totalHipsPosDiff * 100) / 100,
          hipsRot: Math.round(totalHipsRotDiff * 100) / 100,
          headRot: Math.round(totalHeadRotDiff * 100) / 100,
          legRot: Math.round(totalLegRotDiff * 100) / 100,
          armRot: Math.round(totalArmRotDiff * 100) / 100
        });
      }
      
      return results;
    });
    
    console.log('RESULTS:');
    console.log(JSON.stringify(anims, null, 2));
  } catch (err) {
    console.error('Error during run:', err);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});

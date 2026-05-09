const fs = require('fs');
global.THREE = require('three');
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader.js');
const { JSDOM } = require('jsdom');
const { window } = new JSDOM();
global.document = window.document;

const gltfData = fs.readFileSync('Assets/NPC.YB.glb').buffer;
const loader = new GLTFLoader();
loader.parse(gltfData, '', (gltf) => {
    const model = gltf.scene;
    const mixer = new THREE.AnimationMixer(model);
    
    // Find sit action (NlaTrack.003)
    let sitClip = null;
    gltf.animations.forEach(clip => {
        if (clip.name.toLowerCase() === 'nlatrack.003') {
            sitClip = clip;
        }
    });
    
    if (sitClip) {
        const action = mixer.clipAction(sitClip);
        action.reset().setEffectiveWeight(1).play();
        console.log("Action plays. Initial update.");
        mixer.update(0);
        
        let initialPos = null;
        model.traverse(c => {
            if (c.isBone && c.name === 'Hip') {
                initialPos = c.position.clone();
            }
        });
        
        console.log("Initial Hip Y:", initialPos ? initialPos.y : 'Not found');
        
        // Sim 1 second
        mixer.update(1.0);
        
        let newPos = null;
        model.traverse(c => {
            if (c.isBone && c.name === 'Hip') {
                newPos = c.position.clone();
            }
        });
        
        console.log("Hip Y after 1s:", newPos ? newPos.y : 'Not found');
    } else {
        console.log("Clip not found");
    }
});

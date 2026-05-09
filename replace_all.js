const fs = require('fs');

let content = fs.readFileSync('js/EnvironmentBuilder.js', 'utf8');

function replaceBlock(startAnchor, endAnchor, replacementText) {
    const startIdx = content.indexOf(startAnchor);
    if (startIdx === -1) {
        console.error("Could not find start anchor:\n" + startAnchor.substring(0, 50));
        return false;
    }
    const endIdx = content.indexOf(endAnchor, startIdx);
    if (endIdx === -1) {
        console.error("Could not find end anchor:\n" + endAnchor.substring(0, 50));
        return false;
    }
    
    content = content.substring(0, startIdx) + replacementText + content.substring(endIdx + endAnchor.length);
    console.log("Successfully replaced block starting with: " + startAnchor.substring(0, 50).trim());
    return true;
}

// 1. YELLOW BUTTERFLY
const ybStart = `                            // === YELLOW BUTTERFLY NPC ===
                            const ybGltfLoader = new GLTFLoader();`;
const ybEnd = `                            scene.add(ybGroup);
                            // Save to global for EngineMain
                            window._yellowButterflyNPC = ybGroup;

                            if (gltf.animations && gltf.animations.length > 0) {`;
const ybEndFull = content.indexOf(`                        });`, content.indexOf(ybEnd));
if (ybEndFull !== -1) {
    const ybReplacement = `                            // === PLACEHOLDER: Yellow Butterfly ===
                            const startX = 0.3; const startZ = -0.5; const startY = (typeof platformY !== 'undefined') ? platformY + 0.05 : 1.7; 
                            const ybGroup = new THREE.Group();
                            ybGroup.position.set(startX, startY, startZ);
                            const ybModel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true }));
                            ybModel.position.set(0, 0.9, 0); ybGroup.add(ybModel);
                            
                            scene.add(ybGroup); window._yellowButterflyNPC = ybGroup;
                            if (window.masterAI) window.masterAI.registerSystem('NPC_YB', { mesh: ybGroup, update: () => {} });
                            console.log('[NPC] Spawned YellowButterfly Placeholder');`;
    content = content.substring(0, content.indexOf(ybStart)) + ybReplacement + content.substring(ybEndFull + `                        });`.length);
    console.log("Replaced YB");
}

// 2. NATURE SPIRIT
const nsStart = `                        // === NATURE SPIRIT (21 FEET TALL STAG) ===
                        const nsGltfLoader = new GLTFLoader();`;
const nsEnd = `                        // RESOLVE THE LOADING BLOCKER ONCE TEXTURES AND MESHES ARE READY`;
const nsEndFull = content.indexOf(nsEnd);
if (nsEndFull !== -1) {
    const nsReplacement = `                        // === PLACEHOLDER: NatureSpirit ===
                        const nsModel = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.5, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
                        nsModel.position.set(-20, 1.25, -10); scene.add(nsModel); window.natureSpiritSystem = { mesh: nsModel };
                        if (window.masterAI) window.masterAI.registerSystem('NatureSpirit', { mesh: nsModel, update: () => {} });
                        
`;
    content = content.substring(0, content.indexOf(nsStart)) + nsReplacement + content.substring(nsEndFull);
    console.log("Replaced Nature Spirit");
}

// 3. BHG
const bhgStart = `                // Load the actual upgraded girl model and place her inside the Tipi
                const gltfLoader = new GLTFLoader();`;
const bhgEnd = `                scene.add(bhgGroup);
                window._bhgGroup = bhgGroup;
                window._bhgBalloon = questGroup2;`;
const bhgEndFull = content.indexOf(bhgEnd);
if (bhgEndFull !== -1) {
    const bhgReplacement = `                // === PLACEHOLDER: Brings Happiness Girl ===
                const bhgModel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0x800080, wireframe: true }));
                bhgModel.position.set(0, 0.9, 0); bhgGroup.add(bhgModel);
                
                if (window.masterAI) window.masterAI.registerSystem('NPC_BHG', { mesh: bhgGroup, update: () => {} });
                
                scene.add(bhgGroup);
                window._bhgGroup = bhgGroup;
                window._bhgBalloon = questGroup2;`;
    content = content.substring(0, content.indexOf(bhgStart)) + bhgReplacement + content.substring(bhgEndFull + bhgEnd.length);
    console.log("Replaced BHG");
}

// 4. REG & WILDLIFE
const regStart = `                // === NPC REG (Tipi 3) ===
                const regLoader = new GLTFLoader();`;
const regEnd = `                // === HERD SYSTEM (Buffalo & Horse) ===
                if (typeof HerdSystem !== 'undefined') {
                    window.herdSystem = new HerdSystem(scene, window._getGroundY);
                    if (window.masterAI) window.masterAI.registerSystem('herds', window.herdSystem);
                }`;
const regEndFull = content.indexOf(regEnd);
if (regEndFull !== -1) {
    const regReplacement = `                // === PLACEHOLDER: Reg ===
                const regModel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0x0000ff, wireframe: true }));
                regModel.position.set(0, 0.9, 0); tipi3Group.add(regModel);
                if (window.masterAI) window.masterAI.registerSystem('NPC_Reg', { mesh: tipi3Group, update: () => {} });
`;
    content = content.substring(0, content.indexOf(regStart)) + regReplacement + content.substring(regEndFull + regEnd.length);
    console.log("Replaced REG & WILDLIFE");
}

fs.writeFileSync('js/EnvironmentBuilder.js', content);

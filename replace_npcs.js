const fs = require('fs');

let content = fs.readFileSync('js/EnvironmentBuilder.js', 'utf8');

// NatureSpirit
const nsStart = content.indexOf("const nsGltfLoader = new GLTFLoader();");
let nsEnd = content.indexOf("scene.add(window.natureSpiritSystem.mesh);", nsStart);
if (nsEnd !== -1) {
    nsEnd += "scene.add(window.natureSpiritSystem.mesh);".length;
    const nsReplacement = `
                        // --- PLACEHOLDER: NatureSpirit ---
                        const nsGeo = new THREE.CylinderGeometry(0.8, 0.8, 2.5, 16);
                        const nsMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
                        const nsModel = new THREE.Mesh(nsGeo, nsMat);
                        nsModel.position.set(0, 1.25, -25);
                        window.natureSpiritSystem = { mesh: nsModel };
                        scene.add(nsModel);
                        if (window.masterAI) {
                            window.masterAI.registerSystem('NatureSpirit', { mesh: nsModel, update: () => {} });
                        }
    `;
    content = content.substring(0, nsStart) + nsReplacement + content.substring(nsEnd);
    console.log("NS replaced successfully");
} else {
    console.log("Could not find NS block");
}

// BHG
const bhgStart = content.indexOf("const gltfLoader = new GLTFLoader();", content.indexOf("bhgGroup.add(halo);"));
let bhgEnd = content.indexOf("window._bhgGroup = bhgGroup;", bhgStart);
if (bhgEnd !== -1) {
    bhgEnd += "window._bhgGroup = bhgGroup;".length;
    const bhgReplacement = `
                    // --- PLACEHOLDER: Brings Happiness Girl ---
                    const bhgGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16);
                    const bhgMat = new THREE.MeshBasicMaterial({ color: 0x800080, wireframe: true });
                    const bhgModel = new THREE.Mesh(bhgGeo, bhgMat);
                    bhgModel.position.set(0, 0.9, 0);
                    bhgGroup.add(bhgModel);
                    
                    scene.add(bhgGroup);
                    window._bhgGroup = bhgGroup;
                    
                    if (window.masterAI) {
                        window.masterAI.registerSystem('NPC_BHG', { mesh: bhgGroup, update: () => {} });
                    }
    `;
    content = content.substring(0, bhgStart) + bhgReplacement + content.substring(bhgEnd);
    console.log("BHG replaced successfully");
} else {
    console.log("Could not find BHG block");
}

// REG
const regStart = content.indexOf("const regLoader = new GLTFLoader();");
let regEnd = content.indexOf("scene.add(regGroup);", regStart);
if (regEnd !== -1) {
    regEnd += "scene.add(regGroup);".length;
    const regReplacement = `
                    // --- PLACEHOLDER: Reg ---
                    const regGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16);
                    const regMat = new THREE.MeshBasicMaterial({ color: 0x0000ff, wireframe: true });
                    const regModel = new THREE.Mesh(regGeo, regMat);
                    regModel.position.set(0, 0.9, 0);
                    regGroup.add(regModel);
                    
                    scene.add(regGroup);
                    
                    if (window.masterAI) {
                        window.masterAI.registerSystem('NPC_Reg', { mesh: regGroup, update: () => {} });
                    }
    `;
    content = content.substring(0, regStart) + regReplacement + content.substring(regEnd);
    console.log("REG replaced successfully");
} else {
    console.log("Could not find REG block");
}

fs.writeFileSync('js/EnvironmentBuilder.js', content);

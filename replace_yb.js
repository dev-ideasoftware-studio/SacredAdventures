const fs = require('fs');

let content = fs.readFileSync('js/EnvironmentBuilder.js', 'utf8');

const ybStart = content.indexOf("const ybGltfLoader = new GLTFLoader();");
const ybEnd = content.indexOf("scene.add(ybGroup);", ybStart) + "scene.add(ybGroup);".length;

if (ybStart !== -1 && ybEnd !== -1) {
    const replacement = `
                            // --- PLACEHOLDER: Yellow Butterfly ---
                            const placeholderGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16);
                            const placeholderMat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
                            const ybModel = new THREE.Mesh(placeholderGeo, placeholderMat);
                            ybModel.position.set(0, 0.9, 0); // half height
                            ybGroup.add(ybModel);
                            
                            window._yellowButterflyNPC = ybGroup;
                            scene.add(ybGroup);
                            
                            if (window.masterAI) {
                                window.masterAI.registerSystem('NPC_YB', { mesh: ybGroup, update: () => {} });
                            }
    `;
    content = content.substring(0, ybStart) + replacement + content.substring(ybEnd);
    fs.writeFileSync('js/EnvironmentBuilder.js', content);
    console.log("YB replaced successfully");
} else {
    console.log("Could not find YB block");
}

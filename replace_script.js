const fs = require('fs');
let text = fs.readFileSync('js/EnvironmentBuilder.js', 'utf8');

function replaceBlock(startMarker, endMarker, replacement) {
    const startIdx = text.indexOf(startMarker);
    if (startIdx === -1) {
        console.log(`Failed to find start marker: ${startMarker}`);
        return;
    }
    const endIdx = text.indexOf(endMarker, startIdx);
    if (endIdx === -1) {
        console.log(`Failed to find end marker: ${endMarker}`);
        return;
    }
    const blockEnd = endIdx + endMarker.length;
    text = text.slice(0, startIdx) + replacement + text.slice(blockEnd);
    console.log(`Replaced block starting with ${startMarker.trim()}`);
}

// 1. YB Block
replaceBlock(
    '// === YELLOW BUTTERFLY NPC ===',
    '                        });\n\n                        // === NATURE SPIRIT (21 FEET TALL STAG) ===',
    `// === PLACEHOLDER: Yellow Butterfly ===
                            const startX = 0.3; const startZ = -0.5; const startY = (typeof platformY !== 'undefined') ? platformY + 0.05 : 1.7; 
                            const ybGroup = new THREE.Group();
                            ybGroup.position.set(startX, startY, startZ);
                            const ybModel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true }));
                            ybModel.position.set(0, 0.9, 0); ybGroup.add(ybModel);
                            
                            const questGroup = createQuestBalloon('1', 'quest_1_start_game');
                            questGroup.position.set(0, 11.2, 0); questGroup.userData.baseY = 11.2; 
                            const stringGeo = new THREE.CylinderGeometry(0.0018, 0.0018, 3.8, 4); stringGeo.translate(0, -1.9, 0);
                            const stringMesh = new THREE.Mesh(stringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24 }));
                            stringMesh.position.set(0, -0.6, 0); questGroup.add(stringMesh);
                            ybGroup.add(questGroup); window._questMarker = questGroup; 
                            
                            scene.add(ybGroup); window._yellowButterflyNPC = ybGroup;
                            if (window.masterAI) window.masterAI.registerSystem('NPC_YB', { mesh: ybGroup, update: () => {} });
                            
                        // === NATURE SPIRIT (21 FEET TALL STAG) ===`
);

// 2. NatureSpirit Block
replaceBlock(
    '// === NATURE SPIRIT (21 FEET TALL STAG) ===',
    '                        });\n\n                        // RESOLVE THE LOADING BLOCKER',
    `// === PLACEHOLDER: NatureSpirit ===
                            const nsModel = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.5, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
                            nsModel.position.set(-20, 1.25, -10); scene.add(nsModel); window.natureSpiritSystem = { mesh: nsModel };
                            if (window.masterAI) window.masterAI.registerSystem('NatureSpirit', { mesh: nsModel, update: () => {} });
                        
                        // RESOLVE THE LOADING BLOCKER`
);

// 3. BHG Block
replaceBlock(
    '// Load the actual upgraded girl model and place her inside the Tipi',
    '                });\n                \n                scene.add(bhgGroup);',
    `// === PLACEHOLDER: Brings Happiness Girl ===
                const bhgModel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0x800080, wireframe: true }));
                bhgModel.position.set(0, 0.9, 0); bhgGroup.add(bhgModel);
                
                const questGroup2 = createQuestBalloon('2', 'quest_2_find_her');
                const markerY2 = bhgY + 10.3; const markerZ2 = bhgZ;
                questGroup2.position.set(bhgX, markerY2, markerZ2); questGroup2.userData.baseY = markerY2;
                const stringGeo2 = new THREE.CylinderGeometry(0.0018, 0.0018, 2.9, 4); stringGeo2.translate(0, -1.45, 0); 
                const stringMesh2 = new THREE.Mesh(stringGeo2, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24 }));
                stringMesh2.position.set(0, -1.45, 0); questGroup2.add(stringMesh2);
                questGroup2.visible = false; scene.add(questGroup2); window._questMarker2 = questGroup2; window._bhgBalloon = questGroup2;
                
                if (window.masterAI) window.masterAI.registerSystem('NPC_BHG', { mesh: bhgGroup, update: () => {} });
                
                scene.add(bhgGroup);`
);

// 4. REG Block
replaceBlock(
    '// === NPC REG (Tipi 3) ===',
    '                });\n                \n                scene.add(regGroup);',
    `// === PLACEHOLDER: Reg ===
                const regModel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0x0000ff, wireframe: true }));
                regModel.position.set(0, 0.9, 0); regGroup.add(regModel);
                if (window.masterAI) window.masterAI.registerSystem('NPC_Reg', { mesh: regGroup, update: () => {} });
                
                scene.add(regGroup);`
);

fs.writeFileSync('js/EnvironmentBuilder.js', text);

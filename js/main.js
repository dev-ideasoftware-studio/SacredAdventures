import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { Engine } from './Engine.js';
import { FPV } from './components/FPV.js';
import { Minimap } from './components/Minimap.js';
import { EventLog } from './components/EventLog.js';
import { CommandInput } from './components/CommandInput.js';
import { StatsPanel } from './components/StatsPanel.js';
import { Keypad } from './components/Keypad.js';
import { GuideButtons } from './components/GuideButtons.js';
import { MAP_SIZE, TILE_SIZE, T_CORN, T_WATER } from './Constants.js';

// Global game instance
window.game = new Engine();
const game = window.game;

// Components
const fpv = new FPV(game);
const minimap = new Minimap(game);
const eventLog = new EventLog();
const cmdInput = new CommandInput(game);
const stats = new StatsPanel(game);
const keypad = new Keypad();
const guide = new GuideButtons(game);

// Wire up logging
game.log = (msg, color) => eventLog.log(msg, color);

// --- Game Logic Implementations ---

// Encounter Handler
game.onEncounter = (mob) => {
    game.encounterActive = true;
    game.currentEncounterMob = mob;
    
    const modal = document.getElementById('encounter-modal');
    const title = document.getElementById('enc-title');
    const desc = document.getElementById('enc-desc');
    const actions = document.getElementById('enc-actions');
    const avatarContainer = document.getElementById('enc-avatar-container');
    
    actions.innerHTML = '';
    modal.classList.remove('hidden');

    if (mob.isNPC) {
        title.innerText = mob.type;
        desc.innerText = "A friendly trader. You can buy supplies or share gossip.";
        const av = document.createElement('div');
        av.className = 'encounter-avatar';
        av.style.backgroundImage = 'url(https://via.placeholder.com/80/312e81/ffffff?text=Josh)';
        avatarContainer.innerHTML = '';
        avatarContainer.appendChild(av);

        actions.innerHTML = `
            <button class="action-btn" onclick="handleEncounter('trade')">💰 Trade</button>
            <button class="action-btn" onclick="handleEncounter('talk')">💬 Talk</button>
            <button class="action-btn secondary" onclick="handleEncounter('leave')">Leave</button>
        `;
    } else {
        title.innerText = "Wildlife Encountered";
        desc.innerText = `You see a ${mob.type} grazing nearby.`;
        avatarContainer.innerHTML = '';
        actions.innerHTML = `
            <button class="action-btn" onclick="handleEncounter('hunt')">🏹 Hunt (Food)</button>
            <button class="action-btn" onclick="handleEncounter('observe')">👁️ Observe (XP)</button>
            <button class="action-btn secondary" onclick="handleEncounter('ignore')">Ignore</button>
        `;
    }
    
    // Stop movement
    game.input.keys.w = game.input.keys.s = game.input.keys.a = game.input.keys.d = false;
};

// Loot Handler
game.onLoot = (obj, index) => {
    const p = game.player;
    if (obj.type === 'wood') {
        p.wood++;
        game.log("Gathered Firewood.", "#8B4513");
        game.spawnFloatingText("+1 Wood", "#8B4513", obj.mesh.position);
    } else if (obj.type === 'fish') {
        if (p.hasSpear) {
            p.corn++; // Using corn logic for food count
            game.log("Speared a Fish.", "#38bdf8");
            game.spawnFloatingText("+1 Fish", "#38bdf8", obj.mesh.position);
            game.scene.remove(obj.mesh);
            game.gameObjects.splice(index, 1);
        } else {
             if (Math.random() < 0.05) game.log("Need Fishing Spear!", "#ef4444");
        }
        if (!p.hasSpear) return; // Don't remove if not caught
    } else if (obj.type === 'Spirit Card') {
        // Always give fast delivery
        // Show modal
        game.encounterActive = true;
        document.getElementById('item-modal').classList.remove('hidden');
        game.log("Found Spirit Card!", "#a855f7");
        game.spawnFloatingText("Card!", "#a855f7", obj.mesh.position);
        game.scene.remove(obj.mesh);
        game.gameObjects.splice(index, 1);
        return; // Modal handles resume
    } else {
        game.log(`Found ${obj.type}.`, "#facc15");
        game.spawnFloatingText(obj.type, "#facc15", obj.mesh.position);
        game.scene.remove(obj.mesh);
        game.gameObjects.splice(index, 1);
    }
    stats.update();
    guide.updateCampButtons();
};

window.pickupCard = () => {
    game.player.cards.push('fast_delivery');
    game.log("Card added to deck.", "#a855f7");
    document.getElementById('item-modal').classList.add('hidden');
    game.encounterActive = false;
    stats.updateCards();
};

window.handleEncounter = (action) => {
    const mob = game.currentEncounterMob;
    if (!mob) return;

    if (mob.isNPC) {
        if (action === 'trade') game.log("Trade menu not implemented.", "#a8a8a8");
        if (action === 'talk') game.log("Josh: 'Keep your head down in the woods.'", "#FDFBF7");
        if (action === 'leave') {
            game.log("You bid farewell.", "#a0aec0");
            mob.encountered = true;
            game.scene.remove(mob.mesh);
            const idx = game.animals.indexOf(mob);
            if (idx > -1) game.animals.splice(idx, 1);
        }
        if (action !== 'leave') return;
    } else {
        if (action === 'hunt') {
            startHuntCinematic(mob);
            // Return early to keep encounterActive true during cinematic
            document.getElementById('encounter-modal').classList.add('hidden');
            return; 
        } else if (action === 'observe') {
            game.log(`You observed the ${mob.type}. +XP`, "#556B2F");
            game.spawnFloatingText("+XP", "#556B2F", mob.mesh.position);
            mob.encountered = true;
        } else {
            game.log("You stepped away.", "#a0aec0");
            mob.encountered = true;
            setTimeout(() => { mob.encountered = false; }, 5000);
        }
    }
    document.getElementById('encounter-modal').classList.add('hidden');
    game.encounterActive = false;
    game.currentEncounterMob = null;
};

function startHuntCinematic(mob) {
    const crosshair = document.getElementById('crosshair');
    if(crosshair) crosshair.style.display = 'block';
    game.encounterActive = true;
    
    const arrGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8);
    const arrMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const arrow = new THREE.Mesh(arrGeo, arrMat);
    arrow.rotation.x = Math.PI / 2;
    arrow.position.copy(game.fpvCamera.position);
    arrow.position.y -= 0.2;
    arrow.lookAt(mob.mesh.position);
    
    game.scene.add(arrow);
    game.arrows.push(arrow);
    
    game.huntingMode = {
        mob: mob,
        arrow: arrow,
        startTime: performance.now(),
        duration: 1000
    };
    game.log(`You aim your bow at the ${mob.type}...`, "#facc15");
}

window.findResources = (type) => {
    game.log(`Scanning for ${type}...`, "#FDFBF7");
    game.resourceMarkers.forEach(m => game.scene.remove(m));
    game.resourceMarkers = [];

    const range = 5;
    const px = Math.round(game.player.x);
    const py = Math.round(game.player.y);
    let foundCount = 0;

    for (let y = py - range; y <= py + range; y++) {
        for (let x = px - range; x <= px + range; x++) {
            if (x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE) {
                const tile = game.map[y][x];
                let icon = null;

                if (type === 'wood') {
                    const loot = game.gameObjects.find(o => Math.round(o.x) === x && Math.round(o.y) === y);
                    if (loot && loot.type === 'wood') icon = "🪵";
                }
                else if (type === 'food') {
                    if (tile === T_CORN) icon = "🌽";
                    else if (tile === T_WATER) {
                        const fish = game.gameObjects.find(o => o.type === 'fish' && Math.round(o.x) === x && Math.round(o.y) === y);
                        if (fish) icon = "🐟";
                    } else {
                        const loot = game.gameObjects.find(o => Math.round(o.x) === x && Math.round(o.y) === y);
                        if (loot && loot.type === 'Raw Maize') icon = "🌽";
                    }
                }

                if (icon) {
                    createResourceMarker(x, y, icon);
                    foundCount++;
                }
            }
        }
    }
    
    if (foundCount > 0) game.log(`Found ${foundCount} ${type} sources nearby.`, "#4ade80");
    else game.log(`No ${type} found nearby.`, "#ef4444");
};

function createResourceMarker(x, y, symbol) {
    const cvs = document.createElement('canvas');
    cvs.width = 64; cvs.height = 64;
    const ctx = cvs.getContext('2d');
    ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fillStyle = "#facc15"; ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = "30px Arial";
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol, 32, 34);

    const tex = new THREE.CanvasTexture(cvs);
    const mat = new THREE.SpriteMaterial({ map: tex });
    const sprite = new THREE.Sprite(mat);

    const px = (x - MAP_SIZE / 2) * TILE_SIZE;
    const pz = (y - MAP_SIZE / 2) * TILE_SIZE;
    sprite.position.set(px, 3, pz);
    sprite.scale.set(3, 3, 1);
    game.scene.add(sprite);
    game.resourceMarkers.push(sprite);
}

// Camp Interactions
window.openContextAction = (type) => {
    // Determine context based on proximity if type not set
    // In original code, it passed 'inspect' or 'camp' based on button click logic that was set inside update loop
    // BUT here we set onclick="openContextAction()" in HTML without params
    // So we need to Check interactions again?
    // Actually, in original code: guideBtn.onclick = () => openContextAction('inspect');
    // So we need a system to update the onclick handler OR just check state here.
    
    // Let's check state
    const gx = Math.round(game.player.x);
    const gy = Math.round(game.player.y);
    const nearCamp = game.activeCampMarker && Math.abs(gx - game.activeCampMarker.x) < 2 && Math.abs(gy - game.activeCampMarker.y) < 2;
    
    if (nearCamp) {
        if (!game.player.hasAxe && !game.activeCampMarker.axeTaken) {
             // Inspect
             document.getElementById('item-modal').classList.remove('hidden');
             // Show axe logic??
             // Original: modal shows "Card Found" or something. 
             // Actually original code reused item-modal for generic items?
             // Wait, original code: 
             /*
                if (type === 'inspect') {
                    document.getElementById('item-modal').classList.remove('hidden');
                    // ...
                }
             */
             // And picking up axe:
             /*
                window.pickupAxe = () => { ... }
             */
             // Just triggering the modal isn't enough, we need to customize it for Axe?
             // Or maybe the modal is static in HTML?
             // In HTML I see:
             /*
                <div id="item-modal" ...>
                    <h2>Card Found!</h2> ... <button ... onclick="pickupCard()">Keep It</button>
                </div>
             */
             // It seems hardcoded for Card.
             // I should modify it dynamically or add another modal for Axe.
             // For now, let's assume it's just for card or I'll patch it.
             const modal = document.getElementById('item-modal');
             modal.querySelector('h2').textContent = "Item Found";
             modal.querySelector('.icon').textContent = "🪓";
             modal.querySelector('h3').textContent = "Stone Axe";
             modal.querySelector('p').textContent = "A simple tool for chopping wood.";
             modal.querySelector('button').onclick = window.pickupAxe;
             modal.classList.remove('hidden');
        } else {
             // Open Camp Menu
             document.getElementById('interaction-prompt').classList.add('hidden');
             document.getElementById('camp-menu').classList.remove('hidden');
        }
        game.encounterActive = true;
        game.input.keys.w = false; // Stop
    }
};

window.pickupAxe = () => {
    game.player.hasAxe = true;
    if (game.activeCampMarker && game.activeCampMarker.axe) {
        game.scene.remove(game.activeCampMarker.axe);
        game.activeCampMarker.axeTaken = true;
    }
    document.getElementById('item-modal').classList.add('hidden');
    game.encounterActive = false;
    game.log("You took the Stone Axe.", "#facc15");
    guide.updateCampButtons();
};

window.handleCampAction = (action) => {
    const p = game.player;
    if (action === 'rest') {
        p.hp = Math.min(p.maxHp, p.hp + 5);
        game.log("Rested.", "#4ade80");
        game.gameTime += 2; 
        window.closeCampMenu();
    }
    if (action === 'fire') {
        if (p.wood > 0) {
            p.wood--;
            game.hasFire = true;
            startFireCinematic();
        } else game.log("Need Wood!", "#ef4444");
    }
    if (action === 'craft_spear') {
        if (p.wood > 0) {
            p.wood--;
            p.hasSpear = true;
            game.log("Crafted Fishing Spear.", "#38bdf8");
        } else game.log("Need Wood!", "#ef4444");
    }
    if (action === 'cook') {
        game.log("Roasted meal.", "#facc15");
    }
    stats.update();
    guide.updateCampButtons();
};

window.closeCampMenu = () => {
    document.getElementById('camp-menu').classList.add('hidden');
    game.encounterActive = false;
};

function startFireCinematic() {
    document.body.classList.add('cinematic');
    if (game.activeCampMarker && game.activeCampMarker.firepit) {
        const fireGroup = game.activeCampMarker.firepit;
        const light = new THREE.PointLight(0xff4500, 2, 20);
        light.position.y = 1; 
        light.castShadow = true;
        fireGroup.add(light);
        
        for (let i = 0; i < 10; i++) {
             const pGeo = new THREE.DodecahedronGeometry(0.2);
             const pMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
             const p = new THREE.Mesh(pGeo, pMat);
             p.position.set((Math.random() - 0.5) * 0.5, Math.random(), (Math.random() - 0.5) * 0.5);
             fireGroup.add(p);
             game.fireParticles.push({ mesh: p, speed: 0.5 + Math.random() });
        }
        
        game.cinematicMode = {
             type: 'fire',
             startTime: performance.now(),
             target: fireGroup.position.clone(),
             light: light
        };
    }
    window.closeCampMenu();
    game.log("You built a warm fire.", "#f97316");
    setTimeout(() => {
        document.body.classList.remove('cinematic');
        game.cinematicMode = null;
        game.updatePlayerPos();
    }, 4000);
}

window.useCard = (type) => {
    game.cardToUse = type;
    if (type === 'fast_delivery') {
        document.getElementById('card-confirm-modal').classList.remove('hidden');
        game.encounterActive = true;
    }
};

window.confirmCardUse = () => {
    if (game.cardToUse === 'fast_delivery') {
        const idx = game.player.cards.indexOf(game.cardToUse);
        if (idx > -1) game.player.cards.splice(idx, 1);

        const dist = 3;
        const dx = Math.sin(game.player.rot);
        const dy = Math.cos(game.player.rot);
        const tx = Math.round(game.player.x + dx * dist);
        const ty = Math.round(game.player.y + dy * dist);
        
        const traderGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.7, 8);
        const traderMat = new THREE.MeshStandardMaterial({ color: 0x312e81 });
        game.worldGen.spawnNPC(traderGeo, traderMat, 'Trader Josh', tx, ty);
        
        game.log("You summoned Josh the Trader!", "#a855f7");
        stats.updateCards();
    }
    window.cancelCardUse();
};

window.cancelCardUse = () => {
    document.getElementById('card-confirm-modal').classList.add('hidden');
    game.encounterActive = false;
    game.cardToUse = null;
};

// Register Components
game.registerComponent(fpv);
game.registerComponent(minimap);
game.registerComponent(cmdInput);
game.registerComponent(stats);
game.registerComponent(keypad);
game.registerComponent(guide);

// Initialize
window.onload = () => {
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.remove();
    game.init();
    stats.update();
    stats.updateCards();
};

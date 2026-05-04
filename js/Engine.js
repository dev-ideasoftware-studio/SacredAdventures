import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { WorldGen } from './systems/WorldGen.js';
import { InputManager } from './systems/Input.js';
import { TILE_SIZE, MAP_SIZE, ROT_SPEED, MOVE_SPEED, T_FOREST, T_WATER, PLAYER_HEIGHT } from './Constants.js';

export class Engine {
    constructor() {
        this.scene = null;
        this.camera = null;     // Minimap Ortho Camera
        this.renderer = null;   // Minimap Renderer
        this.fpvCamera = null;
        this.fpvRenderer = null;

        this.input = new InputManager(this);
        this.worldGen = new WorldGen(this);

        this.components = []; // List of components to update (FPV, Minimap, etc.)

        // Game State
        this.map = [];
        this.player = { 
            x: 40, y: 40, rot: 0, 
            hp: 20, maxHp: 20, 
            wood: 0, corn: 0, fish: 0, 
            hasAxe: false, hasSpear: false, 
            cards: ['fast_delivery'], 
            object: null, marker: null 
        };
        
        this.gameObjects = [];
        this.animals = [];
        this.floatingTexts = [];
        this.fireParticles = [];
        this.resourceMarkers = [];
        this.arrows = [];

        this.gameTime = 8.0;
        this.timeScale = 0.5;
        this.lastTime = performance.now();
        this.isGameMoving = false;
        
        // Modal/Cinematic States
        this.encounterActive = false;
        this.cinematicMode = null;
        this.huntingMode = null;
        this.cardToUse = null;
        this.currentEncounterMob = null;
        this.activeCampMarker = null;
        this.timeSinceCamp = 0;
        this.hasFire = false;
        this.hungerTriggered = false;
        this.isRotating = false;

        this.lastPos = new THREE.Vector3();
        this.moveSpeedVal = 0;

        // Lights
        this.sunlight = null;
        this.ambientLight = null;
        this.nightLight = null;
    }

    init() {
        // Scene Setup
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x1e2610, 0.02);
        this.scene.background = new THREE.Color(0x1e2610);

        this.setupLights();
        
        // Initialize Input
        this.input.init();

        // Generate World
        this.worldGen.generateWilderness();
        
        // Spawn Initial Camp
        const cx = this.player.x;
        const cy = this.player.y - 4;
        this.worldGen.spawnCampMarker(cx, cy);

        // Start Loop
        this.log("You awaken in the Sacred Grove. The spirits watch.", "#e3ebe3");
        setTimeout(() => this.triggerHungerEvent(), 2000);
        
        this.animate();
    }

    setupLights() {
        this.sunlight = new THREE.DirectionalLight(0xfcf5e5, 1.0);
        this.sunlight.position.set(50, 100, 20);
        this.sunlight.castShadow = true;
        this.sunlight.shadow.mapSize.width = 2048;
        this.sunlight.shadow.mapSize.height = 2048;
        this.sunlight.shadow.camera.left = -60;
        this.sunlight.shadow.camera.right = 60;
        this.sunlight.shadow.camera.top = 60;
        this.sunlight.shadow.camera.bottom = -60;
        this.scene.add(this.sunlight);

        this.ambientLight = new THREE.HemisphereLight(0x425224, 0x0f172a, 0.4);
        this.scene.add(this.ambientLight);

        this.nightLight = new THREE.AmbientLight(0x425224, 0.2);
        this.nightLight.layers.set(0);
        this.scene.add(this.nightLight);
    }

    registerComponent(component) {
        this.components.push(component);
        if (component.init) component.init();
    }

    log(msg, color) {
        const div = document.createElement('div');
        div.textContent = msg;
        div.style.color = color || '#ccc';
        const el = document.getElementById('event-log');
        if(el) {
            el.appendChild(div);
            el.scrollTop = el.scrollHeight;
        }
    }

    spawnFloatingText(msg, color, pos) {
        // Only minimal logic here, ideally moved to a component but acceptable in Engine for now
        // Or create a FloatingTextSystem. For simplicity, keeping basic logic here but refactoring class out.
        // Actually, let's keep the `FloatingText` class definition in a util or just inline here if small.
        // I'll inline the creation logic similar to previous code but adapting to system.
        
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = "Bold 40px Nunito";
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(msg, 128, 48);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(pos);
        sprite.position.y += 1.5;
        sprite.scale.set(4, 1, 1);
        
        this.floatingTexts.push({ sprite: sprite, life: 2.0 });
        this.scene.add(sprite);
    }

    triggerHungerEvent() {
        if (this.hungerTriggered) return;
        this.hungerTriggered = true;
        this.log("You are hungry...", "#eab308");
        this.log("It is growing dark.", "#eab308");
        const el = document.getElementById('stat-hunger');
        if (el) { el.textContent = "Hungry"; el.style.color = "#facc15"; }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        let now = performance.now();
        let dt = (now - this.lastTime) / 1000;
        this.lastTime = now;

        // Cinematic Override
        if (this.cinematicMode) {
           this.updateCinematic(dt, now);
        } else {
           this.updateGameLogic(dt);
        }

        // Update Floating Texts
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.life -= dt;
            ft.sprite.position.y += dt * 1.5;
            ft.sprite.material.opacity = Math.min(1, ft.life);
            if (ft.life <= 0) {
                this.scene.remove(ft.sprite);
                this.floatingTexts.splice(i, 1);
            }
        }

        // Update Arrows
        for (let i = this.arrows.length - 1; i >= 0; i--) {
            const arr = this.arrows[i];
            arr.translateY(dt * 15.0); // Move forward
        }

        if (this.huntingMode) {
             const elapsed = performance.now() - this.huntingMode.startTime;
             if (elapsed > this.huntingMode.duration) {
                 this.huntingMode = null;
                 this.encounterActive = false;
                 // Cleanup all arrows
                 this.arrows.forEach(a => this.scene.remove(a));
                 this.arrows = [];
                 this.log("The shot missed...", "#a0aec0");
             }
        }

        // Update Components
        this.components.forEach(c => {
            if (c.update) c.update(dt);
        });
    }

    updateCinematic(dt, now) {
         const mode = this.cinematicMode;
         if(mode.type === 'fire') {
            const elapsed = (now - mode.startTime) / 1000;
            const radius = 5;
            const angle = elapsed * 0.5;
            this.fpvCamera.position.x = mode.target.x + Math.sin(angle) * radius;
            this.fpvCamera.position.z = mode.target.z + Math.cos(angle) * radius;
            this.fpvCamera.position.y = 2 + Math.sin(elapsed) * 0.5;
            this.fpvCamera.lookAt(mode.target);

            if (mode.light) {
                mode.light.intensity = 1.5 + Math.random();
            }
         }
         
         // Animate particles
         this.fireParticles.forEach(p => {
             p.mesh.position.y += dt * p.speed;
             if (p.mesh.position.y > 1.5) p.mesh.position.y = 0;
             p.mesh.scale.setScalar(1 - p.mesh.position.y / 1.5);
         });
    }

    updateGameLogic(dt) {
        if (this.encounterActive || this.huntingMode) return;

        // Input Handling
        const keys = this.input.keys;
        const inputActive = keys.w || keys.s || keys.a || keys.d;

        if (inputActive) {
            if (keys.a || keys.d) this.isRotating = true;
        } else {
             if (this.isRotating) {
                const currentRot = this.player.rot;
                const snap = Math.PI / 4;
                const targetRot = Math.round(currentRot / snap) * snap;
                this.player.rot += (targetRot - this.player.rot) * 5.0 * dt;
                this.updatePlayerPos();
                if (Math.abs(targetRot - this.player.rot) < 0.01) {
                    this.player.rot = targetRot;
                    this.isRotating = false;
                }
            }
            return;
        }

        // Time Cycle
        this.gameTime += dt * this.timeScale;
        if (this.gameTime >= 24) this.gameTime = 0;
        
        // Atmosphere
        let intensity = Math.max(0, Math.sin((this.gameTime - 6) * (Math.PI / 12)));
        if (!this.hungerTriggered) intensity = Math.max(0.1, intensity);
        if (this.hungerTriggered) { 
            intensity = 0.2; 
            this.scene.fog.color.setHex(0x0f172a); 
            this.scene.background.setHex(0x0f172a); 
        } else {
            const dayColor = new THREE.Color(0xfcf5e5);
            const nightColor = new THREE.Color(0x0f172a);
            this.sunlight.color.lerpColors(nightColor, dayColor, intensity);
            this.scene.background.lerpColors(nightColor, new THREE.Color(0x1e2610), intensity);
            this.scene.fog.color.copy(this.scene.background);
        }
        this.sunlight.intensity = intensity;

        // Movement
        let move = 0;
        if (keys.w) move = 1;
        if (keys.s) move = -1;
        let rot = 0;
        if (keys.a) rot = 1;
        if (keys.d) rot = -1;

        if (rot !== 0) {
            this.player.rot += rot * ROT_SPEED * dt;
            this.updatePlayerPos();
        }

        if (move !== 0) {
            const dx = Math.sin(this.player.rot) * move * MOVE_SPEED * dt;
            const dy = Math.cos(this.player.rot) * move * MOVE_SPEED * dt;
            const nextX = this.player.x + (dx / TILE_SIZE);
            const nextY = this.player.y + (dy / TILE_SIZE);
            const gx = Math.round(nextX);
            const gy = Math.round(nextY);

            const nextTile = this.map[gy] ? this.map[gy][gx] : undefined;
            let allowMove = false;

            if (nextTile === T_FOREST) {
                allowMove = true;
                this.player.rot += (Math.random() - 0.5) * 0.1;
            } else if (nextTile !== T_WATER && nextTile !== undefined) {
                allowMove = true;
            }

            if (allowMove) {
                this.player.x = nextX;
                this.player.y = nextY;
            }

            this.updatePlayerPos();
            this.checkEncounters();
            this.checkInteractions();
            
            // Random Camp Spawn
            this.timeSinceCamp += dt;
            if (this.timeSinceCamp > 15) {
                this.timeSinceCamp = 0;
                let cx, cy;
                do {
                    cx = Math.min(MAP_SIZE - 2, Math.max(2, Math.round(this.player.x) + Math.floor(Math.random() * 6) - 3));
                    cy = Math.min(MAP_SIZE - 2, Math.max(2, Math.round(this.player.y) + Math.floor(Math.random() * 6) - 3));
                } while (this.map[cy] && this.map[cy][cx] !== T_GRASS);
                this.worldGen.spawnCampMarker(cx, cy);
            }
        }
    }

    updatePlayerPos() {
        if(!this.player.object) return;
        const px = (this.player.x - MAP_SIZE / 2) * TILE_SIZE;
        const pz = (this.player.y - MAP_SIZE / 2) * TILE_SIZE;
        this.player.object.position.set(px, 0, pz);
        
        if(this.fpvCamera) {
            this.fpvCamera.position.set(px, PLAYER_HEIGHT, pz);
            this.fpvCamera.rotation.y = this.player.rot + Math.PI;
        }

        if (this.player.marker) {
            this.player.marker.position.set(px, 10, pz);
            this.player.marker.rotation.y = this.player.rot + Math.PI;
            
            if(this.camera) {
                this.camera.position.x = px;
                this.camera.position.z = pz;
                this.camera.lookAt(px, 0, pz);
            }
        }
    }

    checkEncounters() {
        // Logic will be moved to components or kept here if simple. 
        // For now, keep simple encounter check hooks.
        // Implementing full logic requires moving 'animals' check here.
        if(!this.player.object) return;
        const px = this.player.object.position.x;
        const pz = this.player.object.position.z;
        
        for (let anim of this.animals) {
            if (anim.encountered) continue;
            const ax = anim.mesh.position.x;
            const az = anim.mesh.position.z;
            const dist = Math.sqrt((px - ax) ** 2 + (pz - az) ** 2);
            if (dist < 4.0) {
                 // Trigger encounter - delegate to a manager or method
                 // For now, just a placeholder or call global handle (if we keep globals)
                 // Better: Emit event or call interaction component
                 if(this.onEncounter) this.onEncounter(anim);
                 break;
            }
        }
    }

    checkInteractions() {
        if(!this.player.object) return;
        const px = this.player.object.position.x;
        const pz = this.player.object.position.z;
        
        // Loot
        for (let i = this.gameObjects.length - 1; i >= 0; i--) {
            const obj = this.gameObjects[i];
            const ox = obj.mesh.position.x;
            const oz = obj.mesh.position.z;
            if (obj.animate) obj.animate();

            if (Math.abs(px - ox) < 2.0 && Math.abs(pz - oz) < 2.0) {
                 if(this.onLoot) this.onLoot(obj, i);
            }
        }
    }
}

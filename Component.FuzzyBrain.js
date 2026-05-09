// ======================================================================
// Component.FuzzyBrain.js — Adaptive Rendering AI Controller
// Monitors FPS and dynamically adjusts rendering quality to maintain
// smooth performance. Controls: shadows, PIP, tree LOD, draw distance.
// ======================================================================

class FuzzyBrain {
    constructor(renderer, composer, scene, config = {}) {
        this.renderer = renderer;
        this.composer = composer;
        this.scene = scene;
        
        // --- TARGETS ---
        this.targetFPS = config.targetFPS || 55;
        this.criticalFPS = config.criticalFPS || 20;
        this.recoveryFPS = config.recoveryFPS || 45;
        
        // --- FPS TRACKING ---
        this.frameTimes = [];          // Rolling window of frame deltas
        this.windowSize = 60;          // Average over 1 full second to ignore WebGL compile spikes
        this.currentFPS = 60;
        this.smoothFPS = 60;
        this.frameCount = 0;
        
        // --- QUALITY LEVELS ---
        // 0 = Ultra (everything on), 1 = High, 2 = Medium, 3 = Low, 4 = Survival
        this.qualityLevel = 0;
        this.qualityNames = ['ULTRA', 'HIGH', 'MEDIUM', 'LOW', 'SURVIVAL'];
        this.cooldownFrames = 0;       // Prevent rapid quality changes
        this.cooldownDuration = 60;    // Wait 60 frames between changes
        
        // --- CONTROLLED SYSTEMS ---
        this.shadows = true;
        this.shadowMapSize = 2048;     // Reduced from 4096 for 60fps base
        this.pipEnabled = true;
        this.pipSkipFrames = 1;        // Render PIP every N frames
        this.fogDensity = 0.003;       // Base engine barebones fog
        this.treeRenderDist = 120;     // Max distance to render trees
        this.maxVisibleTrees = 200;
        this.shadowCullRadius = 150;   // Default shadow radius
        this.pixelRatio = window.devicePixelRatio || 1;
        this.aiThrottle = 1;           // 1 = every frame, 3 = every 3rd frame
        
        // --- REFERENCES ---
        this.pipRenderer = null;
        this.pipCamera = null;
        this.sunLight = null;
        this.treeMeshes = [];          // Tree scene objects for LOD
        this.camera = null;
        this.creatureSystems = {};     // { name: system } — registered creature AIs
        this.npcs = [];                // { id, mesh, system } — isolated interactive NPCs
        
        // --- DIAGNOSTICS ---
        this.lastReport = 0;
        this.reportInterval = 3000;    // Report every 3 seconds
        this.enabled = true;
        
        // --- CONFIG REGISTRY ---
        // Records of asset/texture decisions and rendering optimizations
        // This is the AI's memory of what works and what doesn't
        this.registry = {
            textures: {
                ground: {
                    file: 'Assets/ground.png',
                    type: 'photorealistic',
                    repeat: [12, 12],
                    note: 'Forest floor — pine needles, moss, pebbles. 1024x1024. Previous grass_seamless.png looked like a quilt. This one matches Ponderosa forest theme.'
                },
                treeBark: {
                    file: 'Assets/PineTree/wood100.jpg',
                    type: 'original_3ds',
                    note: 'Loaded by TDSLoader from 3DS file. DO NOT override with custom materials.'
                },
                treeBranch: {
                    file: 'Assets/PineTree/branch2.png',
                    type: 'original_3ds',
                    note: 'Loaded by TDSLoader. Needs alphaTest:0.5 and DoubleSide. DO NOT override.'
                }
            },
            models: {
                pineTree: {
                    file: 'Assets/PineTree/tree.3ds',
                    loader: 'TDSLoader',
                    scale: 0.35,
                    fixes: ['rotateX(-PI/2) for Z-up→Y-up', 'colorSpace=SRGB', 'DoubleSide', 'alphaTest=0.5'],
                    note: 'PRESERVE original materials. TDSLoader auto-assigns textures via setResourcePath.'
                }
            },
            performance: {
                shadowMap: '2048 is sweet spot. 4096 too expensive, 1024 visibly worse.',
                terrain: '64x64 segments. 128x128 was overkill for sine-wave hills.',
                lensflare: 'Single element only. Multiple elements = visual noise + GPU waste.',
                pip: 'Skip frames via FuzzyBrain. Every 2nd frame at HIGH, every 4th at MEDIUM, off at LOW.',
                groundMaterial: 'No displacementMap on ground (doubles vertex processing). Vertex height is enough.',
                statsHUD: 'scene.traverse every 30 frames max. More often kills FPS.',
                treeRendering: 'Preserve 3DS original materials. Custom material overrides broke appearance.',
                fog: 'FogExp2 density 0.008 default. Increase to 0.015-0.025 to hide distant geometry at low FPS.'
            }
        };
        
        console.log('[FuzzyBrain] Initialized — target: ' + this.targetFPS + ' FPS');
        console.log('[FuzzyBrain] Config registry loaded:', Object.keys(this.registry.textures).length, 'textures,', Object.keys(this.registry.models).length, 'models');
    }
    
    // --- LINK EXTERNAL SYSTEMS ---
    linkPIP(pipRenderer, pipCamera) {
        this.pipRenderer = pipRenderer;
        this.pipCamera = pipCamera;
    }
    
    linkSun(sunLight) {
        this.sunLight = sunLight;
    }
    
    linkCamera(camera) {
        this.camera = camera;
    }
    
    linkTrees(treeMeshes) {
        this.treeMeshes = treeMeshes;
    }
    
    /**
     * Register a creature system (rabbits, squirrels, deer, etc.)
     * for FPS-aware population throttling.
     */
    linkCreatureSystem(name, system) {
        this.creatureSystems[name] = system;
        console.log(`[FuzzyBrain] Linked creature system: ${name}`);
    }
    
    /**
     * Register a single NPC mesh and its animation system
     */
    linkNPC(id, mesh, system) {
        if (!mesh) return;
        this.npcs.push({ id, mesh, system });
        console.log(`[FuzzyBrain] Linked NPC: ${id}`);
    }
    
    /**
     * Returns status of all linked creature systems.
     */
    getCreatureStatus() {
        const status = {};
        for(const [name, sys] of Object.entries(this.creatureSystems)) {
            if(sys.getStatus) status[name] = sys.getStatus();
        }
        return status;
    }
    
    /**
     * Note: updateAnimations was removed in v2.0.0. 
     * FuzzyBrain no longer controls AI logic or delta-time throttling.
     * Wildlife and NPCs are now managed by MasterAI and MasterNPCAI respectively.
     */
    
    // --- MAIN UPDATE (call once per frame) ---
    update(delta) {
        if(!this.enabled) return;
        
        this.frameCount++;
        
        // Clamp maximum delta to prevent giant load spikes from tanking the average
        const clampedDelta = Math.min(delta, 0.1); // Max 100ms per frame
        
        // Track frame time
        this.frameTimes.push(clampedDelta);
        if(this.frameTimes.length > this.windowSize) {
            this.frameTimes.shift();
        }
        
        // Calculate smoothed FPS
        if(this.frameTimes.length >= 5) {
            const avgDelta = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
            this.currentFPS = 1.0 / Math.max(avgDelta, 0.001);
            // Exponential smoothing
            this.smoothFPS = this.smoothFPS * 0.9 + this.currentFPS * 0.1;
        }
        
        // Cooldown
        if(this.cooldownFrames > 0) {
            this.cooldownFrames--;
            return;
        }
        
        // --- FUZZY LOGIC DECISION ---
        this.evaluate();
        
        // --- TREE LOD & SHADOW CULLING (every 30 frames) ---
        if(this.frameCount % 30 === 0 && this.camera && this.treeMeshes.length > 0) {
            this.updateTreeLOD();
        }
        
        // --- DIAGNOSTICS ---
        const now = performance.now();
        if(now - this.lastReport > this.reportInterval) {
            this.lastReport = now;
            console.log(`[FuzzyBrain] FPS: ${this.smoothFPS.toFixed(1)} | Quality: ${this.qualityNames[this.qualityLevel]} | Shadows: ${this.shadows} | Res: ${this.pixelRatio.toFixed(1)}`);
        }
    }
    
    // --- FUZZY EVALUATION ---
    evaluate() {
        const fps = this.smoothFPS;
        
        if(fps < this.criticalFPS && this.qualityLevel < 4) {
            // EMERGENCY — drop quality fast
            this.setQuality(Math.min(this.qualityLevel + 2, 4));
            this.lastDowngradeFrame = this.frameCount;
        } else if(fps < this.targetFPS && this.qualityLevel < 4) {
            // BELOW TARGET — reduce quality one step
            this.setQuality(this.qualityLevel + 1);
            this.lastDowngradeFrame = this.frameCount;
        } else if(fps > this.recoveryFPS && this.qualityLevel > 0) {
            // ABOVE RECOVERY — restore quality one step, but ONLY after stable 10s
            // Prevents the infinite lighting flash loop (downgrade -> fps rises -> upgrade -> fps drops -> downgrade)
            if (this.frameCount - (this.lastDowngradeFrame || 0) > 180) {
              this.setQuality(this.qualityLevel - 1);
            }
        }
    }
    
    // --- APPLY QUALITY PRESET ---
    setQuality(level) {
        if(level === this.qualityLevel) return;
        
        const oldLevel = this.qualityLevel;
        this.qualityLevel = Math.max(0, Math.min(4, level));
        
        // Much longer cooldown after an upgrade to prevent rapid oscillation
        this.cooldownFrames = (this.qualityLevel < oldLevel) ? 300 : this.cooldownDuration;
        
        console.log(`[FuzzyBrain] Quality: ${this.qualityNames[oldLevel]} → ${this.qualityNames[this.qualityLevel]}`);
        
        // HARDCAP Device Pixel Ratio to exactly 1.0 to prevent Mac OS scaling 
        // issues resulting in silent 5K rendering queues and hard 30 FPS thermal locks.
        const maxPR = 1.0;
        
        switch(this.qualityLevel) {
            case 0: // ULTRA (60+ FPS)
                this.applyShadows(true, 2048);
                this.shadowCullRadius = 150;
                this.applyPIP(true, { logbook: 4, compass: 1, avatar: 2, axe: 1 });
                this.applyFog(0.003);
                this.applyPostProcessing(true); // Full shaders
                if(window.SacredState && window.SacredState.bokehPass) window.SacredState.bokehPass.enabled = true;
                // SUPERSAMPLING IN ULTRA REMOVED: Capped at 1.0 to prevent 30fps lock.
                this.applyResolutionScaling(maxPR); 
                this.maxVisibleTrees = 200;
                this.aiThrottle = 1;
                break;
                
            case 1: // HIGH (55-60 FPS)
                this.applyShadows(true, 1024);
                this.shadowCullRadius = 80;    // Pull in shadows slightly
                this.applyPIP(true, { logbook: 4, compass: 2, avatar: 3, axe: 2 });        // Throttled to prevent GPU/CPU drawImage stall
                this.applyFog(0.004); // subtle increase
                this.applyPostProcessing(true); // Full shaders
                // Disabling BokehPass in HIGH mode drastically rescues FPS while maintaining other shaders
                if(window.SacredState && window.SacredState.bokehPass) window.SacredState.bokehPass.enabled = false;
                this.applyResolutionScaling(maxPR); // Full Res
                this.maxVisibleTrees = 150;
                this.aiThrottle = 1;           // Never throttle AI below 60fps visually
                break;
                
            case 2: // MEDIUM (45-55 FPS)
                this.applyShadows(false, 512);
                this.shadowCullRadius = 40;    // Only local shadows (40ft)
                this.applyPIP(true, { logbook: 6, compass: 3, avatar: 4, axe: 3 }); // Skip 5 frames
                this.applyFog(0.006);
                this.applyPostProcessing(true);
                if(window.SacredState && window.SacredState.bokehPass) window.SacredState.bokehPass.enabled = false;
                this.applyResolutionScaling(Math.min(maxPR, 1.0)); // 1x Res
                this.maxVisibleTrees = 100;
                this.aiThrottle = 2;           // AI every 2nd frame (30fps)
                break;
                
            case 3: // LOW (<45 FPS)
                this.applyShadows(false);      // OFF
                this.shadowCullRadius = 0;
                this.applyPIP(true, { logbook: 8, compass: 4, avatar: 5, axe: 4 });
                this.applyFog(0.008); 
                this.applyPostProcessing(false); // Shaders OFF
                if(window.SacredState && window.SacredState.bokehPass) window.SacredState.bokehPass.enabled = false;
                this.applyResolutionScaling(Math.min(maxPR, 1.0)); // 1x Res minimum
                this.maxVisibleTrees = 50;
                this.aiThrottle = 2;
                for(const sys of Object.values(this.creatureSystems)) {
                    if(sys.setPopulationCap) sys.setPopulationCap(8);
                }
                break;
                
            case 4: // SURVIVAL (Meltdown)
                this.applyShadows(false);
                this.shadowCullRadius = 0;
                this.applyPIP(true, { logbook: 10, compass: 6, avatar: 10, axe: 6 });       // Ultra throttle for survival
                this.applyFog(0.015);          // Thick fog to hide culling
                this.applyPostProcessing(false);
                if(window.SacredState && window.SacredState.bokehPass) window.SacredState.bokehPass.enabled = false;
                this.applyResolutionScaling(Math.min(maxPR, 1.0)); // 1x Res minimum
                this.maxVisibleTrees = 20;     // Bare minimum trees
                this.aiThrottle = 3;           // AI at 20fps max drop
                for(const sys of Object.values(this.creatureSystems)) {
                    if(sys.setPopulationCap) sys.setPopulationCap(4);
                }
                break;
        }
    }
    
    // --- SHADOW CONTROL ---
    applyShadows(enable, mapSize) {
        this.shadows = enable;
        
        // CRITICAL PERFORMANCE FIX
        // We intentionally DO NOT update this.renderer.shadowMap.enabled dynamically!
        // Toggling global shadow map flags forces Three.js to dump and synchronously 
        // recompile every single material shader in the entire game world, creating 
        // a massive 1600ms+ Main Thread freeze exactly when the user is already losing FPS.
        // Toggling `castShadow` directly on the Light eliminates the draw calls without freezing!

        if(this.sunLight) {
            this.sunLight.castShadow = enable;
        }
    }
    
    // --- PIP CONTROL ---
    applyPIP(enable, skips) {
        this.pipEnabled = enable;
        this.pipSkipFrames = skips.logbook;
        this.compassSkipFrames = skips.compass;
        this.avatarSkipFrames = skips.avatar;
        this.axeSkipFrames = skips.axe;
    }
    
    // Should PIP render this frame?
    shouldRenderPIP() {
        if(!this.pipEnabled) return false;
        return (this.frameCount % this.pipSkipFrames === 0);
    }

    shouldRenderCompassPIP() {
        if(!this.pipEnabled) return false;
        return (this.frameCount % this.compassSkipFrames === 0);
    }

    shouldRenderAvatarPIP() {
        if(!this.pipEnabled) return false;
        return (this.frameCount % this.avatarSkipFrames === 0);
    }

    shouldRenderAxePIP() {
        if(!this.pipEnabled) return false;
        return (this.frameCount % this.axeSkipFrames === 0);
    }
    
    // --- FOG CONTROL ---
    applyFog(density) {
        this.fogDensity = density;
        if(this.scene && this.scene.fog) {
            this.scene.fog.density = density;
        }
    }
    
    // --- RESOLUTION SCALING ---
    applyResolutionScaling(ratio) {
        this.pixelRatio = ratio;
        if(this.renderer) {
            this.renderer.setPixelRatio(ratio);
        }
        if (typeof window !== 'undefined' && window.SacredState && window.SacredState.composer) {
            window.SacredState.composer.setPixelRatio(ratio);
        }
    }
    
    // --- POST PROCESSING CONTROL ---
    applyPostProcessing(enable) {
        // Dynamically toggle PostProcessing based on quality level.
        // Breathtaking Bokeh is extremely heavy, so it should only run in ULTRA mode.
        // We leave lightweight shaders on for Medium/High.
        if (typeof window !== 'undefined' && window.SacredState) {
            // NOTE: bokehPass is specifically toggled inside setQuality 
            // depending on ULTRA vs HIGH, but this generic toggle 
            // handles blanket disabling for low performance.
            if (window.SacredState.vTiltShiftPass) window.SacredState.vTiltShiftPass.enabled = enable;
            if (window.SacredState.hTiltShiftPass) window.SacredState.hTiltShiftPass.enabled = enable;
        }
    }
    
    // --- TREE LOD & SHADOW CULLING ---  
    updateTreeLOD() {
        if(!this.camera || this.treeMeshes.length === 0) return;
        
        // --- SMART CULLING INIT ---
        if (!this._fpvFrustum) {
            this._fpvFrustum = new THREE.Frustum();
            this._pipFrustum = new THREE.Frustum();
            this._projMatrix = new THREE.Matrix4();
            this._pipProjMatrix = new THREE.Matrix4();
        }
        
        // Update main camera frustum
        this._projMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
        this._fpvFrustum.setFromProjectionMatrix(this._projMatrix);
        
        // Update PIP/Map camera frustums
        const activePipCameras = [];
        if (this.pipCamera) activePipCameras.push(this.pipCamera);
        if (typeof window !== 'undefined' && window.axePipCam) activePipCameras.push(window.axePipCam);
        if (typeof window !== 'undefined' && window._nativeMapCam) activePipCameras.push(window._nativeMapCam);
        
        if (!this._pipFrustums) this._pipFrustums = [];
        while (this._pipFrustums.length < activePipCameras.length) this._pipFrustums.push(new THREE.Frustum());
        
        for (let i = 0; i < activePipCameras.length; i++) {
            this._pipProjMatrix.multiplyMatrices(activePipCameras[i].projectionMatrix, activePipCameras[i].matrixWorldInverse);
            this._pipFrustums[i].setFromProjectionMatrix(this._pipProjMatrix);
        }

        const camX = this.camera.position.x;
        const camY = this.camera.position.y;
        const camZ = this.camera.position.z;
        
        // CRITICAL V8 FIX: allTrees occasionally tracks raw instanced {} metadata objects. 
        // DO NOT add dynamic properties to them or V8 drops into slow "dictionary mode".
        // Filter strictly for living THREE.Object3D instances (Bushes and standalone props).
        const physicalTrees = [];
        for (let i = 0; i < this.treeMeshes.length; i++) {
            const t = this.treeMeshes[i];
            if (t.isMesh || t.isGroup || t.isObject3D) {
                // Manually create a bounding sphere using the object's position to avoid .geometry undefined errors on Groups
                if (!this._dummySphere) this._dummySphere = new THREE.Sphere(new THREE.Vector3(), 8.0); // 8 unit radius covers most trees
                this._dummySphere.center.copy(t.position);

                // Determine visibility in frustum
                let inView = this._fpvFrustum.intersectsSphere(this._dummySphere);
                if (!inView) {
                    for (let j = 0; j < activePipCameras.length; j++) {
                        if (this._pipFrustums[j].intersectsSphere(this._dummySphere)) {
                            inView = true;
                            break;
                        }
                    }
                }
                t.userData.inView = inView;
                
                const dx = t.position.x - camX;
                const dy = t.position.y - camY;
                const dz = t.position.z - camZ;
                t.userData.distSq = (dx * dx) + (dy * dy) + (dz * dz);
                physicalTrees.push(t);
            }
        }
        
        // Sort the isolated structural trees by localized distance
        physicalTrees.sort((a, b) => a.userData.distSq - b.userData.distSq);
        
        // Show nearest N bushes/trees that are ACTUALLY IN VIEW
        let visibleCount = 0;
        for(let i = 0; i < physicalTrees.length; i++) {
            const t = physicalTrees[i];
            if (t.userData.inView && visibleCount < this.maxVisibleTrees) {
                t.visible = true;
                visibleCount++;
            } else {
                t.visible = false;
            }
        }
        
        // --- CULL NPCs & WILDLIFE ---
        if (!this._npcDummySphere) this._npcDummySphere = new THREE.Sphere(new THREE.Vector3(), 5.0);

        const cullObject = (mesh, distSq) => {
            if (!mesh || !mesh.position) return;
            this._npcDummySphere.center.copy(mesh.position);
            
            let inView = this._fpvFrustum.intersectsSphere(this._npcDummySphere);
            if (!inView) {
                for (let j = 0; j < activePipCameras.length; j++) {
                    if (this._pipFrustums[j].intersectsSphere(this._npcDummySphere)) {
                        inView = true;
                        break;
                    }
                }
            }
            // Always render if very close to prevent popping
            if (distSq < 100) inView = true;
            
            mesh.visible = inView;
            if (mesh.userData) mesh.userData.inView = inView;
        };

        // Cull isolated NPCs
        for (const npc of this.npcs) {
            if (!npc.mesh) continue;
            const dx = npc.mesh.position.x - camX;
            const dy = npc.mesh.position.y - camY;
            const dz = npc.mesh.position.z - camZ;
            const distSq = (dx * dx) + (dy * dy) + (dz * dz);
            
            if (npc.mesh.userData) npc.mesh.userData.distSq = distSq;
            cullObject(npc.mesh, distSq);
        }

        // Cull creature system models
        for (const [name, sys] of Object.entries(this.creatureSystems)) {
            const arrays = [];
            if(sys.rabbits) arrays.push(sys.rabbits);
            if(sys.deer) arrays.push(sys.deer);
            if(sys.solitaryBirds) arrays.push(sys.solitaryBirds);
            
            for (const arr of arrays) {
                if(!Array.isArray(arr)) continue;
                for (const entity of arr) {
                    const mesh = entity.mesh || entity;
                    if (!mesh || !mesh.position) continue;
                    
                    const dx = mesh.position.x - camX;
                    const dy = mesh.position.y - camY;
                    const dz = mesh.position.z - camZ;
                    const distSq = (dx * dx) + (dy * dy) + (dz * dz);
                    
                    if (mesh.userData) mesh.userData.distSq = distSq;
                    cullObject(mesh, distSq);
                }
            }
        }
    }
    
    // --- GET STATUS for HUD ---
    getStatus() {
        return {
            fps: this.smoothFPS.toFixed(0),
            quality: this.qualityNames[this.qualityLevel],
            level: this.qualityLevel,
            shadows: this.shadows,
            pip: this.pipEnabled,
            trees: this.maxVisibleTrees
        };
    }
}
// Export for classic script usage
if(typeof window !== 'undefined') {
    window.FuzzyBrain = FuzzyBrain;
}

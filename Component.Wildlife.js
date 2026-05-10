// ======================================================================
// Component.Wildlife.js — Wildlife System (Rabbits, Birds)
// ======================================================================
// This file serves as the REFERENCE TEMPLATE for all creature systems.
// To create a new creature (squirrel, deer, bear, bird):
//   1. Copy this file as Component.<Creature>System.js
//   2. Replace the OBJ model path in init()
//   3. Adjust DEFAULTS (speeds, distances, flee behavior)
//   4. Customize the state machine: pickMotherState / pickSoloState
//   5. Adjust createRabbitHole → create<Creature>Den / Nest / etc.
//   6. Register with FuzzyBrain via linkFuzzyBrain(brain)
//
// Architecture:
//   - Constructor accepts (scene, player, groundHeightFunc, vegetationData)
//   - AI runs per-creature in updateAI() with a state machine
//   - Physics runs per-creature in updatePhysics() with hop animation
//   - Holes/dens managed by updateHoles() with emerge/hide logic
//   - FuzzyBrain integration via linkFuzzyBrain() for FPS-aware throttle
// ======================================================================
// ======================================================================

window.attachDebugLabel = (mesh, name, getEntityData) => {
    // Isolated forensic tracker using floating HTML Text (no red lines)
    setTimeout(() => {
        if (!mesh.parent) return;
        
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.color = '#ffffff';
        div.style.backgroundColor = 'rgba(0,0,0,0.7)';
        div.style.padding = '8px';
        div.style.borderRadius = '6px';
        div.style.fontFamily = 'monospace';
        div.style.fontSize = '12px';
        div.style.fontWeight = 'bold';
        div.style.textShadow = '1px 1px 2px #000';
        div.style.pointerEvents = 'none';
        div.style.zIndex = '999999';
        div.style.textAlign = 'center';
        document.body.appendChild(div);

        // Pre-calculate physical size SAFELY OUTSIDE the update loop to prevent Infinite Recursion!
        const initialBox = new THREE.Box3().setFromObject(mesh);
        const baseHeight = isFinite(initialBox.max.y) ? (initialBox.max.y - initialBox.min.y) : 1.0;
        
        const updateHUD = () => {
            if (!mesh.parent) {
                if (div.parentNode) div.parentNode.removeChild(div);
                return;
            }
            
            requestAnimationFrame(updateHUD);
            
            const vector = new THREE.Vector3();
            mesh.getWorldPosition(vector);
            
            // Approximate top relative to ground
            const topY = vector.y + (baseHeight * mesh.scale.y) * 1.5;
            
            // Project 3D coordinate to 2D Screen
            const activeCamera = window.camera || (window.game && window.game.camera);
            if (activeCamera) {
                const distToCamera = activeCamera.position.distanceTo(vector);
                
                // Culling text labels that are too incredibly far (e.g., > 150m) to save DOM performance
                if (distToCamera > 150) {
                    div.style.display = 'none';
                    return;
                }
                
                const ScreenVec = new THREE.Vector3(vector.x, topY, vector.z);
                ScreenVec.project(activeCamera);
                
                const x = (ScreenVec.x * .5 + .5) * window.innerWidth;
                const y = (ScreenVec.y * -.5 + .5) * window.innerHeight;
                
                // Only show if in front of camera
                if (ScreenVec.z < 1) {
                    div.style.left = `${x}px`;
                    div.style.top = `${y}px`;
                    div.style.display = 'block';
                    div.style.transform = 'translate(-50%, -100%)'; // Center above
                    
                    const data = getEntityData ? getEntityData() : { state: 'UNKNOWN', anim: 'N/A' };
                    
                    div.innerHTML = `
                        <span style="color:#f39c12; font-size:14px;">[${name}]</span><br>
                        State: <span style="color:#2ecc71">${data.state}</span><br>
                        Anim: ${data.anim}<br>
                        Dist: ${Math.round(distToCamera)}m
                    `;
                } else {
                    div.style.display = 'none';
                }
            }
        };
        
        requestAnimationFrame(updateHUD);
        
    }, 500);
    
    console.log(`[DEBUG] Attached isolated forensic tracker to ${name}`);
};

class RabbitSystem {
    constructor(scene, player, groundHeightFunc, vegetationData = {}) {
        this.scene = scene;
        this.player = player;
        this.getHeight = groundHeightFunc;
        
        this.rabbits = [];
        this.mothers = [];
        this.treePositions = vegetationData.trees || window._treePositions || [];
        
        // Vegetation awareness
        this.bushPositions = vegetationData.bushes || [];
        this.treePositions = vegetationData.trees || [];
        this.treeTrunkRadius = 1.5;
        this.coverRadius = 6.0;
        
        // Rabbit holes
        this.holes = [];       // [{mesh, position, residents: [], safeDist: 12}]
        this.holeFleeDist = 8.0;   // Bolt to hole when player gets this close
        this.holeRadius = 0.1;     // Must get very close to disappear to let dive animation play out
        this.holeDiveStart = 1.5;  // Start dive animation within this range
        this.emergeDelay = 2.0;
        
        // Config
        this.fleeDist = 14.0;  // Start alert/freeze at this distance
        this.runSpeed = 2.5;
        this.walkSpeed = 0.5;
        this.babySpeed = 1.0;
        this.sprintSpeed = 3.5;
        
        // AI States
        this.STATES = {
            IDLE: 0,
            EATING: 1,
            WALKING: 2,
            RUNNING: 3,
            POOPING: 4,
            PEEING: 5,
            SCRATCHING: 6,
            GREETING: 7,       // Nose boop with sibling
            FOLLOWING_MOM: 8,
            SLEEPING: 9,
            RESTING: 10,       // Loaf/sprawl
            SEEKING_COVER: 11,

            FLEEING_TO_HOLE: 13,
            HIDDEN: 14,
            SNUGGLING: 15,
            EMERGING: 15,
            SPOOKED: 16,
            ALERT: 17,
            NOSE_TWITCH: 18,   // Rapid tiny head bob
            GROOMING: 19,      // Face wash or ear scratch
            STRETCHING: 20,    // Long body stretch
            FLOPPING: 21,      // Falls to side (total relaxation)
            BINKYING: 22,      // Joy jump with twist!
            CHINNING: 23,      // Scent marking territory
            PERISCOPE: 24,     // Standing tall on hind legs
            THUMPING: 25,      // Warning foot stomp
            RETURNING_TO_MOTHER: 31,
            PEEKING: 32
        };
        
        this.init();
    }
    
    init() {
        const gltfLoader = window.GLTFLoader ? new window.GLTFLoader() : new THREE.GLTFLoader();
        gltfLoader.load('Assets/rabbit.animated.glb', (gltf) => {
            const meshTemplate = gltf.scene;
            this.rabbitAnimations = gltf.animations;
            
            // Natural earth-tone palette — browns, beige, dark browns (NO red/orange)
            const colors = [
                0xc4a882, // Light sandy beige
                0xa68b6b, // Warm tan
                0x8b7355, // Medium brown
                0x6b5240, // Dark brown
                0x4a3728, // Deep chocolate
                0x9c8e7c, // Dusty gray-brown (agouti)
                0xd4c4a8, // Pale cream
                0x7a6652, // Earthy umber
            ];
            
            // Helper — find a tree position to spawn near (shade!)
            const pickNearTree = (centerX, centerZ, maxRange) => {
                const allShade = [...this.treePositions, ...this.bushPositions];
                if(allShade.length === 0) return { x: centerX, z: centerZ };
                // Find closest tree within range
                let best = allShade[0];
                let bestDist = Infinity;
                for(const t of allShade) {
                    const dx = t.x - centerX;
                    const dz = t.z - centerZ;
                    const d = dx * dx + dz * dz;
                    if(d < bestDist && d < maxRange * maxRange) {
                        bestDist = d;
                        best = t;
                    }
                }
                // Offset slightly from trunk
                const angle = Math.random() * Math.PI * 2;
                const dist = 2.0 + Math.random() * 2.0;
                return {
                    x: best.x + Math.cos(angle) * dist,
                    z: best.z + Math.sin(angle) * dist
                };
            };
            
            // 0. SINGLE UNIFIED FAMILY (Right of Tipi 1)
            const tipiX = 8;
            const tipiZ = -3;
            const tipiY = this.getHeight(tipiX, tipiZ);
            
            // Generate Home Hole
            const famHole = this.createRabbitHole(tipiX + 1, tipiZ + 1);

            const specialMomColor = 0x8B5A2B; // Dark Tan
            const specialMom = this.createRabbit(meshTemplate, 1.0, specialMomColor, 'MOTHER');
            specialMom.role = 'MOTHER';
            specialMom.mesh.position.set(tipiX, tipiY, tipiZ);
            specialMom.homeHole = famHole;
            this.mothers.push(specialMom);
            
            // Unified Flock of 12 beautiful bunnies to fill the sanctuary
            const totalBunnies = 12;
            for(let i = 0; i < totalBunnies; i++) {
                const isSpecial = (i === 2); 
                const col = colors[i % colors.length]; // Each gets a distinct earth tone
                const scale = 0.35 + Math.random() * 0.25; 
                
                const baby = this.createRabbit(meshTemplate, scale, col, 'BUNNY');
                baby.role = 'BUNNY';
                baby.mother = specialMom;
                baby.isSpecial = isSpecial;
                baby.homeHole = famHole;
                
                const angle = Math.random() * Math.PI * 2;
                const dist = 1.0 + Math.random() * 4.0; 
                const bx = tipiX + Math.sin(angle) * dist;
                const bz = tipiZ + Math.cos(angle) * dist;
                baby.mesh.position.set(bx, this.getHeight(bx, bz), bz);
            }
        });
    }
    
    createRabbit(meshTemplate, scale, color, name) {
        let mesh = meshTemplate;
        if (window.SkeletonUtils) {
            mesh = window.SkeletonUtils.clone(meshTemplate);
        } else {
            mesh = meshTemplate.clone();
        }
        
        mesh.traverse(c => {
            if (c.isMesh && c.material) {
                c.material = c.material.clone();
                c.material.color.set(color);
                c.material.roughness = 0.9;
                c.castShadow = false; // Disabled for tiny geometry performance
                c.receiveShadow = false;
            }
        });
        
        // APPLY THE VALIDATED 1:1 SCALAR (To override the 5x reduction, restoring full Box3 baseline)
        const finalScale = scale * 0.35; // Mathematically accurate biological scaling for a forest rabbit
        mesh.scale.set(finalScale, finalScale, finalScale);
        
        this.scene.add(mesh);
        
        // Force fully synchronized geometries before reading the bounding box
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        let trueYOffset = mesh.position.y - box.min.y;
        
        // Failsafe for uninitialized GLB skeletons returning Infinity
        if (isNaN(trueYOffset) || !isFinite(trueYOffset)) {
            trueYOffset = scale * 0.6; 
        }
        
        // USER REQUEST: Rabbit models are halfway above ground. Force feet specifically down flush.
        trueYOffset = -0.1; // Physically sink into the grass
        
        mesh.parentData_trueYOffset = trueYOffset; // Store for DOM diagnostic overlay
        
        // Wrap the rabbit in a Group to fix the 90-degree sideways hopping orientation natively
        const wrapper = new THREE.Group();
        wrapper.parentData_trueYOffset = trueYOffset; // CRITICAL FIX: Transfer proxy property to wrapper to prevent NaN physics cascade crashes
        // Inner mesh rotated so its biological nose (-X/-Z) structurally points perfectly forward
        mesh.rotation.y = -Math.PI / 2; // User requested: Fix sideways jumping by forcing strict 90deg offset from X to Z
        wrapper.add(mesh);
        
        // SCENE EDITOR: Inject miniature tabletop base for Village Builder
        if (window.createEditorBase) {
            // Animals get smaller bases (radius 0.6)
            // Use a greenish-brown base for wildlife
            const editorBase = window.createEditorBase(0.6, wrapper, 0x334422);
            wrapper.add(editorBase);
        }

        this.scene.add(wrapper);
        
        console.log(`[WILDLIFE DEBUG] ${name} Spawning. Bounding Box:`, box, `Calculated yOffset: ${trueYOffset}`);
        
        const mixer = new THREE.AnimationMixer(mesh);
        if (this.rabbitAnimations && this.rabbitAnimations.length > 0) {
            // USER REQUEST: Match "represented" hops (re-enabling biological hop skeletal cycle)
            mixer.clipAction(this.rabbitAnimations[0]).play();
        }
        
        const rabbit = {
            mesh: wrapper,
            mixer: mixer,
            state: this.STATES.IDLE,
            timer: Math.random() * 5,
            target: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            role: 'RABBIT',
            baseScale: 1.0, // Wrapper natively operates at 1.0; inner mesh holds the biological scale
            mother: null,
            targetHole: null,
            // Fuzzy Logic AI Memory
            memory: { dangerSpots: [], safeSpots: [] },
            iq: 0.5 + Math.random() * 0.5,
            // Hopping animation
            hopPhase: Math.random() * Math.PI * 2,  // Random start phase
            speedMult: 0.7 + Math.random() * 0.6,   // 0.7x–1.3x speed variation
            hopHeight: scale * 0.1,                 // Hop height scales with rabbit size
            trueYOffset: trueYOffset                // Guaranteed ground contact offset
        };
        this.rabbits.push(rabbit);
        return rabbit;
    }
    
    createRabbitHole(x, z) {
        const holeGroup = new THREE.Group();
        const groundY = this.getHeight(x, z);
        
        // SLOPE ALIGNMENT — sample 4 sides to tilt circle flat on terrain
        const sd = 0.3;
        const hL = this.getHeight(x - sd, z);
        const hR = this.getHeight(x + sd, z);
        const hF = this.getHeight(x, z - sd);
        const hB = this.getHeight(x, z + sd);
        
        // Average the 5 samples (center + 4 sides) for stable placement
        // This prevents floating on hilltop peaks where center is the highest point
        const avgY = (groundY + hL + hR + hF + hB) / 5;
        holeGroup.position.set(x, avgY + 0.02, z);
        
        const tangentX = new THREE.Vector3(sd * 2, hR - hL, 0);
        const tangentZ = new THREE.Vector3(0, hB - hF, sd * 2);
        const normal = new THREE.Vector3().crossVectors(tangentX, tangentZ).normalize();
        holeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        
        // DIRT RING — earthy mound around the burrow mouth (2x smaller)
        const RING_RADIUS = 0.158;
        const ringGeo = new THREE.RingGeometry(0.098, RING_RADIUS, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x5a3a1a,  // Earth brown mound
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.52,     // 48% transparent — blends well with grass
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 1;
        holeGroup.add(ring);
        
        // HOLE DISC — dark burrow opening (2x smaller)
        const HOLE_RADIUS = 0.105;
        const discGeo = new THREE.CircleGeometry(HOLE_RADIUS, 32);
        const discMat = new THREE.MeshBasicMaterial({ 
            color: 0x0a0503,  // Near-black burrow interior
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.rotation.x = -Math.PI / 2;
        disc.renderOrder = 2;
        holeGroup.add(disc);
        
        this.scene.add(holeGroup);
        
        const hole = {
            mesh: holeGroup,
            position: new THREE.Vector3(x, groundY, z),
            residents: [],
            emergeTimer: 0,
            safeDist: 8.0,
            owner: null,
            family: []
        };
        
        this.holes.push(hole);
        return hole;
    }
    
    update(delta) {
        for(const r of this.rabbits) {
            if(r.state !== this.STATES.HIDDEN) {
                this.updateAI(r, delta);
                this.updatePhysics(r, delta);
                if (r.mixer) {
                    // Prevent "walking in place" by explicitly pausing animation when stationary!
                    // If currentSpeed > 0, resume walk animation.
                    const isMoving = (r.currentSpeed || 0) > 0.05;
                    r.mixer.timeScale = isMoving ? 1.0 : 0.0;
                    
                    // Cull animations beyond ~63 units
                    if (r.mesh.position.distanceToSquared(this.player.position) < 4000) {
                        r.mixer.update(delta);
                    }
                }
            }
        }
        // Update holes — emerge logic
        this.updateHoles(delta);
    }
    
    // =========================================================
    // FLEE HELPER — single source of truth for flee-to-hole
    // =========================================================
    fleeToHole(r) {
        // Log danger spot (Fuzzy Logic Memory)
        if (r.memory && Math.random() < r.iq) {
            r.memory.dangerSpots.push(this.player.position.clone());
            if (r.memory.dangerSpots.length > 5) r.memory.dangerSpots.shift(); // Keep recent
        }
        
        const targetHole = this.findNearestSafeHole(r.mesh.position);
        if(targetHole) {
            const playerToHoleDist = this.player.position.distanceTo(targetHole.position);
            
            // Hole blocked by player — seek cover or run
            if(playerToHoleDist < 2.5) {
                const nearShade = this.findNearestShade(r.mesh.position);
                if(nearShade) {
                    const bushToPlayer = new THREE.Vector3(
                        this.player.position.x - nearShade.x, 0,
                        this.player.position.z - nearShade.z
                    ).normalize();
                    r.target.set(
                        nearShade.x - bushToPlayer.x * 1.5 - r.mesh.position.x, 0,
                        nearShade.z - bushToPlayer.z * 1.5 - r.mesh.position.z
                    ).normalize();
                    r.state = this.STATES.SEEKING_COVER;
                    r.timer = 4.0;
                    return true;
                }
                // No cover — just run away
                r.target.subVectors(r.mesh.position, this.player.position).setY(0).normalize();
                r.state = this.STATES.RUNNING;
                r.timer = 1.5;
                return true;
            }
            
            // Hole is clear — flee to it
            r.targetHole = targetHole;
            r.target.set(
                targetHole.position.x - r.mesh.position.x, 0,
                targetHole.position.z - r.mesh.position.z
            ).normalize();
            r.state = this.STATES.FLEEING_TO_HOLE;
            r.fleeTime = 0;
            r.hasFreezed = true;
            
            // MOMMA CALLS BABIES
            if(r.role === 'MOTHER') {
                for(const baby of this.rabbits) {
                    if(baby.mother === r && baby.state !== this.STATES.HIDDEN && baby.state !== this.STATES.FLEEING_TO_HOLE) {
                        baby.targetHole = targetHole;
                        baby.target.set(
                            targetHole.position.x - baby.mesh.position.x, 0,
                            targetHole.position.z - baby.mesh.position.z
                        ).normalize();
                        baby.state = this.STATES.FLEEING_TO_HOLE;
                        baby.fleeTime = 0;
                    }
                }
            }
            return true;
        }
        
        // No hole found — run away from player
        r.target.subVectors(r.mesh.position, this.player.position).setY(0).normalize();
        r.state = this.STATES.RUNNING;
        r.timer = 1.5;
        return false;
    }
    
    // =========================================================
    // UPDATE AI — clean priority cascade
    // =========================================================
    // Priority order (highest first):
    //   1. EMERGING — never interrupt
    //   2. FLEEING_TO_HOLE — steering + dive logic
    //   3. Player proximity — flee zone then freeze zone
    //   4. ALERT timer expiry — bolt to hole
    //   5. SPOOKED — immediate flee
    //   6. Baby follow-mom (for bunnies)
    //   7. Scare cooldown wander
    //   8. SEEKING_COVER / RUNNING handlers
    //   9. Home hole leash
    //  10. Shade preference
    //  11. State timer → pickRandomState
    // =========================================================
    updateAI(r, delta) {
        // === 1. EMERGING — never interrupt ===
        if(r.state === this.STATES.EMERGING) return;
        
        // === 2. FLEEING_TO_HOLE — steering toward hole ===
        if(r.state === this.STATES.FLEEING_TO_HOLE) {
            if(r.targetHole) {
                const distToHole = r.mesh.position.distanceTo(r.targetHole.position);
                
                // Continuous steering toward hole, avoiding player
                if(distToHole > this.holeDiveStart) {
                    const toHole = new THREE.Vector3(
                        r.targetHole.position.x - r.mesh.position.x, 0,
                        r.targetHole.position.z - r.mesh.position.z
                    ).normalize();
                    
                    const toPlayer = new THREE.Vector3(
                        this.player.position.x - r.mesh.position.x, 0,
                        this.player.position.z - r.mesh.position.z
                    );
                    const playerDist = toPlayer.length();
                    toPlayer.normalize();
                    
                    const dot = toHole.dot(toPlayer);
                    const cross = Math.abs(toPlayer.x * toHole.z - toPlayer.z * toHole.x);
                    const lateralClearance = cross * playerDist;
                    
                    r.fleeTime = (r.fleeTime || 0) + delta;
                    
                    if(r.fleeTime > 5.0 || lateralClearance > 3.0) {
                        r.target.copy(toHole);
                    } else if(dot > 0.1 && playerDist < 8.0) {
                        const perpL = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x);
                        const perpR = new THREE.Vector3(toPlayer.z, 0, -toPlayer.x);
                        const perp = perpL.dot(toHole) > perpR.dot(toHole) ? perpL : perpR;
                        
                        if(playerDist < 3.0) {
                            r.target.copy(perp).lerp(toHole, 0.2).normalize();
                        } else {
                            const avoidStrength = Math.min(0.8, 3.0 / playerDist);
                            r.target.copy(toHole).lerp(perp, avoidStrength).normalize();
                        }
                    } else {
                        r.target.copy(toHole);
                    }
                }
                
                // Approaching dive
                if(distToHole < this.holeDiveStart) {
                    r.diveProgress = 1.0 - (distToHole / this.holeDiveStart);
                } else {
                    r.diveProgress = 0;
                }
                
                // Arrived at hole — hide
                if(distToHole < this.holeRadius && r.state !== this.STATES.SNUGGLING) {
                    r.state = this.STATES.SNUGGLING;
                    r.snuggleTimer = 1.0; // 1 second burrow animation
                    
                    // Momma calls babies to same hole
                    if(r.role === 'MOTHER') {
                        const momHole = r.targetHole;
                        for(const baby of this.rabbits) {
                            if(baby.mother === r && baby.state !== this.STATES.HIDDEN && baby.state !== this.STATES.FLEEING_TO_HOLE && baby.state !== this.STATES.SNUGGLING) {
                                baby.targetHole = momHole;
                                baby.target.set(
                                    momHole.position.x - baby.mesh.position.x, 0,
                                    momHole.position.z - baby.mesh.position.z
                                ).normalize();
                                baby.state = this.STATES.FLEEING_TO_HOLE;
                                baby.fleeTime = 0;
                            }
                        }
                    }
                }
            }
            return;
        }
        
        // Explicitly sync the EXACT physical AI logic name + exact mixer animation to the debug overlay HUD
        const stateStr = Object.keys(this.STATES).find(k => this.STATES[k] === r.state) || r.state;
        const animStr = r.currentAnim ? ` (${r.currentAnim})` : ' (idle)';
        r.mesh.userData.stateName = `${stateStr}${animStr}`;
        
        // === 3. PLAYER PROXIMITY — flee or freeze ===
        const distToPlayer = r.mesh.position.distanceTo(this.player.position);
        
        // SPECIAL LIGHT TAN BUNNY AI
        if (r.isSpecial && r.state !== this.STATES.HIDDEN) {
            if (r.state === this.STATES.RETURNING_TO_MOTHER) {
                const distToMom = r.mesh.position.distanceTo(r.mother.mesh.position);
                if (distToMom < 2.0) {
                    r.state = this.STATES.IDLE;
                    r.timer = 2.0; // Wait before wandering natively again
                } else {
                    r.target.subVectors(r.mother.mesh.position, r.mesh.position).setY(0).normalize();
                    r.state = this.STATES.RUNNING;
                }
                return; // Block standard flee
            }
            
            // Trigger follow if player comes near (within 15 units = ~50 feet)
            if (distToPlayer < 15.0 && r.state !== this.STATES.FOLLOWING_PLAYER) {
                r.state = this.STATES.FOLLOWING_PLAYER;
                r.followTimer = 0;
            }
            
            if (r.state === this.STATES.FOLLOWING_PLAYER) {
                r.followTimer += delta;
                
                // Always organically face the player
                r.mesh.lookAt(this.player.position.x, r.mesh.position.y, this.player.position.z);
                
                if (r.followTimer > 30.0) {
                    r.state = this.STATES.RETURNING_TO_MOTHER;
                } else if (distToPlayer > 3.0) { // 10 feet = ~3 units
                    // Walk toward player
                    r.target.subVectors(this.player.position, r.mesh.position).setY(0).normalize();
                    r.state = this.STATES.RUNNING;
                } else {
                    // Close enough, stare and twitch natively
                    r.state = this.STATES.IDLE;
                }
                return; // Block standard flee/freeze
            }
        }
        
        // Reset freeze flag when player is far
        if(distToPlayer > 20.0) r.hasFreezed = false;
        
        // 3a. SANCTUARY LOGIC — player too close, bolt to hole UNLESS player is calm!
        if(distToPlayer < this.holeFleeDist
           && r.state !== this.STATES.SEEKING_COVER
           && !(r.scareCooldown > 0 && distToPlayer > 4.0)) {
            
            const isCalm = (window.SacredState.calmTimer > 2.5);
            if (isCalm && distToPlayer > 2.5) {
                if (r.state !== this.STATES.PEEKING) {
                    r.state = this.STATES.PEEKING;
                    r.timer = 2.0 + Math.random() * 3.0;
                }
            } else {
                // If not calm, clear the peek rotation and run!
                if (r.mesh.rotation.x < 0) r.mesh.rotation.x = 0;
                if (r.mesh.rotation.z !== 0) r.mesh.rotation.z = 0;
                this.fleeToHole(r);
                return;
            }
            if (r.state !== this.STATES.PEEKING) return;
        }
        
        // 3b. FREEZE ZONE — alert, watch player
        if(distToPlayer < this.fleeDist && distToPlayer >= this.holeFleeDist
           && !r.hasFreezed && !(r.scareCooldown > 0)
           && r.state !== this.STATES.ALERT
           && r.state !== this.STATES.SEEKING_COVER && r.state !== this.STATES.HIDDEN) {
            r.state = this.STATES.ALERT;
            r.timer = 1.0 + Math.random() * 1.5;
            const toPlayer = new THREE.Vector3().subVectors(this.player.position, r.mesh.position);
            const sideAngle = Math.atan2(toPlayer.x, toPlayer.z) + (Math.random() < 0.5 ? 1.2 : -1.2);
            r.mesh.rotation.y = sideAngle;
            return;
        }
        
        // === 4. ALERT — freeze timer, then bolt ===
        if(r.state === this.STATES.ALERT) {
            // If player walks INTO the flee zone during freeze, bolt immediately!
            if(distToPlayer < this.holeFleeDist && window.SacredState.calmTimer <= 2.5) {
                r.hasFreezed = true;
                this.fleeToHole(r);
                return;
            }
            
            r.timer -= delta;
            // Smooth turn toward player
            r.mesh.lookAt(this.player.position.x, r.mesh.position.y, this.player.position.z);
            
            if(r.timer <= 0) {
                r.hasFreezed = true;
                const distNow = r.mesh.position.distanceTo(this.player.position);
                if(distNow < this.fleeDist) {
                    this.fleeToHole(r);
                } else {
                    r.state = this.STATES.IDLE;
                    r.timer = 2 + Math.random();
                }
            }
            return;
        } else if (r.state === this.STATES.PEEKING) {
            // Sanctuary AI: Mathematical Peek (tilt backwards on hind legs)
            r.mesh.rotation.x = THREE.MathUtils.lerp(r.mesh.rotation.x, -Math.PI/3, delta * 3.0);
            
            // Turn to watch the player
            const targetYaw = Math.atan2(this.player.position.x - r.mesh.position.x, this.player.position.z - r.mesh.position.z);
            let diff = targetYaw - r.mesh.rotation.y;
            while(diff < -Math.PI) diff += Math.PI*2;
            while(diff > Math.PI) diff -= Math.PI*2;
            r.mesh.rotation.y += diff * delta * 5.0;
            
            // Nose wiggle!
            r.mesh.rotation.z = Math.sin(performance.now() * 0.02) * 0.05;
            
            r.timer -= delta;
            
            if (!window.SacredState.calmTimer || window.SacredState.calmTimer <= 2.5) {
                // Player broke trust!
                r.mesh.rotation.x = 0;
                r.mesh.rotation.z = 0;
                r.state = this.STATES.ALERT;
            } else if (r.timer <= 0) {
                // Satisfied curiosity, go back to eating
                r.mesh.rotation.x = 0;
                r.mesh.rotation.z = 0;
                r.state = this.STATES.EATING;
                r.timer = 5.0;
            }
            return; // Halt base hopping logic while peeking
        }
        
        // === 5. SPOOKED — immediate flee ===
        if(r.state === this.STATES.SPOOKED) {
            r.hasFreezed = true;
            this.fleeToHole(r);
            return;
        }
        
        // === 6. BABY FOLLOW-MOM — highest non-flee priority ===
        if(r.role === 'BUNNY' && r.mother && r.state !== this.STATES.SLEEPING) {
            const distToMom = r.mesh.position.distanceTo(r.mother.mesh.position);
            if(distToMom > 4.0) {
                r.state = this.STATES.FOLLOWING_MOM;
                r.target.subVectors(r.mother.mesh.position, r.mesh.position).normalize();
                return; // Don't let shade/leash override follow-mom
            } else if(r.state === this.STATES.FOLLOWING_MOM && distToMom < 2.0) {
                r.state = this.STATES.IDLE;
                r.timer = 1.0;
            }
        }
        
        // === 7. SCARE COOLDOWN — tick down, skip advanced behavior ===
        if(r.scareCooldown > 0) {
            r.scareCooldown -= delta;
            if(r.scareCooldown <= 0) r.hasFreezed = false;
        }
        
        // === 8. SEEKING COVER — crouch when near cover ===
        if(r.state === this.STATES.SEEKING_COVER) {
            if(this.isNearCover(r.mesh.position)) {
                r.state = this.STATES.RESTING;
                r.timer = 8 + Math.random() * 5;
                return;
            }
            r.timer -= delta;
            if(r.timer <= 0) { r.state = this.STATES.IDLE; r.timer = 2.0; }
            return;
        }
        
        // === 9. RUNNING — stop after timer ===
        if(r.state === this.STATES.RUNNING) {
            r.timer -= delta;
            if(r.timer <= 0) {
                r.state = this.STATES.IDLE;
                r.timer = 2 + Math.random() * 2;
                r.hasFreezed = false;
            }
            return;
        }
        
        // === 10. HOME HOLE LEASH ===
        if(r.homeHole && r.state !== this.STATES.FOLLOWING_MOM) {
            const distToHome = r.mesh.position.distanceTo(r.homeHole.position);
            if(distToHome > 12.0) {
                r.target.set(
                    r.homeHole.position.x - r.mesh.position.x, 0,
                    r.homeHole.position.z - r.mesh.position.z
                ).normalize();
                r.state = this.STATES.WALKING;
                r.timer = 2.0;
                return;
            }
        }
        
        // === 11. SHADE PREFERENCE ===
        if((r.state === this.STATES.IDLE || r.state === this.STATES.EATING || r.state === this.STATES.RESTING)
           && !this.isNearCover(r.mesh.position) && r.timer <= 0) {
            const shade = this.findNearestShade(r.mesh.position);
            if(shade) {
                r.target.set(shade.x - r.mesh.position.x, 0, shade.z - r.mesh.position.z).normalize();
                r.state = this.STATES.WALKING;
                r.timer = 3 + Math.random() * 2;
                return;
            }
        }
        
        // === 12. STATE TIMER — tick down, pick next state ===
        r.timer -= delta;
        if(r.timer <= 0) {
            this.pickRandomState(r);
        }
    }
    
    pickRandomState(r) {
        // --- FUZZY LOGIC STRESS EVALUATOR ---
        let stress = 0;
        if (r.memory && r.memory.dangerSpots.length > 0) {
            for (const spot of r.memory.dangerSpots) {
                const dist = r.mesh.position.distanceTo(spot);
                if (dist < 30) {
                    stress += (30 - dist) / 30; // Closer = more stress
                }
            }
        }
        stress *= r.iq || 0.5; // Smarter rabbits get more stressed by memory
        
        // If highly stressed, override normal grazing routines
        if (stress > 0.8 && Math.random() < stress) {
            // Highly paranoid behavior
            if (Math.random() < 0.5 && !this.isNearCover(r.mesh.position)) {
                // Seek shade/cover because we are scared
                const shade = this.findNearestShade(r.mesh.position);
                if(shade) {
                    r.target.set(shade.x - r.mesh.position.x, 0, shade.z - r.mesh.position.z).normalize();
                    r.state = this.STATES.WALKING; // Move to cover
                    r.timer = 2.0;
                    return;
                }
            }
            r.state = this.STATES.PERISCOPE; // Stand up and look
            r.timer = 2.0 + Math.random();
            return;
        }

        // MOTHER — always heads to shade (nearest bush) to eat
        if(r.role === 'MOTHER') {
            this.pickMotherState(r);
            return;
        }
        // BUNNY — simple baby tasks, follow mom is priority
        if(r.role === 'BUNNY') {
            this.pickBunnyState(r);
            return;
        }
        // SOLO RABBIT — default behavior
        this.pickSoloState(r);
    }
    
    pickMotherState(r) {
        const rand = Math.random();
        
        // Shade-seeking matriarch — prefers to stay near trees
        if(rand < 0.22) {
            // Herding — circle around babies
            r.state = this.STATES.WALKING;
            r.timer = 1.0 + Math.random() * 0.5; // High Frequency
            const babies = this.rabbits.filter(b => b.mother === r);
            if(babies.length > 0) {
                const cx = babies.reduce((s, b) => s + b.mesh.position.x, 0) / babies.length;
                const cz = babies.reduce((s, b) => s + b.mesh.position.z, 0) / babies.length;
                const toCenter = new THREE.Vector3(cx - r.mesh.position.x, 0, cz - r.mesh.position.z);
                r.target.set(-toCenter.z, 0, toCenter.x).normalize();
            } else {
                const angle = Math.random() * Math.PI * 2;
                r.target.set(Math.sin(angle), 0, Math.cos(angle));
            }
        } else if(rand < 0.38) {
            // Forage toward shade (tree)
            r.state = this.STATES.WALKING;
            r.timer = 1.0 + Math.random() * 0.5;
            const shade = this.findNearestShade(r.mesh.position);
            if(shade) {
                r.target.set(shade.x - r.mesh.position.x, 0, shade.z - r.mesh.position.z).normalize();
            } else {
                const angle = Math.random() * Math.PI * 2;
                r.target.set(Math.sin(angle), 0, Math.cos(angle));
            }
        } else if(rand < 0.52) {
            r.state = this.STATES.EATING;
            r.timer = 1.0 + Math.random(); // High Frequency
        } else if(rand < 0.64) {
            r.state = this.STATES.RESTING;
            r.timer = 1.0 + Math.random();
        } else if(rand < 0.74) {
            r.state = this.STATES.GROOMING;
            r.timer = 0.5 + Math.random();
        } else if(rand < 0.82) {
            // Periscope — stand tall, scan for danger
            r.state = this.STATES.PERISCOPE;
            r.timer = 1.0 + Math.random();
        } else if(rand < 0.88) {
            // Warning thump — freezes all babies nearby
            r.state = this.STATES.THUMPING;
            r.timer = 0.5;
            for(const baby of this.rabbits) {
                if(baby.mother === r && baby.state !== this.STATES.HIDDEN && baby.state !== this.STATES.FLEEING_TO_HOLE) {
                    baby.state = this.STATES.IDLE; // Freeze in place, don't trigger flee
                    baby.timer = 1.5;
                }
            }
        } else if(rand < 0.94) {
            r.state = this.STATES.IDLE;
            r.timer = 1.0 + Math.random() * 0.5;
        } else {
            r.state = this.STATES.NOSE_TWITCH;
            r.timer = 0.5 + Math.random() * 0.5;
        }
    }
    
    pickBunnyState(r) {
        // High frequency hopping
        const rand = Math.random();
        
        if(rand < 0.20) {
            // Nibble grass near mom
            r.state = this.STATES.EATING;
            r.timer = 1.0 + Math.random(); 
        } else if(rand < 0.75) {
            // Tiny playful hop around (Hopping increased vastly)
            r.state = this.STATES.WALKING;
            r.timer = 0.8 + Math.random() * 0.5;
            const angle = Math.random() * Math.PI * 2;
            r.target.set(Math.sin(angle), 0, Math.cos(angle));
        } else if(rand < 0.82) {
            // Nap in a pile near mom
            r.state = this.STATES.SLEEPING;
            r.timer = 1.5 + Math.random() * 1.5;
        } else if(rand < 0.86) {
            r.state = this.STATES.IDLE;
            r.timer = 1.0 + Math.random();
        } else if(rand < 0.90) {
            // Nose boop with sibling!
            r.state = this.STATES.GREETING;
            r.timer = 1.0;
        } else if(rand < 0.86) {
            // Binky! Joy jump — bunnies do this more often
            r.state = this.STATES.BINKYING;
            r.timer = 0.6 + Math.random() * 0.4;
        } else if(rand < 0.92) {
            r.state = this.STATES.NOSE_TWITCH;
            r.timer = 0.5 + Math.random() * 0.5;
        } else {
            // Flopping — baby flops over in total relaxation
            r.state = this.STATES.FLOPPING;
            r.timer = 1.5 + Math.random() * 1.5;
        }
    }
    
    pickSoloState(r) {
        const rand = Math.random();
        
        if(rand < 0.70) {
            // HOP FORWARD then graze — vastly increased probability
            if (window._pondCenter && Math.random() < 0.25) {
                // Hop towards the water source (25% chance of hydration instinct)
                const dir = new THREE.Vector3().subVectors(window._pondCenter, r.mesh.position);
                r.target.set(dir.x, 0, dir.z).normalize();
            } else {
                // Pick a gentle direction (slightly random from current facing)
                const currentAngle = r.mesh.rotation.y + (Math.random() - 0.5) * 0.8;
                r.target.set(Math.sin(currentAngle), 0, Math.cos(currentAngle));
            }
            r.state = this.STATES.WALKING;
            r.timer = 0.3 + Math.random() * 0.4; // 1-2 short hops worth of movement (walk only a little)
            // After walking timer expires, pickRandomState will fire again
            // and likely land on EATING (grazing)
        } else if(rand < 0.85) {
            // Grazing / Eating — head down, nibbling
            r.state = this.STATES.EATING;
            r.timer = 1.0 + Math.random() * 0.5; // High Frequency Switching
        } else if(rand < 0.85) {
            // Idle sit — just resting, looking around
            r.state = this.STATES.IDLE;
            r.timer = 1.0 + Math.random();
        } else if(rand < 0.93) {
            // Periscope — stand tall, ears up, look around
            r.state = this.STATES.PERISCOPE;
            r.timer = 1.5 + Math.random() * 1.5;
        } else {
            // Nose twitch
            r.state = this.STATES.NOSE_TWITCH;
            r.timer = 0.5 + Math.random() * 0.5;
        }
    }

    
    updatePhysics(r, delta) {
        const pos = r.mesh.position;
        let speed = 0;
        
        // Behavior — apply per-rabbit speed variation
        if(r.state === this.STATES.WALKING) speed = 0.8 * r.speedMult;
        if(r.state === this.STATES.RUNNING) speed = 2.5 * r.speedMult;
        if(r.state === this.STATES.FOLLOWING_MOM) speed = 1.0 * r.speedMult;
        if(r.state === this.STATES.SEEKING_COVER) speed = 2.5 * r.speedMult;
        if(r.state === this.STATES.FLEEING_TO_HOLE) speed = 4.0 * r.speedMult;
        if(r.state === this.STATES.SPOOKED) speed = 2.0 * r.speedMult;
        if(r.state === this.STATES.CHINNING) speed = 0.4 * r.speedMult;
        if(r.state === this.STATES.BINKYING) speed = 1.5 * r.speedMult;
        // ALERT state: speed = 0 (frozen, looking at player)
        
        r.currentSpeed = speed; // Expose to the update() loop to pause AnimationMixer
        
        // Movement
        if(speed > 0) {
            const nextX = pos.x + r.target.x * speed * delta;
            const nextZ = pos.z + r.target.z * speed * delta;
            
            // Tree trunk collision check — tangent plane sliding
            let blocked = false;
            for(const tree of this.treePositions) {
                const dx = pos.x - tree.x;
                const dz = pos.z - tree.z;
                const distToCenter = Math.sqrt(dx * dx + dz * dz);
                
                // If the next step would put us inside the trunk
                const nextDx = nextX - tree.x;
                const nextDz = nextZ - tree.z;
                const nextDist = Math.sqrt(nextDx * nextDx + nextDz * nextDz);

                if(nextDist < this.treeTrunkRadius) {
                    blocked = true;
                    // Calculate tangent plane to the trunk circle
                    const normal = new THREE.Vector3(dx, 0, dz).normalize();
                    const moveVec = r.target.clone();
                    
                    // Dot product of movement onto normal
                    const dot = moveVec.dot(normal);
                    
                    // Slide along the tangent by subtracting the inward component
                    if (dot < 0) {
                        moveVec.sub(normal.multiplyScalar(dot));
                        if(moveVec.lengthSq() > 0.01) {
                            r.target.copy(moveVec.normalize());
                        } else {
                            // Hit dead on — pick a random tangent side
                            r.target.set(-normal.z, 0, normal.x).normalize();
                            if (Math.random() < 0.5) r.target.negate();
                        }
                    }
                    break; // Only slide against one tree per frame
                }
            }
            
            // =============================================
            // REALISTIC PHYSICAL HOPPING
            // =============================================
            
            if (r.hopCycle === undefined) {
                r.hopCycle = 0;
            }
            
            let hopY = 0;
            let currentSpeed = 0;
            
            if (speed > 0) {
                if (speed <= this.walkSpeed * 1.5) {
                    // USER REQUEST: incorporate a little walking for slow speed movements (less than run threshold)
                    currentSpeed = speed;
                    hopY = 0;
                    r.hopCycle = 0; // Maintain cycle reset
                    
                    // Smooth rotation toward target, compensating for +Z rabbit face orientation
                    const dummy = new THREE.Object3D();
                    dummy.position.copy(pos);
                    dummy.lookAt(pos.x - r.target.x, pos.y, pos.z - r.target.z);
                    let diff = dummy.rotation.y - r.mesh.rotation.y;
                    while(diff < -Math.PI) diff += Math.PI * 2;
                    while(diff > Math.PI) diff -= Math.PI * 2;
                    r.mesh.rotation.y += diff * 6.0 * delta;
                    
                    pos.x += Math.sin(r.mesh.rotation.y) * currentSpeed * delta;
                    pos.z += Math.cos(r.mesh.rotation.y) * currentSpeed * delta;
                } else {
                    // USER REQUEST: Use advanced physics jumps for adults, and realistic tiny hops for bunnies.
                    const isAdult = r.role === 'MOTHER';
                    const jumpScalar = isAdult ? 4.5 : 1.2; // Adults leap huge bounds, babies do tiny hops
                    const maxHopDist = Math.max(0.5, r.baseScale * jumpScalar) * 0.4;
                    
                    let totalCycle = maxHopDist / speed; 
                    totalCycle = Math.min(0.8, Math.max(0.18, totalCycle)); // STRICT clamps to prevent micro-speed infinity jump physics
                    
                    const ratioAir = Math.min(0.7, 0.4 + (speed / 10)); 
                    const hDuration = totalCycle * ratioAir;
                    
                    r.hopCycle += delta;
                    if (r.hopCycle > totalCycle) r.hopCycle -= totalCycle;
                    
                    if (r.hopCycle < hDuration) {
                        // Airborne Phase (True Physics Gravity Arc)
                        const t = r.hopCycle;
                        const g = 9.8 * 2.0; // Simulated gravitational mass specifically tailored for wildlife
                        const v0 = (g * hDuration) / 2.0; // V0 mapped to mathematically land cleanly at duration
                        
                        // Parabolic arc tracking real falling bounds
                        hopY = ((v0 * t) - (0.5 * g * t * t));
                        if(hopY < 0) hopY = 0;
                        
                        currentSpeed = speed * (totalCycle / hDuration);
                        
                        // AIRBORNE: Let the skeletal jumping animation play naturally
                        if (r.mixer) r.mixer.timeScale = 1.0;
                    } else {
                        // Resting Phase (Gather Phase)
                        hopY = 0;
                        currentSpeed = 0;
                        
                        // GROUNDED: Freeze skeletal animation at Anticipation frame explicitly
                        if (r.mixer) {
                            r.mixer.timeScale = 0.0;
                            // Optionally force to frame 0 but pausing usually holds perfectly for hopping
                        }
                    }
                    
                    // Turn to face target ONLY while planted on the ground, NEVER while airborne
                    const isGrounded = (r.hopCycle >= hDuration || r.hopCycle < delta * 1.5);
                    if (isGrounded) {
                        const dummy = new THREE.Object3D();
                        dummy.position.copy(pos);
                        dummy.lookAt(pos.x - r.target.x, pos.y, pos.z - r.target.z);
                        let diff = dummy.rotation.y - r.mesh.rotation.y;
                        while(diff < -Math.PI) diff += Math.PI * 2;
                        while(diff > Math.PI) diff -= Math.PI * 2;
                        // Fast realignment while planted
                        r.mesh.rotation.y += diff * 15.0 * delta;
                    }
                    
                    // Displace directly forward along facing angle
                    pos.x += Math.sin(r.mesh.rotation.y) * currentSpeed * delta;
                    pos.z += Math.cos(r.mesh.rotation.y) * currentSpeed * delta;
                }
            } else {
                r.hopCycle = 0; // Reset smoothly
                hopY = 0;
                currentSpeed = 0;
                // Idle or alert: restore skeletal breathing/idle
                if (r.mixer) r.mixer.timeScale = 0.8;
            }
            
            // Sync current speed for the mixer logic
            r.currentSpeed = currentSpeed;
            
            const groundY = this.getHeight(pos.x, pos.z);
            pos.y = groundY + hopY + r.trueYOffset;
            if (r.debugLine) r.debugLine.position.set(pos.x, 0, pos.z); // Update infinite visual line
            
            // Basic reset on physics rotation; Native skeletal animations dictate precise organic squash/stretch.
            // USER REQUEST: removed morphing and upside-down physics. The model now translates perfectly flat.
            r.mesh.rotation.x = 0;
            r.mesh.rotation.z = 0;
            const bs = r.baseScale || 0.05;
            r.mesh.scale.set(bs, bs, bs);

            if (r.diveProgress > 0 && r.state === this.STATES.FLEEING_TO_HOLE) {
                // Let the entire model cleanly translate into the hole with no rotations/shrinkage
                pos.y -= r.diveProgress * Math.max(1.5, bs * 2.0); // Physically drop the mesh down into the terrain gap
            }
            
        } else if (r.state !== this.STATES.SNUGGLING) {
            // STATIONARY (Skip if snuggling into burrow since that handles its own transforms)
            const bs = r.baseScale || 0.05;
            const groundY = this.getHeight(pos.x, pos.z);
            pos.y = groundY + r.trueYOffset; 
            if (r.debugLine) r.debugLine.position.set(pos.x, 0, pos.z); // Tracker constantly pins to X/Z
            
            r.mesh.scale.set(bs, bs, bs);
            r.mesh.rotation.x = 0;
            
            // ALERT pose — stand tall, ears up, tense
            if(r.state === this.STATES.ALERT) {
                r.mesh.rotation.x = -0.05;
            }
            
            // IDLE Organic Twitches (5-degree random rotations)
            if (r.state === this.STATES.IDLE || r.state === this.STATES.RESTING) {
                r.idleTwitchTimer = (r.idleTwitchTimer || 0) - delta;
                if (r.idleTwitchTimer <= 0) {
                    r.idleTwitchTarget = (Math.random() - 0.5) * 0.174; // ~10 degrees total arc (+- 5 deg)
                    r.idleTwitchTimer = 1.0 + Math.random() * 3.0; // Twitch every 1-4 seconds
                }
                if (r.idleTwitchTarget) {
                    // Smoothly interpolate the yaw toward the small twitch angle over time
                    r.mesh.rotation.y += r.idleTwitchTarget * delta * 2.0;
                    // Decay the target so it stops moving
                    r.idleTwitchTarget -= r.idleTwitchTarget * delta * 2.0;
                }
            }
        }
        
        if(speed === 0 && r.state !== this.STATES.SNUGGLING) r.mesh.rotation.z = 0;
        
        // TERRAIN CLAMP — never let rabbits float above ground
        const clampY = this.getHeight(pos.x, pos.z);
        if(pos.y < clampY && r.state !== this.STATES.SNUGGLING && r.state !== this.STATES.EMERGING) pos.y = clampY;
        
        // Animations (Procedural) — for non-movement states
        const time = Date.now() * 0.001;
        const bs = r.baseScale || 0.5;
        
        // USER REQUEST: Stop all procedural animations of rabbits.
        if (r.state === this.STATES.EMERGING) {
            const progress = 1.0 - (r.timer / 1.0);
            const amt = Math.min(Math.max(progress, 0), 1.0);
            r.mesh.scale.set(bs, bs, bs);
            r.mesh.position.y = this.getHeight(r.mesh.position.x, r.mesh.position.z) - (1.0 - amt) * Math.max(1.5, bs * 2.0);
        } else if(r.state === this.STATES.SNUGGLING) {
            r.snuggleTimer -= delta;
            
            const p = Math.max(0, r.snuggleTimer); // 1.0 down to 0.0
            
            r.mesh.scale.set(bs, bs, bs);
            
            // USER REQUEST: True Animated Hole Dive!
            // Plunge head-first downward progressively into the tunnel
            r.mesh.rotation.x = -Math.PI * 0.4 * (1.0 - p); // Rotate nose downward ~70 degrees
            r.mesh.rotation.z = 0;
            
            // Actively suck toward the geometric center of the hole during dive
            if (r.homeHole) {
                const tx = r.homeHole.mesh.position.x;
                const tz = r.homeHole.mesh.position.z;
                r.mesh.position.x += (tx - r.mesh.position.x) * delta * 3.0;
                r.mesh.position.z += (tz - r.mesh.position.z) * delta * 3.0;
            }
            
            // Sink vertically into the ground matching the angled dive body length
            r.mesh.position.y = this.getHeight(r.mesh.position.x, r.mesh.position.z) - ((1.0 - p) * Math.max(1.8, bs * 2.5));
            
            if(r.snuggleTimer <= 0) {
                r.state = this.STATES.HIDDEN;
                r.mesh.visible = false;
                r.mesh.rotation.set(0, r.baseAnimRotationY || 0, 0);
                r.mesh.scale.set(r.baseScale, r.baseScale, r.baseScale);
                r.hideTimer = 3.0 + Math.random() * 3.0; // Stay hidden
                if (r.targetHole) {
                    r.targetHole.residents.push(r);
                    r.targetHole = null;
                }
            }
        }
    }
    
    // --- VEGETATION AWARENESS HELPERS ---
    
    // Search ALL shade sources (trees + bushes) for nearest cover
    findNearestShade(position) {
        let nearest = null;
        let minDist = Infinity;
        // Check bushes first
        for(const bush of this.bushPositions) {
            const dx = position.x - bush.x;
            const dz = position.z - bush.z;
            const dist = dx * dx + dz * dz;
            if(dist < minDist) {
                minDist = dist;
                nearest = bush;
            }
        }
        // Also check trees — they provide shade!
        for(const tree of this.treePositions) {
            const dx = position.x - tree.x;
            const dz = position.z - tree.z;
            const dist = dx * dx + dz * dz;
            if(dist < minDist) {
                minDist = dist;
                nearest = tree;
            }
        }
        return nearest;
    }
    
    isNearCover(position) {
        const r2 = this.coverRadius * this.coverRadius;
        // Check bushes
        for(const bush of this.bushPositions) {
            const dx = position.x - bush.x;
            const dz = position.z - bush.z;
            if(dx * dx + dz * dz < r2) return true;
        }
        // Also check trees — trees provide shade cover!
        for(const tree of this.treePositions) {
            const dx = position.x - tree.x;
            const dz = position.z - tree.z;
            if(dx * dx + dz * dz < r2) return true;
        }
        return false;
    }
    
    findNearestHole(position) {
        let nearest = null;
        let minDist = Infinity;
        for(const hole of this.holes) {
            const dx = position.x - hole.position.x;
            const dz = position.z - hole.position.z;
            const dist = dx * dx + dz * dz;
            if(dist < minDist) {
                minDist = dist;
                nearest = hole;
            }
        }
        return nearest;
    }
    
    // COMMUNITY HOLES — find nearest hole that ISN'T near the player
    findNearestSafeHole(rabbitPos) {
        const playerPos = this.player.position;
        const safeRadius = 6.0; // Hole must be ≥6 units from player
        
        let nearest = null;
        let minDist = Infinity;
        
        for(const hole of this.holes) {
            // Check if hole is safe (far from player)
            const dpx = playerPos.x - hole.position.x;
            const dpz = playerPos.z - hole.position.z;
            const distToPlayer = dpx * dpx + dpz * dpz;
            
            if(distToPlayer < safeRadius * safeRadius) continue; // Too close to player, skip
            
            // Distance from rabbit to this hole
            const drx = rabbitPos.x - hole.position.x;
            const drz = rabbitPos.z - hole.position.z;
            const distToRabbit = drx * drx + drz * drz;
            
            if(distToRabbit < minDist) {
                minDist = distToRabbit;
                nearest = hole;
            }
        }
        
        // Fallback: if ALL holes are near player, use any nearest
        return nearest || this.findNearestHole(rabbitPos);
    }
    
    // --- HOLE EMERGE LOGIC ---
    // Momma first (biggest), head-peek only, face player, then pop out
    
    updateHoles(delta) {
        for(const hole of this.holes) {
            if(hole.residents.length === 0) continue;
            
            // Count down hide timers for all residents
            for(const res of hole.residents) {
                if(res.hideTimer !== undefined) res.hideTimer -= delta;
            }
            
            // Sort residents: biggest first (momma emerges first)
            hole.residents.sort((a, b) => b.baseScale - a.baseScale);
            
            // Check if any rabbit has hit their hide time limit
            const forcedEmerge = hole.residents.some(r => r.hideTimer !== undefined && r.hideTimer <= 0);
            
            // Check if player is far enough away
            const distToPlayer = hole.position.distanceTo(this.player.position);
            if(distToPlayer < hole.safeDist && !forcedEmerge) {
                hole.emergeTimer = this.emergeDelay;
                continue;
            }
            
            
            // Reset scared counts when player is far away (rabbits calm down)
            if(distToPlayer > 20.0) {
                for(const res of hole.residents) {
                    res.hasFreezed = false;
                }
            }
            
            // Check if momma is currently mid-emerge — hold bunnies
            if(hole.mommaEmerging) continue;
            
            // Coast is clear! Count down to emerge one rabbit
            hole.emergeTimer -= delta;
            
            if(hole.emergeTimer <= 0) {
                const rabbit = hole.residents.shift();
                if(rabbit) {
                    rabbit.mesh.visible = true;
                    rabbit.mesh.position.copy(hole.position);
                    rabbit.state = this.STATES.EMERGING;
                    rabbit.timer = 2.5 + Math.random() * 1.5;
                    rabbit.emergePhase = 0;
                    rabbit.emergeProgress = 0;
                    rabbit.emergeHole = hole;
                    rabbit.scareCooldown = 2.0 + Math.random() * 1.0; // 2-3s immunity after emerging
                    
                    // Start sunk entirely into hole (no morphing)
                    const bs = rabbit.baseScale;
                    rabbit.mesh.scale.set(bs, bs, bs);
                    rabbit.mesh.position.y = hole.position.y - Math.max(1.5, bs * 2.0);
                    
                    // Face AWAY from player (toward safety, not staring at danger)
                    const awayFromPlayer = new THREE.Vector3().subVectors(
                        rabbit.mesh.position, this.player.position
                    );
                    // Add randomness to direction (±45 degrees)
                    const randomAngle = (Math.random() - 0.5) * Math.PI * 0.5;
                    rabbit.mesh.rotation.y = Math.atan2(awayFromPlayer.x, awayFromPlayer.z) + randomAngle;
                    
                    // If momma, block bunnies until she finishes
                    if(rabbit.role === 'MOTHER') {
                        hole.mommaEmerging = true;
                    }
                }
                hole.emergeTimer = 0.5 + Math.random() * 1.5; // Random stagger
            }
        }
        
        // Handle emerging rabbits — 3-phase animation
        for(const r of this.rabbits) {
            if(r.state !== this.STATES.EMERGING) continue;
            
            r.timer -= delta;
            r.emergeProgress = (r.emergeProgress || 0) + delta;
            const bs = r.baseScale;
            
            // Keep facing player the whole time
            const toPlayer = new THREE.Vector3().subVectors(
                this.player.position, r.mesh.position
            );
            r.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
            
            if(r.emergeProgress < 0.6) {
                // PHASE 1: Rise up slowly — head peeking out
                const t = r.emergeProgress / 0.6;
                const holeY = this.getHeight(r.mesh.position.x, r.mesh.position.z);
                r.mesh.position.y = holeY - 0.2 + t * 0.2;
                r.mesh.scale.set(bs * 0.4, bs * (0.4 + t * 0.1), bs * 0.4);
                
                // Check if player got close during peek — duck back in!
                const peekDist = r.mesh.position.distanceTo(this.player.position);
                if(peekDist < 10.0) {
                    // Bolt out and run away entirely instead of ducking back in over and over!
                    r.state = this.STATES.SEEKING_COVER; // Transition to running state
                    r.mesh.position.y = holeY;           // Pop up to ground level instantly
                    r.mesh.scale.set(bs, bs, bs);
                    r.fleeTime = 0;
                    
                    // Run out in the opposite direction from where the player is standing
                    const awayForce = new THREE.Vector3().subVectors(r.mesh.position, this.player.position).normalize();
                    r.target.copy(awayForce);
                    
                    if(r.emergeHole) {
                        r.targetHole = this.findNearestSafeHole(r.mesh.position);
                        r.emergeHole = null;
                        if(r.targetHole) r.state = this.STATES.FLEEING_TO_HOLE;
                    }
                    if(r.role === 'MOTHER' && r.homeHole) r.homeHole.mommaEmerging = false;
                    continue;
                }
                
            } else if(r.emergeProgress < 1.8) {
                // PHASE 2: Peek — cautious, sniffing, nose twitching
                const peekTime = r.emergeProgress - 0.6;
                const bob = Math.sin(peekTime * 4) * 0.02;
                const holeY = this.getHeight(r.mesh.position.x, r.mesh.position.z);
                r.mesh.position.y = holeY + bob;
                r.mesh.scale.set(bs * 0.4, bs * 0.5, bs * 0.4);
                // Nose twitch — tiny head rotation
                r.mesh.rotation.z = Math.sin(peekTime * 8) * 0.03;
                
            } else {
                // PHASE 3: Pop fully out
                const t = Math.min(1.0, (r.emergeProgress - 1.8) / 0.5);
                const scaleUp = 0.5 + t * 0.5;
                r.mesh.scale.set(bs * scaleUp, bs * scaleUp, bs * scaleUp);
                const holeY = this.getHeight(r.mesh.position.x, r.mesh.position.z);
                r.mesh.position.y = holeY;
            }
            
            // Done emerging — walk away from hole before settling
            if(r.timer <= 0) {
                // Walk away from hole in the direction rabbit is facing
                r.state = this.STATES.WALKING;
                r.timer = 2.0 + Math.random() * 3;
                const walkAngle = r.mesh.rotation.y + (Math.random() - 0.5) * 0.5;
                r.target.set(Math.sin(walkAngle), 0, Math.cos(walkAngle));
                r.mesh.scale.set(bs, bs, bs);
                r.mesh.position.y = this.getHeight(r.mesh.position.x, r.mesh.position.z);
                r.emergePhase = 0;
                r.emergeProgress = 0;
                r.emergeHole = null;
                // If momma just finished, unblock bunnies
                if(r.role === 'MOTHER' && r.homeHole) {
                    r.homeHole.mommaEmerging = false;
                }
            }
        }
    }
    
    // =============================================
    // MASTER AI INTEGRATION (FuzzyBrain)
    // =============================================
    
    /**
     * Link to the master FuzzyBrain AI controller.
     * Enables FPS-aware population throttling.
     */
    linkFuzzyBrain(brain) {
        this.fuzzyBrain = brain;
    }
    
    /**
     * Set max visible creatures. FuzzyBrain calls this
     * when FPS drops to reduce rendering load.
     * Hides the most distant creatures from the player.
     */
    setPopulationCap(maxVisible) {
        // AI Throttling Disabled for Story Consistency.
        // The user explicitly requested fixed population counts (10-15 solos, 2 families), 
        // so we must not allow FuzzyBrain to stealth-hide them on low-end hardware.
        this.populationCap = maxVisible;
        
        // Unhide everything that was previously throttled to restore normalcy
        for(let r of this.rabbits) {
            if(r._throttleHidden) {
                r._throttleHidden = false;
                if(r.state !== this.STATES.HIDDEN) r.mesh.visible = true;
            }
        }
    }
    
    /**
     * Returns current status for debug HUD and FuzzyBrain.
     */
    getStatus() {
        let visible = 0, hidden = 0, fleeing = 0, idle = 0;
        for(const r of this.rabbits) {
            if(r.state === this.STATES.HIDDEN) hidden++;
            else if(r.mesh.visible) {
                visible++;
                if(r.state === this.STATES.FLEEING_TO_HOLE || r.state === this.STATES.RUNNING) fleeing++;
                if(r.state === this.STATES.IDLE || r.state === this.STATES.EATING || r.state === this.STATES.RESTING) idle++;
            }
        }
        return {
            total: this.rabbits.length,
            visible,
            hidden,
            fleeing,
            idle,
            holes: this.holes.length
        };
    }
}

// ======================================================================
// BirdSystem — Flying birds (solitary low-flyers + distant flocks)
// ======================================================================

class BirdSystem {
    constructor(scene, player, groundHeightFunc, treePositions = []) {
        this.scene = scene;
        this.player = player;
        this.getHeight = groundHeightFunc;
        this.treePositions = treePositions.length > 0 ? treePositions : (window._treePositions || []);
        
        this.solitaryBirds = [];
        this.flocks = [];
        this.mixers = []; // AnimationMixers for GLB birds
        this.worldRadius = 250;
        this.glbLoaded = false;
        
        this.init();
    }
    
    init() {
        // Load Bird.glb for solitary birds (close-up, animated)
        const loader = window.GLTFLoader ? new window.GLTFLoader() : new THREE.GLTFLoader();
        const baseHref = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        loader.load(`${baseHref}/Assets/Bird.glb`, (gltf) => {
            const template = gltf.scene;
            const animations = gltf.animations;
            
            // Normalize model size
            const box = new THREE.Box3().setFromObject(template);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const targetSize = 1.5; // Bird wingspan ~1.5 units
            const scaleFactor = targetSize / maxDim;
            template.scale.multiplyScalar(scaleFactor);
            
            // Center the model
            box.setFromObject(template);
            const center = box.getCenter(new THREE.Vector3());
            template.position.sub(center);
            template.rotation.y = Math.PI / 2; // FIX: Corrected Math.PI / 2 to face flight vector 
            
            // Create solitary birds from GLB clones
            const numSolitary = 4;
            for(let i = 0; i < numSolitary; i++) {
                const birdModel = template.clone();
                birdModel.traverse(c => {
                    if (c.isMesh) c.frustumCulled = false;
                });
                const birdGroup = new THREE.Group();
                birdGroup.add(birdModel);
                
                // Altitude and Forced Perspective Scaling
                const baseAlt = 20 + Math.random() * 40; // 20 to 60 units high
                
                // High altitude birds need to appear significantly smaller to fake depth
                // Alt 20 -> Scale 1.2
                // Alt 60 -> Scale 0.4
                const altRatio = (baseAlt - 20) / 40; 
                const s = 1.2 - (altRatio * 0.8);
                birdGroup.scale.set(s, s, s);
                
                const angle = Math.random() * Math.PI * 2;
                const radius = 15 + Math.random() * 40;
                birdGroup.position.set(
                    Math.cos(angle) * radius,
                    baseAlt,
                    Math.sin(angle) * radius
                );
                
                // Setup animation mixer
                let mixer = null;
                if(animations && animations.length > 0) {
                    mixer = new THREE.AnimationMixer(birdModel);
                    const clip = animations[0];
                    const action = mixer.clipAction(clip);
                    action.play();
                    // Hawks soar slowly! Reduce aggressive flapping to a gentle glide beat
                    action.timeScale = 0.15 + Math.random() * 0.25;
                    this.mixers.push(mixer);
                }
                
                const bird = {
                    mesh: birdGroup,
                    mixer,
                    dirAngle: Math.random() * Math.PI * 2,
                    speed: 7 + Math.random() * 3, // Hawks fly fast and straight
                    flapPhase: Math.random() * Math.PI * 2,
                    weaveFreq: 0.05 + Math.random() * 0.05, // Very slow weave
                    weaveAmp: 0.1 + Math.random() * 0.2, // Fix "sliding sideways" (drastic reduction)
                    baseAlt: baseAlt,
                    altOscFreq: 0.08 + Math.random() * 0.1, // Gentle thermal soaring
                    altOscAmp: 3 + Math.random() * 3,
                    turnTimer: 5 + Math.random() * 5,
                    type: 'solitary'
                };
                
                this.solitaryBirds.push(bird);
                // Add visual debug laser
                window.attachDebugLabel(birdGroup, 'Hawk');
                
                this.scene.add(birdGroup);
                console.log(`[WILDLIFE DEBUG] Hawk spawn Y: ${birdGroup.position.y}`);
            }
            
            this.glbLoaded = true;
            console.log('[Wildlife] Bird.glb loaded — ' + numSolitary + ' solitary birds spawned');
        }, undefined, (err) => {
            console.warn('[Wildlife] Bird.glb failed to load, using procedural birds:', err);
            this.initProceduralSolitary();
        });
        
        // (Procedural flocks removed — only scenic geese remain)
        
        // --- SCENIC GOOSE FLOCK (high altitude, visible on load) ---
        this.initScenicGeese();
    }
    
    initScenicGeese() {
        const geese = new THREE.Group();
        const gooseCount = 12;
        const mat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide });
        
        const flock = {
            group: geese,
            birds: [],
            dirAngle: -0.4, // Heading roughly left-to-right across player's view
            speed: 1.2, // Faster, higher altitude 
            altitude: 45, // High up to clear entirely over the forest and fog
            formation: 'V',
            driftFreq: 0.03,
            driftAmp: 0.15,
            isGeese: true
        };
        
        for(let i = 0; i < gooseCount; i++) {
            // Tiny V-formation geese — minimal geometry (3 triangles)
            const g = new THREE.Group();
            
            // Body — small sliver (distant)
            const bodyGeo = new THREE.ConeGeometry(0.04, 0.25, 3);
            bodyGeo.rotateX(Math.PI / 2);
            const body = new THREE.Mesh(bodyGeo, mat);
            g.add(body);
            
            // Left wing — single small triangle
            const wingGeo = new THREE.BufferGeometry();
            const verts = new Float32Array([
                0, 0, 0,
                -0.23, 0.03, -0.05,
                0, 0, -0.07
            ]);
            wingGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
            wingGeo.computeVertexNormals();
            const leftWing = new THREE.Mesh(wingGeo, mat);
            leftWing.rotation.set(0, 0, 0); // BUGFIX: Initialize rotation so update() doesn't crash
            g.add(leftWing);
            
            // Right wing — mirrored
            const rWingGeo = new THREE.BufferGeometry();
            const rVerts = new Float32Array([
                0, 0, 0,
                0.23, 0.03, -0.05,
                0, 0, -0.07
            ]);
            rWingGeo.setAttribute('position', new THREE.BufferAttribute(rVerts, 3));
            rWingGeo.computeVertexNormals();
            const rightWing = new THREE.Mesh(rWingGeo, mat);
            rightWing.rotation.set(0, 0, 0); // BUGFIX
            g.add(rightWing);
            
            // Bypass culling due to extreme distance
            body.frustumCulled = false;
            leftWing.frustumCulled = false;
            rightWing.frustumCulled = false;
            
            // V-formation positioning
            const side = i % 2 === 0 ? 1 : -1;
            const rank = Math.ceil(i / 2);
            if(i === 0) {
                g.position.set(0, 0, 0); // Lead goose
            } else {
                g.position.set(side * rank * 1.2, Math.random() * 0.3, -rank * 1.8);
            }
            
            const phase = Math.random() * Math.PI * 2;
            const freq = 2.5 + Math.random() * 1.0; // 2.5-3.5 Hz — natural goose flap
            
            flock.birds.push({
                mesh: g,
                leftWing,
                rightWing,
                flapPhase: phase,
                flapFreq: freq
            });
            geese.add(g);
        }
        
        // Position: above and in front of player start (camera at 0, 1.7, 5)
        // Place slightly right and ahead so player looks up and sees them crossing
        geese.position.set(15, flock.altitude, -8); // Close and low for visibility
        
        this.flocks.push(flock);
        this.scene.add(geese);
        console.log('[Wildlife] Scenic goose flock: ' + gooseCount + ' geese at altitude ' + flock.altitude);
    }
    
    initProceduralSolitary() {
        // Fallback if Bird.glb fails to load
        const numSolitary = 4;
        for(let i = 0; i < numSolitary; i++) {
            const bird = this.createBird(0.4 + Math.random() * 0.15, 0x1a1a1a);
            const angle = Math.random() * Math.PI * 2;
            const radius = 15 + Math.random() * 40;
            bird.mesh.position.set(
                Math.cos(angle) * radius,
                20 + Math.random() * 15,
                Math.sin(angle) * radius
            );
            bird.dirAngle = Math.random() * Math.PI * 2;
            bird.speed = 4 + Math.random() * 2;
            bird.flapPhase = Math.random() * Math.PI * 2;
            bird.flapFreq = 0.3 + Math.random() * 0.2;
            bird.weaveFreq = 0.15 + Math.random() * 0.15;
            bird.weaveAmp = 1 + Math.random() * 1.5;
            bird.baseAlt = 20 + Math.random() * 20;
            bird.altOscFreq = 0.2 + Math.random() * 0.3;
            bird.altOscAmp = 2 + Math.random() * 3;
            bird.turnTimer = 3 + Math.random() * 5;
            bird.type = 'solitary';
            bird.procedural = true;
            this.solitaryBirds.push(bird);
            // Add visual debug laser
            window.attachDebugLabel(bird.mesh, 'SmallBird');
            this.scene.add(bird.mesh);
            console.log(`[WILDLIFE DEBUG] SmallBird spawn Y: ${bird.mesh.position.y}`);
        }
    }
    
    createBird(scale, color) {
        const group = new THREE.Group();
        
        // Body — elongated ellipsoid
        const bodyGeo = new THREE.SphereGeometry(1, 6, 4);
        bodyGeo.scale(0.3, 0.25, 1.0);
        const mat = new THREE.MeshLambertMaterial({ 
            color, 
            side: THREE.DoubleSide 
        });
        const body = new THREE.Mesh(bodyGeo, mat);
        group.add(body);
        
        // Wings — flat planes that rotate for flapping
        const wingGeo = new THREE.PlaneGeometry(1.8, 0.5);
        wingGeo.translate(0.9, 0, 0); // Pivot at edge
        
        const leftWing = new THREE.Mesh(wingGeo, mat);
        leftWing.position.set(0, 0.05, 0);
        leftWing.rotation.y = Math.PI / 2;
        group.add(leftWing);
        
        const rightWing = new THREE.Mesh(wingGeo.clone(), mat);
        rightWing.position.set(0, 0.05, 0);
        rightWing.rotation.y = -Math.PI / 2;
        rightWing.scale.x = -1; // Mirror
        group.add(rightWing);
        
        // Tail — small triangle
        const tailGeo = new THREE.PlaneGeometry(0.4, 0.3);
        const tail = new THREE.Mesh(tailGeo, mat);
        tail.position.set(0, 0, -0.8);
        tail.rotation.x = -0.3;
        group.add(tail);
        
        group.scale.set(scale, scale, scale);
        
        return {
            mesh: group,
            body,
            leftWing,
            rightWing,
            flapPhase: 0,
            flapFreq: 5,
            speed: 5,
            dirAngle: 0,
            procedural: true
        };
    }
    
    update(delta) {
        const time = performance.now() * 0.001;
        
        // Update animation mixers (GLB bird animations)
        for(const mixer of this.mixers) {
            mixer.update(delta);
        }
        
        // --- UPDATE SOLITARY BIRDS ---
        for(const bird of this.solitaryBirds) {
            // Initialize smooth angle if needed
            if(bird.currentAngle === undefined) bird.currentAngle = bird.dirAngle;
            
            // === SANCTUARY AI SWOOP LOGIC ===
            if (!bird.state) bird.state = 0; // 0 = FLYING, 1 = SWOOPING, 2 = LANDED
            
            const isCalm = (window.SacredState.calmTimer > 5.0);
            const distToPlayer = bird.mesh.position.distanceTo(this.player.position);
            
            // 1. Chance to land if player is extremely calm and bird is flying
            if (bird.state === 0 && isCalm && distToPlayer < 40 && Math.random() < 0.005) {
                bird.state = 1; // Begin Swoop
                bird.landTarget = new THREE.Vector3(
                    this.player.position.x + (Math.random() - 0.5) * 8, // Target safe ground near player
                    0, 
                    this.player.position.z + (Math.random() - 0.5) * 8
                );
                // Dynamically fetch accurate ground height for target
                bird.landTarget.y = this.getHeight ? this.getHeight(bird.landTarget.x, bird.landTarget.z) : 0;
            }
            
            // 2. Weaving flight path — gently adjust target direction
            bird.turnTimer -= delta;
            
            if (bird.state === 1) { // SWOOPING
                const dx = bird.landTarget.x - bird.mesh.position.x;
                const dz = bird.landTarget.z - bird.mesh.position.z;
                const distToLand = Math.sqrt(dx*dx + dz*dz);
                
                bird.dirAngle = Math.atan2(dx, dz); // Steer directly at landing spot
                
                // Dive altitude calculation — smooth linear descent
                if (distToLand < 2.0 || bird.mesh.position.y <= bird.landTarget.y + 0.1) {
                    bird.state = 2; // LANDED
                    bird.turnTimer = 4.0 + Math.random() * 4.0;
                    bird.mesh.position.y = bird.landTarget.y;
                } else {
                    // Dive slope
                    bird.mesh.position.y -= Math.max(0.5, bird.mesh.position.y - bird.landTarget.y) * delta * 1.5;
                }
            } else if (bird.state === 2) { // LANDED
                // Foraging behavior
                if (!isCalm || distToPlayer < 2.5 || bird.turnTimer <= 0) {
                    // Spooked or bored -> Fly away!
                    bird.state = 0;
                    bird.baseAlt = 20 + Math.random() * 10;
                    bird.turnTimer = 0; // Force immediate path recalculation
                }
            } else if(bird.turnTimer <= 0) {
                // NORMAL FLYING: Wrap around world — gently steer toward center ONLY during new turn calculations
                const distFromCenter = Math.sqrt(
                    bird.mesh.position.x * bird.mesh.position.x + 
                    bird.mesh.position.z * bird.mesh.position.z
                );
                
                if(distFromCenter > this.worldRadius * 0.85) {
                    bird.dirAngle = Math.atan2(-bird.mesh.position.x, -bird.mesh.position.z);
                    bird.dirAngle += (Math.random() - 0.5) * 0.3;
                    bird.turnTimer = 4 + Math.random() * 2; // Prevent aggressive jitter
                } else {
                    bird.dirAngle += (Math.random() - 0.5) * 0.8; // Gentler turns
                    bird.turnTimer = 3 + Math.random() * 5;
                }
            }
            
            // Avoid trees — gently push target direction away (fast reaction)
            // (Only avoid if flying low to ground; high soaring hawks ignore the dense canopy safely)
            if(bird.mesh.position.y < 12) {
                for(const tree of this.treePositions) {
                    const dx = bird.mesh.position.x - tree.x;
                    const dz = bird.mesh.position.z - tree.z;
                    const dist = Math.sqrt(dx * dx + dz * dz);
                    if(dist < 7) {
                        const awayAngle = Math.atan2(dx, dz);
                        bird.dirAngle = awayAngle; // Steer away
                        break;
                    }
                }
            }
            
            // SMOOTH ROTATION — bird turns gradually, never snaps/flips
            let angleDiff = bird.dirAngle - bird.currentAngle;
            // Normalize to [-PI, PI] for shortest path
            while(angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while(angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            const turnRate = 2.0; // radians per second (realistic bird turn)
            const maxTurn = turnRate * delta;
            
            if(Math.abs(angleDiff) > maxTurn) {
                bird.currentAngle += Math.sign(angleDiff) * maxTurn;
            } else {
                bird.currentAngle += angleDiff * delta * 3;
            }
            
            // Move in the direction bird is ACTUALLY facing (not target)
            if (bird.state !== 2) { // Only move when NOT landed
                const moveX = Math.sin(bird.currentAngle) * bird.speed * delta;
                const moveZ = Math.cos(bird.currentAngle) * bird.speed * delta;
                
                // Gentle sine drift perpendicular to flight
                const weave = Math.sin(time * bird.weaveFreq + bird.flapPhase) * bird.weaveAmp;
                const perX = Math.cos(bird.currentAngle) * weave * delta;
                const perZ = -Math.sin(bird.currentAngle) * weave * delta;
                
                bird.mesh.position.x += moveX + perX;
                bird.mesh.position.z += moveZ + perZ;
                
                // Restore regular flying altitude if not swooping
                if (bird.state === 0) {
                    const targetY = bird.baseAlt + Math.sin(time * bird.altOscFreq) * bird.altOscAmp;
                    bird.mesh.position.y += (targetY - bird.mesh.position.y) * delta * 0.5;
                }
                
                // Mesh visual banking (Hawks natively fly backward, flip string match)
                bird.mesh.rotation.y = bird.currentAngle + Math.PI;
                // Bank wings into the turn (based on how far they have left to rotate)
                let bankRot = angleDiff * 3.0; 
                bird.mesh.rotation.z = -bankRot;
                bird.mesh.rotation.x = -0.1; // slight aerodynamic pitch
            } else {
                // Foraging Ground Animation
                bird.mesh.rotation.z = 0;
                bird.mesh.rotation.y = bird.currentAngle;
                bird.mesh.rotation.x = Math.sin(time * 8.0) * 0.2 + 0.1; // Wiggle down to peck
            }

            // Procedural wing flapping for fallback birds (GLB birds use AnimationMixer)
            if(bird.procedural && bird.leftWing && bird.rightWing) {
                const flapCycle = (time * bird.flapFreq + bird.flapPhase) % (Math.PI * 2);
                let wingAngle;
                if(flapCycle < 1.5) {
                    wingAngle = Math.sin(flapCycle * 3) * 0.35;
                } else {
                    wingAngle = 0.15;
                }
                bird.leftWing.rotation.x = wingAngle;
                bird.rightWing.rotation.x = -wingAngle;
            }
        }
        
            // --- UPDATE FLOCKS ---
        for(const flock of this.flocks) {
            // Move flock as unit
            const drift = Math.sin(time * flock.driftFreq) * flock.driftAmp;
            flock.group.position.x += Math.sin(flock.dirAngle + drift) * flock.speed * delta;
            flock.group.position.z += Math.cos(flock.dirAngle + drift) * flock.speed * delta;
            
            // Seamless map wrap-around: Teleport geese back to the opposite edge if they fly away
            const pdx = flock.group.position.x - this.player.position.x;
            const pdz = flock.group.position.z - this.player.position.z;
            const pDistSq = (pdx * pdx) + (pdz * pdz);
            if (pDistSq > 62500) { // Approx 250m away
                const spawnAngle = Math.random() * Math.PI * 2;
                flock.group.position.set(
                    this.player.position.x + Math.sin(spawnAngle) * 200,
                    flock.altitude,
                    this.player.position.z + Math.cos(spawnAngle) * 200
                );
                // Turn them around to passively cross over the player again
                flock.dirAngle = Math.atan2(-Math.sin(spawnAngle), -Math.cos(spawnAngle)) + (Math.random() - 0.5) * 0.5;
            }

            // Gentle altitude bobbing (geese: subtler)
            const bobAmp = flock.isGeese ? 1.0 : 3.0;
            flock.group.position.y = flock.altitude + Math.sin(time * 0.15 + flock.dirAngle) * bobAmp;
            
            // Wrap around — teleport to opposite side
            const distFromCenter = Math.sqrt(
                flock.group.position.x * flock.group.position.x + 
                flock.group.position.z * flock.group.position.z
            );
            if(distFromCenter > this.worldRadius * 1.5) {
                flock.group.position.x = -flock.group.position.x * 0.8;
                flock.group.position.z = -flock.group.position.z * 0.8;
                flock.dirAngle = Math.atan2(-flock.group.position.x, -flock.group.position.z);
                flock.dirAngle += (Math.random() - 0.5) * 0.6;
            }
            
            // Rotate group to face direction
            flock.group.rotation.y = flock.dirAngle;
            
            // Animate individual birds in flock
            for(const bird of flock.birds) {
                if(flock.isGeese) {
                    // GEESE — fluid continuous flapping (never stop)
                    const wingAngle = Math.sin(time * bird.flapFreq + bird.flapPhase) * 0.4;
                    bird.leftWing.rotation.x = wingAngle;
                    bird.rightWing.rotation.x = -wingAngle;
                } else {
                    // Other flocks — glide with occasional flaps
                    const flapCycle = (time * bird.flapFreq + bird.flapPhase) % (Math.PI * 2);
                    let wingAngle;
                    if(flapCycle < 1.0) {
                        wingAngle = Math.sin(flapCycle * 3) * 0.35;
                    } else {
                        wingAngle = 0.1; // Glide position
                    }
                    bird.leftWing.rotation.x = wingAngle;
                    bird.rightWing.rotation.x = -wingAngle;
                }
            }
        }
    }
}

// ======================================================================
// DeerSystem — Simple deer AI (2-3 deer wandering near trees)
// ======================================================================
class DeerSystem {
    constructor(scene, player, groundHeightFunc, vegetationData = {}) {
        this.scene = scene;
        this.player = player;
        this.getHeight = groundHeightFunc;
        this.treePositions = vegetationData.trees || window._treePositions || [];
        
        this.deer = [];
        
        // AI Config
        this.STATES = { IDLE: 0, GRAZING: 1, WALKING: 2, FLEEING: 3, ALERT: 4 };
        this.fleeDist = 20.0;    // Increased flee distance to match pattern guidelines
        this.alertDist = 50.0;   // The Vigilant Grazer distance
        this.walkSpeed = 0.6; // Reduced to perfectly match normal skeletal walk stride
        this.fleeSpeed = 4.0;
        this.deerCount = 12; // Fixed exact population of 5 deer
        
        // Natural deer colors
        this.colors = [
            0x8B6914, // Golden brown
            0x6B4423, // Dark brown
            0x9C7A3C, // Tawny
            0xA0845C, // Light brown
        ];
        
        this.init();
    }
    
    init() {
        const gltfLoader = window.GLTFLoader ? new window.GLTFLoader() : new THREE.GLTFLoader();
        // Load the explicit animated glTF to enable AI animation hooks
        gltfLoader.load('Assets/animated.stag.glb', (gltf) => {
            const meshTemplate = gltf.scene;
            this.deerAnimations = gltf.animations;
            
            // Physical scaling calibrated: Native model is ~4.3 units. 0.35 maps it to ~1.5 world units
            const scaleFactor = 0.35; // A biological adult deer size

            
            for(let i = 0; i < this.deerCount; i++) {
                let deerMesh = meshTemplate;
                if (window.SkeletonUtils) {
                    deerMesh = window.SkeletonUtils.clone(meshTemplate);
                } else {
                    deerMesh = meshTemplate.clone();
                }
                
                // deerMesh retains the `template`'s Box3 auto-normalized scale (e.g. 2.5 meters targetSize).
                const scaleVariance = 0.8 + Math.random() * 0.4; // +/- 20% size variation for fawns/bucks
                const finalScale = scaleFactor * scaleVariance * 2.0; // Doubled scale as requested!
                deerMesh.scale.set(finalScale, finalScale, finalScale);
                
                // Procedural Golden-Brown Fur Material (Fixes the missing texture issue on raw GLTFs)
                const furMaterial = new THREE.MeshStandardMaterial({
                    color: 0x8b5a2b,    // Deep golden brown
                    roughness: 0.9,     // Highly diffuse fur
                    metalness: 0.0,
                    side: THREE.FrontSide
                });
                
                deerMesh.traverse(c => {
                    if(c.isMesh) {
                        // Only override material if it's not pre-mapped, or force it if it's the generic untextured stag
                        c.material = furMaterial; 
                        c.castShadow = true;
                        c.receiveShadow = true;
                        c.frustumCulled = false; // Prevent invisible skinned meshes
                    }
                });
                
                const mixer = new THREE.AnimationMixer(deerMesh);
                let idleAction = null;
                let walkAction = null;
                let finalActions = null;
                
                if (this.deerAnimations && this.deerAnimations.length > 0) {
                    const idleClip = this.deerAnimations.find(a => a.name === 'Idle' || a.name === 'AnimalArmature|Idle') || this.deerAnimations[12] || this.deerAnimations[0];
                    const walkClip = this.deerAnimations.find(a => a.name === 'Walk' || a.name === 'AnimalArmature|Walk') || this.deerAnimations[9] || this.deerAnimations[1] || idleClip;
                    const gallopClip = this.deerAnimations.find(a => a.name === 'Gallop' || a.name === 'AnimalArmature|Gallop') || this.deerAnimations[5] || walkClip;
                    const eatClip = this.deerAnimations.find(a => a.name === 'Eating' || a.name === 'AnimalArmature|Eating') || this.deerAnimations[3] || idleClip;
                    const alertClip = this.deerAnimations.find(a => a.name === 'Idle_2' || a.name === 'AnimalArmature|Idle_2') || this.deerAnimations[11] || idleClip;
                    
                    idleAction = mixer.clipAction(idleClip); // Idle
                    walkAction = mixer.clipAction(walkClip); // Walk
                    const gallopAction = mixer.clipAction(gallopClip); // Gallop
                    const eatAction = mixer.clipAction(eatClip); // Eating (Grazing)
                    const alertAction = mixer.clipAction(alertClip); // Alert (Staring)
                    
                    eatAction.play(); // Start grazing immediately
                    
                    if (idleAction && walkAction && gallopAction && eatAction && alertAction) {
                        finalActions = { idle: idleAction, walk: walkAction, gallop: gallopAction, eat: eatAction, alert: alertAction };
                    }
                }
                
                // Place near trees at medium distance from player
                const angle = (i / this.deerCount) * Math.PI * 2 + Math.random() * 0.5;
                const dist = 20 + Math.random() * 20;
                // All deer spawn further into the dense forest, away from the Tipi
                let dx, dz;
                if(this.treePositions && this.treePositions.length > 0) {
                    const farTrees = this.treePositions.filter(t => Math.abs(t.x) > 15 || Math.abs(t.z) > 15);
                    const treeList = farTrees.length > 0 ? farTrees : this.treePositions;
                    const nearTree = treeList[Math.floor(Math.random() * treeList.length)];
                    const treeAngle = Math.random() * Math.PI * 2;
                    dx = nearTree.x + Math.cos(treeAngle) * (3 + Math.random() * 8);
                    dz = nearTree.z + Math.sin(treeAngle) * (3 + Math.random() * 8);
                } else {
                    // Safe fallback if trees aren't loaded yet
                    dx = -20 - Math.random() * 40;
                    dz = -20 - Math.random() * 40;
                }
                
                const dy = this.getHeight(dx, dz);
                
                // A dynamic animated model typically has origin perfectly at its feet, so use exactly 0 height offset
                let trueYOffset = 0.0; 
                
                deerMesh.position.set(dx, dy + trueYOffset, dz);
                deerMesh.rotation.y = Math.random() * Math.PI * 2;
                
                // Add visual debug laser
                window.attachDebugLabel(deerMesh, `Deer_${i}`, () => {
                    const stateStr = Object.keys(this.STATES).find(k => this.STATES[k] === this.deer[i]?.state) || 'UNKNOWN';
                    return {
                        state: stateStr,
                        anim: this.deer[i]?.currentAnim || 'N/A'
                    };
                });
                
                this.scene.add(deerMesh);
                console.log(`[WILDLIFE DEBUG] Deer spawn Y: ${deerMesh.position.y}`);
                
                this.deer.push({
                    mesh: deerMesh,
                    mixer: mixer,
                    state: this.STATES.GRAZING,
                    timer: 5 + Math.random() * 10, // Graze for long periods
                    target: new THREE.Vector3(dx, 0, dz),
                    baseY: trueYOffset, // Exact Y offset for physics loop projection
                    headBob: Math.random() * Math.PI * 2,
                    currentAnim: 'eat',
                    isAlpha: (i === 0), // Herd alpha logic
                    iq: 0.5 + Math.random() * 0.5,
                });
                
                // Mount animations payload onto object using the local actions variable we just populated
                if (finalActions) {
                    this.deer[this.deer.length - 1].actions = finalActions;
                }
            }
            
            // === NATURE SPIRIT — giant ethereal deer ===
            let spiritMesh = meshTemplate;
            if (window.SkeletonUtils) {
                spiritMesh = window.SkeletonUtils.clone(meshTemplate);
            } else {
                spiritMesh = meshTemplate.clone();
            }
            const spiritScale = 5.0; // 20 feet tall (Majestic scale)
            spiritMesh.scale.set(spiritScale, spiritScale, spiritScale);
            
            // Ethereal glowing material — highly visible emissive glow
            const spiritMaterial = new THREE.MeshStandardMaterial({
                color: 0xc8e8ff,          // Pale ice-blue
                emissive: 0x4488cc,        // Soft blue glow
                emissiveIntensity: 0.8,
                transparent: true,
                opacity: 0.35,             // More visible! 10% was too ethereal
                side: THREE.DoubleSide,
                roughness: 0.3,
                metalness: 0.1,
                depthWrite: false,         // Prevent z-fighting with terrain
            });
            spiritMesh.traverse(c => {
                if(c.isMesh) {
                    c.material = spiritMaterial;
                    c.castShadow = false; // Spirits don't cast shadows
                    c.receiveShadow = false;
                    c.renderOrder = 999;  // Render last for correct transparency
                    c.frustumCulled = false; // Prevent invisible skinned meshes
                }
            });
            
            const spiritMixer = new THREE.AnimationMixer(spiritMesh);
            
            // Removed root-removal code for the Nature Spirit since STAG.glb tracks organic locomotion safely.
            // Using a raw AnimationMixer clip.
            
            if (this.deerAnimations && this.deerAnimations.length > 0) {
                const walkClip = this.deerAnimations.find(a => a.name === 'Walk' || a.name === 'AnimalArmature|Walk') || this.deerAnimations[9] || this.deerAnimations[1] || this.deerAnimations[0];
                const action = spiritMixer.clipAction(walkClip);
                // "Walk gracefully and slowly off the screen" 
                action.timeScale = 0.25; 
                action.play();
            }
            
            // Spawn directly behind Tipi 1, heading across the screen
            const TIPI_X = 0;  // Tipi 1 center
            const TIPI_Z = 0;
            const sx = TIPI_X;
            const sz = TIPI_Z - 6.0; // Behind the tipi
            const sy = this.getHeight(sx, sz);
            
            spiritMesh.updateMatrixWorld(true);
            const sBox = new THREE.Box3().setFromObject(spiritMesh);
            let sTrueY = spiritMesh.position.y - sBox.min.y;
            if(isNaN(sTrueY) || !isFinite(sTrueY) || Math.abs(sTrueY) < 0.2) sTrueY = spiritScale * 0.6;
            
            spiritMesh.position.set(sx, sy + sTrueY, sz);
            spiritMesh.rotation.y = Math.PI * 0.5; // Face right — heading across screen
            
            // Ethereal aura light — soft glow around the spirit
            const auraLight = new THREE.PointLight(0x88ccff, 2.0, 15);
            auraLight.position.set(0, 1.5, 0); // Centered on body
            spiritMesh.add(auraLight);
            
            // Debug label removed for clean visuals
            this.scene.add(spiritMesh);
            console.log(`[WILDLIFE DEBUG] SpiritDeer spawn Y: ${spiritMesh.position.y}`);
            
            this.spirit = {
                mesh: spiritMesh,
                mixer: spiritMixer,
                auraLight,
                state: this.STATES.WALKING,
                timer: 8 + Math.random() * 10,
                target: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
                baseY: sTrueY,
                headBob: 0,
                isSpirit: true,
                // Lifecycle — visible exactly 60s, comes back every 6 minutes
                visibleTime: 60.0,     // 1 minute before fade
                fadeTime: 5.0,         
                cooldown: 0,           
                cooldownDuration: 360, // 6 minutes 
                phase: 'visible',      // 'visible' | 'fading' | 'hidden' | 'appearing'
                phaseTimer: 60.0,
                baseOpacity: 0.35,
                // Click glow
                glowTimer: 0,
                glowActive: false,
            };
            this.deer.push(this.spirit);
            
            console.log(`[Wildlife] Spawned ${this.deerCount} deer + 1 Nature Spirit`);
        });
    }
    
    update(delta) {
        const playerPos = this.player.position;
        
        for(const d of this.deer) {
            const stateStr = Object.keys(this.STATES).find(k => this.STATES[k] === d.state) || d.state;
            const animStr = d.currentAnim ? ` (${d.currentAnim})` : '';
            d.mesh.userData.stateName = d.isSpirit ? `SPIRIT_WANDERING${animStr}` : `${stateStr}${animStr}`;

            const distToPlayer = d.mesh.position.distanceTo(playerPos);
            
            if (d.mixer && distToPlayer < 120) {
                d.mixer.update(delta); // Let action.timeScale govern speed natively
            }
            
            // SPIRIT — never flees, drifts ethereally
            if(d.isSpirit) {
                // === LIFECYCLE PHASE MANAGEMENT ===
                d.phaseTimer -= delta;
                
                if(d.phase === 'visible') {
                    d.mesh.visible = true;
                    if(d.phaseTimer <= 0) {
                        d.phase = 'fading';
                        d.phaseTimer = d.fadeTime;
                    }
                } else if(d.phase === 'fading') {
                    // Fade out over fadeTime seconds
                    const fadeProgress = Math.max(0, d.phaseTimer / d.fadeTime);
                    d.baseOpacity = 0.10 * fadeProgress;
                    if(d.auraLight) d.auraLight.intensity = 2.0 * fadeProgress;
                    if(d.phaseTimer <= 0) {
                        d.phase = 'hidden';
                        d.phaseTimer = d.cooldownDuration;
                        d.mesh.visible = false;
                        if(d.auraLight) d.auraLight.intensity = 0;
                    }
                } else if(d.phase === 'hidden') {
                    d.mesh.visible = false;
                    if(d.phaseTimer <= 0) {
                        // Reappear at new random position
                        const newAngle = Math.random() * Math.PI * 2;
                        const newDist = 25 + Math.random() * 20;
                        const nx = Math.cos(newAngle) * newDist;
                        const nz = Math.sin(newAngle) * newDist;
                        d.mesh.position.set(nx, this.getHeight(nx, nz) + d.baseY, nz);
                        d.mesh.rotation.y = Math.random() * Math.PI * 2;
                        d.phase = 'appearing';
                        d.phaseTimer = d.fadeTime;
                        d.mesh.visible = true;
                    }
                } else if(d.phase === 'appearing') {
                    // Fade in over fadeTime seconds
                    const appearProgress = 1.0 - Math.max(0, d.phaseTimer / d.fadeTime);
                    d.baseOpacity = 0.10 * appearProgress;
                    if(d.auraLight) d.auraLight.intensity = 2.0 * appearProgress;
                    if(d.phaseTimer <= 0) {
                        d.phase = 'visible';
                        d.phaseTimer = d.visibleTime;
                        d.baseOpacity = 0.10;
                    }
                }
                
                // === CLICK GLOW ===
                if(d.glowActive) {
                    d.glowTimer -= delta;
                    const glowFade = Math.max(0, d.glowTimer / 3.0);
                    d.mesh.traverse(c => {
                        if (c.isMesh && c.material) {
                            c.material.emissive.setHex(0xffd700); // Golden glow
                            c.material.emissiveIntensity = 2.0 * glowFade;
                        }
                    });
                    d.baseOpacity = Math.min(0.35, 0.10 + 0.25 * glowFade); // Brighter when glowing
                    if(d.auraLight) {
                        d.auraLight.color.setHex(0xffd700);
                        d.auraLight.intensity = 5.0 * glowFade;
                    }
                    if(d.glowTimer <= 0) {
                        d.glowActive = false;
                        d.mesh.traverse(c => {
                            if (c.isMesh && c.material) {
                                c.material.emissive.setHex(0x4488cc); // Back to blue
                                c.material.emissiveIntensity = 0.6;
                            }
                        });
                        d.baseOpacity = 0.10;
                        if(d.auraLight) d.auraLight.color.setHex(0x88ccff);
                    }
                }
                
                // Only animate if visible
                if(d.mesh.visible) {
                    d.timer -= delta;
                    const t = performance.now() * 0.001;
                    
                    // Ground-lock feet — no hover/bob that would break foot contact
                    const baseGroundY = this.getHeight(d.mesh.position.x, d.mesh.position.z) + d.baseY;
                    d.mesh.position.y = baseGroundY;
                    
                    // Scripted Pathing: Create a decoupled physics heading 
                    if (d.trueHeading === undefined) d.trueHeading = Math.PI * 0.5; // Starts pointing Right (+X) across screen
                    d.trueHeading += Math.sin(t * 0.1) * delta * 0.1; // Gentle meandering curve
                    
                    // Just walk forward slowly — smooth majestic linear translation
                    const majesticSpeed = 0.15; 
                    d.mesh.position.x += Math.sin(d.trueHeading) * majesticSpeed * delta;
                    d.mesh.position.z += Math.cos(d.trueHeading) * majesticSpeed * delta;
                    
                    // Decouple geometric visual rotation because GLTF is rigidly rigged sideways (+X)
                    d.mesh.rotation.y = d.trueHeading - Math.PI / 2;
                    
                    // Breathing shimmer on top of base opacity
                    const shimmer = Math.sin(t * 0.3) * 0.03;
                    d.mesh.traverse(c => {
                        if (c.isMesh && c.material) {
                            c.material.opacity = d.baseOpacity + shimmer;
                        }
                    });
                    
                    if(!d.glowActive && d.auraLight) {
                        const breathe = 0.5 + Math.sin(t * 0.5) * 0.3;
                        d.auraLight.intensity = Math.min(d.auraLight.intensity, 1.5 + breathe);
                    }
                }
                
                continue; // Skip normal AI
            }
            
            // FLEE — player too close (normal deer only)
            if(distToPlayer < this.fleeDist && d.state !== this.STATES.FLEEING) {
                // Log danger spot (Fuzzy Logic Memory)
                if (d.memory && Math.random() < d.iq) {
                    d.memory.dangerSpots.push(this.player.position.clone());
                    if (d.memory.dangerSpots.length > 5) d.memory.dangerSpots.shift(); // Keep recent
                }

                this.setDeerState(d, this.STATES.FLEEING);
                d.timer = 5.0 + Math.random() * 3.0;
                
                // Alpha triggers panic in the whole herd
                if (d.isAlpha) {
                    for(const herdD of this.deer) {
                        if (!herdD.isSpirit && herdD.state !== this.STATES.FLEEING) {
                            this.setDeerState(herdD, this.STATES.FLEEING);
                            herdD.timer = 5.0 + Math.random() * 3.0;
                            const hFleeVec = new THREE.Vector3().subVectors(herdD.mesh.position, playerPos).setY(0).normalize().multiplyScalar(40);
                            herdD.target.copy(herdD.mesh.position).add(hFleeVec);
                        }
                    }
                }
                const fleeVec = new THREE.Vector3().subVectors(d.mesh.position, playerPos).setY(0).normalize().multiplyScalar(40);
                d.target.copy(d.mesh.position).add(fleeVec);
            } 
            // ALERT (Vigilant Grazer) — player in hearing range
            else if (distToPlayer < this.alertDist && distToPlayer >= this.fleeDist && d.state !== this.STATES.FLEEING && d.state !== this.STATES.ALERT) {
                this.setDeerState(d, this.STATES.ALERT);
                d.timer = 3.0 + Math.random() * 2.0; 
                // Alpha triggers alert in the herd
                if (d.isAlpha) {
                    for(const herdD of this.deer) {
                        if (!herdD.isSpirit && herdD.state !== this.STATES.FLEEING && herdD.state !== this.STATES.ALERT) {
                            this.setDeerState(herdD, this.STATES.ALERT);
                            herdD.timer = 2.0 + Math.random() * 2.0;
                        }
                    }
                }
            }
            
            // State machine execution
            switch(d.state) {
                case this.STATES.ALERT:
                    d.timer -= delta;
                    // Stare directly at player
                    const dxA = playerPos.x - d.mesh.position.x;
                    const dzA = playerPos.z - d.mesh.position.z;
                    const targetAngleA = Math.atan2(dxA, dzA);
                    this.smoothTurn(d, targetAngleA, delta * 5.0);
                    d.mesh.rotation.x = 0; // Head up proudly
                    
                    if(d.timer <= 0) {
                        // After staring, if the player hasn't moved closer, resume grazing
                        if(distToPlayer >= this.alertDist) {
                            this.setDeerState(d, this.STATES.GRAZING);
                            d.timer = 5.0 + Math.random() * 10.0;
                        } else {
                            // Slowly walk away sideways to create distance
                            this.setDeerState(d, this.STATES.WALKING);
                            d.timer = 3.0 + Math.random() * 2.0;
                            const angle = targetAngleA + (Math.PI/2) * (Math.random() > 0.5 ? 1 : -1);
                            d.target.set(d.mesh.position.x + Math.cos(angle)*15, 0, d.mesh.position.z + Math.sin(angle)*15);
                        }
                    }
                    break;

                case this.STATES.IDLE:
                    d.timer -= delta;
                    d.mesh.rotation.y += Math.sin(performance.now() * 0.0005 + d.headBob) * delta * 0.3; // Look around
                    if(d.timer <= 0) {
                        this.setDeerState(d, Math.random() > 0.4 ? this.STATES.GRAZING : this.STATES.WALKING);
                        d.timer = 5.0 + Math.random() * 5.0;
                        if (d.state === this.STATES.WALKING) this.pickHerdTarget(d);
                    }
                    break;
                    
                case this.STATES.GRAZING:
                    d.timer -= delta;
                    if(d.timer <= 0) {
                        this.setDeerState(d, Math.random() > 0.3 ? this.STATES.IDLE : this.STATES.WALKING);
                        d.timer = 3.0 + Math.random() * 5.0;
                        if (d.state === this.STATES.WALKING) this.pickHerdTarget(d);
                    }
                    break;
                    
                case this.STATES.WALKING:
                    d.timer -= delta;
                    const dxW = d.target.x - d.mesh.position.x;
                    const dzW = d.target.z - d.mesh.position.z;
                    const distW = Math.sqrt(dxW*dxW + dzW*dzW);
                    
                    if (distW > 0.5) {
                        // The physical target angle indicating where the deer should move
                        const targetAngle = Math.atan2(dxW, dzW);
                        
                        // Because the new `animated.stag.glb` is rigged facing sideways (+X instead of +Z),
                        // we must visually rotate the mesh by -90 degrees (-Math.PI/2) so its head faces the target.
                        // However, we DO NOT translate along its internal rotation.y! 
                        // We physically translate it purely along the forward target vector.
                        this.smoothTurn(d, targetAngle - Math.PI / 2, delta * 2.0);
                        
                        // Translate physically along the true vector (Standard +Z forward geometry)
                        d.mesh.position.x += Math.sin(targetAngle) * this.walkSpeed * delta;
                        d.mesh.position.z += Math.cos(targetAngle) * this.walkSpeed * delta;
                    }
                    d.mesh.position.y = this.getHeight(d.mesh.position.x, d.mesh.position.z) + d.baseY;
                    
                    if(d.timer <= 0 || distW < 1.0) {
                        this.setDeerState(d, this.STATES.GRAZING);
                        d.timer = 10.0 + Math.random() * 15.0;
                    }
                    break;
                    
                case this.STATES.FLEEING:
                    d.timer -= delta;
                    const dxF = d.target.x - d.mesh.position.x;
                    const dzF = d.target.z - d.mesh.position.z;
                    const distF = Math.sqrt(dxF*dxF + dzF*dzF);
                    
                    if (distF > 0.5) {
                        // Invert coordinates for negative-Z glTF rigs so they face forward
                        this.smoothTurn(d, Math.atan2(dxF, dzF) + Math.PI, delta * 5.0);
                        d.mesh.position.x -= Math.sin(d.mesh.rotation.y) * this.fleeSpeed * delta;
                        d.mesh.position.z -= Math.cos(d.mesh.rotation.y) * this.fleeSpeed * delta;
                    }
                    d.mesh.position.y = this.getHeight(d.mesh.position.x, d.mesh.position.z) + d.baseY;
                    
                    // Subtle gallop bob using math
                    d.mesh.position.y += Math.abs(Math.sin(performance.now() * 0.015)) * 0.15;
                    
                    if(d.timer <= 0 && distToPlayer > this.fleeDist * 1.5) {
                        this.setDeerState(d, this.STATES.ALERT); // Stop and look back to see if safe
                        d.timer = 3.0 + Math.random() * 2.0;
                    }
                    break;
            }
        }
    }
    
    // Click-to-glow — call from main game's click handler
    clickSpirit(raycaster, camera) {
        if(!this.spirit || !this.spirit.mesh.visible) return false;
        raycaster.setFromCamera(raycaster._clickPos || new THREE.Vector2(0, 0), camera);
        const hits = raycaster.intersectObject(this.spirit.mesh, true);
        if(hits.length > 0) {
            this.spirit.glowActive = true;
            this.spirit.glowTimer = 3.0; // 3 second golden glow
            
            // Award +1 experience to the player
            if (window.SacredState) {
                window.SacredState.experience = (window.SacredState.experience || 0) + 1;
                console.log(`[Wildlife] Nature Spirit touched! +1 XP (Total: ${window.SacredState.experience})`);
            } else {
                console.log('[Wildlife] Nature Spirit touched! Golden glow activated.');
            }
            
            // Show feedback to player
            if (window.uiManager && window.uiManager.showCenterBubble) {
                window.uiManager.showCenterBubble('Spirit Blessing: +1 Experience', 2500);
            }
            return true;
        }
        return false;
    }
    
    setDeerState(d, newState) {
        if (!d || d.state === newState) return;
        d.state = newState;
        if (!d.actions) return; // Spirit has no complete actions obj yet
        
        for(let key in d.actions) {
            if (d.actions[key]) d.actions[key].stop();
        }
        
        if (newState === this.STATES.FLEEING && d.actions.gallop) d.actions.gallop.play();
        else if (newState === this.STATES.WALKING && d.actions.walk) d.actions.walk.play();
        else if (newState === this.STATES.GRAZING && d.actions.eat) d.actions.eat.play();
        else if (newState === this.STATES.ALERT && d.actions.alert) d.actions.alert.play();
        else if (d.actions.idle) d.actions.idle.play();
    }
    
    smoothTurn(d, targetYaw, amount) {
        let diff = (targetYaw - d.mesh.rotation.y) % (Math.PI * 2);
        if (diff < -Math.PI) diff += Math.PI * 2;
        if (diff > Math.PI) diff -= Math.PI * 2;
        d.mesh.rotation.y += diff * amount;
    }
    
    pickHerdTarget(d) {
        if (d.isAlpha) {
             // Herd Level Navigation: Bias toward Ecosystem Hub
             if (window._pondCenter && Math.random() < 0.35) {
                 const angle = Math.random() * Math.PI * 2;
                 const banks = window._pondExtents || 20.0;
                 const dist = banks * (0.3 + Math.random() * 0.5); // inside the defined pond extents radius
                 d.target.set(window._pondCenter.x + Math.cos(angle)*dist, 0, window._pondCenter.z + Math.sin(angle)*dist);
             } else {
                 const angle = Math.random() * Math.PI * 2;
                 const dist = 10 + Math.random() * 20;
                 d.target.set(d.mesh.position.x + Math.cos(angle)*dist, 0, d.mesh.position.z + Math.sin(angle)*dist);
             }
        } else {
             const alpha = this.deer[0];
             const angle = Math.random() * Math.PI * 2;
             const flexDist = 3 + Math.random() * 6; // Stay close
             if (alpha && !alpha.isSpirit) {
                 d.target.set(alpha.mesh.position.x + Math.cos(angle)*flexDist, 0, alpha.mesh.position.z + Math.sin(angle)*flexDist);
             }
        }
    }
}

// ==========================================
// 🐎 HORSE SYSTEM
// Isolated shy behavior logic
// ==========================================
class HorseSystem {
    constructor(scene, player, groundHeightFunc, vegetationData = {}) {
        this.scene = scene;
        this.player = player;
        this.getHeight = groundHeightFunc;
        this.treePositions = (vegetationData.trees && vegetationData.trees.length > 0) ? vegetationData.trees : (window._treePositions || []);
        
        this.horses = [];
        this.horse = null; // Legacy reference for active diagnostic scripts
        this.STATES = { IDLE: 0, WALKING: 1, FLEEING: 2, GRAZING: 3, TROT_HOME: 4, SPOOKED: 5, CURIOUS: 6 };
        this.fleeDist = 20.0; // Trigger distance to shy away
        this.walkSpeed = 1.0; // Calibrated to match walk animation stride length at timeScale 0.49
        this.fleeSpeed = 4.0;
        this.homeBase = new THREE.Vector3(-3.5, 0, 1.5); // Spawns immediately left of Tipi 1 / Quest 1
        
        this.init();
    }
    
    init() {
        const gltfLoader = window.GLTFLoader ? new window.GLTFLoader() : new THREE.GLTFLoader();
        gltfLoader.load('Assets/Horse.glb', (gltf) => {
            const baseMesh = gltf.scene;
            this.animations = gltf.animations;
            
            const scaleFactor = 0.35; // Corrected from 0.045 toy-size mistake (Now 1.6m tall)
            baseMesh.scale.setScalar(scaleFactor);
            
            for (let i = 0; i < 5; i++) { // Added 2 extra horses
                let mesh;
                if (window.SkeletonUtils) {
                    mesh = window.SkeletonUtils.clone(baseMesh);
                } else {
                    mesh = baseMesh.clone();
                }
                
                const mixer = new THREE.AnimationMixer(mesh);
                
                const findClip = (keywords, ...fallbacks) => {
                    // 1. Strict Exact Match (Case-Insensitive)
                    let match = this.animations.find(a => keywords.some(kw => 
                        a.name.toLowerCase() === kw.toLowerCase() || 
                        a.name.toLowerCase() === `animalarmature|${kw.toLowerCase()}`
                    ));
                    
                    // 2. Fallback Substring Match
                    if (!match) {
                        match = this.animations.find(a => keywords.some(kw => a.name.toLowerCase().includes(kw)));
                    }
                    
                    // 3. Fallback Index chain (since exporter strips names)
                    if (!match) {
                        for (let idx of fallbacks) {
                            if (this.animations[idx]) { match = this.animations[idx]; break; }
                        }
                    }
                    return match || this.animations[0];
                };

                // EXACT mapping to Horse.glb animations to prevent fallback cross-pollination.
                const runClip = findClip(["Gallop"], 5);
                const walkClip = findClip(["Walk"], 9);
                const idleClip = findClip(["Idle"], 12) || walkClip;
                const eatClip = findClip(["Eating"], 3) || idleClip;

                // CRITICAL FIX: To prevent completely missing animation maps from bleeding into each other!
                if (idleClip === walkClip) console.warn('[WILDLIFE] Horse IDLE clip missing, fell back to WALK.');

                const rearClip = findClip(["Gallop_Jump"], 4) || runClip; // Spook uses the jump or falls back to run


                // We MUST CLONE the clip before stripping tracks, so we don't permanently destroy 
                // the raw bone maps for the other 4 horses. This shared-array mutation is what 
                // caused horses 2-5 to jitter wildly out of bounds during idle!
                // Use a secure clip rebuilding technique rather than toJSON() which wipes out critical quaternion data and stalls horse legs!
                const makeSafeClip = (sourceClip) => {
                    if (!sourceClip) return null;
                    const cleanTracks = sourceClip.tracks.filter(track => {
                        const name = track.name.toLowerCase();
                        if ((name.includes('armature') || name.includes('root') || name.includes('skeleton')) && 
                            (name.includes('position'))) { // ONLY strip positional root motion, DO NOT strip quaternion rotations or legs stall!
                            return false; 
                        }
                        return true;
                    });
                    return new THREE.AnimationClip(sourceClip.name, sourceClip.duration, cleanTracks);
                };

                const safeIdleClip = makeSafeClip(idleClip);
                const safeWalkClip = makeSafeClip(walkClip);
                const safeRunClip = makeSafeClip(runClip);
                const safeEatClip = makeSafeClip(eatClip); 
                const safeRearClip = makeSafeClip(rearClip); // Separate unique action instance

                const actions = {
                    idle: mixer.clipAction(safeIdleClip),
                    walk: mixer.clipAction(safeWalkClip),
                    run: mixer.clipAction(safeRunClip),
                    eat: mixer.clipAction(safeEatClip),
                    rear: mixer.clipAction(safeRearClip)
                };
                
                actions.rear.setLoop(THREE.LoopOnce, 1);
                actions.rear.clampWhenFinished = true;
                
                // Spawn locations: 0 is homeBase. 1 and 2 are remote that walk inward.
                let dx, dz;
                if (i === 0) {
                    dx = this.homeBase.x; dz = this.homeBase.z;
                } else if (i === 1) {
                    dx = -120; dz = 0; // Opposite end of map
                } else if (i === 2) {
                    dx = 120; dz = 0; // Opposite end of map
                } else {
                    dx = this.homeBase.x + (Math.random() - 0.5) * 40;
                    dz = this.homeBase.z + (Math.random() - 0.5) * 40;
                }
                const dy = this.getHeight(dx, dz);
                
                mesh.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(mesh);
                let trueYOffset = mesh.position.y - box.min.y;
                if(isNaN(trueYOffset) || !isFinite(trueYOffset) || trueYOffset === 0) trueYOffset = scaleFactor * 0.6;
                
                mesh.position.set(dx, dy + trueYOffset, dz);
                mesh.rotation.y = Math.random() * Math.PI * 2;
                
                mesh.traverse(c => {
                    if (c.isMesh) { 
                        c.castShadow = true; 
                        c.receiveShadow = true; 
                        c.frustumCulled = false; // Prevent invisible skinned meshes
                    }
                });

                this.scene.add(mesh);
                
                // Bind animation speeds to physics speeds
                actions.walk.setEffectiveTimeScale(0.49); // Synced with walkSpeed 1.0
                actions.run.setEffectiveTimeScale(1.25); // Bound to flee speed

                const isDistant = (i === 1 || i === 2);
                const initTarget = isDistant ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(dx + 5, 0, dz + 5);
                
                // Initialize correct animation to match starting state (no blanket eat.play)
                const initState = isDistant ? this.STATES.WALKING : this.STATES.GRAZING;
                // Stop all actions, play only the correct one
                for (const key in actions) { actions[key].stop(); }
                if (initState === this.STATES.WALKING) {
                    actions.walk.setEffectiveWeight(1.0);
                    actions.walk.play();
                } else {
                    actions.eat.setEffectiveWeight(1.0);
                    actions.eat.play();
                }
                
                const hEnt = {
                    mesh: mesh,
                    mixer: mixer,
                    state: isDistant ? this.STATES.WALKING : this.STATES.GRAZING,
                    timer: isDistant ? 9999 : 5 + Math.random() * 15, // Distant horses walk until they arrive
                    target: initTarget,
                    baseY: trueYOffset,
                    actions: actions,
                    home: isDistant ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(dx, 0, dz)
                };
                
                window.attachDebugLabel(hEnt.mesh, 'Horse_' + i, () => {
                    const stateStr = Object.keys(this.STATES).find(k => this.STATES[k] === hEnt.state) || hEnt.state;
                    return {
                        state: stateStr,
                        anim: hEnt.currentAnim || 'None',
                        speed: (hEnt.state === this.STATES.WALKING) ? this.walkSpeed : (hEnt.state === this.STATES.FLEEING || hEnt.state === this.STATES.TROT_HOME ? this.fleeSpeed : 0)
                    };
                });
                
                this.horses.push(hEnt);
            }
            
            this.horse = this.horses[0];
            console.log(`[Wildlife] 3 Horses loaded and cloned successfully`);
        });
    }
    
    update(delta) {
        if (!this.horses || this.horses.length === 0) return;
        
        for (const h of this.horses) {
            const stateStr = Object.keys(this.STATES).find(k => this.STATES[k] === h.state) || h.state;
            const animStr = h.currentAnim ? ` (${h.currentAnim})` : '';
            h.mesh.userData.stateName = `${stateStr}${animStr}`;
            
            const playerPos = this.player.position;
            const distToPlayer = h.mesh.position.distanceTo(playerPos);
            const distToHome = h.mesh.position.distanceTo(h.home);
            
            if (h.mixer && distToPlayer < 120) h.mixer.update(delta);
            
            h.timer -= delta;
            
            // --- SANCTUARY AI INTERACTION ---
            const isCalm = (window.SacredState.calmTimer > 2.0);
            
            // Interaction Trigger Player within range
            if (distToPlayer < this.fleeDist && h.state !== this.STATES.SPOOKED && h.state !== this.STATES.FLEEING) {
                if (isCalm && distToPlayer > 8.0) {
                    // Player is calm and not too close. Be CURIOUS!
                    if (h.state !== this.STATES.CURIOUS) {
                        this.setHorseState(h, this.STATES.CURIOUS);
                        h.timer = 4.0;
                    }
                } else if (!isCalm || distToPlayer <= 5.0) {
                    // Player sprinted, OR walked TOO uncomfortably close, spook!
                    this.setHorseState(h, this.STATES.SPOOKED);
                    h.timer = 1.5; // Rear up time
                    
                    const fleeVec = new THREE.Vector3().subVectors(h.mesh.position, playerPos);
                    fleeVec.y = 0;
                    fleeVec.normalize().multiplyScalar(40);
                    h.target.copy(h.mesh.position).add(fleeVec);
                    
                    // Turn rapidly to face player to rear up
                    h.mesh.rotation.y = Math.atan2(playerPos.x - h.mesh.position.x, playerPos.z - h.mesh.position.z);
                }
            }
            
            if (h.state === this.STATES.CURIOUS) {
                // Orient towards player and walk slowly to within 9 feet
                const dx = playerPos.x - h.mesh.position.x;
                const dz = playerPos.z - h.mesh.position.z;
                if (distToPlayer > 9.0) {
                    h.target.set(playerPos.x, 0, playerPos.z);
                    this.moveTowards(h, h.target, this.walkSpeed * 0.4 * delta); // slow, cautious walk
                } else {
                    h.target.set(h.mesh.position.x, 0, h.mesh.position.z);
                    this.moveTowards(h, h.target, 0); // Stops but looks
                }
                
                // If player starts sprinting, curiousity ends immediately!
                if (!isCalm) h.timer = 0; 

                if (h.timer <= 0) {
                    this.setHorseState(h, this.STATES.GRAZING);
                    h.timer = 6.0;
                }
            } else if (h.state === this.STATES.SPOOKED) {
                if (h.timer <= 0) {
                    this.setHorseState(h, this.STATES.FLEEING);
                    h.timer = 4.0;
                }
            } else if (h.state === this.STATES.FLEEING) {
                if (h.timer <= 0) {
                    this.setHorseState(h, this.STATES.WALKING);
                    h.timer = 3.0; // short walk before resting
                } else {
                    this.moveTowards(h, h.target, this.fleeSpeed * delta);
                }
            } else if (h.state === this.STATES.TROT_HOME) {
                if (distToHome < 5.0) {
                    this.setHorseState(h, this.STATES.GRAZING);
                    h.timer = 10.0 + Math.random() * 10.0;
                } else {
                    h.target.copy(h.home);
                    this.moveTowards(h, h.target, this.fleeSpeed * 0.8 * delta); // brisk trot (matches Gallop animation)
                }
            } else if (h.state === this.STATES.WALKING) {
                const distToTarget = h.mesh.position.distanceTo(h.target);
                if (h.timer <= 0 || distToTarget < 2.0) {
                    this.setHorseState(h, Math.random() > 0.4 ? this.STATES.GRAZING : this.STATES.IDLE);
                    h.timer = 5.0 + Math.random() * 10.0;
                } else {
                    this.moveTowards(h, h.target, this.walkSpeed * delta);
                }
            } else if (h.state === this.STATES.IDLE) {
                if (h.timer <= 0) {
                    this.setHorseState(h, Math.random() > 0.6 ? this.STATES.GRAZING : this.STATES.WALKING);
                    h.timer = 5.0 + Math.random() * 5.0;
                    this.pickHorseTarget(h);
                }
            } else if (h.state === this.STATES.GRAZING) {
                if (h.timer <= 0) {
                    if (distToHome > 30.0) {
                        this.setHorseState(h, this.STATES.TROT_HOME); // Bounding box tether
                    } else {
                        this.setHorseState(h, Math.random() > 0.5 ? this.STATES.IDLE : this.STATES.WALKING);
                        h.timer = 4.0 + Math.random() * 4.0;
                        if (h.state === this.STATES.WALKING) this.pickHorseTarget(h);
                    }
                }
            }
        }
    }
    
    moveTowards(h, targetVec, stepDist) {
        const dx = targetVec.x - h.mesh.position.x;
        const dz = targetVec.z - h.mesh.position.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        
        if (dist > 0.1) {
            // === BOID OBSTACLE AVOIDANCE (Sanctuary Ecosystem) ===
            // Look ahead. If obstructed by a tree or tipi, add perpendicular force to trajectory vector.
            let fwd = new THREE.Vector3(Math.sin(h.mesh.rotation.y), 0, Math.cos(h.mesh.rotation.y));
            let repulsion = new THREE.Vector3();
            
            const checkPoints = [{x:0, z:0, r:4.0}]; // Tipi
            if (window._bhgGroup) checkPoints.push({x:35, z:45, r:4.0}); // Quest Tipi
            if (this.treePositions && this.treePositions.length > 0) {
                // Localize search to immediate proximity for performance
                for(let tPos of this.treePositions) {
                    const idx = h.mesh.position.x - tPos.x;
                    const idz = h.mesh.position.z - tPos.z;
                    if((idx*idx + idz*idz) < 64) checkPoints.push({x:tPos.x, z:tPos.z, r:1.2});
                }
            }
            if (window._treeTrunksInstanced) {
                 const cnt = window._treeTrunksInstanced.count;
                 const mat = new THREE.Matrix4();
                 const p = new THREE.Vector3();
                 for (let i = 0; i < cnt; i++) {
                     window._treeTrunksInstanced.getMatrixAt(i, mat);
                     p.setFromMatrixPosition(mat);
                     const idx = h.mesh.position.x - p.x;
                     const idz = h.mesh.position.z - p.z;
                     if((idx*idx + idz*idz) < 64) checkPoints.push({x: p.x, z: p.z, r:1.2});
                 }
            }
            
            for(let obs of checkPoints) {
                const odx = h.mesh.position.x - obs.x;
                const odz = h.mesh.position.z - obs.z;
                const distSq = odx*odx + odz*odz;
                const minR = obs.r + 1.2;
                if(distSq < minR*minR && distSq > 0.01) {
                    const distToC = Math.sqrt(distSq);
                    const toObs = new THREE.Vector3(-odx, 0, -odz).normalize(); // pointing TO obstacle
                    const approachDot = fwd.dot(toObs);
                    
                    if (approachDot > 0.3) {
                        // We are walking towards it! Add repulsion
                        const force = (minR - distToC) * 3.0; // Push strength
                        const awayVec = new THREE.Vector3(odx, 0, odz).normalize();
                        repulsion.addScaledVector(awayVec, force);
                    }
                }
            }
            
            // Apply steering forces if any, otherwise continue towards target
            if (repulsion.lengthSq() > 0.01) {
                fwd.add(repulsion).normalize();
            } else {
                fwd = new THREE.Vector3(dx, 0, dz).normalize();
            }

            // Rotate towards the finalized safe forward vector
            const targetAngle = Math.atan2(fwd.x, fwd.z);
            let diff = targetAngle - h.mesh.rotation.y;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            h.mesh.rotation.y += diff * stepDist * 2.5; // Quick turning when avoiding
            
            // Move along the physical rotation vector
            const facingFactor = Math.max(0.1, 1.0 - Math.abs(diff) / Math.PI);
            h.mesh.position.x += Math.sin(h.mesh.rotation.y) * stepDist * facingFactor;
            h.mesh.position.z += Math.cos(h.mesh.rotation.y) * stepDist * facingFactor;
        }
        
        const groundY = this.getHeight(h.mesh.position.x, h.mesh.position.z);
        h.mesh.position.y = groundY + h.baseY;
    }
    
    setHorseState(h, newState) {
        if (!h || h.state === newState) return;
        h.state = newState;
        
        if (h.mixer) h.mixer.timeScale = 1.0;

        // Retrieve the old active action (if any) to crossfade from it smoothly
        let oldAction = null;
        for (const key in h.actions) {
            if (h.actions[key] && h.actions[key].isRunning()) {
                oldAction = h.actions[key];
            }
        }
        
        // Determine the correct action for the new state
        let newAction = null;
        if (newState === this.STATES.FLEEING || newState === this.STATES.TROT_HOME) newAction = h.actions.run;
        else if (newState === this.STATES.WALKING) newAction = h.actions.walk;
        else if (newState === this.STATES.GRAZING) newAction = h.actions.eat;
        else if (newState === this.STATES.SPOOKED) newAction = h.actions.rear;
        else if (newState === this.STATES.CURIOUS) newAction = h.actions.walk; // Trot over slowly, then idle
        else newAction = h.actions.idle;
        
        if (newAction) {
            newAction.reset();
            if (newState === this.STATES.WALKING) newAction.setEffectiveTimeScale(0.49);
            else if (newState === this.STATES.CURIOUS) newAction.setEffectiveTimeScale(0.35); // Very slow gentle walk
            else if (newState === this.STATES.FLEEING || newState === this.STATES.TROT_HOME) newAction.setEffectiveTimeScale(1.25);
            else if (newState === this.STATES.IDLE) newAction.setEffectiveTimeScale(0); // Freeze the fallback walk clip
            else newAction.setEffectiveTimeScale(1);
            
            newAction.setEffectiveWeight(1);
            h.currentAnim = newAction.getClip().name;
            newAction.play();
            
            if (oldAction && oldAction !== newAction) {
                newAction.crossFadeFrom(oldAction, 0.5, true);
            }
        }
    }
    
    pickHorseTarget(h) {
        // Pick an angle somewhat in front of them (+/- 90 max) to completely eliminate instant 180 snaps
        const offset = (Math.random() - 0.5) * Math.PI;
        const angle = h.mesh.rotation.y + offset;
        const dist = 5 + Math.random() * 15;
        // In this engine math, X is mapped to sin() and Z to cos() for rotation.y
        h.target.set(h.mesh.position.x + Math.sin(angle)*dist, 0, h.mesh.position.z + Math.cos(angle)*dist);
    }
}

// ==========================================
// 🐿️ PROCEDURAL SQUIRREL SYSTEM
// Uses lightweight basic shapes since no asset exists.
// Adds brief vertical scurrying on pine trunks.
// ==========================================
class SquirrelSystem {
    constructor(scene, camera, groundHeightFunc, vegetationData = {}) {
        this.scene = scene;
        this.camera = camera;
        this.getHeight = groundHeightFunc;
        this.squirrels = [];
        this.visibleSquirrels = []; 
        this.treeMeshes = [];
        this.baseGeometries = this.createSquirrelGeometries();
        this.baseMaterials = this.createSquirrelMaterials();
        
        this.treeMeshes = (vegetationData.trees && vegetationData.trees.length > 0) ? vegetationData.trees : (window._treePositions || []); // Pass reference, populates async!
        // Do not call feedTrees() here manually; tree data is not downloaded yet.
    }

    createSquirrelGeometries() {
        // Low-poly style (Doubled the body length directly inside the cylinder height parameter per request)
        return {
            body: new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6),
            head: new THREE.ConeGeometry(0.14, 0.25, 6),
            tail: new THREE.CylinderGeometry(0.08, 0.02, 0.5, 5)
        };
    }

    createSquirrelMaterials() {
        // Red-brown / Grey variations
        return [
            new THREE.MeshStandardMaterial({ color: 0x8a5a44, roughness: 0.9, flatShading: true }), // Brown
            new THREE.MeshStandardMaterial({ color: 0x9e7b65, roughness: 0.9, flatShading: true }), // Light Brown
            new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 0.9, flatShading: true })  // Grey
        ];
    }

    buildSquirrelMesh(material) {
        const group = new THREE.Group();
        
        const body = new THREE.Mesh(this.baseGeometries.body, material);
        body.rotation.x = Math.PI / 2; // Lay flat vertically against tree
        body.castShadow = true;
        group.add(body);

        const head = new THREE.Mesh(this.baseGeometries.head, material);
        head.position.set(0, 0.4, 0.05); // Shifted Y from 0.25 to 0.4 to match new longer body
        head.rotation.x = -Math.PI / 8; // Look slightly up/out
        head.castShadow = true;
        group.add(head);

        // Tail wrapper for easy pivoting at the base
        const tailWrapper = new THREE.Group();
        tailWrapper.position.set(0, -0.3, -0.1); // Shifted Y from -0.15 to -0.3 to match new longer body
        
        const tail = new THREE.Mesh(this.baseGeometries.tail, material);
        tail.position.set(0, 0.25, -0.05); // Offset so pivot is at base
        tail.rotation.x = Math.PI / 6; // Curve back slightly
        tail.castShadow = true;
        tailWrapper.add(tail);
        
        group.add(tailWrapper);
        group.userData.tail = tailWrapper;
        group.userData.head = head;
        
        // Scale up slightly so they are visible on large pines
        group.scale.set(0.8, 0.8, 0.8);
        return group;
    }

    feedTrees(treeMeshes) {
        this.treeMeshes = treeMeshes;
        if(this.treeMeshes.length === 0) return;
        // this.spawnSquirrels(8); // Spawn 8 squirrels in the forest (DISABLED PER USER REQUEST)
    }

    spawnSquirrels(count) {
        for (let i = 0; i < count; i++) {
            // Pick a random tree
            const tree = this.treeMeshes[Math.floor(Math.random() * this.treeMeshes.length)];
            const groundY = this.getHeight ? this.getHeight(tree.x, tree.z) : 0;
            const treePos = new THREE.Vector3(tree.x, groundY, tree.z);

            // Avoid spawning on trees right at the camera origin if possible
            if(treePos.length() < 10) continue; 

            const material = this.baseMaterials[Math.floor(Math.random() * this.baseMaterials.length)];
            const mesh = this.buildSquirrelMesh(material);

            // Attach to trunk
            const angle = Math.random() * Math.PI * 2;
            const trunkRadius = 0.5; // Approx pine trunk thickness
            const heightOnTrunk = 2.0 + Math.random() * 4.0; 

            // Position relative to tree center
            const ox = Math.cos(angle) * trunkRadius;
            const oz = Math.sin(angle) * trunkRadius;
            mesh.position.set(treePos.x + ox, treePos.y + heightOnTrunk, treePos.z + oz);

            // Face outward from tree center
            mesh.lookAt(treePos.x + ox * 2, mesh.position.y, treePos.z + oz * 2);

            const sq = {
                mesh: mesh,
                treeCenter: treePos,
                trunkRadius: trunkRadius,
                angle: angle,
                baseY: treePos.y,
                height: heightOnTrunk,
                state: 'IDLE', // IDLE, SCURRY_UP, SCURRY_DOWN, HIDE
                fleeCooldown: 0.0,
                timer: Math.random() * 5.0,
                targetHeight: heightOnTrunk,
                tailFlickTimer: 0
            };

            // Add visual debug laser
            window.attachDebugLabel(mesh, 'Squirrel', () => {
                return { state: sq.state, anim: 'Procedural/None' };
            });
            this.scene.add(mesh);
            console.log(`[WILDLIFE DEBUG] Squirrel spawn Y: ${mesh.position.y}`);

            this.squirrels.push(sq);
        }
        console.log(`[Wildlife] Spawned ${this.squirrels.length} procedural squirrels`);
    }
    linkFuzzyBrain(brain) {
        this.brain = brain;
    }

    update(delta) {
        // Late-bound initialization check (trees are loaded asynchronously by Environment Builder)
        if (this.squirrels.length === 0 && this.treeMeshes && this.treeMeshes.length > 0) {
            this.spawnSquirrels(8);
        }

        if(this.squirrels.length === 0) return;

        const time = performance.now() * 0.001;
        const playerPos = this.camera.position;

        // Culling (only update closest squirrels to save FPS)
        this.visibleSquirrels = [];
        for (const s of this.squirrels) {
            const distSq = s.mesh.position.distanceToSquared(playerPos);
            if (distSq < 1600) { // 40m radius
                this.visibleSquirrels.push(s);
                s.mesh.visible = true;
            } else {
                s.mesh.visible = false;
            }
        }

        for (const s of this.visibleSquirrels) {
            s.mesh.userData.stateName = s.state;
            
            s.timer -= delta;
            if (s.fleeCooldown > 0) s.fleeCooldown -= delta;

            // Tail flickering (anxious squirrel movement)
            s.tailFlickTimer -= delta;
            if(s.tailFlickTimer <= 0) {
                // Occasional rapid flick
                if(Math.random() < 0.1) {
                    s.mesh.userData.tail.rotation.x = Math.sin(time * 30) * 0.2;
                } else {
                    s.mesh.userData.tail.rotation.x = THREE.MathUtils.lerp(s.mesh.userData.tail.rotation.x, 0, 0.1);
                }
                s.tailFlickTimer = 0.1;
            }

            // Head twitch
            if(Math.random() < 0.02 && s.state === 'IDLE') {
                s.mesh.userData.head.rotation.y = (Math.random() - 0.5) * 0.5;
            } else if (s.state !== 'IDLE') {
                s.mesh.userData.head.rotation.y = 0; // Look straight while moving
            }

            // Proximity Flee AI (Hide behind tree and scamper up)
            if (s.state !== 'FLEE_HIDE' && s.state !== 'SCURRY_UP' && s.fleeCooldown <= 0) {
                const distSq = s.mesh.position.distanceToSquared(playerPos);
                // Only Flee-trigger natively if they aren't already safely high up in the canopy
                if (distSq < 100 && s.height < 5.0) { 
                    const dx = playerPos.x - s.treeCenter.x;
                    const dz = playerPos.z - s.treeCenter.z;
                    const playerAngle = Math.atan2(dz, dx);
                    
                    s.targetAngle = playerAngle + Math.PI; // Opposite side
                    s.state = 'FLEE_HIDE';
                    s.timer = 5.0; // Adrenaline cooldown
                }
            }

            // State Machine
            if (s.state === 'IDLE') {
                if (s.timer <= 0) {
                    // Decide where to scurry: strictly up or down trunk
                    const action = Math.random();
                    // Max trunk height before branches expanded to 7.5 to allow more vertical scurry freedom
                    if (action < 0.6 && s.height < 7.5) {
                        s.state = 'SCURRY_UP';
                        s.targetHeight = Math.min(7.5, s.height + 2.5 + Math.random() * 3.0);
                        // Sideways and longer when running up
                        s.mesh.rotation.z = Math.PI / 2;
                        s.mesh.scale.set(0.48, 0.7, 0.48); 
                        s.spiralDir = 0; // Strict vertical, no spiraling
                    } else if (action >= 0.4 && s.height > 1.0) {
                        s.state = 'SCURRY_DOWN';
                        s.targetHeight = Math.max(1.0, s.height - 2.5 - Math.random() * 3.0);
                        // Rotate 180 to face down
                        s.mesh.rotation.z = Math.PI; 
                        s.mesh.scale.set(0.48, 0.7, 0.48); // Longer down too
                        s.spiralDir = 0;
                    } else {
                        // Stay idle
                        s.timer = 1.0 + Math.random() * 3.0;
                        s.mesh.rotation.z = 0;
                        s.mesh.scale.set(0.48, 0.48, 0.48);
                    }
                }
            } 
            else if (s.state === 'SCURRY_UP' || s.state === 'SCURRY_DOWN') {
                const speed = 2.5 * delta; // SCAMPER SPEED REDUCED — visible 1-2 sec climb rather than 0.3 sec teleport
                const dir = s.state === 'SCURRY_UP' ? 1 : -1;
                s.height += speed * dir;

                // Bobbing while running
                const scurryBob = Math.sin(time * 40) * 0.05;
                
                // MANDATORY RULE: Keep attached to tree trunk surface (no spiraling)
                const ox = Math.cos(s.angle) * (s.trunkRadius + scurryBob);
                const oz = Math.sin(s.angle) * (s.trunkRadius + scurryBob);
                s.mesh.position.set(s.treeCenter.x + ox, s.baseY + s.height, s.treeCenter.z + oz);

                // Re-orient to face perfectly outward
                s.mesh.lookAt(s.treeCenter.x + ox * 2, s.mesh.position.y, s.treeCenter.z + oz * 2);
                
                if (s.state === 'SCURRY_UP') {
                    s.mesh.rotation.z = Math.PI / 2; // Face UP
                } else if (s.state === 'SCURRY_DOWN') {
                    s.mesh.rotation.z = -Math.PI / 2; // Face DOWN naturally
                }

                // Stop condition
                if ((dir === 1 && s.height >= s.targetHeight) || (dir === -1 && s.height <= s.targetHeight)) {
                    s.state = 'IDLE';
                    s.fleeCooldown = 4.0; // Don't instantly flee again
                    s.timer = 0.5 + Math.random() * 1.5; // VERY SHORT rest so they remain highly active!
                    s.mesh.rotation.z = 0; // Face outward horizontally while clinging
                    s.mesh.scale.set(0.48, 0.48, 0.48); // Reset length
                }
            }
            else if (s.state === 'HIDE' || s.state === 'FLEE_HIDE') {
                const speed = (s.state === 'FLEE_HIDE' ? 8.0 : 4.0) * delta;
                
                // Absolute angular difference
                let diff = (s.targetAngle - s.angle) % (Math.PI * 2);
                if (diff < -Math.PI) diff += Math.PI * 2;
                if (diff > Math.PI) diff -= Math.PI * 2;
                
                const turnDir = Math.sign(diff);
                s.angle += speed * turnDir;

                const scurryBob = Math.sin(time * 40) * 0.05;
                const ox = Math.cos(s.angle) * (s.trunkRadius + scurryBob);
                const oz = Math.sin(s.angle) * (s.trunkRadius + scurryBob);
                s.mesh.position.set(s.treeCenter.x + ox, s.baseY + s.height, s.treeCenter.z + oz);
                
                // Look outward from new angle
                s.mesh.lookAt(s.treeCenter.x + ox * 2, s.mesh.position.y, s.treeCenter.z + oz * 2);
                s.mesh.rotation.z = Math.PI / 2 * turnDir; // Bank into turn

                if (Math.abs(diff) < 0.15) {
                    if (s.state === 'FLEE_HIDE') {
                        // Safe on the back of the tree, now shoot up to rest
                        s.state = 'SCURRY_UP';
                        s.targetHeight = Math.min(6.5, s.height + 4.0); // Scamper high but stay on trunk
                        s.spiralDir = 0;                 // Perfectly vertical hide
                        s.mesh.rotation.z = Math.PI / 2;
                        s.mesh.scale.set(0.48, 0.8, 0.48); // Fully stretched out
                    } else {
                        s.state = 'IDLE';
                        s.timer = 1.0 + Math.random() * 3.0;
                        s.mesh.rotation.z = 0; // Restore upright
                        s.mesh.scale.set(0.48, 0.48, 0.48); // Restore length
                    }
                }
            }
        }
    }
}

class ButterflySystem {
    constructor(scene, getHeightFunction, playerMesh) {
        this.scene = scene;
        this.getHeight = getHeightFunction;
        this.player = playerMesh;
        this.butterflies = [];
        this.init();
    }
    init() {
        // Procedural Butterfly Design
        // Left Wing - Scaled down drastically to insect size (approx 0.05 units)
        const wingGeo = new THREE.PlaneGeometry(0.06, 0.08);
        wingGeo.translate(0.03, 0, 0); // pivot at edge
        
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffdd00, // Vibrant Yellow
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            depthWrite: false
        });
        
        // Spawn closely near Tipi front
        const sx = 0.0;
        const sz = -5.0;
        
        for(let i=0; i<8; i++) { // Swarm of 8
            const group = new THREE.Group();
            
            const lWing = new THREE.Mesh(wingGeo, mat);
            const rWing = new THREE.Mesh(wingGeo, mat);
            rWing.scale.x = -1; // Mirror
            
            // Add a slight V-shape rest pose
            lWing.rotation.x = -Math.PI / 2;
            rWing.rotation.x = -Math.PI / 2;
            
            group.add(lWing);
            group.add(rWing);
            
            
            group.scale.set(1.0, 1.0, 1.0); // Reset scale to 1.0 since geometry is naturally insect sized
            
            // Tighter spawn cluster right near the Tipi
            const px = sx + (Math.random()-0.5)*3.0;
            const pz = sz + (Math.random()-0.5)*3.0;
            const py = this.getHeight(px, pz) + 0.5 + Math.random();
            group.position.set(px, py, pz);
            
            // Soft aura (also scaled down for the smaller size)
            if (i === 0) {
                const light = new THREE.PointLight(0xffdd00, 0.8, 3.0);
                group.add(light);
            }
            
            this.scene.add(group);
            this.butterflies.push({
                mesh: group,
                lWing: lWing,
                rWing: rWing,
                timeOffset: Math.random() * 100,
                origin: new THREE.Vector3(sx, py, sz),
                target: group.position.clone(),
                timer: 0,
                flapSpeed: 20 + Math.random() * 10
            });
        }
        console.log(`[WILDLIFE DEBUG] Spawned ${this.butterflies.length} Procedural Yellow Butterflies`);
    }
    
    update(delta, playerPos) {
        if (!this.butterflies || this.butterflies.length === 0) return;
        const time = performance.now() * 0.001;
        
        for (const b of this.butterflies) {
            b.timer -= delta;
            if (b.timer <= 0) {
                // Pick new target very close to origin (Tipi) so they hover tightly
                b.target.x = b.origin.x + (Math.random() - 0.5) * 4.0;
                b.target.z = b.origin.z + (Math.random() - 0.5) * 4.0;
                b.target.y = this.getHeight(b.target.x, b.target.z) + 0.2 + Math.random() * 1.5;
                b.timer = 0.5 + Math.random() * 1.0;
            }
            
            // Move toward target smoothly
            b.mesh.position.lerp(b.target, delta * 2.5);
            
            // Flutter physics
            const flutterY = Math.sin(time * 15 + b.timeOffset) * 0.05;
            b.mesh.position.y += flutterY;
            
            // Directional rotation
            const dx = b.target.x - b.mesh.position.x;
            const dz = b.target.z - b.mesh.position.z;
            const targetYaw = Math.atan2(dx, dz);
            
            let diff = (targetYaw - b.mesh.rotation.y) % (Math.PI * 2);
            if (diff < -Math.PI) diff += Math.PI * 2;
            if (diff > Math.PI) diff -= Math.PI * 2;
            b.mesh.rotation.y += diff * delta * 3.0;
            
            // Wing Flapping Animation (independent of rotation.z chaos)
            const flapAngle = Math.sin(time * b.flapSpeed + b.timeOffset) * 0.8; 
            b.lWing.rotation.y = -flapAngle; // Flap up/down
            b.rWing.rotation.y = flapAngle;
            
            // Erratic wing/roll tilts to sell the "butterfly" illusion
            b.mesh.rotation.z = Math.sin(time * 25 + b.timeOffset) * 0.1;
            b.mesh.rotation.x = Math.sin(time * 12 + b.timeOffset) * 0.1;
        }
    }
}

// Map exports to window
if (typeof window !== 'undefined') {
    window.RabbitSystem = RabbitSystem;
    window.BirdSystem = BirdSystem;
    window.DeerSystem = DeerSystem;
    window.SquirrelSystem = SquirrelSystem;
    window.HorseSystem = HorseSystem;
    window.ButterflySystem = ButterflySystem;
}

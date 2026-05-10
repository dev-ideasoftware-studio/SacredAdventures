// js/Component.NextGenWildlife.js

window.NextGenRabbitSystem = class NextGenRabbitSystem {
    constructor(scene, getGroundY) {
        this.scene = scene;
        this.getGroundY = getGroundY;
        this.rabbits = [];
        // Place hole exactly to the right side of the Tipi 
        this.holePos = new THREE.Vector3(7, 0, -1); 
        this.holePos.y = this.getGroundY(this.holePos.x, this.holePos.z);
        this.isHiding = false;
        
        // Create actual burrow hole mesh
        const holeGeo = new THREE.CircleGeometry(0.07, 16);
        const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505, depthWrite: false });
        const holeMesh = new THREE.Mesh(holeGeo, holeMat);
        holeMesh.rotation.x = -Math.PI / 2;
        holeMesh.position.copy(this.holePos);
        holeMesh.position.y += 0.05; // Slightly above ground
        this.scene.add(holeMesh);

        this.init();
    }

    init() {
        const loader = new THREE.GLTFLoader();
        loader.load('Assets/rabbit.animated.glb', (gltf) => {
            const template = gltf.scene;
            const animations = gltf.animations;

            // Define the family structure (Scaled down 3x)
            const familySpecs = [
                { role: 'mother', scale: 0.8 / 3, color: 0xa08560 }, // Brownish
                { role: 'father', scale: 1.1 / 3, color: 0x4a4a4a }, // Dark Grey
                { role: 'child1', scale: 0.45 / 3, color: 0xffffff }, // White
                { role: 'child2', scale: 0.4 / 3, color: 0xc4b387 }, // Light Tan
                { role: 'child3', scale: 0.5 / 3, color: 0x6e6255 }  // Speckled brown
            ];

            familySpecs.forEach((spec, i) => {
                // SkeletonUtils is required to clone SkinnedMeshes safely
                const clone = window.SkeletonUtils.clone(template);
                clone.scale.set(spec.scale, spec.scale, spec.scale);
                
                // Needs unique materials to color them independently
                clone.traverse(c => {
                    if (c.isMesh) {
                        c.material = c.material.clone();
                        if (c.material.color) c.material.color.setHex(spec.color);
                        c.castShadow = true;
                    }
                });

                // Scatter around hole initially
                const rx = this.holePos.x + (Math.random() - 0.5) * 8.0;
                const rz = this.holePos.z + (Math.random() - 0.5) * 8.0;
                clone.position.set(rx, this.getGroundY(rx, rz), rz);
                
                // Force feet to align exactly with ground
                // (Stripped out dynamic Box3 bounding logic, as bone animations cause the box to shift and create a float glitch)
                // USER REQUEST: Rabbit models are halfway above ground. Force feet specifically down flush.
                const feetOffset = 0.25; // Adjusted to physically raise them out of the subterranean grass
                clone.position.y += feetOffset;
                clone.userData.isWildlife = true;
                
                // Add PIP marker (Faded green fill, Brown outer ring)
                // Small animals get ~3ft diameter (0.45m radius)
                if (window.createPIPMarker) {
                    // pass: color(faded green), innerRadius, outerRadius, hasArrow, borderColor(brown), fillOpacity
                    const rMarker = window.createPIPMarker(0x6b8e23, 0.4 / spec.scale, 0.45 / spec.scale, true, 0x8b4513, 0.5);
                    clone.add(rMarker);
                }

                // SCENE EDITOR: Inject Miniature Base
                if (window.createEditorBase) {
                    const editorBase = window.createEditorBase(0.6 / spec.scale, clone, 0x334422);
                    clone.add(editorBase);
                }

                this.scene.add(clone);

                // Setup Animation
                const mixer = new THREE.AnimationMixer(clone);
                const idle = animations.length > 0 ? animations.find(a => a.name.toLowerCase().includes('idle')) || animations[0] : null;
                const hop = animations.length > 0 ? animations.find(a => a.name.toLowerCase().includes('run') || a.name.toLowerCase().includes('hop')) || animations[0] : null;
                
                let idleAction, hopAction;
                if (idle) { idleAction = mixer.clipAction(idle); idleAction.play(); }
                if (hop) { hopAction = mixer.clipAction(hop); }

                this.rabbits.push({
                    mesh: clone,
                    mixer: mixer,
                    role: spec.role,
                    actions: { idle: idleAction, hop: hopAction },
                    currentAction: idleAction,
                    state: 'graze', // graze, hop, hide
                    target: new THREE.Vector3(),
                    timer: Math.random() * 5.0,
                    baseScale: spec.scale,
                    feetOffset: feetOffset
                });
            });
            console.log("[Wildlife] Rabbit Family Spawned at Burrow");
        });
    }

    update(delta, playerPos) {
        if (!this.rabbits.length || !playerPos) return;

        // Track Player Speed for Behavioral Analysis
        if (!this.lastPlayerPos) this.lastPlayerPos = playerPos.clone();
        const playerSpeed = playerPos.distanceTo(this.lastPlayerPos) / Math.max(0.016, delta);
        this.lastPlayerPos.copy(playerPos);

        const mother = this.rabbits.find(r => r.role === 'mother');

        for (let r of this.rabbits) {
            r.mixer.update(delta);
            r.timer -= delta;
            
            // Artificial Intelligence: Continuous Habituation Physics
            if (r.trust === undefined) r.trust = 0; // 0 to 100
            
            const distToPlayer = playerPos.distanceTo(r.mesh.position);
            
            // Modulate Trust
            if (distToPlayer < 25.0) {
                if (playerSpeed > 4.0) {
                    // Sudden movements shatter trust instantly
                    r.trust -= 40 * delta; 
                } else if (playerSpeed < 1.0) {
                    // Standing perfectly still builds trust rapidly
                    r.trust += 12 * delta;
                } else {
                    // Slow walking builds trust slowly
                    r.trust += 3 * delta;
                }
            } else {
                // Out of sight out of mind; slowly default back to baseline
                if (r.trust > 0) r.trust -= 2 * delta; 
            }
            // Clamp trust uniquely per rabbit giving them individual personalities
            const maxTrust = r.role === 'mother' ? 80 : 100; // Mother is always slightly warier
            r.trust = Math.max(0, Math.min(maxTrust, r.trust));
            
            // Determine active mode via Trust Profile
            let mode = 'graze';
            if (distToPlayer < 12.0 && r.trust < 40) {
                mode = 'flee_hide'; // Terrified
            } else if (distToPlayer < 25.0 && r.trust > 60) {
                mode = 'observe'; // Curious
            } else {
                mode = 'wander'; // Safe baseline
            }

            // === STATE MACHINE EXECUTION ===

            if (mode === 'flee_hide') {
                if (r.state !== 'hide') {
                    if (r.state !== 'fleeing') {
                        r.state = 'fleeing';
                        r.target.copy(this.holePos);
                    }
                    
                    const distToTarget = r.mesh.position.distanceTo(r.target);
                    if (distToTarget > 0.5) {
                        // High-speed frantic fleeing
                        this.moveTowards(r, r.target, 7.5, delta);
                        // Standard mesh visibility shrink wrapper (undo burrow hide)
                        if (r.mesh.scale.y < r.baseScale) r.mesh.scale.addScalar(delta * 2.0);
                        this.playAction(r, 'hop');
                    } else {
                        // Divng into hole mechanism
                        r.mesh.scale.subScalar(delta * 4.0);
                        if (r.mesh.scale.y <= 0.05) {
                            r.mesh.scale.setScalar(0.001);
                            r.state = 'hide';
                            this.playAction(r, 'idle');
                        }
                    }
                }
            } 
            else if (mode === 'observe') {
                // Stop whatever they are doing and simply watch the player
                r.state = 'observing';
                r.hopCycle = 0;
                r.mesh.position.y = this.getGroundY(r.mesh.position.x, r.mesh.position.z) + r.feetOffset;
                if (r.mesh.scale.y < r.baseScale) r.mesh.scale.addScalar(delta * 2.0);
                
                // Slowly softly rotate to keep eyes on player
                const dir = new THREE.Vector3().subVectors(playerPos, r.mesh.position);
                dir.y = 0;
                if (dir.length() > 0.1) {
                    dir.normalize();
                    const lookTgt = r.mesh.position.clone().add(dir);
                    r.mesh.lookAt(lookTgt);
                }
                
                // Extremely rare tiny hop closer to player if trust is maxed!
                if (r.trust >= 90 && r.role.includes('child') && Math.random() < 0.005) {
                    r.state = 'hop_curious';
                    r.target.copy(playerPos);
                    // Don't get TOO close (stop 2m away)
                    const offset = new THREE.Vector3().subVectors(r.mesh.position, playerPos).normalize().multiplyScalar(3.0);
                    r.target.add(offset);
                    r.timer = 1.0; 
                } else {
                    this.playAction(r, 'idle'); // Standing tall watching
                }
            }
            else {
                // WANDER AND GRAZE (Baseline safe simulation)
                if (r.state === 'hide' || r.state === 'fleeing') r.state = 'graze'; // Reset safety
                
                if (r.state !== 'hop_curious' && r.state !== 'hop') {
                   r.hopCycle = 0;
                   r.mesh.position.y = this.getGroundY(r.mesh.position.x, r.mesh.position.z) + r.feetOffset;
                }
                
                if (r.mesh.scale.y < r.baseScale) r.mesh.scale.addScalar(delta * 2.0);
                if (r.mesh.scale.y > r.baseScale) r.mesh.scale.setScalar(r.baseScale);

                if (r.timer <= 0) {
                    if (Math.random() > 0.6) {
                        r.state = 'hop';
                        this.playAction(r, 'hop');
                        r.timer = 1.0 + Math.random() * 2.0;

                        // AI Flocking Math
                        if (r.role.includes('child') && mother) {
                            // Children stay heavily grouped near mother structurally (Simple life bounding)
                            r.target.copy(mother.mesh.position);
                            r.target.x += (Math.random() - 0.5) * 3.0; // tighter radius
                            r.target.z += (Math.random() - 0.5) * 3.0;
                        } else {
                            // Adults wander near burrow hole securely
                            r.target.copy(this.holePos);
                            r.target.x += (Math.random() - 0.5) * 15.0;
                            r.target.z += (Math.random() - 0.5) * 15.0;
                        }
                    } else {
                        r.state = 'graze';
                        this.playAction(r, 'idle');
                        r.timer = 2.0 + Math.random() * 4.0;
                    }
                }

                // Execute active hop state
                if (r.state === 'hop' || r.state === 'hop_curious') {
                    const distToTarget = r.mesh.position.distanceTo(r.target);
                    if (distToTarget > 0.5) {
                        // Tiptoe slower when curious
                        const speed = r.state === 'hop_curious' ? 1.0 : 2.5; 
                        this.moveTowards(r, r.target, speed, delta);
                        this.playAction(r, 'hop');
                    } else {
                        r.state = 'graze';
                        this.playAction(r, 'idle');
                        r.timer = 2.0;
                    }
                }
            }
        }
    }

    moveTowards(rabbit, target, speed, delta) {
        const dir = new THREE.Vector3().subVectors(target, rabbit.mesh.position);
        dir.y = 0;
        dir.normalize();
        
        // Smooth rotate
        const lookTgt = rabbit.mesh.position.clone().add(dir);
        rabbit.mesh.lookAt(lookTgt);
        
        // USER REQUEST: Advanced Physics Jumps for Adults vs Babies
        let hopY = 0;
        if ((rabbit.state === 'hop' || rabbit.state === 'hop_curious') && delta) {
            if (rabbit.hopCycle === undefined) rabbit.hopCycle = 0;
            
            const isAdult = rabbit.role === 'mother' || rabbit.role === 'father';
            const jumpScalar = isAdult ? 4.5 : 1.2; // Adults leap bounds, babies do tiny hops
            
            // Curious hop is much shorter and gentler!
            const hopLength = rabbit.state === 'hop_curious' ? 0.2 : 0.4;
            const maxHopDist = Math.max(0.5, rabbit.baseScale * jumpScalar) * hopLength;
            
            let totalCycle = maxHopDist / Math.max(0.1, speed); 
            totalCycle = Math.min(0.8, Math.max(0.18, totalCycle));
            const hDuration = totalCycle * 0.6; // Time in air
            
            rabbit.hopCycle += delta;
            if (rabbit.hopCycle > totalCycle) rabbit.hopCycle -= totalCycle;
            
            if (rabbit.hopCycle < hDuration) {
                const t = rabbit.hopCycle;
                const g = isAdult ? 19.6 : 39.2; // Gravity (babies fall to ground super fast for quick micro hops)
                const v0 = (g * hDuration) / 2.0; 
                hopY = ((v0 * t) - (0.5 * g * t * t));
                if (hopY < 0) hopY = 0;
                
                // Allow forward movement only during the arc
                rabbit.mesh.position.addScaledVector(dir, speed * delta);
            }
        } else {
            // Standard smooth movement
             rabbit.mesh.position.addScaledVector(dir, speed * delta);
        }
        
        rabbit.mesh.position.y = this.getGroundY(rabbit.mesh.position.x, rabbit.mesh.position.z) + rabbit.feetOffset + hopY;
    }

    playAction(rabbit, actionName) {
        if (!rabbit.actions[actionName]) return;
        
        // Fix rabbits walking in place if Idle doesn't have a track
        if (actionName === 'idle' && rabbit.actions.idle && rabbit.actions.hop && rabbit.actions.idle.getClip() === rabbit.actions.hop.getClip()) {
            rabbit.actions[actionName].setEffectiveTimeScale(0.001); // Freeze legs
        } else {
            rabbit.actions[actionName].setEffectiveTimeScale(1.0);
        }

        const newAction = rabbit.actions[actionName];
        if (newAction && rabbit.currentAction !== newAction) {
            for (let key in rabbit.actions) {
                 if (rabbit.actions[key] && key !== actionName) {
                      rabbit.actions[key].fadeOut(0.2);
                 }
            }
            newAction.reset();
            newAction.setEffectiveWeight(1.0);
            newAction.play();
            if (rabbit.currentAction) newAction.crossFadeFrom(rabbit.currentAction, 0.2, true);
            rabbit.currentAction = newAction;
        }
    }
    
    // Core Engine compatibility stub to prevent TypeError
    linkFuzzyBrain(brain) { }
};

window.InteractiveHorseSystem = class InteractiveHorseSystem {
    constructor(scene, getGroundY) {
        this.scene = scene;
        this.getGroundY = getGroundY;
        this.horse = null;
        this.mixer = null;
        this.actions = {};
        this.currentAction = null;
        this.state = 'graze';
        this.timer = 0;
        this.trust = 0; // 0 to 100
        this.target = new THREE.Vector3();
        
        this.init();
    }

    init() {
        const loader = new THREE.GLTFLoader();
        loader.load('Assets/Horse.glb', (gltf) => {
            this.asset = gltf.scene;
            
            // Three.js LookAt targets its -Z axis.
            // Horse natively faces +X. Wrap it in a +90-degree mathematical flip to sink it onto the engine track.
            // User request (20x): "turn it 45 degrees right" -> subtract Math.PI / 4.
            this.meshRig = new THREE.Group();
            this.meshRig.rotation.y = 0; // Corrected to 0 offset so it naturally points where it walks
            this.meshRig.add(this.asset);

            this.horse = new THREE.Group();
            this.horse.add(this.meshRig);
            this.horse.scale.set(0.375, 0.375, 0.375); // Reduced by exactly another 25% of its 0.5 scale
            
            // User Request (18x): Horse MUST be EXACTLY 3-feet to the left of its current anchor, locked to face her.
            const sx = -4.0; // Pushed Left
            const sz = 5.0;
            this.horse.position.set(sx, this.getGroundY(sx, sz), sz);
            
            this.asset.traverse(c => {
                if (c.isMesh) { 
                    c.castShadow = true; 
                    c.receiveShadow = true; 
                    
                    // Force smooth shading algorithm over the geometry
                    if (c.geometry) {
                        c.geometry.computeVertexNormals(); 
                    }
                    if (c.material) {
                        c.material = Array.isArray(c.material) ? c.material[0].clone() : c.material.clone();
                        // Fix texture encoding
                        if (c.material.map) {
                            c.material.map.colorSpace = THREE.SRGBColorSpace;
                            c.material.map.needsUpdate = true;
                        }
                        c.material.roughness = 0.85; // Organic skin/hair
                        c.material.metalness = 0.05;
                        c.material.flatShading = false;
                        c.material.needsUpdate = true;
                    }
                }
            });
            
            // Attach PIP marker (Faded green fill, Brown outer ring)
            if (window.createPIPMarker) {
                const horseMarker = window.createPIPMarker(0x6b8e23, 2.0, 2.4, true, 0x8b4513, 0.5);
                this.horse.add(horseMarker);
            }
            
            // Attach FPV diagnostic visual arrow
            if (window.createFPVFacingArrow) {
                const horseFpvArrow = window.createFPVFacingArrow(0x6b8e23, 3.5, new THREE.Vector3(0, 0, 1));
                this.horse.add(horseFpvArrow);
            }
            
            this.scene.add(this.horse);

            if (gltf.animations && gltf.animations.length > 0) {
                // IMPORTANT: Bind Mixer to raw asset to prevent glTF track hierarchical resolution failure
                this.mixer = new THREE.AnimationMixer(this.asset);
                // Safely grab distinct animation tracks (Using Array spread to prevent overlap)
                const anims = gltf.animations;
                let walk, idle;
                if (anims.length > 1) {
                    walk = anims.find(a => a.name.toLowerCase().includes('walk') && !a.name.toLowerCase().includes('hit')) || anims[1];
                    idle = anims.find(a => a.name.toLowerCase().includes('idle') || a.name.toLowerCase().includes('stand') || a.name.toLowerCase().includes('rest')) || anims[0];
                } else {
                    walk = anims[0];
                    idle = anims[0];
                }
                
                this.actions.walk = this.mixer.clipAction(walk);
                this.actions.idle = this.mixer.clipAction(idle);
                this.actions.idle.setEffectiveTimeScale(0.3); // Play idle animation in slow motion
                
                this.currentAction = this.actions.idle;
                this.currentAction.play();
            }
            console.log("[Wildlife] Interactive Horse Spawned");
        });
    }

    update(delta, playerPos) {
        if (!this.horse) return;
        if (!this.horse) return;
        if (this.mixer) this.mixer.update(delta);
        
        // Break up animation repetition by occasionally freezing natively like real horses do
        if (this.actions && this.actions.idle && (this.state === 'graze' || this.state === 'interact')) {
            if (Math.random() < 0.001) { // Massive reduction to 0.1% chance per frame so horse actually moves
                 const currentScale = this.actions.idle.getEffectiveTimeScale();
                 if (currentScale > 0) {
                     this.actions.idle.setEffectiveTimeScale(0);
                     setTimeout(() => {
                          if (this.actions && this.actions.idle) this.actions.idle.setEffectiveTimeScale(0.2 + (Math.random() * 0.3));
                     }, 1000 + Math.random() * 3000);
                 }
            }
        }
        
        // USER REQUEST: Randomize head movements when idle
        if (this.state === 'graze' || this.state === 'interact') {
            if (!this.neckBone) {
                this.horse.traverse(c => {
                    if (c.isBone && c.name.toLowerCase().includes('neck')) this.neckBone = c;
                });
            }
            if (this.neckBone && window._globalTime) {
                const t = window._globalTime.value;
                // Add procedural perlin-like offsets directly AFTER the mixer permanently overwrites the bone
                this.neckBone.rotation.x += Math.sin(t * 1.5) * 0.15 + (Math.cos(t * 0.4) * 0.1);
                this.neckBone.rotation.z += Math.cos(t * 0.8) * 0.2;
            }
        }
        
        // Track Player Speed for Behavioral Analysis
        if (!this.lastPlayerPos && playerPos) this.lastPlayerPos = playerPos.clone();
        let playerSpeed = 0;
        if (playerPos) {
            playerSpeed = playerPos.distanceTo(this.lastPlayerPos) / Math.max(0.016, delta);
            this.lastPlayerPos.copy(playerPos);
        }
        
        let isInteracting = false;
        
        // Flee Logic vs Trust Logic
        if (playerPos) {
            const distToPlayer = this.horse.position.distanceTo(playerPos);
            
            // Continuous Habituation Physics
            if (distToPlayer < 35.0) {
                if (playerSpeed > 5.0) {
                    this.trust -= 40 * delta; 
                } else if (playerSpeed < 1.0) {
                    this.trust += 10 * delta;
                } else {
                    this.trust += 2 * delta;
                }
            } else {
                if (this.trust > 0) this.trust -= 1.5 * delta; 
            }
            this.trust = Math.max(0, Math.min(100, this.trust));

            // Dynamic Player Approach Reaction
            if (distToPlayer < 12.0 && this.state !== 'celebrate') { // Ignore trust for the walk-away narrative
                if (this.state !== 'retreating') {
                    this.state = 'retreating';
                    this.playAction('walk');
                    if (this.actions.walk) this.actions.walk.setEffectiveTimeScale(1.0); // Slow walk away
                    
                    // Maintain a 15-meter buffer from the player
                    const awayDir = new THREE.Vector3().subVectors(this.horse.position, playerPos).normalize();
                    awayDir.y = 0;
                    this.target.copy(this.horse.position).addScaledVector(awayDir, 15.0);
                }
                isInteracting = true; // Overrides idle wander
            } else if (this.state === 'retreating' && distToPlayer > 18.0) {
                // Return home when player has left
                this.state = 'returning_home';
                this.playAction('walk');
                if (this.actions.walk) this.actions.walk.setEffectiveTimeScale(1.0);
                
                // Return to anchor point (-3, 5) near Yellow Butterfly
                this.target.set(-3.0, this.getGroundY(-3.0, 5.0), 5.0);
                isInteracting = true;
            } else if (distToPlayer < 20.0 && this.trust > 60) {
                if (this.state !== 'observing' && this.state !== 'retreating' && this.state !== 'returning_home' && this.state !== 'celebrate') {
                    // Turn to watch player!
                    this.state = 'observing';
                    
                    const currentQuat = this.horse.quaternion.clone();
                    const lookTgt = playerPos.clone();
                    lookTgt.y = this.horse.position.y;
                    this.horse.lookAt(lookTgt);
                    const targetQuat = this.horse.quaternion.clone();
                    this.horse.quaternion.copy(currentQuat);
                    this.horse.quaternion.slerp(targetQuat, 2.5 * delta);
                    
                    this.playAction('idle');
                }
                if (this.state === 'observing') isInteracting = true; 
            }
        }
        
        // Nature Spirit Event Reaction Hook
        if (window.natureSpiritSystem && 
           (window.natureSpiritSystem.state === 'walking_out' || window.natureSpiritSystem.state === 'turning_away') && 
           !this.celebrated) {
            this.celebrated = true;
            this.state = 'celebrate';
            this.timer = 12.0; // Play and jump for 12 seconds while it walks away
            
            // Re-bind greeting animations on the fly if needed
            if (this.mixer) {
                 const jump = this.mixer._actions.map(a => a._clip).find(c => c.name.toLowerCase().includes('jump') || c.name.toLowerCase().includes('kick')) 
                               || this.actions.walk.getClip();
                 this.actions.celebrate = this.mixer.clipAction(jump);
                 if(this.actions.celebrate !== this.actions.walk) this.actions.celebrate.setEffectiveTimeScale(1.2);
            }
            this.playAction('celebrate');
        }
        
        if (this.state === 'celebrate') {
            isInteracting = true;
            this.timer -= delta;
            if (window._yellowButterflyNPC) {
                // Horse playfully faces YB while jumping
                const currentQuat = this.horse.quaternion.clone();
                this.horse.lookAt(window._yellowButterflyNPC.position);
                const targetQuat = this.horse.quaternion.clone();
                this.horse.quaternion.copy(currentQuat);
                this.horse.quaternion.slerp(targetQuat, 2.5 * delta);
                
                // YB turns back to watch and greet the horse enthusiastically while the spirit departs
                const ybCurrent = window._yellowButterflyNPC.quaternion.clone();
                const targetPosition = this.horse.position.clone();
                targetPosition.y = window._yellowButterflyNPC.position.y;
                window._yellowButterflyNPC.lookAt(targetPosition);
                const ybTarget = window._yellowButterflyNPC.quaternion.clone();
                window._yellowButterflyNPC.quaternion.copy(ybCurrent);
                window._yellowButterflyNPC.quaternion.slerp(ybTarget, 2.5 * delta);
            }
            if (this.timer <= 0) {
                this.state = 'interact'; // Fall back to calm interaction
            }
        }
        
        // Movement loop
        if (this.state === 'fleeing' || this.state === 'retreating' || this.state === 'returning_home') {
            const dir = new THREE.Vector3().subVectors(this.target, this.horse.position);
            dir.y = 0;
            if (dir.length() > 1.5) {
                dir.normalize();
                const lookTgt = this.horse.position.clone().add(dir);
                const currentQuat = this.horse.quaternion.clone();
                this.horse.lookAt(lookTgt);
                const targetQuat = this.horse.quaternion.clone();
                this.horse.quaternion.copy(currentQuat);
                
                // Turn smoother when retreating, faster when fleeing
                const turnSpeed = this.state === 'fleeing' ? 3.5 : 1.5;
                this.horse.quaternion.slerp(targetQuat, turnSpeed * delta);
                
                // Move slower when retreating/returning
                const moveSpeed = this.state === 'fleeing' ? 9.0 : 2.5;
                this.horse.position.addScaledVector(dir, moveSpeed * delta);
                this.horse.position.y = this.getGroundY(this.horse.position.x, this.horse.position.z);
            } else {
                if (this.state === 'retreating') {
                    // Reached buffer distance, turn back softly to watch player while waiting
                    this.state = 'observing';
                    this.playAction('idle');
                } else {
                    this.state = 'interact'; // Returning home sets back to interact hook
                }
            }
        }
        // Interaction Check with Yellow Butterfly (Checks globals directly since they load asynchronously)
        if (!isInteracting && this.state !== 'fleeing' && this.state !== 'observing') {
            this.timer -= delta;
            
            if (this.state === 'interact') {
                // Execute active looking at Butterfly
                if (window._yellowButterflyNPC) {
                    const currentQuat = this.horse.quaternion.clone();
                    this.horse.lookAt(window._yellowButterflyNPC.position);
                    const targetQuat = this.horse.quaternion.clone();
                    this.horse.quaternion.copy(currentQuat);
                    this.horse.quaternion.slerp(targetQuat, 2.5 * delta);
                }
                
                // After interacting, randomly walk around and graze
                if (this.timer <= 0) {
                    this.state = 'walk';
                    this.playAction('walk');
                    const rx = this.horse.position.x + (Math.random() - 0.5) * 6.0;
                    const rz = this.horse.position.z + (Math.random() - 0.5) * 6.0;
                    this.target.set(rx, 0, rz);
                }
            } else if (this.state === 'graze') {
                if (this.timer <= 0) {
                    // Come back to face yellow butterfly
                    this.state = 'return';
                    this.playAction('walk');
                    if (window._yellowButterflyNPC) {
                        // Pick a target looking at butterfly 2.5m away
                        const toButter = new THREE.Vector3().subVectors(this.horse.position, window._yellowButterflyNPC.position).normalize();
                        this.target.copy(window._yellowButterflyNPC.position).addScaledVector(toButter, 2.5);
                    } else {
                        this.target.copy(this.horse.position); // Wait if absent
                    }
                }
            }

            const isMoving = (this.state === 'walk' || this.state === 'return');
            if (isMoving) {
                const dir = new THREE.Vector3().subVectors(this.target, this.horse.position);
                dir.y = 0;
                
                // Check if target is reached
                if (dir.length() < 1.0) {
                    if (this.state === 'return') {
                        this.state = 'interact';
                        this.playAction('idle');
                        this.timer = 4.0 + Math.random() * 4.0;
                    } else {
                        // Standard walk reached target -> START GRAZING
                        this.state = 'graze';
                        this.playAction('idle');
                        this.timer = 3.0 + Math.random() * 2.5; // Stay grazing for a short while, then move again
                    }
                } else {
                    dir.normalize();
                    let speed = (this.state === 'flee') ? 9.0 : 1.5; // Very fast flee
                    
                    // SMART PATHING: Dynamic Vector Repulsion Avoidance to curve around obstacles
                    
                    // 1. Tipi Avoidance (Tipi is at 0,0 radius 3.2)
                    const distToTipi = Math.hypot(this.horse.position.x, this.horse.position.z);
                    if (distToTipi < 6.0) {
                        // Push outward away from 0,0
                        const repulse = new THREE.Vector3(this.horse.position.x, 0, this.horse.position.z).normalize();
                        // Cross product to slide along the surface
                        dir.addScaledVector(repulse, 2.0).normalize();
                    }
                    
                    // 2. Continual Yellow Butterfly Avoidance (Smart Pathing)
                    if (window._yellowButterflyNPC) {
                        const npcDist = this.horse.position.distanceTo(window._yellowButterflyNPC.position);
                        // Repel safely if entering her strict 1.5m personal physics bounds
                        if (npcDist < 1.5) {
                            const repulse = new THREE.Vector3().subVectors(this.horse.position, window._yellowButterflyNPC.position).normalize();
                            repulse.y = 0;
                            dir.addScaledVector(repulse, 2.5).normalize();
                        }
                    }

                    // Strict LookAt Rule Disabled: Horse should face where it walks
                    const lookTgt = this.horse.position.clone().add(dir);
                    lookTgt.y = this.horse.position.y;
                    
                    // Turn softly gently while moving
                    const currentQuat = this.horse.quaternion.clone();
                    this.horse.lookAt(lookTgt);
                    const targetQuat = this.horse.quaternion.clone();
                    this.horse.quaternion.copy(currentQuat);
                    this.horse.quaternion.slerp(targetQuat, 3.5 * delta);
                    
                    // Apply movement
                    const nextPos = this.horse.position.clone().addScaledVector(dir, speed * delta);
                    
                    // Fallback Hard-Collision Check
                    let blocked = false;
                    if (this.state !== 'flee' && window._yellowButterflyNPC && nextPos.distanceTo(window._yellowButterflyNPC.position) < 2.0) blocked = true;
                    if (Math.hypot(nextPos.x, nextPos.z) < 3.2) blocked = true;
                    
                    if (!blocked) {
                        this.horse.position.copy(nextPos);
                        this.horse.position.y = this.getGroundY(this.horse.position.x, this.horse.position.z);
                    } else {
                        // Force an artificial slide tangent if directly pinned against invisible wall
                        this.target.x += (Math.random() - 0.5) * 20.0;
                        this.target.z += (Math.random() - 0.5) * 20.0;
                    }
                }
            }
        }
    }

    playAction(name) {
        if (!this.actions[name]) return;
        
        // Prevent walking-in-place glitch if GLTF lacks a dedicated idle track
        if (name === 'idle' && this.actions.idle && this.actions.walk && this.actions.idle.getClip() === this.actions.walk.getClip()) {
            this.actions[name].setEffectiveTimeScale(0.001); // Freeze legs
        } else if (name === 'walk') {
            this.actions[name].setEffectiveTimeScale(this.state === 'retreating' ? 0.7 : 1.0); 
        }

        if (this.currentAction !== this.actions[name]) {
            for (let key in this.actions) {
                 if (this.actions[key] && key !== name) {
                      this.actions[key].fadeOut(0.3); // Kill overlapping actions completely
                 }
            }
            this.actions[name].reset();
            this.actions[name].setEffectiveWeight(1.0);
            this.actions[name].play();
            if (this.currentAction) {
                this.actions[name].crossFadeFrom(this.currentAction, 0.3, true);
            }
            this.currentAction = this.actions[name];
        }
    }
};

/**
 * BirdSystem.js
 * =====================
 * Manages ambient avian wildlife including high-altitude hawks
 * and low-poly flocking systems.
 */

window.BirdSystem = class BirdSystem {
    constructor(scene) {
        this.scene = scene;
        this.solitaryBirds = [];
        this.flocks = [];
        this.loader = new window.GLTFLoader();
        this.clock = new THREE.Clock();
        this.mixers = [];
        
        // Configuration
        this.hawkRadius = 25.0;
        this.hawkHeight = 18.0;
        this.hawkSpeed = 0.4;
        
        // Flock Logic
        this.flockInterval = 300.0; // 5 minutes
        this.flockTimer = 295.0; // Spawn shortly after load
        
        this.init();
    }

    async init() {
        this.loader.load('Assets/Bird.glb', (gltf) => {
            this.birdTemplate = gltf;
            
            // 1. Instantiate the Lone Hawk (Solitary)
            const hawk = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(gltf.scene) : gltf.scene.clone();
            hawk.scale.set(0.6, 0.6, 0.6);
            
            hawk.traverse(c => {
                if (c.isMesh) {
                    c.material = c.material.clone();
                    c.material.color.setHex(0x3e2723); 
                    c.castShadow = true;
                }
            });

            const mixer = new THREE.AnimationMixer(hawk);
            if (gltf.animations.length > 0) mixer.clipAction(gltf.animations[0]).play();
            this.mixers.push(mixer);

            const hawkData = {
                mesh: hawk,
                mixer: mixer,
                angle: Math.random() * Math.PI * 2,
                radius: this.hawkRadius,
                speed: this.hawkSpeed,
                height: this.hawkHeight,
                type: 'hawk',
                phase: Math.random() * 100
            };
            
            this.solitaryBirds.push(hawkData);
            this.scene.add(hawk);
            
            console.log("[BirdSystem] Solitary Hawk initialized.");
        }, undefined, (err) => {
            console.warn("[BirdSystem] Bird.glb missing. Using procedural fallback.");
            this.createProceduralBird();
        });
    }

    spawnGeeseFlock() {
        if (!this.birdTemplate) return;
        
        const flockGroup = new THREE.Group();
        const gooseCount = 7; // V-formation (1 lead, 3 on each side)
        const spread = 2.5;
        const altitude = 45.0; // High altitude geese
        
        for (let i = 0; i < gooseCount; i++) {
            const goose = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(this.birdTemplate.scene) : this.birdTemplate.scene.clone();
            goose.scale.set(0.4, 0.4, 0.4);
            
            // Positioning in V-shape
            const row = Math.floor((i + 1) / 2);
            const side = (i % 2 === 0) ? 1 : -1;
            if (i === 0) {
                goose.position.set(0, 0, 0); // Lead bird
            } else {
                goose.position.set(side * row * spread, 0, -row * spread);
            }

            const mixer = new THREE.AnimationMixer(goose);
            if (this.birdTemplate.animations.length > 0) {
                const action = mixer.clipAction(this.birdTemplate.animations[0]);
                action.time = Math.random() * 2.0; // Desync flapping
                action.play();
            }
            this.mixers.push(mixer);
            flockGroup.add(goose);
        }

        // Start flock outside world bounds
        const startX = -150;
        const startZ = (Math.random() - 0.5) * 100;
        flockGroup.position.set(startX, altitude, startZ);
        flockGroup.lookAt(150, altitude, startZ); // Fly across
        
        this.flocks.push({
            group: flockGroup,
            velocity: new THREE.Vector3(12.0, 0, 0), // Fly East at speed 12
            life: 30.0 // 30 seconds to cross
        });
        
        this.scene.add(flockGroup);
        console.log("[BirdSystem] High altitude geese flock spawned.");
    }

    createProceduralBird() {
        const group = new THREE.Group();
        const wingGeo = new THREE.BoxGeometry(0.8, 0.05, 0.3);
        wingGeo.translate(0.4, 0, 0);
        const mat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const leftWing = new THREE.Mesh(wingGeo, mat);
        const rightWing = new THREE.Mesh(wingGeo, mat);
        rightWing.rotation.y = Math.PI;
        group.add(leftWing, rightWing);
        group.scale.set(0.5, 0.5, 0.5);
        
        const hawkData = {
            mesh: group,
            leftWing: leftWing,
            rightWing: rightWing,
            angle: Math.random() * Math.PI * 2,
            radius: this.hawkRadius,
            speed: this.hawkSpeed,
            height: this.hawkHeight,
            type: 'hawk',
            phase: Math.random() * 100
        };
        this.solitaryBirds.push(hawkData);
        this.scene.add(group);
    }

    update(delta, params = {}) {
        const time = this.clock.getElapsedTime();

        // 1. Update Mixers
        this.mixers.forEach(m => m.update(delta));

        // 2. Update Hawk (Circular Path)
        this.solitaryBirds.forEach(bird => {
            bird.angle += bird.speed * delta;
            const activeRadius = bird.radius + Math.sin(time * 0.4 + bird.phase) * 6.0;
            const activeHeight = bird.height + Math.cos(time * 0.25 + bird.phase) * 3.5;
            
            const px = Math.cos(bird.angle) * activeRadius;
            const pz = Math.sin(bird.angle) * activeRadius;
            const futureAngle = bird.angle + 0.15;
            const futureRadius = bird.radius + Math.sin((time + 0.5) * 0.4 + bird.phase) * 6.0;
            const fx = Math.cos(futureAngle) * futureRadius;
            const fz = Math.sin(futureAngle) * futureRadius;
            
            bird.mesh.position.set(px, activeHeight, pz);
            bird.mesh.lookAt(fx, activeHeight, fz);
            bird.mesh.rotateY(Math.PI); 

            if (bird.leftWing) {
                const flap = Math.sin(time * 5.0 + bird.phase);
                bird.leftWing.rotation.z = flap * 0.4;
                bird.rightWing.rotation.z = -flap * 0.4;
            }
        });

        // 3. Update Flocks (Linear Path)
        for (let i = this.flocks.length - 1; i >= 0; i--) {
            const flock = this.flocks[i];
            flock.group.position.addScaledVector(flock.velocity, delta);
            flock.life -= delta;
            if (flock.life <= 0) {
                this.scene.remove(flock.group);
                this.flocks.splice(i, 1);
            }
        }

        // 4. Spawn Logic
        this.flockTimer += delta;
        if (this.flockTimer >= this.flockInterval) {
            this.flockTimer = 0;
            this.spawnGeeseFlock();
        }
    }
};
};

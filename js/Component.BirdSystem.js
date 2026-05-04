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
        this.loader = new window.GLTFLoader();
        this.clock = new THREE.Clock();
        
        // Configuration
        this.hawkRadius = 25.0;
        this.hawkHeight = 18.0;
        this.hawkSpeed = 0.4;
        
        this.init();
    }

    async init() {
        // Load the bird asset from legacy archive path
        this.loader.load('Assets/Bird.glb', (gltf) => {
            // 1. Instantiate the Lone Hawk (Solitary)
            const hawk = gltf.scene;
            hawk.scale.set(0.6, 0.6, 0.6);
            
            // Apply a darker, more predatory material to the Hawk
            hawk.traverse(c => {
                if (c.isMesh) {
                    c.material = c.material.clone();
                    c.material.color.setHex(0x3e2723); // Dark brown hawk
                    c.castShadow = true;
                }
            });

            const hawkData = {
                mesh: hawk,
                angle: Math.random() * Math.PI * 2,
                radius: this.hawkRadius,
                speed: this.hawkSpeed,
                height: this.hawkHeight,
                type: 'hawk',
                phase: Math.random() * 100
            };
            
            this.solitaryBirds.push(hawkData);
            this.scene.add(hawk);
            
            console.log("[BirdSystem] Solitary Hawk initialized in the sky.");
        }, undefined, (err) => {
            console.warn("[BirdSystem] Bird.glb not found at Assets/Bird.glb. Falling back to procedural wings.");
            this.createProceduralBird();
        });
    }

    createProceduralBird() {
        // Simple low-poly fallback if GLB is missing
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

    update(delta) {
        const time = this.clock.getElapsedTime();

        this.solitaryBirds.forEach(bird => {
            // 1. Circular Pathing
            bird.angle += bird.speed * delta;
            
            // Add a slight "soaring" wobble to the radius and height
            const activeRadius = bird.radius + Math.sin(time * 0.5 + bird.phase) * 5.0;
            const activeHeight = bird.height + Math.cos(time * 0.3 + bird.phase) * 2.0;
            
            const px = Math.cos(bird.angle) * activeRadius;
            const pz = Math.sin(bird.angle) * activeRadius;
            
            // 2. Physics-Based Orientation (Always look ahead)
            // We calculate a future point on the path to derive the look-at vector
            const futureAngle = bird.angle + 0.1;
            const fx = Math.cos(futureAngle) * activeRadius;
            const fz = Math.sin(futureAngle) * activeRadius;
            
            bird.mesh.position.set(px, activeHeight, pz);
            bird.mesh.lookAt(fx, activeHeight, fz);
            bird.mesh.rotateY(Math.PI); // Correct model orientation for backward-facing legacy assets
            
            // 3. Wing Flapping (Procedural)
            // Hawks soar mostly, so we flap slowly and intermittently
            const flap = Math.sin(time * 4.0 + bird.phase);
            if (bird.leftWing) {
                bird.leftWing.rotation.z = flap * 0.5;
                bird.rightWing.rotation.z = -flap * 0.5;
            } else {
                // If it's a GLB, we might have animations or we just tilt the body
                bird.mesh.rotation.z = Math.sin(time * 2.0) * 0.1; // Soaring tilt
            }
        });
    }
};

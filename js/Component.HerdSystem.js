/**
 * HerdSystem.js
 * =====================
 * Manages large grazing animals like Buffalo and Horses.
 * Features: Grazing, wandering, and player-proximity fleeing.
 * Registered with MasterNPCAI for unified awareness.
 */

window.HerdSystem = class HerdSystem {
    constructor(scene, getGroundY) {
        this.scene = scene;
        this.getGroundY = getGroundY;
        this.animals = [];
        this.loader = new window.GLTFLoader();
        
        this.STATES = {
            GRAZING: 'grazing',
            WANDERING: 'wandering',
            FLEEING: 'fleeing'
        };

        this.init();
    }

    init() {
        // Load Buffalo
        this.loader.load('Assets/Buffalo.glb', (gltf) => {
            this.spawnHerd(gltf, 'Buffalo', 5, new THREE.Vector3(0, 0, -50), 12.0);
        });

        // Load Horse
        this.loader.load('Assets/Horse.glb', (gltf) => {
            this.spawnHerd(gltf, 'Horse', 4, new THREE.Vector3(-50, 0, 0), 8.0);
        });
    }

    spawnHerd(gltf, type, count, center, radius) {
        const animations = gltf.animations;
        
        for (let i = 0; i < count; i++) {
            const model = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(gltf.scene) : gltf.scene.clone();
            const scale = (type === 'Buffalo') ? 1.5 : 1.2;
            model.scale.set(scale, scale, scale);
            
            const x = center.x + (Math.random() - 0.5) * radius * 2;
            const z = center.z + (Math.random() - 0.5) * radius * 2;
            const y = typeof this.getGroundY === 'function' ? this.getGroundY(x, z) : 0;
            
            model.position.set(x, y, z);
            model.rotation.y = Math.random() * Math.PI * 2;
            
            const mixer = new THREE.AnimationMixer(model);
            const actions = {};
            animations.forEach(clip => {
                const name = clip.name.toLowerCase();
                if (name.includes('idle') || name.includes('eat') || name.includes('graze')) actions.idle = mixer.clipAction(clip);
                else if (name.includes('walk')) actions.walk = mixer.clipAction(clip);
                else if (name.includes('run') || name.includes('gallop')) actions.run = mixer.clipAction(clip);
            });

            if (actions.idle) actions.idle.play();

            const animal = {
                mesh: model,
                mixer: mixer,
                actions: actions,
                type: type,
                state: this.STATES.GRAZING,
                timer: 5.0 + Math.random() * 10.0,
                targetPos: new THREE.Vector3(x, y, z),
                homeCenter: center.clone(),
                homeRadius: radius
            };

            this.animals.push(animal);
            this.scene.add(model);
        }
        console.log(`[HerdSystem] Spawned ${count} ${type}s.`);
    }

    update(delta, params = {}) {
        const { playerPos = null } = params || {};

        this.animals.forEach(a => {
            if (a.mixer) a.mixer.update(delta);

            const distToPlayer = playerPos ? a.mesh.position.distanceTo(playerPos) : 999;

            // 1. Fleeing Logic
            if (distToPlayer < 10.0 && a.state !== this.STATES.FLEEING) {
                a.state = this.STATES.FLEEING;
                if (playerPos) {
                    const fleeDir = new THREE.Vector3().subVectors(a.mesh.position, playerPos).normalize();
                    a.targetPos.copy(a.mesh.position).addScaledVector(fleeDir, 15.0);
                }
                if (a.actions.idle) a.actions.idle.stop();
                if (a.actions.run) a.actions.run.play();
                else if (a.actions.walk) a.actions.walk.play();
            }

            // 2. State Machine
            a.timer -= delta;
            
            if (a.state === this.STATES.GRAZING) {
                if (a.timer <= 0) {
                    a.state = this.STATES.WANDERING;
                    a.timer = 5.0 + Math.random() * 5.0;
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * a.homeRadius;
                    a.targetPos.set(a.homeCenter.x + Math.cos(angle) * dist, 0, a.homeCenter.z + Math.sin(angle) * dist);
                    if (a.actions.idle) a.actions.idle.stop();
                    if (a.actions.walk) a.actions.walk.play();
                }
            } else if (a.state === this.STATES.WANDERING || a.state === this.STATES.FLEEING) {
                const moveSpeed = (a.state === this.STATES.FLEEING) ? 8.0 : 2.0;
                const dx = a.targetPos.x - a.mesh.position.x;
                const dz = a.targetPos.z - a.mesh.position.z;
                const dist = Math.sqrt(dx*dx + dz*dz);

                if (dist < 0.5 || (a.state === this.STATES.FLEEING && distToPlayer > 20.0)) {
                    a.state = this.STATES.GRAZING;
                    a.timer = 10.0 + Math.random() * 10.0;
                    if (a.actions.walk) a.actions.walk.stop();
                    if (a.actions.run) a.actions.run.stop();
                    if (a.actions.idle) a.actions.idle.play();
                } else {
                    const vx = (dx / dist) * moveSpeed * delta;
                    const vz = (dz / dist) * moveSpeed * delta;
                    a.mesh.position.x += vx;
                    a.mesh.position.z += vz;
                    if (this.getGroundY) a.mesh.position.y = this.getGroundY(a.mesh.position.x, a.mesh.position.z);
                    
                    const targetAngle = Math.atan2(dx, dz);
                    let diff = targetAngle - a.mesh.rotation.y;
                    while(diff < -Math.PI) diff += Math.PI * 2;
                    while(diff > Math.PI) diff -= Math.PI * 2;
                    a.mesh.rotation.y += diff * 4 * delta;
                }
            }
        });
    }
};

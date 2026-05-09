import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { System } from './System.js';
import { TransformComponent, MeshComponent, AnimationComponent, InteractableComponent } from './components/Components.js';
import { Bus } from './EventBus.js';

export class EntitySystem extends System {
    constructor(scene) {
        super();
        this.scene = scene;
        this.gltfLoader = new GLTFLoader();
        this.objLoader = new OBJLoader();
        
        // Listen to ground height requests
        this.groundHeightCache = {};
        Bus.subscribe('GROUND_HEIGHT_RESOLVED', (data) => {
            this.groundHeightCache[`${data.x},${data.z}`] = data.y;
            this.resolvePendingEntities(data.x, data.z, data.y);
        });
        
        this.pendingGroundEntities = [];
        
        // Track player for proximity
        this.currentPlayerPos = new THREE.Vector3();
        Bus.subscribe('PLAYER_MOVED', (data) => {
            this.currentPlayerPos.set(data.x, data.y, data.z);
        });
    }

    spawn(entity, config) {
        this.addEntity(entity);
        
        // Setup initial transform
        const transform = new TransformComponent(config.position[0], config.position[1], config.position[2]);
        if (config.rotation) {
            transform.rotation.set(config.rotation[0], config.rotation[1], config.rotation[2]);
        }
        entity.addComponent(transform);
        
        // Interaction Rules
        if (config.interaction) {
            entity.addComponent(new InteractableComponent(config.interaction));
        }

        // Load Model
        if (config.modelPath) {
            this.loadModel(entity, config);
        }
    }

    loadModel(entity, config) {
        const transform = entity.getComponent(TransformComponent);
        const isGltf = config.modelPath.endsWith('.glb') || config.modelPath.endsWith('.gltf');
        
        const onLoad = (modelBase) => {
            const model = isGltf ? modelBase.scene : modelBase;
            
            // Scaling logic
            if (config.scaleToHeight) {
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const sf = config.scaleToHeight / Math.max(size.y, 0.1);
                model.scale.set(sf, sf, sf);
            } else if (config.scale) {
                model.scale.set(config.scale, config.scale, config.scale);
            }
            
            // Shadows and Colors
            model.traverse(child => {
                if (child.isMesh) {
                    if (!config.disableShadows) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                    if (config.colorTint) {
                        child.material = child.material.clone();
                        child.material.color.setHex(config.colorTint);
                    }
                }
            });
            
            // Animations
            if (isGltf && modelBase.animations && modelBase.animations.length > 0) {
                const animComp = new AnimationComponent();
                animComp.mixer = new THREE.AnimationMixer(model);
                
                modelBase.animations.forEach(clip => {
                    if (config.stripPositionalAnim) {
                        clip.tracks = clip.tracks.filter(track => !track.name.includes('.position'));
                    }
                    animComp.actions[clip.name.toLowerCase()] = animComp.mixer.clipAction(clip);
                });
                
                const idleClip = modelBase.animations.find(a => a.name.toLowerCase().includes('idle')) || modelBase.animations[0];
                animComp.activeAction = animComp.actions[idleClip.name.toLowerCase()];
                if (animComp.activeAction) animComp.activeAction.play();
                
                entity.addComponent(animComp);
            }
            
            // Interactable visual attachments
            const interactable = entity.getComponent(InteractableComponent);
            if (interactable) {
                if (interactable.hasBloom) {
                    const blGeo = new THREE.SphereGeometry(1.2, 8, 8);
                    const blMat = new THREE.MeshBasicMaterial({ 
                        color: 0xfffbcc, transparent: true, opacity: 0.6, 
                        blending: THREE.AdditiveBlending, depthWrite: false 
                    });
                    interactable.bloomLight = new THREE.Mesh(blGeo, blMat);
                    model.add(interactable.bloomLight);
                    interactable.bloomLight.position.set(0, 1.5, 0);
                }
                if (interactable.hasBalloon) {
                    const bGeo = new THREE.SphereGeometry(0.3, 16, 16);
                    const bMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.2, metalness: 0.8 });
                    interactable.balloonMesh = new THREE.Mesh(bGeo, bMat);
                    model.add(interactable.balloonMesh);
                    interactable.balloonMesh.position.set(0, 3.5, 0); // Above head
                }
            }

            // Sync initial transform
            model.position.copy(transform.position);
            model.rotation.copy(transform.rotation);
            
            // Drop to ground capability
            if (config.snapToGround) {
                this.requestGroundSnap(entity, model);
            } else {
                this.scene.add(model);
            }
            
            entity.addComponent(new MeshComponent(model));
        };
        
        if (isGltf) {
            this.gltfLoader.load(config.modelPath, onLoad);
        } else {
            this.objLoader.load(config.modelPath, onLoad);
        }
    }
    
    requestGroundSnap(entity, model) {
        const transform = entity.getComponent(TransformComponent);
        const cacheKey = `${transform.position.x},${transform.position.z}`;
        
        if (this.groundHeightCache[cacheKey] !== undefined) {
            transform.position.y = this.groundHeightCache[cacheKey];
            model.position.y = transform.position.y;
            this.scene.add(model);
        } else {
            this.pendingGroundEntities.push({ entity, model, x: transform.position.x, z: transform.position.z });
            Bus.dispatch('REQUEST_GROUND_HEIGHT', { x: transform.position.x, z: transform.position.z });
        }
    }
    
    resolvePendingEntities(x, z, y) {
        for (let i = this.pendingGroundEntities.length - 1; i >= 0; i--) {
            const pending = this.pendingGroundEntities[i];
            if (pending.x === x && pending.z === z) {
                const transform = pending.entity.getComponent(TransformComponent);
                transform.position.y = y;
                pending.model.position.y = y;
                this.scene.add(pending.model);
                this.pendingGroundEntities.splice(i, 1);
            }
        }
    }

    update(deltaTime) {
        this.entities.forEach(entity => {
            if (!entity.isActive) return;
            
            const animComp = entity.getComponent(AnimationComponent);
            if (animComp) animComp.update(deltaTime);
            
            const transform = entity.getComponent(TransformComponent);
            const meshComp = entity.getComponent(MeshComponent);
            
            // Sync physics/logic transform to rendering mesh
            if (transform && meshComp && meshComp.mesh) {
                meshComp.mesh.position.copy(transform.position);
                meshComp.mesh.rotation.copy(transform.rotation);
                
                const interactable = entity.getComponent(InteractableComponent);
                if (interactable) {
                    const dist = transform.position.distanceTo(this.currentPlayerPos);
                    
                    // Balloon floating
                    if (interactable.balloonMesh) {
                        interactable.balloonMesh.position.y = 3.5 + Math.sin(Date.now() * 0.002) * 0.2;
                    }
                    
                    if (dist < interactable.proximityDist && !interactable.isTriggered) {
                        interactable.isTriggered = true;
                        
                        // Switch animation
                        if (animComp && animComp.actions[interactable.animOnProximity]) {
                            const newAction = animComp.actions[interactable.animOnProximity];
                            newAction.reset().play();
                            if (animComp.activeAction) newAction.crossFadeFrom(animComp.activeAction, 0.5, false);
                            animComp.activeAction = newAction;
                        }
                    } else if (dist >= interactable.proximityDist + 1.0 && interactable.isTriggered) {
                        interactable.isTriggered = false;
                        
                        // Back to idle
                        if (animComp && animComp.actions[interactable.idleActionId]) {
                            const idleAction = animComp.actions[interactable.idleActionId];
                            idleAction.reset().play();
                            if (animComp.activeAction) idleAction.crossFadeFrom(animComp.activeAction, 0.5, false);
                            animComp.activeAction = idleAction;
                        }
                    }
                    
                    // Face player
                    if (interactable.facePlayer && dist < interactable.proximityDist * 2) {
                        // Math.atan2 for looking at player
                        const dx = this.currentPlayerPos.x - transform.position.x;
                        const dz = this.currentPlayerPos.z - transform.position.z;
                        const targetAngle = Math.atan2(dx, dz);
                        
                        // Smoothly interpolate rotation.y to targetAngle
                        // Note: Depending on model standard orientation, might need Math.PI offset.
                        let currentAngle = transform.rotation.y;
                        
                        // Normalize angles for shortest rotation 
                        let _diff = targetAngle - currentAngle;
                        while (_diff < -Math.PI) _diff += Math.PI * 2;
                        while (_diff > Math.PI) _diff -= Math.PI * 2;
                        
                        transform.rotation.y += _diff * 0.05; // 0.05 is slerp speed
                    }
                }
            }
        });
    }
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class PlayerManager {
    constructor(scene, renderPipeline) {
        this.scene = scene;
        this.renderPipeline = renderPipeline;
        
        // Input state
        this.keys = {
            w: false, a: false, s: false, d: false,
            arrowup: false, arrowdown: false, arrowleft: false, arrowright: false
        };
        
        // Settings
        this.SPEED = 5.0;
        this.TURN_SPEED = 2.0;
        this.PLAYER_HEIGHT = 1.67; // 5.5 feet
        this.walkCycle = 0; // For head bobbing
        
        // Map Avatar (Layer 1 only for ortho camera)
        this.mapAvatar = this.createMapAvatar();
        this.scene.add(this.mapAvatar);
        
        // Animation states
        this.mixer = null;
        this.idleAction = null;
        this.walkAction = null;
        this.isWalking = false;

        this.loadAvatar();
        
        // Allocate vectors once
        this.dir = new THREE.Vector3();
        this.right = new THREE.Vector3();
        this.up = new THREE.Vector3(0, 1, 0);
        
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
    }

    createMapAvatar() {
        // High visibility cone pointer
        const geo = new THREE.ConeGeometry(0.8, 2.0, 16);
        geo.rotateX(Math.PI / 2); // Point along +Z (or -Z) so it matches FPV looking forward
        
        const mat = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00, 
            depthWrite: false, 
            depthTest: false 
        });
        
        const avatar = new THREE.Mesh(geo, mat);
        avatar.renderOrder = 9999;
        
        // Ensure it's only visible on Layer 1 (Ortho View)
        avatar.layers.enable(1);
        avatar.layers.disable(0);
        
        return avatar;
    }

    loadAvatar() {
        // Avatar is now exclusively bootstrapped, rigidly scaled, and animated by EngineMain to prevent redundant mesh clashing and z-fighting.
        // We simply wait for the engine to initialize it globally.
        const checkReady = setInterval(() => {
            if (window._playerAvatar && window._playerAvatarMixer) {
                clearInterval(checkReady);
                
                // Remove fallback cone
                if (this.mapAvatar) {
                    this.scene.remove(this.mapAvatar);
                }
                
                // Bind locomotions natively
                this.mapAvatar = window._playerAvatar;
                this.mixer = window._playerAvatarMixer;
                this.idleAction = window._avIdleAction;
                this.walkAction = window._avWalkAction;
            }
        }, 100);
    }

    onKeyDown(e) {
        const key = e.key.toLowerCase();
        if (this.keys[key] !== undefined) {
            this.keys[key] = true;
        }
    }

    onKeyUp(e) {
        const key = e.key.toLowerCase();
        if (this.keys[key] !== undefined) {
            this.keys[key] = false;
        }
    }

    update(delta, getGroundY) {
        const camera = this.renderPipeline.fpvCamera;
        let isMoving = false;
        let turnAmount = 0;
        let moveAmount = 0;
        
        // 1. Keyboard Input Calculation
        if (this.keys.arrowleft || this.keys.a) { turnAmount += this.TURN_SPEED * delta; }
        if (this.keys.arrowright || this.keys.d) { turnAmount -= this.TURN_SPEED * delta; }
        if (this.keys.w || this.keys.arrowup) { moveAmount += this.SPEED * delta; }
        if (this.keys.s || this.keys.arrowdown) { moveAmount -= this.SPEED * delta; }
        
        // 2. Thumbstick Input Calculation (from Journal)
        const tx = window._thumbX || 0;
        const ty = window._thumbY || 0;
        if (Math.abs(tx) > 0.1) { turnAmount -= tx * this.TURN_SPEED * 1.5 * delta; }
        if (Math.abs(ty) > 0.1) { moveAmount -= ty * this.SPEED * delta; }
        
        // Apply Rotation
        if (Math.abs(turnAmount) > 0) {
            camera.rotation.y += turnAmount;
            isMoving = true;
        }
        
        // Apply Position
        if (Math.abs(moveAmount) > 0) {
            camera.getWorldDirection(this.dir);
            this.dir.y = 0;
            this.dir.normalize();
            
            camera.position.addScaledVector(this.dir, moveAmount);
            isMoving = true;
            
            // Broadcast for ECS proximity systems
            import('../core/EventBus.js').then(({ Bus }) => {
                 Bus.dispatch('PLAYER_MOVED', { x: camera.position.x, y: camera.position.y, z: camera.position.z });
            });
        }
        
        // Apply Head Bobbing and Animations
        if (isMoving) {
            this.walkCycle += delta * this.SPEED * 1.5;
            this.bobAmplitude = THREE.MathUtils.lerp(this.bobAmplitude || 0, 0.15, delta * 10);
            if (!this.isWalking) {
                this.isWalking = true;
                if (this.walkAction) {
                    this.walkAction.reset().play();
                    this.walkAction.crossFadeFrom(this.idleAction, 0.2, false);
                }
                this.notifyUI('walk');
            }
        } else {
            this.bobAmplitude = THREE.MathUtils.lerp(this.bobAmplitude || 0, 0, delta * 15);
            if (this.isWalking) {
                this.isWalking = false;
                if (this.walkAction) {
                    this.idleAction.reset().play();
                    this.idleAction.crossFadeFrom(this.walkAction, 0.2, false);
                }
                this.notifyUI('idle');
            }
        }
        
        if (this.mixer) this.mixer.update(delta);

        const bobbingOffset = Math.abs(Math.sin(this.walkCycle)) * (this.bobAmplitude || 0);
        
        // Lock to Terrain
        // Force the X/Z bounded within reasonable limits? Not right now.
        const expectedY = getGroundY(camera.position.x, camera.position.z);
        camera.position.y = expectedY + this.PLAYER_HEIGHT + bobbingOffset;
        
        // Map Avatar FPV sync is exclusively handled by EngineMain's native frame hook.
        if (this.renderPipeline.orthoCamera) {
            this.renderPipeline.orthoCamera.position.x = camera.position.x;
            this.renderPipeline.orthoCamera.position.z = camera.position.z + 10; // Animal Crossing offset
            this.renderPipeline.orthoCamera.position.y = expectedY + 25; // Adjusted height
        }
    }

    notifyUI(animationState) {
        const panel = document.getElementById('panel-frame');
        if (panel && panel.contentWindow) {
            panel.contentWindow.postMessage({ type: 'AVATAR_ANIM_CHANGE', status: animationState }, '*');
        }
    }
}

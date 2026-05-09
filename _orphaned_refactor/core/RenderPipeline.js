import * as THREE from 'three';
import { Bus } from './EventBus.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

export class RenderPipeline {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.isVillageView = false; // False = FPV is main, True = Orthographic TopDown is main
        
        // Render layers
        this.MAIN_LAYER = 0;
        this.PIP_LAYER = 1;

        // Pip Logic handled natively via scissor testing

        // 1. FPV Perspective Camera
        this.fpvCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.fpvCamera.position.set(0, 1.67, 15); // Start off exactly at player eye level (5.5ft)
        this.fpvCamera.lookAt(0, 1.67, 0); // Look towards the tipi

        // 2. Top-Down Orthographic Camera (Village/PIP View)
        const frustumSize = 40; // Approx 40 feet view area
        // PIP is a perfect square, so aspect is 1.0 to avoid stretching
        this.orthoCamera = new THREE.OrthographicCamera(
            frustumSize / - 2,
            frustumSize / 2,
            frustumSize / 2,
            frustumSize / - 2,
            1,
            1000
        );
        // Position offset backward and looking down at an angle (Animal Crossing style)
        this.orthoCamera.position.set(0, 35, 15);
        this.orthoCamera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 3); // 60 degrees down
        
        // Native WebGL Corner Masking (Perfectly crops the Square WebGL into a Circle via Z-Buffer!)
        const maskGeo = new THREE.RingGeometry(frustumSize * 0.48, frustumSize * 1.5, 32);
        const maskMat = new THREE.MeshBasicMaterial({ 
            colorWrite: false, // Do not draw black, leave the FPV pixels alone!
            depthWrite: true,  // Draw Z to block the PIP village pixels
            depthTest: false   // Always pass
        }); 
        this.webGLCircularMask = new THREE.Mesh(maskGeo, maskMat);
        this.webGLCircularMask.position.set(0, 0, -2);
        this.webGLCircularMask.renderOrder = -9999; // Ensure it draws before village
        this.webGLCircularMask.visible = false;     // Only active during PIP rendering
        this.orthoCamera.add(this.webGLCircularMask);
        this.orthoCamera.layers.enable(1); // See the player's topdown avatar
        this.scene.add(this.orthoCamera); // Must be in scene for child meshes to render

        this.activeMainCamera = this.fpvCamera;
        this.activePipCamera = this.orthoCamera;

        this.setupPostProcessing();
    }

    setupPostProcessing() {
        const renderScene = new RenderPass(this.scene, this.fpvCamera);
        
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(renderScene);

        // 2. High-Fidelity Depth of Field (Shift-Tilt / Macro)
        this.bokehPass = new BokehPass(this.scene, this.fpvCamera, {
            focus: 10.0,
            aperture: 0.0001,
            maxblur: 0.005,
            width: window.innerWidth,
            height: window.innerHeight
        });
        this.composer.addPass(this.bokehPass);
        
        // 3. Immersive Vignette Shader
        const vignetteShader = {
            uniforms: {
                "tDiffuse": { value: null },
                "color": { value: new THREE.Color(0x050510) },     // Very faint dark blue
                "tipiScreenPos": { value: new THREE.Vector2(-9, -9) }, // Hide by default
                "tipiScreenRadius": { value: 0.15 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform vec3 color;
                uniform vec2 tipiScreenPos;
                uniform float tipiScreenRadius;
                varying vec2 vUv;
                
                void main() {
                    vec4 texel = texture2D(tDiffuse, vUv);
                    
                    // Distance from exact center screen
                    vec2 center = vec2(0.5, 0.5);
                    float dist = distance(vUv, center);
                    // Start fading edge out at 0.5 dist, max dark at 1.0
                    float vignette = smoothstep(0.5, 1.2, dist);
                    
                    // Tipi Mask (pierce the vignette so the bright tipi shines through)
                    float tipiDist = distance(vUv, tipiScreenPos);
                    float tipiMask = smoothstep(tipiScreenRadius * 0.5, tipiScreenRadius, tipiDist);
                    
                    // Mix base image with vignette darkness multiplier (not pitch black)
                    texel.rgb = mix(texel.rgb, texel.rgb * 0.3 + color * 0.1, vignette * tipiMask);
                    
                    gl_FragColor = texel;
                }
            `
        };
        
        this.humanEyePass = new ShaderPass(vignetteShader);
        this.composer.addPass(this.humanEyePass);
    }

    handleResize() {
        const aspect = window.innerWidth / window.innerHeight;
        
        this.fpvCamera.aspect = aspect;
        this.fpvCamera.updateProjectionMatrix();

        // OrthoCamera strictly maintains 1.0 aspect to prevent the compass view from stretching
        const frustumSize = 40;
        this.orthoCamera.left = frustumSize / - 2;
        this.orthoCamera.right = frustumSize / 2;
        this.orthoCamera.top = frustumSize / 2;
        this.orthoCamera.bottom = frustumSize / - 2;
        this.orthoCamera.updateProjectionMatrix();
    }

    toggleViewMode() {
        this.isVillageView = !this.isVillageView;
        if (this.isVillageView) {
            this.activeMainCamera = this.orthoCamera;
            this.activePipCamera = this.fpvCamera;
        } else {
            this.activeMainCamera = this.fpvCamera;
            this.activePipCamera = this.orthoCamera;
        }
        Bus.dispatch('VIEW_MODE_CHANGED', { isVillageView: this.isVillageView });
    }

    render() {
        // Render Main View
        this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        this.renderer.setScissorTest(false);
        this.renderer.clear();
        
        if (this.composer && this.activeMainCamera === this.fpvCamera) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.activeMainCamera);
        }

        // Calculate PiP dimensions from fully dynamic CSS DOM element
        const pipContainer = document.getElementById('pip-container');
        if (pipContainer && !pipContainer.classList.contains('hidden')) {
            const rect = pipContainer.getBoundingClientRect();
            // WebGL Y is from bottom
            const y = window.innerHeight - rect.bottom;
            
            // 1. Temporarily disable autoClear so we don't nuke the FPV pixels in the Scissor square corners
            const autoClear = this.renderer.autoClear;
            this.renderer.autoClear = false;
            
            // 2. Clear ONLY depth to slice out a fresh Z-buffer window for the PIP rendering
            this.renderer.clearDepth();
            
            // 3. Enable the PiP masking ring (only works on ortho currently)
            if (this.webGLCircularMask && this.activePipCamera === this.orthoCamera) {
                this.webGLCircularMask.visible = true;
            }

            // 4. Render PIP natively using Scissor
            this.renderer.setViewport(rect.left, y, rect.width, rect.height);
            this.renderer.setScissor(rect.left, y, rect.width, rect.height);
            this.renderer.setScissorTest(true);
            this.renderer.render(this.scene, this.activePipCamera);
            
            // 5. Clean up state
            if (this.webGLCircularMask) this.webGLCircularMask.visible = false;
            this.renderer.setScissorTest(false);
            this.renderer.autoClear = autoClear;
        }
    }

    // DEPRECATED: Sub-canvas rendering was a catastrophic frame killer.
    // 15 FPS lost natively reading pixels block-by-block. 
    drawPipToCanvas() {
        return; 
    }
}

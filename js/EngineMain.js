        window._DEBUG_MIDNIGHT = true; // SET TO FALSE TO SYNC DAY/NIGHT WITH YOUR REAL WORLD COMPUTER TIME!

        console.log("TRACE 1: Module parsing started");
        import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
        import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
        import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

        import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
        import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
        import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
        import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
        import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

        let scene,
            camera,
            renderer;
        let clock,
            controls;

        let player = {
            x: 0, z: 0, rot: 0, speed: 0, dy: 0
        }

            ;

        const keys = {
            w: false, a: false, s: false, d: false,
            arrowup: false, arrowdown: false, arrowleft: false, arrowright: false
        };

        let headBobTimer = 0;
        let frameCount = 0;

        ;
        let axeRenderer,
            pipCamera, _pipRenderTarget, _pipQuad, _pipPostScene, _pipPostCam;
        let tipiRenderer,
            tipiOrthoCam, axePipCam, _tipiRenderTarget, _tipiQuad, _tipiPostScene; // Native UI Camera Pipline
        let gameTime = 8.0; // 8 AM start
        let sunLight;
        let rabbitSystem = null;
        let birdSystem = null;
        let deerSystem = null;
        let squirrelSystem = null;
        let fuzzyBrain;
        let humanEyePass;
        let opticalMask; // The Early-Z Discard Mask
        // Globals needed by extracted modules
        window.tipiObj = null;
        window.handleActionClick = (actionType) => {
            if (event) event.stopPropagation(); // Prevent main canvas click-to-move

            if (actionType === "autowalk") {
                if (window.uiManager && window.uiManager.showCenterBubble) {
                    window.uiManager.showCenterBubble("Starting expedition...", 2000);
                }
                // Close the full-map and trigger a procedural walk event
                window.postMessage({ type: 'TOGGLE_VIEW_MODE' }, '*');
                setTimeout(() => {
                    const targetTree = window.allTrees[Math.floor(Math.random() * window.allTrees.length)];
                    if (targetTree) {
                        window.postMessage({ type: 'MOVE_COMMAND', point: targetTree.position }, '*');
                    }
                }, 500);
            } else if (actionType === "wood") {
                if (window.uiManager && window.uiManager.showCenterBubble) {
                    window.uiManager.showCenterBubble("You search the forest for loose wood...", 3000);
                }
                // Direct gathering command sequence
                window.postMessage({ type: 'TOGGLE_VIEW_MODE' }, '*');
                setTimeout(() => {
                    window.postMessage({ type: 'GATHER_ACTION', target: 'wood' }, '*');
                }, 500);
            } else if (actionType === "wildlife") {
                if (window.uiManager && window.uiManager.showCenterBubble) {
                    window.uiManager.showCenterBubble("You pause quietly to observe the forest spirits.", 4000);
                }
            }
        };
        const PIP_SIZE = 1024;
        let assetFactory;
        const vegData = { bushes: [], trees: [] };

        console.log("TRACE 2: Module variables declared");

        function init() {
            // Unify tracking of progressive events
            window.SacredState = window.SacredState || { questLevel: 0 };

            // 1. SCENE
            scene = new THREE.Scene();

            // 2. CAMERA
            camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(0, 1.7, 5);
            // MASKING: FPV Camera exclusively sees Layer 0 (Environment). 
            // Layer 1 is reserved strictly for player models to prevent the camera from clipping inside its own head.
            camera.layers.disable(1);
            window.camera = camera;
            window.allTrees = allTrees;
            window.swayTrees = swayTrees;

            // --- PLAYER AVATAR INJECTION (Map View Visible) ---
            const gltfLoader = window.GLTFLoader ? new window.GLTFLoader() : new THREE.GLTFLoader();
            // Switch to the fully rigged animated GLB
            gltfLoader.load('Assets/animated.avatar.glb', (gltf) => {
                const avatar = gltf.scene;
                // Move entire avatar asset securely into Layer 1 (Ghost to FPV, Visible to Minimap)
                avatar.traverse(child => {
                    if (child.isMesh) {
                        child.layers.set(1);
                        child.castShadow = true;
                    }
                });

                // Fix scale to rigidly match `BringsHappinessGirl` 1.1x height
                avatar.scale.set(1.1, 1.1, 1.1);

                // Attach pure black PIP directional marker (ghosted to Layer 1)
                const playerMarker = new THREE.Group();
                // Submerge group to ground level so it acts as a floor base!
                playerMarker.position.y = 0.02;
                
                // Raised platform, half radius (0.85 * 0.5 = 0.425)
                const pMarkerGeo = new THREE.CylinderGeometry(0.425, 0.425, 0.25, 32);
                const pMarkerMat = new THREE.MeshPhongMaterial({ color: 0x000000, emissive: 0x222222, shininess: 10 });
                const baseMesh = new THREE.Mesh(pMarkerGeo, pMarkerMat);
                baseMesh.position.y = 0.125; // half thickness
                baseMesh.layers.set(1);
                playerMarker.add(baseMesh);

                // Add brilliant white border around player platform
                const borderGeo = new THREE.TorusGeometry(0.425, 0.04, 16, 48);
                const borderMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
                const borderMesh = new THREE.Mesh(borderGeo, borderMat);
                borderMesh.rotation.x = Math.PI / 2;
                borderMesh.position.y = 0.25; // Rim height
                borderMesh.layers.set(1);
                playerMarker.add(borderMesh);

                // Attach directional wedge pointing natively to Forward (Player Avatar faces -Z by default mentally but is rotated Math.PI so it faces +Z globally)
                const arrowGeo = new THREE.CylinderGeometry(0, 0.25, 0.6, 3);
                const arrowMat = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 }); // PURE WHITE contrast
                const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
                // Flip arrow 180 degrees so it points physically toward the direction the avatar acts
                arrowMesh.rotation.x = Math.PI / 2; // Lie flat, flipped
                // Pierce it aggressively out the absolute FRONT of the player's physical orientation
                arrowMesh.position.set(0, 0.2, 0.6); 
                arrowMesh.layers.set(1);
                
                playerMarker.add(arrowMesh);
                avatar.add(playerMarker);

                // Boot up the native skeletal animation cycle
                if (gltf.animations && gltf.animations.length > 0) {
                    window._playerAvatarMixer = new THREE.AnimationMixer(avatar);
                    
                    // Convention: [0] Tpose, [1] Walk, [2] Idle, [3] Wait
                    window._avIdleClip = gltf.animations.length > 2 ? gltf.animations[2] : gltf.animations[0];
                    window._avWalkClip = gltf.animations.length > 1 ? gltf.animations[1] : null;
                    window._avWaveClip = gltf.animations.length > 3 ? gltf.animations[3] : null;

                    if (window._avIdleClip) {
                        window._avIdleAction = window._playerAvatarMixer.clipAction(window._avIdleClip);
                        window._avIdleAction.play();
                    }
                    if (window._avWalkClip) {
                        window._avWalkAction = window._playerAvatarMixer.clipAction(window._avWalkClip);
                        window._avWalkAction.play();
                        window._avWalkAction.setEffectiveWeight(0);
                    }
                    if (window._avWaveClip) {
                        window._avWaveAction = window._playerAvatarMixer.clipAction(window._avWaveClip);
                    }
                    
                    window._avIsWalking = false;
                }

                window._playerAvatar = avatar;
                scene.add(avatar);
            });

            // 3. RENDERER (Retro Toy-Diorama Fidelity)
            renderer = new THREE.WebGLRenderer({
                antialias: false, // Intentional pixelation for softer toy look
                powerPreference: 'high-performance'
            });
            renderer.setSize(window.innerWidth, window.innerHeight);
            // Native Device Pixel Ratio (FuzzyBrain now handles dynamic down-sampling on fps drops)
            // Prevent Mac Retina limits from defaulting to 2.0x+ and melting the GPU fill-rate.
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0)); // Cap at 1.0 for stable 60 FPS
            renderer.shadowMap.enabled = false;
            // renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.toneMapping = THREE.LinearToneMapping; // Clean, natural tones
            renderer.toneMappingExposure = 1.0;
            document.getElementById('canvas-container').appendChild(renderer.domElement);

            // 4. LOADING MANAGER
            THREE.DefaultLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
                const textEl = document.querySelector('.loading-text');
                const subTextEl = document.querySelector('.loading-subtext');
                const percent = Math.round((itemsLoaded / itemsTotal) * 100);

                // Do not override explicit generation text if we are in the procedural building phase
                if (!window._isGeneratingWorld) {
                    if (textEl) textEl.innerText = `Welcome... ${percent}%`;
                }

                if (subTextEl) {
                    const filename = url.split('/').pop().split('?')[0];
                    subTextEl.innerText = `Downloading: ${filename} (${itemsLoaded}/${itemsTotal})`;
                }
            };

            window._assetDownloadsComplete = false;
            window._worldGenerationComplete = false;

            function checkReadyToStart() {
                if (window._assetDownloadsComplete && window._worldGenerationComplete) {
                    const ld = document.getElementById('loading');
                    if (ld && !ld.dataset.ready) {
                        ld.dataset.ready = 'true';
                        const textEl = document.querySelector('.loading-text');
                        const subTextEl = document.querySelector('.loading-subtext');
                        if (subTextEl) subTextEl.style.display = 'none';

                        // Explicit Pre-compile step to eliminate 1st-frame stutter
                        if (textEl) {
                            textEl.innerText = `Pre-Processing Rendering Engine...`;
                            textEl.style.animation = 'none';
                        }

                        setTimeout(() => {
                            // Force GPU to compile all materials right now
                            renderer.compile(scene, camera);

                            if (window.startBirdsong) window.startBirdsong();

                            if (textEl) {
                                textEl.innerText = `Sacred Grove Ready`;
                                setTimeout(() => {
                                    ld.style.pointerEvents = 'none';
                                    ld.style.opacity = 0;
                                    const bg = document.getElementById('bg-video');
                                    if (bg) { bg.style.transition = 'opacity 2s ease'; bg.style.opacity = 0; setTimeout(() => bg.remove(), 2500); }
                                    setTimeout(() => ld.remove(), 2000); // 2 second CSS transition
                                }, 800);
                            } else {
                                ld.style.pointerEvents = 'none';
                                ld.style.opacity = 0;
                                const bg = document.getElementById('bg-video');
                                if (bg) { bg.style.transition = 'opacity 2s ease'; bg.style.opacity = 0; setTimeout(() => bg.remove(), 2500); }
                                setTimeout(() => ld.remove(), 2000); // Fallback
                            }
                        }, 50); // Small 50ms delay to ensure the DOM paints "Pre-Processing..."
                    }
                }
            }

            THREE.DefaultLoadingManager.onLoad = () => {
                window._assetDownloadsComplete = true;
                checkReadyToStart();
            };

            assetFactory = new AssetFactoryNextGen(THREE.DefaultLoadingManager);

            // 5 & 6. LIGHTING & ENVIRONMENT
            window.envBuilder = new EnvironmentBuilder(scene);
            window.envBuilder.setupLighting();
            window.envBuilder.setupEnvironment();

            // --- PATHFINDING VISUALS ---
            const pathLineMat = new THREE.LineDashedMaterial({ color: 0xffd700, linewidth: 3, dashSize: 0.5, gapSize: 0.25 });
            const pathLineGeo = new THREE.BufferGeometry();
            pathLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
            window._pathLine = new THREE.Line(pathLineGeo, pathLineMat);
            window._pathLine.computeLineDistances();
            window._pathLine.visible = false;
            scene.add(window._pathLine);

            const targetRingGeo = new THREE.RingGeometry(0.5, 0.6, 32);
            const targetRingMat = new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide });
            window._targetRing = new THREE.Mesh(targetRingGeo, targetRingMat);
            window._targetRing.rotation.x = -Math.PI / 2;
            window._targetRing.visible = false;
            scene.add(window._targetRing);

            window._isGeneratingWorld = true;
            window.envBuilder.generateWorld(assetFactory).then(() => {
                console.log('World generated — linking FuzzyBrain');
                window._worldGenerationComplete = true;
                window._isGeneratingWorld = false;
                fuzzyBrain = new FuzzyBrain(renderer, null, scene);
                fuzzyBrain.linkCamera(camera);
                fuzzyBrain.linkSun(window.sunLight);
                fuzzyBrain.linkPIP(typeof axeRenderer !== 'undefined' ? axeRenderer : null, pipCamera);
                if (assetFactory && assetFactory.treeMeshes) {
                    fuzzyBrain.linkTrees(assetFactory.treeMeshes);
                }
                // Link creature systems to master AI
                if (window.rabbitSystem) {
                    window.rabbitSystem.linkFuzzyBrain(fuzzyBrain);
                    fuzzyBrain.linkCreatureSystem('rabbits', window.rabbitSystem);
                }
                checkReadyToStart();
            });

            // 8. POST PROCESSING
            setupPostProcessing();

            // 9. CONTROLS
            setupInput();

            // 10. NEW FEATURES
            setupPIP();
            setupLensflare();

            // 11. LOOP
            clock = new THREE.Clock();

            // FORCE REMOVE LOADING SCREEN (Now handled by DefaultLoadingManager.onLoad)

            requestAnimationFrame(animate);
        }

        // setupLighting extracted to EnvironmentBuilder.js

        // setupLensflare and setupOpticalMask extracted to Component.PostProcessing.js
        function setupPIP() {
            // PIP Renderer REMOVED: Replaced with Native WebGL Scissor Pipeline
            const wrapper = document.getElementById('moondial-wrapper');

            // AXE LOGBOOK RENDERER (CONSOLIDATED INTO MAIN RENDERER)
            window.axeCanvas2D = document.createElement('canvas');
            window.axeCtx = window.axeCanvas2D.getContext('2d', { alpha: true, willReadFrequently: true });
            window.axeCanvas2D.style.pointerEvents = 'none';
            // axeRenderer deleted to save WebGL context!

            // Animal Crossing Tilted Orthographic Map Camera
            const aspect = 1.0;
            // Far plane aggressively widened to 2000 for massive Top-Down views.
            pipCamera = new THREE.OrthographicCamera(-16, 16, 16, -16, 0.1, 2000);
            pipCamera.layers.enable(1); // Enable Layer 1 so we can see the FPV Avatar
            pipCamera.updateProjectionMatrix();

            // NATIVE CANVAS2D UI BLITTING PIPELINE (Replaces 3D Layer Masking Hack)
            window.pipCanvas2D = document.createElement('canvas');
            window.pipCanvas2D.width = PIP_SIZE;
            window.pipCanvas2D.height = PIP_SIZE;
            window.pipCtx = window.pipCanvas2D.getContext('2d', { alpha: true, willReadFrequently: true });
            wrapper.appendChild(window.pipCanvas2D);

            scene.add(pipCamera); // Add Camera to scene so its Mesh descendants evaluate during rendering

            // ----------------------------------------------------------------
            // TIPI HARDWARE OVERLAY (Secondary Renderer Pattern for Journal)
            // ----------------------------------------------------------------
            // TIPI HARDWARE OVERLAY (CONSOLIDATED INTO MAIN RENDERER)
            window.tipiCanvas2D = document.createElement('canvas');
            window.tipiCanvas2D.id = 'tipi-hardware-canvas';
            window.tipiCtx = window.tipiCanvas2D.getContext('2d', { alpha: true, willReadFrequently: true });
            window.tipiCanvas2D.style.position = 'absolute';
            window.tipiCanvas2D.style.zIndex = '10005';
            window.tipiCanvas2D.style.display = 'none';
            window.tipiCanvas2D.style.pointerEvents = 'none';
            window.tipiCanvas2D.style.borderRadius = '4px';
            window.tipiCanvas2D.style.filter = 'sepia(0.12) contrast(1.1)';
            document.body.appendChild(window.tipiCanvas2D);
            // tipiRenderer deleted to save WebGL context!

            // ----------------------------------------------------------------
            // AVATAR SIDE-PANEL PIP OVERLAY
            // ----------------------------------------------------------------
            window.avatarCanvas2D = document.createElement('canvas');
            window.avatarCtx = window.avatarCanvas2D.getContext('2d', { alpha: true, willReadFrequently: true });
            window.avatarOrthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
            window.avatarOrthoCam.layers.set(1); // Only render the Character Layer (1)

            // Zoomed in 50% more (3.5 bounds instead of 7)
            tipiOrthoCam = new THREE.OrthographicCamera(
                -3.5, 3.5, 3.5, -3.5, 0.1, 1000
            );
            tipiOrthoCam.position.set(0, 15, 15); // Above and angled down
            tipiOrthoCam.lookAt(0, 2.5, 0); // Looking at center to keep ground in frame

            axePipCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
            axePipCam.position.set(4.7, 1.8, 10.0);
            axePipCam.lookAt(0, 1.2, 0); // Vector math corrected! Now faces the exact center of the Tipi where the axe floats

            // Limit render layers to avoid drawing full map
            tipiOrthoCam.layers.set(0); // Tipi / Base layers
            axePipCam.layers.set(0);       // NATIVE WEBGLL RENDERTARGET SETUP (Replaces ES6 EffectComposer)
            _pipRenderTarget = new THREE.WebGLRenderTarget(PIP_SIZE, PIP_SIZE, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
            _tipiRenderTarget = new THREE.WebGLRenderTarget(256, 256, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });

            _pipPostCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
            _pipPostCam.position.z = 1; // Pull back so the Quad at Z=0 is not clipped by the near plane

            _pipPostScene = new THREE.Scene();
            const quadGeo = new THREE.PlaneGeometry(2, 2);
            _pipQuad = new THREE.Mesh(quadGeo, null); // material set dynamically
            _pipQuad.frustumCulled = false; // Never cull full-screen quads
            _pipPostScene.add(_pipQuad);

            _tipiPostScene = new THREE.Scene();
            _tipiQuad = new THREE.Mesh(quadGeo, null);
            _tipiQuad.frustumCulled = false;
            _tipiPostScene.add(_tipiQuad);

            const westernFilmShader = {
                uniforms: {
                    "tDiffuse": { value: null },
                    "time": { value: 0.0 }
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
                   uniform float time;
                   varying vec2 vUv;
                   
                   void main() {
                       vec4 color = texture2D(tDiffuse, vUv);
                       float r = color.r * 0.70 + color.g * 0.45 + color.b * 0.15;
                       float g = color.r * 0.45 + color.g * 0.55 + color.b * 0.15;
                       float b = color.r * 0.30 + color.g * 0.40 + color.b * 0.20;
                       color.rgb = mix(color.rgb, vec3(r, g, b), 0.5);

                       // Softened Vignette (No more pitch black occlusion)
                       float dist = distance(vUv, vec2(0.5));
                       float vignette = 1.0 - smoothstep(0.4, 1.3, dist);
                       color.rgb *= mix(1.0, vignette, 0.4);
                       
                       color.rgb = pow(color.rgb, vec3(0.60));
                       color.rgb *= 1.8;
                       
                       gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), 1.0);
                   }
                `
            };

            const vibrantMapShader = {
                uniforms: {
                    "tDiffuse": { value: null },
                    "time": { value: 0.0 }
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
                   uniform float time;
                   varying vec2 vUv;

                   void main() {
                       // Fast Toy Tilt Shift Blur (3-tap lightweight)
                       float blurAmt = abs(vUv.y - 0.5) * 0.04; 
                       vec4 color = texture2D(tDiffuse, vUv);
                       color += texture2D(tDiffuse, clamp(vUv + vec2(0.0, blurAmt), vec2(0.0), vec2(1.0)));
                       color += texture2D(tDiffuse, clamp(vUv - vec2(0.0, blurAmt), vec2(0.0), vec2(1.0)));
                       color *= 0.3333;

                       color.rgb = pow(color.rgb, vec3(0.40));
                       float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                       vec3 vibrant = mix(vec3(gray), color.rgb, 1.4); 

                       // Beautiful Soft Vignette
                       float dist = distance(vUv, vec2(0.5));
                       float vignette = 1.0 - smoothstep(0.3, 1.1, dist);

                       vec3 safeColor = clamp(vibrant * vignette, 0.0, 1.0);
                       gl_FragColor = vec4(safeColor, 1.0);
                   }
                `
            };

            const brightMapShader = {
                uniforms: {
                    "tDiffuse": { value: null },
                    "time": { value: 0.0 }
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
                   uniform float time;
                   varying vec2 vUv;

                   void main() {
                       // Fast Toy Tilt Shift Blur (3-tap lightweight)
                       float blurAmt = abs(vUv.y - 0.5) * 0.04; 
                       vec4 color = texture2D(tDiffuse, vUv);
                       color += texture2D(tDiffuse, clamp(vUv + vec2(0.0, blurAmt), vec2(0.0), vec2(1.0)));
                       color += texture2D(tDiffuse, clamp(vUv - vec2(0.0, blurAmt), vec2(0.0), vec2(1.0)));
                       color *= 0.3333;

                       color.rgb = pow(color.rgb, vec3(0.40));
                       float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                       vec3 vibrant = mix(vec3(gray), color.rgb, 1.4); 

                       // Light Toy Vignette
                       float dist = distance(vUv, vec2(0.5));
                       float vignette = 1.0 - smoothstep(0.4, 1.2, dist);

                       vec3 safeVibrant = clamp(vibrant * mix(1.0, vignette, 0.5), 0.0, 1.0);
                       gl_FragColor = vec4(safeVibrant, 1.0);
                   }
                `
            };

            // Build ShaderMaterials from our configs to use natively on hardware Quads
            const mapMat = new THREE.ShaderMaterial({ ...brightMapShader, uniforms: THREE.UniformsUtils.clone(brightMapShader.uniforms) });
            window._mapMat = mapMat;

            const pipMat = new THREE.ShaderMaterial({ ...vibrantMapShader, uniforms: THREE.UniformsUtils.clone(vibrantMapShader.uniforms) });
            window._pipMat = pipMat;

            const tipiMat = new THREE.ShaderMaterial({ ...westernFilmShader, uniforms: THREE.UniformsUtils.clone(westernFilmShader.uniforms) });
            window._tipiMat = tipiMat;
            _tipiQuad.material = tipiMat; // Tipi uses the Old Western shader permanently

            // Look down from angle
            pipCamera.position.set(20, 20, 20);
            pipCamera.lookAt(0, 0, 0);

            // PIP CLICK EVENTS: Forwarded to `wrapper` beneath

            // CLICK PIP TO SWAP MODES
            window._swapModes = false;
            wrapper.addEventListener('click', (event) => {
                event.stopPropagation();
                window._swapModes = !window._swapModes;
                console.log(`[PIP] Modes swapped: ${window._swapModes ? 'FPV in PIP, Map Main' : 'Map in PIP, FPV Main'} `);
                // Force recalculation of aspect ratios and swap the root camera variable
                window.dispatchEvent(new Event('resize'));
            });
        }

        // setupEnvironment extracted to EnvironmentBuilder.js
        // setupPostProcessing extracted to Component.PostProcessing.js

        const swayTrees = []; // Whole tree objects for wind sway
        const allTrees = []; // For gathering and interaction
        window.allTrees = allTrees; // Export for interaction
        window.inventory = { lumber: 0 };
        window._selectedTree = null;

        window.triggerYellowButterflyHeart = () => {
             if (window.ybSystem && window.ybSystem.actions.heart && window.ybSystem.currentBaseAction) {
                const sys = window.ybSystem;
                sys.actions.heart.reset().play();
                sys.actions.heart.crossFadeFrom(sys.currentBaseAction, 0.5, false);

                // -- FLASH BLOOM EFFECT --
                const flashLight = new THREE.PointLight(0xffddaa, 10.0, 15);
                flashLight.position.set(0, 1.5, 0);
                window._yellowButterflyNPC.add(flashLight);
                
                const flashGeo = new THREE.SphereGeometry(0.5, 32, 32);
                const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending });
                const flashSphere = new THREE.Mesh(flashGeo, flashMat);
                flashSphere.position.set(0, 1.5, 0);
                window._yellowButterflyNPC.add(flashSphere);
                
                let flashDecay = 1.0;
                const flashInterval = setInterval(() => {
                    flashDecay -= 0.05;
                    flashLight.intensity = 10.0 * flashDecay;
                    flashSphere.scale.setScalar(1.0 + (1.0 - flashDecay) * 5.0);
                    flashMat.opacity = flashDecay;
                    if (flashDecay <= 0) {
                        clearInterval(flashInterval);
                        window._yellowButterflyNPC.remove(flashLight);
                        window._yellowButterflyNPC.remove(flashSphere);
                        flashGeo.dispose();
                        flashMat.dispose();
                        flashLight.dispose();
                    }
                }, 50);

                setTimeout(() => {
                    if (sys.currentBaseAction) {
                        sys.currentBaseAction.reset().play();
                        sys.currentBaseAction.crossFadeFrom(sys.actions.heart, 0.5, false);
                    }
                }, 2500); 
            }
        };

        window.triggerConfettiCinematic = (targetMarker, targetGodray, targetPageIdx) => {
            window._isCinematic = true;

            const startLook = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
            // Default look upwards towards a balloon
            const endLook = targetMarker ? targetMarker.position.clone() : new THREE.Vector3(0, window._tipiPlatformY + 5.18, 15);

            let cinTime = 0;
            const cinDuration = 0.5;

            const turnCamera = (from, to, duration, onComplete) => {
                let t = 0;
                const loop = () => {
                    t += 0.016;
                    if (t < duration) {
                        const prog = t / duration;
                        const ease = prog * prog * (3 - 2 * prog);
                        const currentLook = new THREE.Vector3().lerpVectors(from, to, ease);
                        camera.lookAt(currentLook);
                        requestAnimationFrame(loop);
                    } else {
                        camera.lookAt(to);
                        onComplete();
                    }
                };
                loop();
            };

            // Phase 1: Look Up
            turnCamera(startLook, endLook, 0.7, () => {
                // Phase 2: Fade Gold Ray & Explode Confetti
                if (targetMarker) targetMarker.visible = false;
                if (targetGodray) {
                    let gTime = 0;
                    const fadeRay = () => {
                        gTime += 0.016;
                        const pt = gTime / 2.0;
                        if (pt < 1.0) {
                            targetGodray.position.y -= 0.2;
                            targetGodray.material.opacity = 0.08 * (1.0 - pt);
                            requestAnimationFrame(fadeRay);
                        } else {
                            targetGodray.visible = false;
                        }
                    };
                    fadeRay();
                }

                // Physics Confetti
                const confettiCount = 150;
                const cGeo = new THREE.BoxGeometry(0.06, 0.08, 0.005);
                const cMat = new THREE.MeshPhongMaterial({ shininess: 150, specular: 0xffffff, side: THREE.DoubleSide });
                const burst = new THREE.InstancedMesh(cGeo, cMat, confettiCount);
                const dummy = new THREE.Object3D();
                const cColor = new THREE.Color();
                const colors = [0xffffff, 0xffd700, 0xfad02c, 0xfcee73];

                const cVel = [];
                const cRotVel = [];
                const burstCenter = endLook.clone().add(new THREE.Vector3(0, 1.0, 0));

                for (let i = 0; i < confettiCount; i++) {
                    dummy.position.copy(burstCenter);
                    dummy.position.add(new THREE.Vector3((Math.random()-0.5)*0.8, (Math.random()-0.5)*0.8, (Math.random()-0.5)*0.8));
                    dummy.scale.set(1.0, 1.0 + Math.random() * 1.5, 1.0);
                    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                    dummy.updateMatrix();
                    burst.setMatrixAt(i, dummy.matrix);
                    cColor.setHex(colors[Math.floor(Math.random() * colors.length)]);
                    burst.setColorAt(i, cColor);
                    cVel.push(new THREE.Vector3((Math.random() - 0.5) * 4.5, (Math.random() - 0.1) * 4.5, (Math.random() - 0.5) * 4.5));
                    cRotVel.push(new THREE.Vector3((Math.random() - 0.5) * 20.0, (Math.random() - 0.5) * 20.0, (Math.random() - 0.5) * 20.0));
                }
                burst.instanceMatrix.needsUpdate = true;
                if (burst.instanceColor) burst.instanceColor.needsUpdate = true;
                scene.add(burst);

                // Phase 3: Wait 0.8s observing explosion, then look back down
                setTimeout(() => {
                    const downLook = window._yellowButterflyNPC ? window._yellowButterflyNPC.position.clone() : startLook;
                    downLook.y += 1.5; // Look at head height
                    
                    turnCamera(endLook, downLook, 0.8, () => {
                        // Phase 4: Heart Animation + Flash Bloom
                        if (window.triggerYellowButterflyHeart) window.triggerYellowButterflyHeart();
                        
                        // Phase 5: Re-open Logbook to specific page 1.5s later
                        setTimeout(() => {
                            window._isCinematic = false;
                            
                            // Activate Quest 2 Floating Balloon
                            if (window._questMarker2) window._questMarker2.visible = true;
                            
                            const panelFrame = document.getElementById('panel-frame');
                            if (panelFrame && panelFrame.contentWindow) {
                                panelFrame.contentWindow.postMessage({ type: 'FORCE_OPEN_JOURNAL' }, '*');
                                panelFrame.contentWindow.postMessage({ type: 'SYNC_LOGBOOK_PAGE', pageIdx: targetPageIdx }, '*');
                            }
                        }, 1500);
                    });
                }, 800);

                // Confetti Physics Loop (Run completely detached)
                let pTime = 0;
                const animBurst = () => {
                    pTime += 0.016;
                    if (pTime < 4.5) {
                        for (let i = 0; i < confettiCount; i++) {
                            burst.getMatrixAt(i, dummy.matrix);
                            dummy.position.setFromMatrixPosition(dummy.matrix);
                            dummy.rotation.setFromRotationMatrix(dummy.matrix);
                            dummy.scale.setFromMatrixScale(dummy.matrix);

                            cVel[i].x += Math.sin(pTime * 2.5 + i) * 0.05;
                            cVel[i].z += Math.cos(pTime * 2.0 + i) * 0.05;
                            dummy.position.addScaledVector(cVel[i], 0.016);
                            cVel[i].y -= 0.8 * 0.016;
                            cVel[i].x *= 0.92;
                            cVel[i].z *= 0.92;
                            if (cVel[i].y < -0.6) cVel[i].y = -0.6; // Ground friction

                            dummy.rotation.x += cRotVel[i].x * 0.016;
                            dummy.rotation.y += cRotVel[i].y * 0.016;
                            dummy.rotation.z += cRotVel[i].z * 0.016;

                            dummy.updateMatrix();
                            burst.setMatrixAt(i, dummy.matrix);
                        }
                        burst.instanceMatrix.needsUpdate = true;
                        if (pTime > 3.0) {
                            burst.material.transparent = true;
                            burst.material.opacity = (4.5 - pTime) / 1.5;
                        }
                        requestAnimationFrame(animBurst);
                    } else {
                        scene.remove(burst);
                        burst.dispose();
                        cGeo.dispose();
                        cMat.dispose();
                    }
                };
                animBurst();
            });
        };

        function setupInput() {
            // --- PANEL MESSAGE LISTENER (receives from iframe) ---
            window.addEventListener('message', (event) => {
                const msg = event.data;
                if (!msg || !msg.type) return;

                if (msg.type === 'KEY_FORWARD') {
                    const key = msg.key;
                    if (msg.eventType === 'keydown') {
                        keys[key] = true;
                    } else if (msg.eventType === 'keyup') {
                        keys[key] = false;
                    }
                }

                if (msg.type === 'GLOW_SIDEBAR_GATHER') {
                    const gatherBtn = document.querySelector('.action-btn[data-action="wood"]');
                    if (gatherBtn) {
                        gatherBtn.classList.add('bloom-glow');
                    }
                }

                if (msg.type === 'REQ_CHOP_NEAREST_TREE') {
                    const gatherBtn = document.querySelector('.action-btn[data-action="wood"]');
                    if (gatherBtn) gatherBtn.classList.remove('bloom-glow');

                    if (!window._hasGottenAxe) {
                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) panel.contentWindow.postMessage({ type: 'SHOW_LOG', msg: 'You need an axe to chop wood.' }, '*');
                        return;
                    }
                    if (window._choppingTimer > 0) return; // Already chopping
                    if (!window._treeInstancedMeshes || window._treeInstancedMeshes.length === 0) return;

                    let closestInstance = null;
                    let closestDist = Infinity;
                    let closestPos = new THREE.Vector3();
                    let targetInstancedMesh = null;

                    const camPos = camera.position;
                    // FWD vector to prioritize trees somewhat in front of the player
                    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                    const dummy = new THREE.Matrix4();
                    const wp = new THREE.Vector3();

                    window._treeInstancedMeshes.forEach(({ instancedMesh }) => {
                        for (let i = 0; i < instancedMesh.count; i++) {
                            instancedMesh.getMatrixAt(i, dummy);
                            wp.setFromMatrixPosition(dummy);
                            if (wp.y < -100) continue; // Unused instance

                            const dist = wp.distanceTo(camPos);
                            const dirToTree = new THREE.Vector3().subVectors(wp, camPos).normalize();
                            const dot = fwd.dot(dirToTree);

                            // Highly prioritize trees directly in front
                            const score = dist - (dot * 2.0);

                            if (dot > 0.0 && score < closestDist) {
                                closestDist = score;
                                closestInstance = i;
                                targetInstancedMesh = instancedMesh;
                                closestPos.copy(wp);
                            }
                        }
                    });

                    if (closestInstance !== null) {
                        // Ensure Logbook Closes
                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) panel.contentWindow.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*');

                        // Highlight target tree visually
                        if (window._treeHighlightBox) scene.remove(window._treeHighlightBox);
                        const bGeo = new THREE.BoxGeometry(2.0, 10.0, 2.0);
                        const bMat = new THREE.LineBasicMaterial({ color: 0x22c55e, linewidth: 2, transparent: true, opacity: 0.7 });
                        const edges = new THREE.EdgesGeometry(bGeo);
                        window._treeHighlightBox = new THREE.LineSegments(edges, bMat);
                        window._treeHighlightBox.position.set(closestPos.x, closestPos.y + 5, closestPos.z);
                        scene.add(window._treeHighlightBox);

                        // Auto-remove highlight when chop action typically fully resolves
                        setTimeout(() => {
                            if (window._treeHighlightBox && window._treeHighlightBox.parent) {
                                scene.remove(window._treeHighlightBox);
                                window._treeHighlightBox = null;
                            }
                        }, 2500);

                        const actualDist = closestPos.distanceTo(camera.position);

                        if (actualDist <= 6.0) {
                            window._lookTarget = new THREE.Vector3(closestPos.x, camera.position.y, closestPos.z);
                            window._chopTargetInstanceId = closestInstance;
                            window._chopTargetMesh = targetInstancedMesh;
                            window._choppingTimer = 1.6;
                        } else {
                            const dir = new THREE.Vector3().subVectors(camPos, closestPos).normalize();
                            const walkDest = closestPos.clone().add(dir.multiplyScalar(3.0));
                            walkDest.y = camera.position.y;

                            window._moveTarget = walkDest;
                            window._lookTarget = closestPos;

                            const checkArrival = setInterval(() => {
                                if (!window._moveTarget) {
                                    clearInterval(checkArrival);
                                    if (closestPos.distanceTo(camera.position) <= 6.5) {
                                        window._chopTargetInstanceId = closestInstance;
                                        window._chopTargetMesh = targetInstancedMesh;
                                        window._choppingTimer = 1.6;
                                    }
                                }
                            }, 100);
                        }
                    } else {
                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) panel.contentWindow.postMessage({ type: 'SHOW_LOG', msg: 'No trees directly in front of you.' }, '*');
                    }
                }

                if (msg.type === 'FIND_HER_AUTOWALK' || msg.type === 'REQ_FIND_HER_AUTOWALK') {
                    // STANDALONE CINEMATIC LOOP: 1. Turn to face girl. 2. Walk forward. 3. Face her straight-on, she waves.
                    window._isCinematic = true;
                    // Reset legacy flags preventing cross-contamination
                    window._moveTarget = null;
                    window._lookTarget = null;
                    window._activeLookTarget = null;

                    // Walk target is near the girl (bhgGroup at 12, Y, 12)
                    const targetLookX = 12;
                    const targetLookZ = 12;
                    const walkTarget = new THREE.Vector3(12, 0, 8); // Stop a few units in front of her

                    let phase = 'turn';
                    const cinematicWalk = () => {
                        if (!window._isCinematic) {
                            window._isCinematicWalking = false;
                            return; // Cancel if intervened
                        }

                        if (phase === 'turn') {
                            const dx = targetLookX - camera.position.x;
                            const dz = targetLookZ - camera.position.z;
                            const targetAngle = Math.atan2(dx, dz) + Math.PI;

                            let angleDiff = targetAngle - camera.rotation.y;
                            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                            if (Math.abs(angleDiff) > 0.02) {
                                camera.rotation.y += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), 0.05);
                                requestAnimationFrame(cinematicWalk);
                            } else {
                                phase = 'walk';
                                window._isCinematicWalking = true;
                                requestAnimationFrame(cinematicWalk);
                            }
                            return;
                        }

                        if (phase === 'walk') {
                            const wdx = walkTarget.x - camera.position.x;
                            const wdz = walkTarget.z - camera.position.z;
                            const walkingDist = Math.sqrt(wdx * wdx + wdz * wdz);

                            if (walkingDist > 1.5) {
                                const _dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                                _dir.y = 0;
                                _dir.normalize();
                                camera.position.addScaledVector(_dir, 0.12); // Cinematic walk speed
                                requestAnimationFrame(cinematicWalk);
                            } else {
                                window._isCinematicWalking = false;
                                phase = 'faceGirl';
                                requestAnimationFrame(cinematicWalk);
                            }
                            return;
                        }

                        if (phase === 'faceGirl') {
                            // Face the girl straight on
                            const girlPos = new THREE.Vector3();
                            if (window._bhgCharacterMesh) {
                                window._bhgCharacterMesh.getWorldPosition(girlPos);
                            } else if (window._bhgGroup) {
                                girlPos.copy(window._bhgGroup.position);
                            } else {
                                girlPos.set(12, 0, 12);
                            }

                            const dx = girlPos.x - camera.position.x;
                            const dz = girlPos.z - camera.position.z;
                            const targetAngle = Math.atan2(dx, dz) + Math.PI;

                            let angleDiff = targetAngle - camera.rotation.y;
                            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                            if (Math.abs(angleDiff) > 0.02) {
                                camera.rotation.y += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), 0.04);
                                requestAnimationFrame(cinematicWalk);
                            } else {
                                // Camera is now facing girl — trigger her wave
                                if (window._bhgWaveAction && window._bhgIdleAction && window.bhgMixer) {
                                    // Make sure idle is playing first
                                    window._bhgIdleAction.reset().play();

                                    // After a brief idle pause, wave at camera
                                    setTimeout(() => {
                                        window._bhgWaveAction.reset();
                                        window._bhgWaveAction.play();
                                        window._bhgWaveAction.crossFadeFrom(window._bhgIdleAction, 0.5, false);

                                        // When wave finishes, restore idle and complete quest
                                        const onWaveFinish = (e) => {
                                            if (e.action === window._bhgWaveAction) {
                                                window._bhgIdleAction.reset().play();
                                                window._bhgIdleAction.crossFadeFrom(window._bhgWaveAction, 0.5, false);
                                                window.bhgMixer.removeEventListener('finished', onWaveFinish);
                                                finishFindHer();
                                            }
                                        };
                                        window.bhgMixer.addEventListener('finished', onWaveFinish);
                                    }, 800); // 0.8s idle pause before waving
                                } else {
                                    // No wave animation available — finish after a short pause
                                    setTimeout(finishFindHer, 1500);
                                }
                            }
                        }
                    };

                    function finishFindHer() {
                        window._hasTriggeredGirlQuest = true;
                        window._isCinematic = false;

                        // Quest 2 Completed
                        if (window.SacredState) {
                            window.SacredState.questLevel = 3;
                            window.SacredState.activeQuest = 'REQ_QUEST_3_ACTIVATE';
                        }

                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) {
                            panel.contentWindow.postMessage({ type: 'FORCE_OPEN_FOUND_HER' }, '*');
                        }
                    }

                    cinematicWalk();
                }

                if (msg.type === 'START_AUTO_WALK' || msg.type === 'REQ_START_AUTO_WALK') {
                    window._gameStartedCTA = true; // Tracking user interaction for NPC logic
                    // Initial Tipi is at X=0, Z=0. Player spawns at X=0, Z=20.
                    // Walk until roughly 3 units away from the entrance.
                    window._moveTarget = new THREE.Vector3(0, 0, 3);
                    window._lookTarget = new THREE.Vector3(0, 0, 0);

                    // Callback to automatically pop Confetti, and reopen Logbook to Quest 2
                    window._autoWalkCompleteEvent = () => {
                        // Quest 1 Completed, Set Active State for Quest 2 (Find Her)
                        if (window.SacredState) {
                            window.SacredState.questLevel = 2;
                            window.SacredState.activeQuest = 'REQ_FIND_HER_AUTOWALK'; // Legacy trace
                        }
                        window.triggerConfettiCinematic(window._questMarker, window._tipiGodray, 2);
                    };

                    // Ensure panel/HUD updates
                    const panel = document.getElementById('panel-frame');
                    if (panel && panel.contentWindow) {
                        panel.contentWindow.postMessage({ type: 'SHOW_HUD' }, '*');
                    }
                }

                if (msg.type === 'FORCE_OPEN_LOGBOOK_PAGE') {
                    const logIframe = document.getElementById('logbook-frame');
                    if (logIframe && logIframe.contentWindow) {
                        logIframe.contentWindow.postMessage({ type: 'SWITCH_TAB', tab: msg.tab }, '*');
                        logIframe.contentWindow.postMessage({ type: 'GO_TO_PAGE', pageIdx: msg.pageIdx }, '*');
                        logIframe.contentWindow.postMessage({ type: 'VISIBILITY_CHANGE', isVisible: true }, '*');
                    }

                    // Physically force the Logbook UI layer to surface overriding any previous fade states
                    const logContainer = document.getElementById('logbook-container');
                    if (logContainer) {
                        logContainer.classList.remove('hidden');
                        setTimeout(() => logContainer.style.opacity = '1', 50);
                    }
                    window._isLogbookOpen = true;
                }

                if (msg.type === 'OPEN_LOGBOOK') {
                    window._isLogbookOpen = true;

                    // Calculate the active quest page based on game state
                    const qLvl = window.SacredState ? (window.SacredState.questLevel || 0) : 0;
                    let targetPage = 0; // Default: Quest 1 (Tipi Walk / Welcome) - Covers Journal Pages 0-1

                    if (qLvl === 2) targetPage = 2; // Quest 2 (Brings Happiness Girl)
                    else if (qLvl === 3) targetPage = 4; // Quest 3 (The Axe)
                    else if (qLvl >= 4) targetPage = 6; // Quest 4 (Gather Wood from Tree)

                    const panel = document.getElementById('panel-frame');
                    if (panel && panel.contentWindow) {
                        panel.contentWindow.postMessage({ type: 'SYNC_LOGBOOK_PAGE', pageIdx: targetPage }, '*');
                    }
                }
                if (msg.type === 'CLOSE_LOGBOOK') {
                    window._isLogbookOpen = false;
                }

                if (msg.type === 'GATHER_AXE' || msg.type === 'REQ_GATHER_AXE') {
                    if (window._hasTriggeredGirlQuest) {
                        window._choppingTarget = window._axeModel || { "isLumber": true };
                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) {
                            panel.contentWindow.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*'); // Close logbook
                        }
                    } else {
                        window.LLMAssistantSystem && window.LLMAssistantSystem.showToast("You must find Brings Happiness Girl first...");
                    }
                }

                if (msg.type === 'REQ_COMPLETE_QUEST') {
                    // If we have an active quest object (the balloon above the tipi)
                    if (window._questMarker && window._questMarker.visible) {
                        // Trick the game loop into thinking we arrived at the quest target
                        window._isCinematic = false;
                        window._moveTarget = null;

                        // Instantly force the 3D marker/balloon bounding box collision check in the render loop
                        // by moving the player directly under it.
                        camera.position.set(0, 1.0, 15);

                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) {
                            panel.contentWindow.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*'); // Close logbook
                        }
                    }
                }

                if (msg.type === 'REQ_ANIMATE_THEN_GATHER_AXE') {
                    if (window._worldAxeMesh) {
                        // 1. Lock the player in place
                        if (window.SacredState) window.SacredState.canMove = false;

                        // 2. Close Logbook to reveal HUD
                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) {
                            panel.contentWindow.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*');
                        }

                        // Wait for Logbook UI fade-out transition to complete (800ms) before flying the axe
                        setTimeout(() => {
                            // Detach Axe from its local Tipi coordinate group so we can fly it in World Space
                            const startPos = new THREE.Vector3();
                            const startQuat = new THREE.Quaternion();
                            window._worldAxeMesh.getWorldPosition(startPos);
                            window._worldAxeMesh.getWorldQuaternion(startQuat);
                            scene.add(window._worldAxeMesh);
                            window._worldAxeMesh.position.copy(startPos);
                            window._worldAxeMesh.quaternion.copy(startQuat);

                            // 3. Trigger glowing gold haze
                            const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
                            const glowMesh = window._worldAxeMesh.clone();
                            glowMesh.traverse(child => { if (child.isMesh) child.material = glowMat; });
                            glowMesh.scale.multiplyScalar(1.4);
                            window._worldAxeMesh.add(glowMesh);

                            // Add a point light for radiating glow
                            const light = new THREE.PointLight(0xffd700, 4, 15);
                            window._worldAxeMesh.getWorldPosition(light.position);
                            scene.add(light);

                            // 3b. Zoom camera in towards the glowing axe
                            const savedCamPos = camera.position.clone();
                            const savedCamQuat = camera.quaternion.clone();
                            const zoomTarget = startPos.clone();
                            const dirToAxe = new THREE.Vector3().subVectors(zoomTarget, camera.position).normalize();
                            const zoomEndPos = camera.position.clone().add(dirToAxe.multiplyScalar(
                                Math.max(0.5, camera.position.distanceTo(zoomTarget) * 0.6)
                            ));

                            let zoomTime = 0;
                            const zoomDuration = 600; // 0.6s zoom in
                            const zoomIn = () => {
                                zoomTime += 16;
                                const zt = Math.min(1, zoomTime / zoomDuration);
                                const easeZoom = zt * zt * (3 - 2 * zt); // smoothstep
                                camera.position.lerpVectors(savedCamPos, zoomEndPos, easeZoom);
                                camera.lookAt(zoomTarget);
                                if (zt < 1) {
                                    requestAnimationFrame(zoomIn);
                                } else {
                                    // Hold for a beat then start the fly-away
                                    setTimeout(startFlySequence, 400);
                                }
                            };
                            zoomIn();

                            // 4. Calculate flight path directly into the left "ITEMS" sidebar
                            const dist = 1.0;
                            const targetNdc = new THREE.Vector3(-0.9, 0.1, 0.5);
                            targetNdc.unproject(camera);
                            const dir = targetNdc.clone().sub(camera.position).normalize();
                            const endPos = camera.position.clone().add(dir.multiplyScalar(dist));

                            const animStartPos = window._worldAxeMesh.position.clone();

                            let startTime;
                            const duration = 1200; // 1.2s flight and fade out

                            // Instantiate the 3D floating text — smaller black label
                            const canvas = document.createElement('canvas');
                            canvas.width = 1024; canvas.height = 256;
                            const ctx = canvas.getContext('2d');
                            ctx.fillStyle = '#000000';
                            ctx.font = '500 48px Courier New';
                            ctx.textAlign = 'center';
                            ctx.fillText('YOU GOT AN AXE!', 512, 150);

                            const tex = new THREE.CanvasTexture(canvas);
                            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                            const sprite = new THREE.Sprite(mat);
                            sprite.position.copy(animStartPos);
                            sprite.position.y += 0.5; // Spawn above axe
                            sprite.scale.set(0.1, 0.025, 1);
                            scene.add(sprite);

                            function startFlySequence() {
                                startTime = performance.now();
                                flyAxe();
                            } // end startFlySequence

                            function flyAxe() {
                                const now = performance.now();
                                let t = (now - startTime) / duration;
                                if (t > 1) t = 1;

                                const ease = 1 - Math.pow(1 - t, 3); // Ease Out curve

                                window._worldAxeMesh.rotation.y += 0.1;
                                window._worldAxeMesh.rotation.x += 0.05;
                                window._worldAxeMesh.position.lerpVectors(animStartPos, endPos, ease);

                                // Expand the glow mesh specifically while shrinking the overall axe scale
                                if (glowMesh) {
                                    glowMesh.scale.setScalar(1.4 + (ease * 0.8));
                                    glowMat.opacity = 0.8 * (1 - ease);
                                }

                                // Shrink Axe physically as it flies away and fade it out
                                const currentScale = 1.0 - (ease * 0.9);
                                window._worldAxeMesh.scale.setScalar(Math.max(0.1, currentScale));

                                window._worldAxeMesh.traverse(child => {
                                    if (child.isMesh && child.material && child !== glowMesh) {
                                        child.material.transparent = true;
                                        child.material.opacity = 1 - ease;
                                    }
                                });

                                // Reveal and scale the floating text in 3D SPACE
                                if (sprite) {
                                    sprite.position.y += 0.002;
                                    sprite.scale.x += (3.0 - sprite.scale.x) * 0.1;
                                    sprite.scale.y += (0.75 - sprite.scale.y) * 0.1;
                                    sprite.position.lerpVectors(animStartPos, endPos, ease * 0.5); // Text drifts slightly towards it but not fully
                                }

                                if (t < 1) {
                                    requestAnimationFrame(flyAxe);
                                } else {
                                    window._worldAxeMesh.visible = false;
                                    scene.remove(light);

                                    // Let the floating text clear out
                                    let st = 0;
                                    function floatText() {
                                        st += 0.015;
                                        if (sprite) {
                                            sprite.position.y += 0.005;
                                            sprite.material.opacity = 1.0 - st;
                                            sprite.scale.multiplyScalar(1.002);
                                        }
                                        if (st < 1) requestAnimationFrame(floatText);
                                        else scene.remove(sprite);
                                    }
                                    floatText();

                                    // Restore camera position smoothly then finish
                                    let restoreTime = 0;
                                    const restoreDuration = 500;
                                    const currentCamPos = camera.position.clone();
                                    const restoreCam = () => {
                                        restoreTime += 16;
                                        const rt = Math.min(1, restoreTime / restoreDuration);
                                        const easeRestore = rt * rt * (3 - 2 * rt);
                                        camera.position.lerpVectors(currentCamPos, savedCamPos, easeRestore);
                                        camera.quaternion.slerpQuaternions(camera.quaternion, savedCamQuat, easeRestore * 0.15);
                                        if (rt < 1) requestAnimationFrame(restoreCam);
                                        else {
                                            // Update quest state
                                            if (window.SacredState) window.SacredState.questLevel = 4;
                                            window._hasGottenAxe = true;
                                            finishAxeSequence();
                                        }
                                    };
                                    restoreCam();
                                }
                            }

                            // panToBalloonTwo removed — cinematic stops after first camera turn

                            function finishAxeSequence() {
                                window._isCinematic = false;
                                if (window.SacredState) window.SacredState.canMove = true;

                                if (panel && panel.contentWindow) {
                                    panel.contentWindow.postMessage({ type: 'COMPLETE_AXE_GATHER' }, '*');
                                    panel.contentWindow.postMessage({ type: 'GLOW_ITEMS_BUTTON' }, '*');
                                    panel.contentWindow.postMessage({ type: 'OPEN_LOGBOOK_TO_INVENTORY' }, '*');
                                }

                                if (window._axeMesh) window._axeMesh.visible = false;
                                if (typeof window.uiManager !== 'undefined' && window.uiManager.showCenterBubble) {
                                    window.uiManager.showCenterBubble("Axe Acquired! Time to chop wood.", 3000);
                                }
                            }
                            // flyAxe is now called from startFlySequence after zoom-in
                        }, 400);
                    }
                }

                if (msg.type === 'SPAWN_CONFETTI') {
                    if (window._triggerQuestConfetti) {
                        // Spawn confetti slightly in front of the camera and raised up so it falls nicely
                        const camDir = new THREE.Vector3();
                        camera.getWorldDirection(camDir);
                        const pos = camera.position.clone().add(camDir.multiplyScalar(4));
                        pos.y += 2.0;
                        window._triggerQuestConfetti(pos);
                    }
                }

                // TIPI PIP OVERLAY ALIGNMENT VIA POSTMESSAGE
                if (msg.type === 'REQ_ALIGN_TIPI' && msg.rect) {
                    console.log("[PIP_TRACE] REQ_ALIGN_TIPI Received!", JSON.stringify(msg.rect));
                    window._tipiPipTarget = msg.target || 'tipi';
                    if (window.tipiCanvas2D) {
                        const canvasNode = window.tipiCanvas2D;
                        canvasNode.style.display = 'block';
                        let wrapper = document.getElementById('tipi-canvas-wrapper');
                        if (!wrapper) {
                            wrapper = document.createElement('div');
                            wrapper.id = 'tipi-canvas-wrapper';
                            wrapper.style.position = 'absolute';
                            wrapper.style.zIndex = '100001'; // Place it directly over Logbook
                            wrapper.style.borderRadius = '10px';
                            wrapper.style.border = 'none';
                            wrapper.style.overflow = 'hidden';
                            wrapper.style.transform = 'translateZ(0)'; // Force WebKit clip

                            document.body.appendChild(wrapper);
                        }

                        // Clean defaults from canvas
                        canvasNode.style.position = 'absolute';
                        canvasNode.style.top = '0';
                        canvasNode.style.left = '0';
                        canvasNode.style.width = '100%';
                        canvasNode.style.height = '100%';
                        canvasNode.style.borderRadius = '0';
                        canvasNode.style.border = 'none';
                        canvasNode.style.boxShadow = 'none';
                        canvasNode.style.clipPath = 'none';
                        canvasNode.style.webkitClipPath = 'none';
                        canvasNode.style.zIndex = '1';

                        if (canvasNode.parentElement !== wrapper) {
                            wrapper.appendChild(canvasNode);
                        }

                        // We must offset by the iframe's own left/top position in the parent if it has any, 
                        // but the Logbook iframe is full-screen inside #panel-frame, or offset by #panel-frame
                        const bookWrapper = document.getElementById('panel-frame');
                        const bwRect = bookWrapper ? bookWrapper.getBoundingClientRect() : { left: 0, top: 0 };

                        wrapper.style.display = 'block';
                        wrapper.style.left = (bwRect.left + msg.rect.x) + 'px';
                        wrapper.style.top = (bwRect.top + msg.rect.y) + 'px';
                        wrapper.style.width = msg.rect.width + 'px';
                        wrapper.style.height = msg.rect.height + 'px';

                        // Sync WebGL internal resolution with the CSS box for a crisp image
                        const w = Math.floor(msg.rect.width);
                        const h = Math.floor(msg.rect.height);
                        if (canvasNode.width !== w || canvasNode.height !== h || window._lastTipiPipTarget !== window._tipiPipTarget) {
                            window._lastTipiPipTarget = window._tipiPipTarget;
                            window.tipiCanvas2D.width = w;
                            window.tipiCanvas2D.height = h;
                            // Correct the orthographic frustum so the scene is not squashed
                            const aspect = w / h;
                            const target = window._tipiPipTarget;
                            let tipiFrustum = 6.0; // Restored closer view for Tipi
                            if (target === 'bringsHappinessGirlPortrait') tipiFrustum = 3.5; // Zoomed out for 10 ft view
                            else if (target === 'bringsHappinessGirl') tipiFrustum = 3.5;
                            else if (target === 'bhg') tipiFrustum = 4.0;
                            else if (target === 'axeGathering') tipiFrustum = 3.0; // Slightly closer for axe
                            else if (target === 'yellowButterfly') tipiFrustum = 5.0; // Wider for butterfly spirit

                            // Match height to frustum, width to frustum * aspect
                            tipiOrthoCam.left = -tipiFrustum * aspect / 2;
                            tipiOrthoCam.right = tipiFrustum * aspect / 2;
                            tipiOrthoCam.top = tipiFrustum / 2;
                            tipiOrthoCam.bottom = -tipiFrustum / 2;
                            tipiOrthoCam.updateProjectionMatrix();
                        }
                    }
                }

                if (msg.type === 'REQ_HIDE_TIPI') {
                    window._tipiPipTarget = null;
                    window._tipiRect = null;
                    if (window.tipiCanvas2D) {
                        window.tipiCanvas2D.style.display = 'none';
                        const w = document.getElementById('tipi-canvas-wrapper');
                        if (w) w.style.display = 'none';
                    }
                }

                if (msg.type === 'REQ_ALIGN_AXE' && msg.rect) {
                    window._axeRect = msg.rect;
                    window._isAxeCameraCloned = true; // Flag for render loop

                    if (window.axeCanvas2D) {
                        const canvasNode = window.axeCanvas2D;
                        canvasNode.style.display = 'block';

                        let wrapper = document.getElementById('axe-canvas-wrapper');
                        if (!wrapper) {
                            wrapper = document.createElement('div');
                            wrapper.id = 'axe-canvas-wrapper';
                            wrapper.style.position = 'absolute';
                            wrapper.style.zIndex = '100001';
                            wrapper.style.borderRadius = '10px';
                            wrapper.style.border = 'none';
                            wrapper.style.overflow = 'hidden';
                            wrapper.style.transform = 'translateZ(0)';

                            document.body.appendChild(wrapper);
                        }

                        // Clean defaults from canvas
                        canvasNode.style.position = 'absolute';
                        canvasNode.style.top = '0';
                        canvasNode.style.left = '0';
                        canvasNode.style.width = '100%';
                        canvasNode.style.height = '100%';
                        canvasNode.style.borderRadius = '0';
                        canvasNode.style.border = 'none';
                        canvasNode.style.boxShadow = 'none';
                        canvasNode.style.clipPath = 'none';
                        canvasNode.style.webkitClipPath = 'none';
                        canvasNode.style.zIndex = '1';

                        if (canvasNode.parentElement !== wrapper) {
                            wrapper.appendChild(canvasNode);
                        }

                        const bookWrapper = document.getElementById('panel-frame');
                        const bwRect = bookWrapper ? bookWrapper.getBoundingClientRect() : { left: 0, top: 0 };

                        wrapper.style.display = 'block';
                        wrapper.style.left = (bwRect.left + msg.rect.x) + 'px';
                        wrapper.style.top = (bwRect.top + msg.rect.y) + 'px';
                        wrapper.style.width = msg.rect.width + 'px';
                        wrapper.style.height = msg.rect.height + 'px';

                        const w = Math.floor(msg.rect.width);
                        const h = Math.floor(msg.rect.height);
                        if (canvasNode.width !== w || canvasNode.height !== h) {
                            window.axeCanvas2D.width = w;
                            window.axeCanvas2D.height = h;
                        }
                    }
                }

                if (msg.type === 'REQ_HIDE_AXE') {
                    window._axeRect = null;
                    window._isAxeCameraCloned = false;

                    const axeWrapper = document.getElementById('axe-canvas-wrapper');
                    if (axeWrapper) axeWrapper.style.display = 'none';

                    if (window.axeCanvas2D) {
                        const canvasNode = window.axeCanvas2D;
                        canvasNode.style.display = 'none';
                    }
                }

                if (msg.type === 'SET_SEASON') {
                    // Set target time to animate smoothly instead of snapping blindly
                    switch(msg.season) {
                        case 'night': window._targetGameTime = 2.0; break;
                        case 'dawn': window._targetGameTime = 6.0; break;
                        case 'day': window._targetGameTime = 14.0; break;
                        case 'dusk': window._targetGameTime = 18.5; break;
                        case 'gray': window._targetGameTime = 14.0; break;
                    }
                    if (msg.season === 'gray') {
                        window._isOvercastMode = true; 
                    } else window._isOvercastMode = false;
                    
                    // Rotate the UI ring for premium mechanical UX
                    const seasonRing = document.getElementById('season-ring');
                    if (seasonRing) {
                        let rot = 0;
                        if (msg.season === 'night') rot = 0;
                        if (msg.season === 'dawn') rot = -72;
                        if (msg.season === 'day') rot = -144;
                        if (msg.season === 'dusk') rot = -216;
                        if (msg.season === 'gray') rot = -288;
                        seasonRing.style.transform = `rotate(${rot}deg)`;
                        
                        // Keep emojis perfectly upright using counter-rotation
                        const btns = seasonRing.querySelectorAll('.season-btn');
                        btns.forEach(b => {
                            b.style.transform = `rotate(${-rot}deg)`;
                        });
                    }
                }

                if (msg.type === 'SET_MOON_PHASE') {
                    // Turn to night and lock phase visually by hard-setting time
                    window._targetGameTime = 2.0; 
                    window._isTimeLocked = true; // Permanently suspend time to maintain night sync
                    
                    if (!window._3dMoonGroup) {
                        window._3dMoonGroup = new THREE.Group();
                        scene.add(window._3dMoonGroup);
                        
                        // The Emissive True Moon
                        const mGeo = new THREE.SphereGeometry(25, 32, 32);
                        const mMat = new THREE.MeshStandardMaterial({
                            color: 0xffffff,
                            emissive: 0xcccccc,
                            emissiveIntensity: 0.8,
                            roughness: 0.9 
                        });
                        window._3dMoonMesh = new THREE.Mesh(mGeo, mMat);
                        window._3dMoonGroup.add(window._3dMoonMesh);

                        // The Clipping Shadow Sphere (Used to carve crescents out of the moon)
                        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x0a0c10 }); // Dark sky color
                        window._moonShadowMesh = new THREE.Mesh(mGeo, shadowMat);
                        
                        // To prevent z-fighting but allow clipping, scale slightly up
                        window._moonShadowMesh.scale.setScalar(1.02);
                        window._3dMoonGroup.add(window._moonShadowMesh);

                        window._moonLight = new THREE.PointLight(0xaaccff, 0.5, 600);
                        window._3dMoonGroup.add(window._moonLight);
                    }
                    
                    window._3dMoonGroup.visible = true;

                    // Compute physical layout of the Eclipse Shadow based on phase index
                    // phase: 0 = New, 1 = Waxing Crescent, 2 = First Quarter, 3 = Waxing Gibbous
                    // 4 = Full Moon, 5 = Waning Gibbous, 6 = Last Quarter, 7 = Waning Crescent
                    const shadowDistance = 35; // Maximum separation
                    if (msg.phase === 0) {
                        // New Moon - Completely obscured
                        window._moonShadowMesh.visible = true;
                        window._moonShadowMesh.position.set(0, 0, 0);
                    } else if (msg.phase === 4) {
                        // Full Moon - Completely visible
                        window._moonShadowMesh.visible = false;
                    } else {
                        window._moonShadowMesh.visible = true;
                        // Interpolate X offset based on phrase mathematically
                        // A waxing crescent means the shadow is sliding left to right.
                        const isWaxing = msg.phase < 4;
                        const factor = isWaxing ? (msg.phase / 4) : ((msg.phase - 4) / 4);
                        
                        // Positional logic: 
                        // Phase 2 (Quarter): offset X = 25
                        const offset = isWaxing ? (25 - (factor * 50)) : (-25 + (factor * 50));
                        window._moonShadowMesh.position.set(offset, 0, offset * 0.2); // slight Z pop
                    }

                    // Dynamically position the massive 3D moon group floating in the night horizon
                    const currentCamPos = camera.position;
                    window._3dMoonGroup.position.set(
                        currentCamPos.x + 200,   // Offset to the far East horizon
                        currentCamPos.y + 400,   // High up in the sky
                        currentCamPos.z - 600    // Pushed deep back to prevent mountain clipping
                    );

                    // Force the celestial body to always look perfectly at the camera to maintain the 2D crescent mask illusion!
                    window._3dMoonGroup.lookAt(currentCamPos);

                    // Trigger the UI to match
                    window._currentForcePhase = msg.phase;
                    window.postMessage({ type: 'UPDATE_MOON', time: (msg.phase * 3) }, '*');
                }

                if (msg.type === 'TOGGLE_VIEW_MODE') {
                    window._isMapView = !window._isMapView;
                    const isMap = window._isMapView;

                    const curAspect = window.innerWidth / window.innerHeight;

                    if (isMap) {
                        // Enter MAP MODE
                        if (!window._mainFpvCam) window._mainFpvCam = camera;
                        if (!window._nativeMapCam) window._nativeMapCam = pipCamera;
                        
                        // Create an alt Top-Down camera for the PIP so it doesn't use the slow Perspective FPV cam
                        if (!window._pipMapTopDownAlt) {
                            window._pipMapTopDownAlt = new THREE.OrthographicCamera(-16, 16, 16, -16, 0.1, 2500);
                            window._pipMapTopDownAlt.layers.enable(1); // Ensure PIP markers are visible
                            scene.add(window._pipMapTopDownAlt);
                        }
                        pipCamera = window._pipMapTopDownAlt;
                        
                        // Configure the Native Map Cam for Widescreen projection
                        const mapFrust = 80;
                        window._nativeMapCam.left = -mapFrust * curAspect / 2;
                        window._nativeMapCam.right = mapFrust * curAspect / 2;
                        window._nativeMapCam.top = mapFrust / 2;
                        window._nativeMapCam.bottom = -mapFrust / 2;
                        window._nativeMapCam.near = 0.1;
                        window._nativeMapCam.far = 2000;
                        window._nativeMapCam.updateProjectionMatrix();

                        // PiP Engine (240x240) is looking through the Square Alternate camera, keep it square
                        const fpvFrust = 32;
                        pipCamera.left = -fpvFrust / 2;
                        pipCamera.right = fpvFrust / 2;
                        pipCamera.top = fpvFrust / 2;
                        pipCamera.bottom = -fpvFrust / 2;
                        pipCamera.updateProjectionMatrix();

                        // Clean Photorealistic Diorama Lighting (Trees culled, no need to blast HDR exposure)
                        if (window.sunLight) {
                            window.sunLight.intensity = 2.0; 
                        }

                    } else {
                        // Exit MAP MODE -> Return to FPV
                        if (window._nativeMapCam) pipCamera = window._nativeMapCam;

                        // Back to Normal: Main Engine is FPV, which stays perfectly pristine natively
                        // Just restore PiP Engine to original Map Cam
                        const mapFrust = 80;
                        pipCamera.left = -mapFrust / 2;
                        pipCamera.right = mapFrust / 2;
                        pipCamera.top = mapFrust / 2;
                        pipCamera.bottom = -mapFrust / 2;
                        pipCamera.updateProjectionMatrix();

                        // Restore standard FPV lighting
                        if (window.sunLight) {
                            window.sunLight.intensity = 2.0;
                        }
                    }

                    // For the bushes and fallback trees (Hide entirely for clear map visibility)
                    window.allTrees.forEach(t => {
                        if (t.isInstanced) return; // SKIP Instanced Dictionary Objects directly to prevent undefined userData crashes
                        // Extract actual object reference 
                        const m = t.mesh ? t.mesh : t;
                        if (m && m.userData) {
                            if (isMap) {
                                m.userData._prevVisible = m.visible;
                                m.visible = false;
                            } else {
                                m.visible = m.userData._prevVisible !== undefined ? m.userData._prevVisible : true;
                            }
                        }
                    });
                    
                    // Globally toggle Instanced meshes independently
                    if (window._treeInstancedMeshes) {
                        window._treeInstancedMeshes.forEach(im => {
                            if (im.instancedMesh) {
                                im.instancedMesh.visible = !isMap;
                            }
                        });
                    }

                }

                if (msg.type === 'THUMB_MOVE') {
                    window._thumbX = msg.x || 0;
                    window._thumbY = msg.y || 0;
                }

                if (msg.type === 'VOLUME_CHANGE' && typeof msg.volume === 'number') {
                    if (msg.volume < 0) {
                        // Soft fade-out over 1 second
                        const fadeStep = birdsong.volume / 20;
                        const fadeOut = setInterval(() => {
                            birdsong.volume = Math.max(0, birdsong.volume - fadeStep);
                            if (birdsong.volume <= 0.01) {
                                birdsong.volume = 0;
                                birdsong.pause();
                                clearInterval(fadeOut);
                            }
                        }, 50);
                    } else {
                        if (birdsong.paused && msg.volume > 0) {
                            birdsong.volume = msg.volume;
                            birdsong.play().catch(() => { });
                        } else {
                            birdsong.volume = Math.max(0, Math.min(1, msg.volume));
                        }
                    }
                }

                // WCAG TEXT-TO-DRIVE AI BRIDGE
                if (msg.type === 'SEEK_ENTITY') {
                    let targetObj = null;
                    let targetName = (msg.target || '').toLowerCase();

                    if (targetName === 'brings happiness girl' || targetName === 'bhg' || targetName === 'girl' || targetName === 'npc') {
                        // Special NPC exception - same logic as QUEST_AUTOWALK 'bhg'
                        window._moveTarget = new THREE.Vector3(12, 0, 4.0);
                        window._lookTarget = new THREE.Vector3(12, 1.5, 12.0);
                        if (window.fuzzyBrain && window.fuzzyBrain.postProcess && window.SacredState.bokehPass) {
                            window.SacredState.bokehPass.enabled = true;
                        }
                        return;
                    }
                    if (targetName === 'tipi' || targetName === 'base' || targetName === 'home') {
                        window._moveTarget = new THREE.Vector3(0, 0, 8.5);
                        window._lookTarget = new THREE.Vector3(0, 1.5, 0);
                        return;
                    }

                    // Unified finder array [system, array of entities]
                    const searchBanks = [];
                    if (window.rabbitSystem) searchBanks.push(window.rabbitSystem.rabbits);
                    if (window.deerSystem) searchBanks.push(window.deerSystem.deer);
                    if (window.horseSystem) searchBanks.push(window.horseSystem.horses);
                    if (window.birdSystem) searchBanks.push(window.birdSystem.solitaryBirds);

                    let closestDist = Infinity;
                    let closestMesh = null;

                    for (const bank of searchBanks) {
                        for (const entity of bank) {
                            if (!entity.mesh || !entity.mesh.visible || entity.state === 'HIDDEN' || entity.phase === 'hidden') continue;

                            // Does this entity match the search term?
                            let isMatch = false;
                            if (targetName.includes('rabbit') && bank === window.rabbitSystem?.rabbits) isMatch = true;
                            if (targetName.includes('deer') && bank === window.deerSystem?.deer) isMatch = true;
                            if (targetName.includes('horse') && bank === window.horseSystem?.horses) isMatch = true;
                            if ((targetName.includes('bird') || targetName.includes('hawk') || targetName.includes('eagle')) && bank === window.birdSystem?.solitaryBirds) isMatch = true;

                            if (isMatch) {
                                const distSq = camera.position.distanceToSquared(entity.mesh.position);
                                if (distSq < closestDist) {
                                    closestDist = distSq;
                                    closestMesh = entity.mesh;
                                }
                            }
                        }
                    }

                    if (closestMesh) {
                        // Found nearest entity! Walk to a safe offset distance
                        const dir = new THREE.Vector3().subVectors(camera.position, closestMesh.position).normalize();

                        // Distance check. If it's too far, just ignore or walk partly? (We'll walk the whole way)

                        // Stop 4 units away
                        const stopDist = 4.0;
                        window._moveTarget = closestMesh.position.clone().add(dir.multiplyScalar(stopDist));
                        window._moveTarget.y = 0; // Ground snap destination

                        // Look exactly at the animal slightly above ground
                        window._lookTarget = closestMesh.position.clone();
                        window._lookTarget.y += 0.5;

                        // Engage cinematic Depth of Field if available
                        if (window.fuzzyBrain && window.fuzzyBrain.postProcess && window.SacredState.bokehPass) {
                            window.SacredState.bokehPass.enabled = true;
                        }
                    } else {
                        console.log("AI Navigator: Could not find '" + targetName + "' remotely near.");
                    }
                    return;
                }

                // QUEST AUTO-WALK TRIGGER
                if (msg.type === 'QUEST_AUTOWALK' || msg.type === 'startQuestWalk') {
                    let defaultTarget = 'tipi'; // Default to first quest
                    if (window._questMarker && !window._questMarker.visible) {
                        // First quest is complete, advance HUD autowalk to second quest
                        if (window._questMarker2 && window._questMarker2.visible) {
                            defaultTarget = 'bhg';
                        }
                    }
                    const targetId = msg.target || defaultTarget;

                    if (targetId === 'tipi') {
                        // Pathfind to just outside the tipi entrance
                        window._moveTarget = new THREE.Vector3(0, 0, 8.5); // Clear the 5.0 radius
                        window._lookTarget = new THREE.Vector3(0, 1.5, 0); // When arrived, look at Tipi center
                    } else if (targetId === 'bhg') {
                        // Brings Happiness Girl Tipi (X=12, Z=12) is rotated Math.PI (Entrance faces -Z / North)
                        // Entrance is at Z=7. Stand 10 feet (3 units) outside entrance: Z=4.
                        window._moveTarget = new THREE.Vector3(12, 0, 4.0);
                        window._lookTarget = new THREE.Vector3(12, 1.5, 12.0); // Look dead center into Tipi
                    }

                    window._pendingTipiGreeting = true;
                    return;
                }

                if (msg.type === 'WORLD_CMD') {
                    if (msg.action === 'walk_to') {
                        // Forward Logbook World Commands directly into the robust Autowalk System
                        window.postMessage({ type: 'REQ_AUTOWALK_TO_ENTITY', targetName: msg.target }, '*');
                    }
                    return;
                }

                if (msg.type === 'REQ_AUTOWALK_TO_ENTITY') {
                    if (!msg.targetName) return;
                    const search = msg.targetName.toLowerCase();
                    let targetObj = null;

                    // 1. Search Wildlife (Horses, Rabbits, Spirit)
                    if (window._animals && window._animals.length > 0) {
                        for (const a of window._animals) {
                            if (search.includes('horse') && a.species === 'horse') { targetObj = a; break; }
                            if ((search.includes('bunny') || search.includes('rabbit')) && a.species === 'rabbit') { targetObj = a; break; }
                        }
                    }
                    if (!targetObj && search.includes('spirit') && window._natureSpiritParams) {
                        targetObj = window._natureSpiritParams;
                    }

                    // 2. Search Environment (Water, Trees, Tipi, Axe)
                    if (!targetObj) {
                        if (search.includes('water') || search.includes('pond')) targetObj = { mesh: { position: window._pondCenter } };
                        if ((search.includes('tipi') || search.includes('teepee')) && window._tipiMeshes && window._tipiMeshes.length > 0) targetObj = { mesh: window._tipiMeshes[0] };
                        if (search.includes('axe') && window._worldAxeMesh) targetObj = { mesh: window._worldAxeMesh };
                        if ((search.includes('yellowbutterfly') || search.includes('butterfly')) && window._yellowButterflyNPC) targetObj = { mesh: window._yellowButterflyNPC };
                    }

                    if (targetObj) {
                        // Extract position
                        let pos = new THREE.Vector3();
                        if (targetObj.mesh) targetObj.mesh.getWorldPosition(pos);
                        else if (targetObj.position) pos.copy(targetObj.position);

                        if (pos.lengthSq() > 0) {
                            window._moveTarget = new THREE.Vector3(pos.x, 0, pos.z);
                            console.log(`[WCAG Autowalk] Found ${search} at ${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`);

                            // Close logbook to show walking
                            const logContainer = document.getElementById('logbook-container');
                            if (logContainer) {
                                logContainer.style.opacity = '0';
                                setTimeout(() => logContainer.classList.add('hidden'), 300);
                            }
                        }
                    } else {
                        console.warn(`[WCAG Autowalk] Could not find any entity matching: ${search}`);
                    }
                }

                if (msg.type === 'QUEST_REACHED') {
                    // Pan camera up to look at Golden Quest Balloon (height 12)
                    window._lookTarget = new THREE.Vector3(35, 12, 45);

                    // Request the Logbook to toggle OPEN (since it was closed during the walk)
                    const logContainer = document.getElementById('logbook-container');
                    if (logContainer && logContainer.classList.contains('hidden')) {
                        logContainer.classList.remove('hidden');
                        setTimeout(() => logContainer.style.opacity = '1', 50);
                    }

                    // Ensure Logbook iframe processes the page turn
                    const logIframe = document.getElementById('logbook-frame');
                    if (logIframe && logIframe.contentWindow) {
                        logIframe.contentWindow.postMessage({ type: 'QUEST_REACHED' }, '*');
                    }
                }
                if (msg.type === 'LOGBOOK_VISIBILITY') {
                    window._isLogbookOpen = msg.isVisible;
                }

                if (msg.type === 'TAKE_AXE') {
                    // Force close the Logbook UI first so we can see the cinematic
                    const logContainer = document.getElementById('logbook-container');
                    if (logContainer) {
                        logContainer.style.opacity = '0';
                        setTimeout(() => logContainer.classList.add('hidden'), 300);
                    }

                    document.body.classList.add('hud-hidden');
                    window._isCinematic = true;

                    let phase = 'turn';
                    let cinTime = 0;

                    const targetYaw = camera.rotation.y + (Math.PI / 4); // Turn left exactly 45 degrees
                    let originalAxeScale = window._axeMesh ? window._axeMesh.scale.x : 1.0;

                    const popAxe = () => {
                        if (window._axeMesh) window._axeMesh.visible = false;
                        if (window._bhgBalloon && window._bhgBalloon.visible) window._bhgBalloon.visible = false;
                        if (window._axeTextSprite) scene.remove(window._axeTextSprite);

                        // Golden Particle Burst (Confetti from Balloon)
                        const pGeo = new THREE.BufferGeometry();
                        const pCount = 50;
                        const pPos = new Float32Array(pCount * 3);
                        // Burst exactly at the balloon!
                        const burstCenter = (window._bhgBalloon)
                            ? window._bhgBalloon.position.clone()
                            : camera.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(2.0));

                        for (let i = 0; i < pCount; i++) {
                            pPos[i * 3] = burstCenter.x + (Math.random() - 0.5) * 1.5;
                            pPos[i * 3 + 1] = burstCenter.y + (Math.random() - 0.5) * 1.5;
                            pPos[i * 3 + 2] = burstCenter.z + (Math.random() - 0.5) * 1.5;
                        }
                        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
                        const pMat = new THREE.PointsMaterial({
                            color: 0xffd700, size: 0.15, transparent: true, opacity: 1, map: new THREE.TextureLoader().load('Assets/SacredOnes.Particle.png')
                        });
                        const particles = new THREE.Points(pGeo, pMat);
                        scene.add(particles);

                        let pTime = 0;
                        const animateParticles = () => {
                            pTime += 0.016;
                            if (pTime > 1.5) {
                                scene.remove(particles);
                                pGeo.dispose();
                                pMat.dispose();

                                // Restore control and Logbook UI
                                window._isCinematic = false;
                                document.body.classList.remove('hud-hidden');
                                const pFrame = document.getElementById('panel-frame');
                                if (pFrame && pFrame.contentWindow) pFrame.contentWindow.postMessage({ type: 'TAKE_AXE' }, '*');
                                window._hasGottenAxe = true;
                                if (window.SacredState) window.SacredState.questLevel = 4;

                                // Open Journal directly to Inventory
                                const logContainer = document.getElementById('logbook-container');
                                if (logContainer) {
                                    logContainer.classList.remove('hidden');
                                    setTimeout(() => logContainer.style.opacity = '1', 50);
                                }
                                const logIframe = document.getElementById('logbook-frame');
                                if (logIframe && logIframe.contentWindow && logIframe.contentWindow.switchBookTab) {
                                    logIframe.contentWindow.switchBookTab('inventory');
                                }

                                // Clean up the balloon text permanently
                                const notif = document.getElementById('quest-notification');
                                if (notif) notif.style.opacity = '0';

                                return;
                            }

                            pMat.opacity = 1.0 - (pTime / 1.5);
                            const positions = particles.geometry.attributes.position.array;
                            for (let i = 0; i < pCount; i++) {
                                positions[i * 3 + 1] -= 0.02; // gravity drop
                                positions[i * 3] += (Math.random() - 0.5) * 0.05; // flutter X
                                positions[i * 3 + 2] += (Math.random() - 0.5) * 0.05; // flutter Z
                            }
                            particles.geometry.attributes.position.needsUpdate = true;
                            requestAnimationFrame(animateParticles);
                        };
                        animateParticles();
                    };

                    const cinematicAxe = () => {
                        if (!window._isCinematic) return; // Exit if aborted

                        if (phase === 'turn') {
                            const diff = targetYaw - camera.rotation.y;
                            if (Math.abs(diff) > 0.02) {
                                camera.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), 0.035);
                                requestAnimationFrame(cinematicAxe);
                            } else {
                                phase = 'glow';
                                requestAnimationFrame(cinematicAxe);
                            }
                            return;
                        }

                        // Scale up and hyper-illuminate the Axe!
                        if (phase === 'glow') {
                            if (cinTime === 0) {
                                // Redesigned from HTML Overlay to direct 3D Scene Text anchored natively to the Axe Glow
                                if (!window._axeTextSprite) {
                                    const qCanvas = document.createElement('canvas');
                                    qCanvas.width = 512; qCanvas.height = 256;
                                    const qCtx = qCanvas.getContext('2d');

                                    qCtx.shadowColor = 'rgba(0,0,0,0.9)';
                                    qCtx.shadowBlur = 15;
                                    qCtx.shadowOffsetY = 4;

                                    qCtx.font = 'bold 50px "Fredoka", Arial, sans-serif';
                                    qCtx.fillStyle = '#fbc02d';
                                    qCtx.textAlign = 'center';
                                    qCtx.textBaseline = 'middle';
                                    qCtx.fillText('AXE OBTAINED!', 256, 80);

                                    qCtx.font = 'bold 28px "Nunito", Arial, sans-serif';
                                    qCtx.fillStyle = '#ffffff';
                                    qCtx.fillText('You can now chop pines.', 256, 140);

                                    const qTex = new THREE.CanvasTexture(qCanvas);
                                    qTex.minFilter = THREE.LinearFilter;
                                    const qMat = new THREE.SpriteMaterial({ map: qTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false }); // Render consistently on top over shaders
                                    const qSprite = new THREE.Sprite(qMat);
                                    qSprite.scale.set(4, 2, 1);

                                    if (window._axeMesh) {
                                        const wp = new THREE.Vector3();
                                        window._axeMesh.getWorldPosition(wp);
                                        qSprite.position.copy(wp);
                                        qSprite.position.y += 0.8; // Set firmly above the axe so it reads loud and clear
                                    } else {
                                        qSprite.position.copy(camera.position).add(new THREE.Vector3(0, 0, -2).applyQuaternion(camera.quaternion));
                                    }

                                    qSprite.renderOrder = 9999;
                                    scene.add(qSprite);
                                    window._axeTextSprite = qSprite;
                                }
                            }

                            cinTime += 0.016;

                            // Levitate, scale down, and tween towards the ITEMS bag!
                            // The user requested screen-space curve towards the bottom bag
                            if (window._axeTextSprite) {
                                window._axeTextSprite.material.opacity = Math.max(0, 1.0 - cinTime * 2.0);
                                window._axeTextSprite.position.y += 0.005;
                            }

                            if (window._axeMesh) {
                                // 1. Calculate trajectory target: 1.5 units in front of camera, and 1.2 units strictly DOWN (bottom of screen)
                                if (!window._axeStartPos) window._axeStartPos = window._axeMesh.position.clone();
                                const camTarget = new THREE.Vector3(0, 0, -1.5).applyMatrix4(camera.matrixWorld);
                                const downOffset = new THREE.Vector3(0, -1.2, 0).applyQuaternion(camera.quaternion);
                                const finalTarget = camTarget.add(downOffset);

                                // 2. Ease curve
                                const progress = Math.min(1.0, cinTime / 2.0); // 2 second tween
                                const easeInCubic = progress * progress * progress;

                                window._axeMesh.position.lerpVectors(window._axeStartPos, finalTarget, easeInCubic);

                                // 3. Scale down
                                const currentScale = originalAxeScale * (1.0 - progress);
                                window._axeMesh.scale.set(currentScale, currentScale, currentScale);

                                // 4. Spin dramatically
                                window._axeMesh.rotation.y += 0.2;
                                window._axeMesh.rotation.x += 0.1;

                                // 5. Glow
                                window._axeMesh.traverse(child => {
                                    if (child.isMesh && child.material) {
                                        if (!child.userData.origEmissive) child.userData.origEmissive = child.material.emissive ? child.material.emissive.clone() : new THREE.Color(0x000000);
                                        if (child.material.emissive) child.material.emissive.setHex(0xffd700);
                                        child.material.emissiveIntensity = Math.min(4.0, cinTime * 4.0);
                                    }
                                });
                            }

                            // Lengthen the glow and flight transition
                            if (cinTime < 2.0) {
                                requestAnimationFrame(cinematicAxe);
                            } else {
                                if (window._axeMesh) window._axeMesh.visible = false; // "Goes into" the bag fully
                                phase = 'look_up';
                                cinTime = 0;
                                requestAnimationFrame(cinematicAxe);
                            }
                            return;
                        }

                        if (phase === 'look_up') {
                            if (cinTime === 0) {
                                const notif = document.getElementById('quest-notification');
                                if (notif) notif.style.opacity = '0'; // Clean old ref
                            }
                            cinTime += 0.016;

                            // Fade out 3D Text while camera rises
                            if (window._axeTextSprite) {
                                window._axeTextSprite.material.opacity = Math.max(0, 1.0 - cinTime * 2.0);
                                window._axeTextSprite.position.y += 0.002;
                            }

                            if (!window._targetPitchObj) {
                                if (window._bhgBalloon) {
                                    window._bhgBalloon.visible = true;
                                    const camPos = camera.position.clone();
                                    const balPos = window._bhgBalloon.position.clone();
                                    const dir = new THREE.Vector3().subVectors(balPos, camPos).normalize();
                                    window._targetPitchObj = Math.asin(dir.y);
                                } else {
                                    window._targetPitchObj = camera.rotation.x + 0.4;
                                }
                            }

                            const diff = window._targetPitchObj - camera.rotation.x;
                            if (Math.abs(diff) > 0.02) {
                                // Pan up smoothly
                                camera.rotation.x += Math.sign(diff) * Math.min(Math.abs(diff), 0.02);
                                requestAnimationFrame(cinematicAxe);
                            } else {
                                phase = 'poof';
                                setTimeout(popAxe, 200);
                            }
                            return;
                        }
                    };
                    cinematicAxe();
                    return;
                }

                if (msg.type === 'OBSERVE_WILDLIFE_ACTION') {
                    if (window._selectedWildlife) {
                        const book = document.getElementById('book-wrapper');
                        if (book && (book.classList.contains('closing') || book.classList.contains('book-hidden'))) {
                            window.parent.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*');
                        }
                        const logIframe = document.getElementById('logbook-frame');
                        if (logIframe && logIframe.contentWindow) {
                            logIframe.contentWindow.postMessage({ type: 'WILDLIFE_OBSERVED', species: window._selectedWildlife }, '*');
                        }
                    } else {
                        // Flash red or tell user to click animal first
                        if (window.parent) window.parent.postMessage({ type: 'LOG_TEXT', text: "Target a creature first..." }, '*');
                    }
                    return;
                }

                if (msg.type === 'GATHER_ACTION') {
                    // Route the legacy panel GATHER action securely to the modern instanced tree chopping routine
                    window.postMessage({ type: 'REQ_CHOP_NEAREST_TREE' }, '*');
                    return;
                }

                // ONLY PROCESS CANVAS CLICKS BEYOND THIS POINT
                if (msg.type === 'CANVAS_CLICK') {
                    // Prevent interacting with the 3D ground/scene if the Logbook modal is actively consuming the screen
                    if (window._isLogbookOpen) return;

                    // Convert normalized coords (0-1) to NDC (-1 to 1)
                    const _tunnelMouse = new THREE.Vector2(msg.x * 2 - 1, -(msg.y * 2 - 1));
                    const _tunnelRay = new THREE.Raycaster();
                    _tunnelRay.setFromCamera(_tunnelMouse, camera);

                    // Spirit click check
                    if (deerSystem) {
                        _tunnelRay._clickPos = _tunnelMouse;
                        if (deerSystem.clickSpirit(_tunnelRay, camera)) return;
                    }

                    // Animal Raycast Check
                    const raycastableAnimals = [];
                    const allSystems = [
                        { sys: window.rabbitSystem, species: 'rabbit' },
                        { sys: window.deerSystem, species: 'deer' },
                        { sys: window.squirrelSystem, species: 'squirrel' },
                        { sys: window.birdSystem, species: 'bird' },
                        { sys: window.butterflySystem, species: 'butterfly' },
                        { sys: window.bearSystem, species: 'bear' }
                    ];
                    allSystems.forEach(({ sys, species }) => {
                        if (sys) {
                            const list = sys.rabbits || sys.deers || sys.birds || sys.squirrels || sys.butterflies || sys.bears || sys.animals || [];
                            list.forEach(animal => {
                                if (animal.mesh && animal.mesh.visible) {
                                    animal.mesh.userData.isWildlife = true;
                                    animal.mesh.userData.species = species;
                                    raycastableAnimals.push(animal.mesh);
                                }
                            });
                        }
                    });

                    const animalHits = _tunnelRay.intersectObjects(raycastableAnimals, true);
                    if (animalHits.length > 0) {
                        let hitObj = animalHits[0].object;
                        let animalRoot = null;
                        while (hitObj) {
                            if (hitObj.userData && hitObj.userData.isWildlife) {
                                animalRoot = hitObj;
                                break;
                            }
                            hitObj = hitObj.parent;
                        }

                        if (animalRoot) {
                            if (window._wildlifeCrosshair) window._wildlifeCrosshair.removeFromParent();
                            else {
                                const chCanvas = document.createElement('canvas');
                                chCanvas.width = 64; chCanvas.height = 64;
                                const chCtx = chCanvas.getContext('2d');
                                chCtx.strokeStyle = '#22c55e'; // Glowing green
                                chCtx.lineWidth = 4;
                                chCtx.beginPath();
                                chCtx.arc(32, 32, 18, 0, Math.PI * 2);
                                chCtx.moveTo(32, 0); chCtx.lineTo(32, 64);
                                chCtx.moveTo(0, 32); chCtx.lineTo(64, 32);
                                chCtx.stroke();
                                window._wildlifeCrosshair = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(chCanvas), transparent: true, depthTest: false, depthWrite: false }));
                                window._wildlifeCrosshair.scale.set(0.6, 0.6, 1);
                                window._wildlifeCrosshair.renderOrder = 999;
                            }
                            animalRoot.add(window._wildlifeCrosshair);
                            const box = new THREE.Box3().setFromObject(animalRoot);
                            const h = isNaN(box.max.y) ? 1.0 : (box.max.y - box.min.y);
                            window._wildlifeCrosshair.position.set(0, h * 0.7 + 0.5, 0);
                            window._selectedWildlife = animalRoot.userData.species;

                            // Notify UI to highlight Observe button
                            const pf = document.getElementById('panel-frame');
                            if (pf && pf.contentWindow) pf.contentWindow.postMessage({ type: 'HIGHLIGHT_OBSERVE_BTN' }, '*');
                            if (window.parent) window.parent.postMessage({ type: 'LOG_TEXT', text: `Targeted ${window._selectedWildlife}. Press OBSERVE.` }, '*');
                            return; // Stop raycast
                        }
                    } else {
                        if (window._wildlifeCrosshair && window._wildlifeCrosshair.parent) {
                            window._wildlifeCrosshair.removeFromParent();
                            window._selectedWildlife = null;
                        }
                    }

                    // Tree click check (Tunnelled from iFrame)
                    const raycastableTrees = window.allTrees ? window.allTrees.filter(t => !t.isInstanced) : [];
                    if (window._treeTrunksInstanced) raycastableTrees.push(window._treeTrunksInstanced);

                    const treeHits = _tunnelRay.intersectObjects(raycastableTrees, true);
                    if (treeHits.length > 0) {
                        let hitObj = treeHits[0].object;
                        if (hitObj.isInstancedMesh) {
                            // Tree chopping for instanced mesh not supported yet, ignore to allow click-to-move
                        } else {
                            let treeRoot = null;
                            while (hitObj.parent) {
                                if (window.allTrees.includes(hitObj)) {
                                    treeRoot = hitObj;
                                    break;
                                }
                                if (hitObj.parent === null) break; // Prevent infinite loop if parent chain is broken
                                hitObj = hitObj.parent;
                            }
                            if (treeRoot) {
                                if (treeRoot.userData.type === 'balloon') {
                                    // Burst Balloon and Advance Quest 1 -> Quest 2
                                    if (window._questMarker) window._questMarker.visible = false;

                                    // Trigger Confetti
                                    const pGeo = new THREE.BufferGeometry();
                                    const pCount = 50;
                                    const pPos = new Float32Array(pCount * 3);

                                    // treeRoot is the balloon, getting world position
                                    const burstCenter = new THREE.Vector3();
                                    treeRoot.getWorldPosition(burstCenter);

                                    for (let i = 0; i < pCount; i++) {
                                        pPos[i * 3] = burstCenter.x + (Math.random() - 0.5) * 1.5;
                                        pPos[i * 3 + 1] = burstCenter.y + (Math.random() - 0.5) * 1.5;
                                        pPos[i * 3 + 2] = burstCenter.z + (Math.random() - 0.5) * 1.5;
                                    }
                                    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
                                    const pMat = new THREE.PointsMaterial({
                                        color: 0xffd700, size: 0.15, transparent: true, opacity: 1, map: new THREE.TextureLoader().load('Assets/SacredOnes.Particle.png')
                                    });
                                    const particles = new THREE.Points(pGeo, pMat);
                                    scene.add(particles);

                                    let pTime = 0;
                                    const animateParticles = () => {
                                        pTime += 0.016;
                                        if (pTime > 1.5) {
                                            scene.remove(particles);
                                            pGeo.dispose();
                                            pMat.dispose();

                                            // Permanently remove balloon from scene tree
                                            treeRoot.removeFromParent();
                                            return;
                                        }
                                        pMat.opacity = 1.0 - (pTime / 1.5);
                                        const positions = particles.geometry.attributes.position.array;
                                        for (let i = 0; i < pCount; i++) {
                                            positions[i * 3 + 1] -= 0.02; // gravity drop
                                            positions[i * 3] += (Math.random() - 0.5) * 0.05; // flutter X
                                            positions[i * 3 + 2] += (Math.random() - 0.5) * 0.05; // flutter Z
                                        }
                                        particles.geometry.attributes.position.needsUpdate = true;
                                        requestAnimationFrame(animateParticles);
                                    };
                                    animateParticles();

                                    // Update Quest State
                                    if (window.SacredState) window.SacredState.questLevel = 2;

                                    // Open Journal directly to Page 2 (Find Her spread)
                                    const logContainer = document.getElementById('logbook-container');
                                    if (logContainer) {
                                        logContainer.classList.remove('hidden');
                                        setTimeout(() => logContainer.style.opacity = '1', 50);
                                    }

                                    // Re-enable HUD when journal opens
                                    document.body.classList.remove('hud-hidden');

                                    const logIframe = document.getElementById('logbook-frame');
                                    if (logIframe && logIframe.contentWindow) {
                                        // The journal reacts to switchBookTab('journal') but needs a way to force a specific index if needed.
                                        logIframe.contentWindow.postMessage({ type: 'FORCE_OPEN_FIND_HER' }, '*');
                                    }

                                    // DO NOT hide the Guide Card. Explicity update it to the Quest 2 objective.
                                    const pFrame = document.getElementById('panel-frame');
                                    if (pFrame && pFrame.contentWindow) {
                                        pFrame.contentWindow.postMessage({ type: 'UPDATE_QUEST_CARD', desc: 'Find Her' }, '*');
                                    }

                                    window._moveTarget = null;
                                } else if (treeRoot.userData.type === 'axe') {
                                    // Gather axe directly from world
                                    window.parent.postMessage({ type: 'TAKE_AXE' }, '*');
                                    // Also notify iframe to hide card if they open book later
                                    const logIframe = document.getElementById('logbook-frame');
                                    if (logIframe && logIframe.contentWindow) {
                                        logIframe.contentWindow.gatherAxe();
                                    }
                                    window._moveTarget = null;
                                } else if (treeRoot.userData.tipiClickable) {
                                    if (window._selectedTree) deselectTree(window._selectedTree);
                                    window._selectedTree = treeRoot;
                                    highlightTree(treeRoot);
                                } else if (window._selectedTree === treeRoot) {
                                    chopTree(treeRoot, scene);
                                    window._selectedTree = null;
                                } else {
                                    if (window._selectedTree) deselectTree(window._selectedTree);
                                    window._selectedTree = treeRoot;
                                    highlightTree(treeRoot);
                                }
                                return;
                            }
                        }
                    }

                    // Click-to-move
                    if (window._selectedTree) { deselectTree(window._selectedTree); window._selectedTree = null; }
                    const hits = _tunnelRay.intersectObjects(scene.children, true);

                    // Tell the UI Eyes to look at the click position
                    const pf = document.getElementById('panel-frame');
                    if (pf && pf.contentWindow) {
                        pf.contentWindow.postMessage({ type: 'EYE_LOOK', x: _tunnelMouse.x, y: _tunnelMouse.y }, '*');
                    }

                    for (const hit of hits) {
                        if (hit.object.geometry && hit.point.y < 8) { // Height threshold slightly higher for safety
                            window._moveTarget = new THREE.Vector3(hit.point.x, 0, hit.point.z);
                            break;
                        }
                    }
                    // 1. Resize Handler
                    window.addEventListener('resize', () => {
                        if (camera && renderer) {
                            const aspect = window.innerWidth / window.innerHeight;

                            // Maintain standard FPV camera wide aspect ratio unless it's currently shrunk inside the PIP circle
                            if (!window._swapModes) {
                                camera.aspect = aspect;
                                camera.updateProjectionMatrix();
                            }

                            if (pipCamera) {
                                // If PIP is in standard mode, keep it perfectly 1:1 squared
                                if (!window._swapModes && !window._isMapView) {
                                    if (pipCamera.isPerspectiveCamera) {
                                        pipCamera.aspect = 1.0;
                                        pipCamera.updateProjectionMatrix();
                                    }
                                } else {
                                    // Map is full screen! Give it the widescreen aspect
                                    if (pipCamera.isPerspectiveCamera) {
                                        pipCamera.aspect = aspect;
                                        pipCamera.updateProjectionMatrix();
                                    }
                                }
                            }
                            renderer.setSize(window.innerWidth, window.innerHeight);
                        }
                    });
                }
            }, false);

            // 2. Keyboard Handlers (Minimal, Non-Blocking)
            window.addEventListener('keydown', (e) => {
                // Ignore when modifier keys held (CMD+arrow = browser nav, not game)
                if (e.metaKey || e.ctrlKey || e.altKey) return;
                const k = e.key.toLowerCase();
                if (keys.hasOwnProperty(k)) keys[k] = true;

                if (k === 'm') {
                    window.postMessage({ type: 'TOGGLE_VIEW_MODE' }, '*');
                }

                // [DEBUG SUMMONER for Sparse Wildlife]
                if (k === 'p') {
                    console.log("[DEBUG] Teleporting wildlife to player view!");
                    const pDir = new THREE.Vector3();
                    camera.getWorldDirection(pDir);
                    const spawnPos = new THREE.Vector3().copy(camera.position).add(pDir.multiplyScalar(8));

                    if (window.deerSystem && window.deerSystem.deer && window.deerSystem.deer.length > 0) {
                        const d = window.deerSystem.deer[0];
                        d.mesh.position.copy(spawnPos);
                        d.mesh.visible = true;
                        d.phase = 'visible';
                        if (d.target) d.target.copy(spawnPos);
                    }
                    if (window.deerSystem && window.deerSystem.spirit && window.deerSystem.spirit.mesh) {
                        window.deerSystem.spirit.mesh.position.copy(spawnPos).add(new THREE.Vector3(3, 0, 0));
                        window.deerSystem.spirit.mesh.visible = true;
                        window.deerSystem.spirit.phase = 'visible';
                        window.deerSystem.spirit.phaseTimer = 60;
                    }
                    if (window.rabbitSystem && window.rabbitSystem.rabbits && window.rabbitSystem.rabbits.length > 0) {
                        const r = window.rabbitSystem.rabbits[0];
                        r.mesh.position.copy(spawnPos).add(new THREE.Vector3(-3, 0, 0));
                        r.mesh.visible = true;
                        r.state = 0; // IDLE
                    }
                    if (window.squirrelSystem && window.squirrelSystem.squirrels && window.squirrelSystem.squirrels.length > 0) {
                        const s = window.squirrelSystem.squirrels[0];
                        s.mesh.position.copy(spawnPos).add(new THREE.Vector3(-5, 0, 0));
                        s.mesh.visible = true;
                    }
                    if (window.birdSystem && window.birdSystem.solitaryBirds && window.birdSystem.solitaryBirds.length > 0) {
                        const b = window.birdSystem.solitaryBirds[0];
                        b.mesh.position.copy(spawnPos).add(new THREE.Vector3(0, 5, 0));
                        b.baseAlt = spawnPos.y + 5;
                    }
                }

                // Sync UI Eyes for search follow
                const pf = document.getElementById('panel-frame');
                if (pf && pf.contentWindow) {
                    let lx = 0, ly = 0;
                    if (k === 'w' || k === 'arrowup') ly = 0.8;
                    if (k === 's' || k === 'arrowdown') ly = -0.8;
                    if (k === 'a' || k === 'arrowleft') lx = -0.8;
                    if (k === 'd' || k === 'arrowright') lx = 0.8;
                    if (lx !== 0 || ly !== 0) pf.contentWindow.postMessage({ type: 'EYE_LOOK', x: lx, y: ly }, '*');
                }
            }, false);

            window.addEventListener('keyup', (e) => {
                const k = e.key.toLowerCase();
                if (keys.hasOwnProperty(k)) keys[k] = false;
            }, false);

            // Clear stuck keys when window loses focus (CMD+tab etc)
            window.addEventListener('blur', () => {
                for (const k in keys) keys[k] = false;
            });

            // 3. CLICK-TO-MOVE on main 3D viewport
            const _fpvRaycaster = new THREE.Raycaster();
            const _fpvMouse = new THREE.Vector2();
            renderer.domElement.addEventListener('click', (event) => {
                const rect = renderer.domElement.getBoundingClientRect();
                _fpvMouse.set(
                    ((event.clientX - rect.left) / rect.width) * 2 - 1,
                    -((event.clientY - rect.top) / rect.height) * 2 + 1
                );
                _fpvRaycaster.setFromCamera(_fpvMouse, camera);

                // 3b. NATURE SPIRIT check
                if (deerSystem) {
                    _fpvRaycaster._clickPos = _fpvMouse;
                    if (deerSystem.clickSpirit(_fpvRaycaster, camera)) return;
                }

                // 3c. FOREST INTERACTION (Highlight & Chop)
                if (window._treeInstancedMeshes && window._treeInstancedMeshes.length > 0) {
                    const treeMeshes = window._treeInstancedMeshes.map(tm => tm.instancedMesh);
                    const treeHits = _fpvRaycaster.intersectObjects(treeMeshes, false);

                    if (treeHits.length > 0) {
                        const hit = treeHits[0];
                        const instanceId = hit.instanceId;

                        if (window._selectedTreeId === instanceId) {
                            // REQUIRE AXE TO CHOP
                            if (!window._hasGottenAxe) {
                                window.parent.postMessage({ type: 'LOG_TEXT', text: "You need an axe to chop this." }, '*');
                                if (window._selectedTreeId !== null) {
                                    if (window._treeHighlightMesh) window._treeHighlightMesh.visible = false;
                                    window._selectedTreeId = null;
                                }
                                return;
                            }

                            // Prevent chopping if already chopping
                            if (window._choppingTimer > 0) return;

                            // SECOND CLICK: CHOP DOWN (Start Animation)
                            window._chopTargetInstanceId = instanceId;
                            window._choppingTimer = 1.6; // 1.6s duration

                            // Setup equipped FPV axe if not already setup
                            if (!window._equippedAxe && window._axeMesh) {
                                window._equippedAxe = window._axeMesh.clone();
                                window._equippedAxe.traverse(child => {
                                    if (child.isMesh && child.material) {
                                        child.material = child.material.clone();
                                        if (child.material.emissive) child.material.emissive.setHex(0x000000);
                                    }
                                });
                                // Equip it relative to the camera
                                camera.add(window._equippedAxe);
                                window._equippedAxe.position.set(0.6, -0.6, -1.2); // Bottom Right
                                window._equippedAxe._baseRotation = new THREE.Vector3(Math.PI / 4, -Math.PI / 6, 0);
                                window._equippedAxe.rotation.setFromVector3(window._equippedAxe._baseRotation);
                                window._equippedAxe.scale.set(0.6, 0.6, 0.6); // Slightly smaller for FPV view
                            }

                            if (window._equippedAxe) {
                                window._equippedAxe.visible = true;
                            }
                        } else {
                            // FIRST CLICK: SELECT AND HIGHLIGHT
                            window._selectedTreeId = instanceId;

                            // Extract precise world origin from the Instanced array
                            const matrix = new THREE.Matrix4();
                            hit.object.getMatrixAt(instanceId, matrix);
                            const position = new THREE.Vector3().setFromMatrixPosition(matrix);

                            if (!window._treeHighlightMesh) {
                                const geo = new THREE.TorusGeometry(1.5, 0.15, 8, 32);
                                geo.rotateX(Math.PI / 2);
                                const mat = new THREE.MeshStandardMaterial({
                                    color: 0x00ffaa, emissive: 0x00ff55, emissiveIntensity: 1.0,
                                    transparent: true, opacity: 0.8
                                });
                                window._treeHighlightMesh = new THREE.Mesh(geo, mat);
                                window._treeHighlightMesh.renderOrder = 999;
                                scene.add(window._treeHighlightMesh);
                            }
                            window._treeHighlightMesh.position.copy(position);
                            window._treeHighlightMesh.position.y += 0.2; // Float slightly above terrain
                            window._treeHighlightMesh.visible = true;

                            // Deduplicate axe highlight if open
                            if (window._axeMesh && window._axeMesh.userData.highlighted) {
                                window._axeMesh.userData.highlighted = false;
                                window._axeMesh.scale.multiplyScalar(1.0 / 1.2);
                                window._axeMesh.traverse(child => {
                                    if (child.isMesh && child.material) child.material.emissive.setHex(child.userData.origEmissive || 0x000000);
                                });
                            }

                            window.parent.postMessage({ type: 'LOG_TEXT', text: "Pine tree selected. Click again to chop." }, '*');
                        }
                        return; // Prevent fallthrough walk-to
                    }
                }

                // 3d. Check for non-tree interactables like the loose scene axe
                if (window._axeMesh) {
                    const hitAxe = _fpvRaycaster.intersectObject(window._axeMesh, true);
                    if (hitAxe.length > 0 && window._axeMesh.visible) {
                        if (!window._axeMesh.userData.highlighted) {
                            // FIRST CLICK: Highlight and select
                            window._axeMesh.userData.highlighted = true;
                            // Scale up
                            window._axeMesh.scale.multiplyScalar(1.2);
                            // Add glowing emissive highlight
                            window._axeMesh.traverse(child => {
                                if (child.isMesh && child.material) {
                                    child.userData.origEmissive = child.material.emissive ? child.material.emissive.getHex() : 0x000000;
                                    if (!child.material.emissive) child.material.emissive = new THREE.Color(0x000000);
                                    child.material.emissive.setHex(0x555500);
                                }
                            });

                            // Deselect any trees so user knows focus changed
                            if (window._selectedTree) {
                                deselectTree(window._selectedTree);
                                window._selectedTree = null;
                            }
                            // Notify UI of selection
                            window.parent.postMessage({ type: 'LOG_TEXT', text: "Stone Axe selected. Click again to gather." }, '*');

                        } else {
                            // SECOND CLICK: Gather
                            // 1. Calculate the 2D screen coordinate of the Axe for the DOM animation
                            const axePos = new THREE.Vector3();
                            window._axeMesh.getWorldPosition(axePos);

                            const vector = axePos.project(camera); // Returns normalized device coordinates (-1 to +1)
                            const screenX = (vector.x * .5 + .5) * window.innerWidth;
                            const screenY = (vector.y * -.5 + .5) * window.innerHeight;

                            // 2. Dispatch animation signal to the UI Parent
                            window.parent.postMessage({
                                type: 'ANIMATE_GATHER_TO_BAG',
                                item: 'axe',
                                startX: screenX,
                                startY: screenY
                            }, '*');

                            // 3. Dispatch actual quest/inventory payload
                            window.parent.postMessage({ type: 'TAKE_AXE' }, '*');

                            // 4. Update iframe (if open/loaded)
                            const logIframe = document.getElementById('logbook-frame');
                            if (logIframe && logIframe.contentWindow && typeof logIframe.contentWindow.gatherAxe === 'function') {
                                logIframe.contentWindow.gatherAxe();
                            }
                        }
                        return;
                    }
                }

                // 3e. Click-to-move fallback (only if no interactables hit)
                if (window._selectedTreeId !== null && window._selectedTreeId !== undefined) {
                    if (window._treeHighlightMesh) window._treeHighlightMesh.visible = false;
                    window._selectedTreeId = null;
                }

                const hits = _fpvRaycaster.intersectObjects(scene.children, true);
                for (const hit of hits) {
                    // Only walk on terrain/ground (Height threshold slightly higher for safety)
                    if (hit.object.geometry && hit.point.y < 8) {
                        window._moveTarget = new THREE.Vector3(hit.point.x, 0, hit.point.z);
                        break;
                    }
                }
            });
        }

        // AMBIENT BIRDSONG — plays on load, 50% volume, loops
        const birdsong = new Audio('Assets/birdsong.mp3');
        birdsong.volume = 0.4;
        birdsong.loop = true;
        window._birdsongAudio = birdsong; // EXPORT FOR INPUT MANAGER TO CONTROL
        let birdsongStarted = false;
        window.startBirdsong = () => {
            if (birdsongStarted) return;
            birdsongStarted = true;
            birdsong.play().then(() => {
                // Remove all listeners ONLY once successfully started by a trusted interaction token
                document.removeEventListener('click', window.startBirdsong);
                document.removeEventListener('keydown', window.startBirdsong);
                document.removeEventListener('touchstart', window.startBirdsong);
                document.removeEventListener('pointerdown', window.startBirdsong);
                window.removeEventListener('message', window.startBirdsong);
            }).catch(() => { birdsongStarted = false; });
        };
        // Try immediately (works if autoplay allowed)
        window.startBirdsong();
        // Also trigger on any user interaction (iframe gets messages from panel)
        document.addEventListener('click', window.startBirdsong);
        document.addEventListener('keydown', window.startBirdsong);
        document.addEventListener('touchstart', window.startBirdsong);
        document.addEventListener('pointerdown', window.startBirdsong);
        window.addEventListener('message', window.startBirdsong);

        // --- REUSABLE VECTORS (avoid allocating every frame) ---
        const _dir = new THREE.Vector3();
        const _right = new THREE.Vector3();
        const _up = new THREE.Vector3(0, 1, 0);
        const _walkDir = new THREE.Vector3();
        const _pipFwd = new THREE.Vector3();

        // --- CLICK-TO-MOVE VISUAL INDICATOR ---
        // Flat gold donut ring at destination
        const _markerGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 24);
        _markerGeo.rotateX(Math.PI / 2); // Lay flat on ground
        const _markerMat = new THREE.MeshStandardMaterial({
            color: 0xffd700, emissive: 0xffa000, emissiveIntensity: 0.8,
            transparent: true, opacity: 0.7
        });
        const _marker = new THREE.Mesh(_markerGeo, _markerMat);
        _marker.visible = false;
        _marker.renderOrder = 998;
        let _markerAdded = false;

        // --- CACHED DOM ELEMENTS ---
        let _timeEl, _statsEl, _moonFrame;
        function cacheDOMElements() {
            _timeEl = document.getElementById('time-display');
            _statsEl = document.getElementById('dev-fps') || document.getElementById('stats-hud');
            _moonFrame = document.getElementById('moondial-frame');
        }
        // Cache after DOM ready
        setTimeout(cacheDOMElements, 100);

        let cameraPitch = 0;

        // function updateMovement(delta) {} // Removed

        function animate() {
            requestAnimationFrame(animate);
            const delta = clock.getDelta();
            frameCount++;


            // PASSIVE GRAVITY (Follow Terrain)
            const x = camera.position.x;
            const z = camera.position.z;
            const groundY = window._getGroundY ? window._getGroundY(x, z)
                : Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2 + Math.sin(x * 0.3 + z * 0.2) * 0.5;

            // --- MOVEMENT LOGIC ---
            const SPEED = 5.0;
            const TURN_SPEED = 2.0;
            let isMoving = false;

            if (!window._isCinematic) {
                // 1. Rotation (Keyboard A/D + Arrows + Keypad)
                if (keys.arrowleft || keys.a) { camera.rotation.y += TURN_SPEED * delta; isMoving = true; }
                if (keys.arrowright || keys.d) { camera.rotation.y -= TURN_SPEED * delta; isMoving = true; }

                // 2. Direction Vectors (reuse pre-allocated)
                camera.getWorldDirection(_dir);
                _dir.y = 0; _dir.normalize();

                _right.crossVectors(_dir, _up).normalize();

                // 3. Move (WASD + Arrows)
                if (keys.w || keys.arrowup) { camera.position.addScaledVector(_dir, SPEED * delta); isMoving = true; }
                if (keys.s || keys.arrowdown) { camera.position.addScaledVector(_dir, -SPEED * delta); isMoving = true; }

                // 3a. Virtual thumbstick (from panel iframe)
                const tx = window._thumbX || 0;
                const ty = window._thumbY || 0;
                if (Math.abs(tx) > 0.1 || Math.abs(ty) > 0.1) {
                    // Autoturn: X axis turns the player
                    if (Math.abs(tx) > 0.1) {
                        camera.rotation.y -= tx * TURN_SPEED * 1.5 * delta;
                    }
                    // Move: Y axis moves forward/backward
                    if (Math.abs(ty) > 0.1) {
                        camera.position.addScaledVector(_dir, -ty * SPEED * delta);
                    }
                    isMoving = true;
                }

                // 3b. CLICK-TO-MOVE auto-walk (from PIP map click or Gather)
                if (window._moveTarget && !isMoving) {
                    const target = window._moveTarget;
                    const dx = target.x - camera.position.x;
                    const dz = target.z - camera.position.z;
                    const dist = Math.sqrt(dx * dx + dz * dz);

                    if (dist > 1.2) {
                        _dir.set(dx, 0, dz).normalize();
                        const currentSpeed = window._slowWalkcinematic ? (SPEED * 0.3) : SPEED;
                        camera.position.addScaledVector(_dir, currentSpeed * delta);

                        // Face target (Camera looks down -Z, so add PI)
                        if (!window._activeLookTarget) {
                            const targetAngle = Math.atan2(dx, dz) + Math.PI;

                            // Shortest path interpolation for angle
                            let diff = targetAngle - camera.rotation.y;
                            while (diff < -Math.PI) diff += Math.PI * 2;
                            while (diff > Math.PI) diff -= Math.PI * 2;

                            camera.rotation.y += diff * delta * 5.0;
                        }
                        isMoving = true;
                    } else {
                        // Reached the coordinate target
                        window._moveTarget = null;
                        window._activeLookTarget = null; // Clear the cinematic look lock
                        if (window._autoWalkCompleteEvent) {
                            window._autoWalkCompleteEvent();
                            window._autoWalkCompleteEvent = null;
                        }

                        // Remove legacy redundant arrival checks from dist loop

                        // Start chopping if we have a target
                        if (window._choppingTarget && !window._isCinematic) {
                            if (window._choppingTimer === undefined || window._choppingTimer === null) {
                                window._choppingTimer = 1.2; // 1.2s total chop
                            }
                        } else if (!window._isCinematic) {
                            window._moveTarget = null;
                        }

                        if (window._lookTarget) {
                            window._activeLookTarget = window._lookTarget;
                            window._lookTarget = null;
                        }
                    }
                } else if (isMoving && (window._moveTarget || (window._choppingTimer || 0) > 0)) {
                    window._moveTarget = null; // Manual input cancels auto-walk
                    window._lookTarget = null;
                    window._activeLookTarget = null;
                    window._choppingTarget = null;
                    window._choppingTimer = 0;
                }
            } // End of !window._isCinematic wrapper

            // --- PROXIMITY QUEST TRIGGER (Manual Walking) ---
            if (window.SacredState && window.SacredState.questLevel === 2 && window._bhgGroup && !window._isCinematic && !window._pendingTipiGreeting) {
                const dx = camera.position.x - window._bhgGroup.position.x;
                const dz = camera.position.z - window._bhgGroup.position.z;
                if ((dx * dx + dz * dz) < 144) { // 12 units radius
                    window.SacredState.questLevel = 3;
                    window._hasTriggeredGirlQuest = true; // Legacy binding support

                    // Hide floating quest marker 2 if it exists since we are in the dialogue now
                    if (window._questMarker2) window._questMarker2.visible = false;
                    // OPEN JOURNAL TO PAGE 5 FOR THE QUEST
                    setTimeout(() => {
                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) {
                            panel.contentWindow.postMessage({ type: 'FORCE_OPEN_FOUND_HER' }, '*');
                        }
                    }, 500);
                }
            }
            // 3c. CHOPPING PROGRESS
            if ((window._choppingTimer || 0) > 0) {
                window._choppingTimer -= delta;

                // Animate FPV Axe Swinging
                if (window._equippedAxe && window._equippedAxe.visible) {
                    const swingPhase = (1.6 - window._choppingTimer) * Math.PI * 4; // roughly 2+ full swings
                    const dip = Math.sin(swingPhase);
                    window._equippedAxe.rotation.x = window._equippedAxe._baseRotation.x + Math.max(0, dip) * 1.5;
                    window._equippedAxe.position.y = -0.6 - Math.max(0, dip) * 0.4;
                }

                if (window._choppingTarget) {
                    // Legacy non-instanced tree shake
                    window._choppingTarget.rotation.z = Math.sin(Date.now() * 0.05) * 0.03;
                    // Face tree while chopping
                    const t = window._choppingTarget.position;
                    const c = camera.position;
                    const angle = Math.atan2(t.x - c.x, t.z - c.z);
                    camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, angle, delta * 10);
                } else if (window._chopTargetInstanceId !== null && window._chopTargetInstanceId !== undefined) {
                    // Shake camera slightly on hit for instanced trees
                    const dip = Math.sin((1.6 - window._choppingTimer) * Math.PI * 4);
                    if (dip > 0.95) camera.rotation.x += Math.random() * 0.005 - 0.0025;
                }

                if (window._choppingTimer <= 0) {
                    // Hide axe
                    if (window._equippedAxe) window._equippedAxe.visible = false;

                    if (window._choppingTarget) {
                        if (typeof chopTree === 'function') chopTree(window._choppingTarget, scene);
                        window._choppingTarget = null;
                    } else if (window._chopTargetInstanceId !== null && window._chopTargetInstanceId !== undefined) {
                        // Destroy Instanced Tree
                        const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
                        if (window._treeInstancedMeshes) {
                            window._treeInstancedMeshes.forEach(({ instancedMesh }) => {
                                instancedMesh.setMatrixAt(window._chopTargetInstanceId, zeroMatrix);
                                instancedMesh.instanceMatrix.needsUpdate = true;
                            });
                        }
                        if (window._treeHighlightMesh) window._treeHighlightMesh.visible = false;
                        window._selectedTreeId = null;
                        window._chopTargetInstanceId = null;

                        if (window.parent) window.parent.postMessage({ type: 'LOG_TEXT', text: "You chopped down a pine tree." }, '*');
                        // Award Wood
                        if (window.parent) window.parent.postMessage({ type: 'RESOURCE_UPDATE', resource: 'wood', amount: 1 }, '*');
                    }
                    window._moveTarget = null;
                    window._choppingTimer = 0;
                }
                return; // Freeze movement while chopping
            }

            if (window._activeLookTarget) {
                // Smoothly turn to face the lookTarget after arriving (or during cinematic walk)
                const t = window._activeLookTarget;
                const dx = t.x - camera.position.x;
                const dz = t.z - camera.position.z;
                const targetAngle = Math.atan2(-dx, -dz);
                let angleDiff = targetAngle - camera.rotation.y;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                if (Math.abs(angleDiff) > 0.02) {
                    camera.rotation.y += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TURN_SPEED * 1.5 * delta);
                } else {
                    if (!isMoving) {
                        window._activeLookTarget = null; // Finished looking
                        if (window._lookCompleteEvent) {
                            window._lookCompleteEvent();
                            window._lookCompleteEvent = null;
                        }
                    }
                }
            }

            // 3c. Update click-to-move visual indicator
            if (!_markerAdded && scene) {
                scene.add(_marker);
                _markerAdded = true;
            }
            if (window._moveTarget) {
                const t = window._moveTarget;
                const groundAtTarget = window._getGroundY ? window._getGroundY(t.x, t.z)
                    : Math.sin(t.x * 0.1) * Math.cos(t.z * 0.1) * 2 + Math.sin(t.x * 0.3 + t.z * 0.2) * 0.5;
                _marker.visible = false;
                _marker.position.set(t.x, groundAtTarget + 0.05, t.z);
                _marker.material.opacity = 0.5 + Math.sin(performance.now() * 0.004) * 0.2;
            } else {
                _marker.visible = false;
            }

            // 3.5 Hover Physics for Tipi 2 Magical Axe
            if (window._worldAxeMesh) {
                window._worldAxeMesh.position.y = 1.2 + Math.sin(performance.now() * 0.002) * 0.15;
                window._worldAxeMesh.rotation.y += delta * 0.5;
            }

            // 4. Head Bob Animation (Walking)
            let bobOffset = 0;
            if (isMoving || window._isCinematicWalking) {
                headBobTimer += delta * 12; // Walking frequency
                bobOffset = Math.sin(headBobTimer) * 0.15; // Amplitude

                // 4a. Update Quest Proximity (only while moving to save cycles)
                const panelFrame = document.getElementById('panel-frame');
                if (panelFrame && panelFrame.contentWindow) {
                    let nearestDist = Infinity;
                    let nearestId = 'tipi';

                    // Check Main Tipi (0, 0)
                    if (!window._questMarker || window._questMarker.visible) {
                        const dTipi = Math.sqrt(Math.pow(camera.position.x - 0, 2) + Math.pow(camera.position.z - 0, 2));
                        if (dTipi < nearestDist) {
                            nearestDist = dTipi;
                            nearestId = 'tipi';
                        }
                    }

                    // Check Brings Happiness Girl (35, 45)
                    if (window._bhgBalloon && window._bhgBalloon.visible) {
                        const dBhg = Math.sqrt(Math.pow(camera.position.x - 35, 2) + Math.pow(camera.position.z - 45, 2));
                        if (dBhg < nearestDist) {
                            nearestDist = dBhg;
                            nearestId = 'bhg';
                        }
                    }

                    if (nearestDist === Infinity) {
                        nearestDist = Math.sqrt(Math.pow(camera.position.x - 0, 2) + Math.pow(camera.position.z - 0, 2)); // fallback
                    }

                    // Convert meters to feet (1m = ~3.28ft)
                    const distFeet = Math.round(nearestDist * 3.28084);

                    // Throttle postMessage slightly using a simple frame counter or just send it since it's only while moving
                    if (!window._lastDistFeet || Math.abs(window._lastDistFeet - distFeet) >= 2 || window._lastNearestId !== nearestId) {
                        window._lastDistFeet = distFeet;
                        window._lastNearestId = nearestId;
                        panelFrame.contentWindow.postMessage({ type: 'QUEST_DISTANCE_UPDATE', distance: distFeet, nearestId: nearestId }, '*');
                    }
                }
            } else {
                headBobTimer = 0;
            }

            // 4b. Notify panel of movement state (for guide card transparency)
            if (isMoving !== window._lastMovingState) {
                window._lastMovingState = isMoving;
                const panelFrame = document.getElementById('panel-frame');
                if (panelFrame && panelFrame.contentWindow) {
                    panelFrame.contentWindow.postMessage({ type: 'playerMoving', moving: isMoving }, '*');
                }
            }

            // Apply Height (Terrain + Height + Bob)
            const BASE_HEIGHT = 1.7;
            const GRAVITY = 9.8;
            player.dy = (player.dy || 0) - GRAVITY * delta;

            // Calc target Y
            let targetY = camera.position.y + player.dy * delta;

            // Floor Snap with Bob
            if (targetY < groundY + BASE_HEIGHT + bobOffset) {
                camera.position.y = groundY + BASE_HEIGHT + bobOffset;
                player.dy = 0;
            } else {
                camera.position.y = targetY;
            }

            // Sync player object
            player.x = camera.position.x;
            player.z = camera.position.z;

            // --- PATHFINDING VISUAL UPDATE ---
            if (window._moveTarget && window._pathLine && window._targetRing) {
                window._pathLine.visible = true;
                window._targetRing.visible = true;
                
                // Update Target Ring Height
                window._targetRing.position.set(window._moveTarget.x, (window.envBuilder && typeof window.envBuilder.getGroundY === 'function') ? window.envBuilder.getGroundY(window._moveTarget.x, window._moveTarget.z) + 0.1 : 0.1, window._moveTarget.z);
                window._targetRing.scale.setScalar(1.0 + Math.sin(gameTime * 10) * 0.1);

                // Update Line
                const positions = window._pathLine.geometry.attributes.position.array;
                positions[0] = camera.position.x;
                positions[1] = groundY + 0.2;
                positions[2] = camera.position.z;
                positions[3] = window._moveTarget.x;
                positions[4] = window._targetRing.position.y;
                positions[5] = window._moveTarget.z;
                window._pathLine.geometry.attributes.position.needsUpdate = true;
                window._pathLine.computeLineDistances();
                
                // Marching Ants Animation
                window._pathLine.material.dashOffset -= delta * 5.0;
            } else if (window._pathLine && window._targetRing) {
                window._pathLine.visible = false;
                window._targetRing.visible = false;
            }

            // --- AVATAR SYNCHRONIZATION ---
            if (window._playerAvatarMixer) {
                window._playerAvatarMixer.update(delta);
                
                // Crossfade animation states
                if (window._avIdleAction && window._avWalkAction) {
                    if (isMoving && !window._avIsWalking) {
                        window._avIsWalking = true;
                        window._avWalkAction.setEffectiveWeight(1);
                        window._avIdleAction.setEffectiveWeight(0);
                        window._avWalkAction.crossFadeFrom(window._avIdleAction, 0.3, true);
                        const panelFrame = document.getElementById('panel-frame');
                        if (panelFrame && panelFrame.contentWindow) panelFrame.contentWindow.postMessage({ type: 'AVATAR_ANIM_CHANGE', anim: 'walk' }, '*');
                    } else if (!isMoving && window._avIsWalking) {
                        window._avIsWalking = false;
                        window._avIdleAction.setEffectiveWeight(1);
                        window._avWalkAction.setEffectiveWeight(0);
                        window._avIdleAction.crossFadeFrom(window._avWalkAction, 0.3, true);
                        const panelFrame = document.getElementById('panel-frame');
                        if (panelFrame && panelFrame.contentWindow) panelFrame.contentWindow.postMessage({ type: 'AVATAR_ANIM_CHANGE', anim: 'idle' }, '*');
                    }
                }
            }

            if (window.bhgMixer) {
                window.bhgMixer.update(delta);
            }
            if (window._playerAvatar) {
                // Pin the avatar to the camera's world coordinates, dropping Y to foot level
                window._playerAvatar.position.copy(camera.position);
                window._playerAvatar.position.y -= 1.6;

                // Extract 2D Planar Yaw (XZ rotation) to match the player's FPV look direction
                const camDir = new THREE.Vector3();
                camera.getWorldDirection(camDir);
                camDir.y = 0;
                camDir.normalize();
                window._playerAvatar.rotation.y = Math.atan2(camDir.x, camDir.z);
            }
            player.rot = camera.rotation.y;

            // --- TIME & SUN ---
            // If the user clicked a season, fast forward smoothly to the destination!
            if (window._targetGameTime !== undefined) {
                // Determine shortest path (direct or across midnight boundary)
                // Actually simple lerp is fine since seasons don't cross zero except night
                window._manualTimeMode = true;
                const diff = window._targetGameTime - gameTime;
                if (Math.abs(diff) < 0.1) {
                    gameTime = window._targetGameTime;
                    window._targetGameTime = undefined;
                } else {
                    gameTime += diff * delta * 2.0; 
                }
            } else if (window._isTimeLocked) {
                // Time is explicitly locked by God Mode — no clock advancement allowed
            } else if (!window._manualTimeMode) {
                // Advance Time
                // Slow down extremely realistically (1 game hour = ~200 real seconds)
                gameTime += delta * 0.005; 
                if (gameTime >= 24) gameTime -= 24;
            } else {
                gameTime += delta * 0.01;
                if (gameTime >= 24) gameTime -= 24;
            }

            // Day/Night Cycle Shaders
            if (window._skyUniforms && window._sceneFog && window._sceneTarget) {
                // Colors (R, G, B, Intensity)
                const ND = { t: [6, 11, 19], m: [13, 27, 42], b: [58, 69, 85], f: [58, 69, 85], i: 0.1 }; // Night Dark
                const DW = { t: [58, 90, 122], m: [125, 164, 199], b: [201, 213, 227], f: [201, 213, 227], i: 0.6 }; // Dawn
                const DY = { t: [255, 170, 34], m: [255, 213, 128], b: [255, 241, 202], f: [255, 241, 202], i: 1.0 }; // Day Happy
                const DK = { t: [65, 82, 112], m: [220, 140, 80], b: [255, 190, 120], f: [255, 190, 120], i: 0.4 }; // Dusk (Warm bright instead of purple)
                const GY = { t: [140, 145, 150], m: [160, 165, 170], b: [180, 185, 190], f: [180, 185, 190], i: 0.5 }; // Gray Overcast
                
                let p1, p2, prog;
                if (window._isOvercastMode) {
                    p1 = GY; p2 = GY; prog = 1.0;
                } else if (gameTime >= 4 && gameTime < 8) { p1 = ND; p2 = DW; prog = (gameTime - 4) / 4; } // Night -> Dawn
                else if (gameTime >= 8 && gameTime < 11) { p1 = DW; p2 = DY; prog = (gameTime - 8) / 3; } // Dawn -> Day
                else if (gameTime >= 11 && gameTime < 17) { p1 = DY; p2 = DY; prog = 1.0; } // Day
                else if (gameTime >= 17 && gameTime < 20) { p1 = DY; p2 = DK; prog = (gameTime - 17) / 3; } // Day -> Dusk
                else if (gameTime >= 20 && gameTime < 22) { p1 = DK; p2 = ND; prog = (gameTime - 20) / 2; } // Dusk -> Night
                else { p1 = ND; p2 = ND; prog = 1.0; } // Night (22 to 4)

                // Lerp helper
                const lerpRGB = (arr1, arr2, p) => new THREE.Color(
                    (arr1[0] + (arr2[0] - arr1[0]) * p) / 255.0,
                    (arr1[1] + (arr2[1] - arr1[1]) * p) / 255.0,
                    (arr1[2] + (arr2[2] - arr1[2]) * p) / 255.0
                );

                window._skyUniforms.topColor.value.copy(lerpRGB(p1.t, p2.t, prog));
                window._skyUniforms.midColor.value.copy(lerpRGB(p1.m, p2.m, prog));
                window._skyUniforms.bottomColor.value.copy(lerpRGB(p1.b, p2.b, prog));
                
                const fogColor = lerpRGB(p1.f, p2.f, prog);
                window._sceneFog.color.copy(fogColor);
                window._sceneTarget.background.copy(fogColor);
                
                if (window.sunLight) {
                    window.sunLight.intensity = Math.max(p1.i + (p2.i - p1.i) * prog, 0.1);
                }
            }

            // Update Sun Position
            const angle = (gameTime / 24) * Math.PI * 2 - Math.PI / 2; // -PI/2 to start at sunrise approx

            if (window.sunLight) {
                // Keep the light orbiting, but relative to the player so shadows never clip
                const rx = camera.position.x + Math.cos(angle) * 100;
                const ry = Math.sin(angle) * 100; // Rise and set
                const rz = camera.position.z - 30; // Slight offset from sun angle
                window.sunLight.position.set(rx, Math.max(ry, -10), rz); // Clamp min Y so shadows don't break

                // Point target directly at player
                window.sunLight.target.position.copy(camera.position);
                window.sunLight.target.updateMatrixWorld();
            }
            
            // Update Moon position opposite the sun
            if (window._3dMoonGroup && window._3dMoonGroup.visible) {
                if (camera && camera.isPerspectiveCamera) {
                    const fwd = new THREE.Vector3();
                    camera.getWorldDirection(fwd);
                    fwd.y = 0; fwd.normalize();
                    
                    // Keep moon fixed at a comfortable angle in the player's FOV
                    window._3dMoonGroup.position.set(
                        camera.position.x + fwd.x * 250,
                        camera.position.y + 60, // Lowered from 120 to 60 for better FPV visibility
                        camera.position.z + fwd.z * 250
                    );
                    
                    if (window._3dMoonMesh && window._currentForcePhase !== undefined) {
                        const phaseMod = Math.abs(window._currentForcePhase - 4) / 4; 
                        window._3dMoonMesh.scale.x = (window._currentForcePhase === 0) ? 0.01 : 1.0;
                        window._3dMoonMesh.material.emissiveIntensity = 1.0 - (phaseMod * 0.9);
                    }
                }
            }

            // Update UI
            const hours = Math.floor(gameTime);
            const minutes = Math.floor((gameTime - hours) * 60);
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const h12 = hours % 12 || 12;

            const timeStr = `${h12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm} `;
            if (_timeEl) _timeEl.innerText = timeStr;

            // Update Grandfather Clock Sun Dial Rotation
            const celestialDial = document.getElementById('celestial-dial');
            if (celestialDial) {
                // Use the GAME time to drive the Sun Dial, not local PC time!
                // 12 (Noon) = 0deg (Sun at top), 0 (Midnight) = 180deg (Moon at top)
                const dialAngle = ((gameTime - 12) / 24) * 360;
                celestialDial.style.transform = `rotate(${dialAngle}deg)`;

                // Keep the emoji icons constantly pointing upwards despite the rotation
                const cSun = document.getElementById('c-sun');
                const cMoon = document.getElementById('c-moon');
                if (cSun) cSun.style.transform = `translateX(-50%) rotate(${-dialAngle}deg)`;
                // Moon started upside-down visually so we offset its reverse rotation by +180
                if (cMoon) cMoon.style.transform = `translateX(-50%) rotate(${-dialAngle + 180}deg)`;
            }
            
            // Constantly sync Moon Phase widget
            window.postMessage({ type: 'UPDATE_MOON', time: gameTime }, '*');

            // Sync Compass UI to the player's world camera rotation
            const compassRing = document.querySelector('.compass-outer-ring');
            const compassTextLayer = document.querySelector('.compass-text-layer');

            if (compassRing) {
                // Convert camera Y radians to degrees and invert it for the compass layout.
                const compassTurnDeg = THREE.MathUtils.radToDeg(camera.rotation.y);
                compassRing.style.transform = `rotate(${compassTurnDeg}deg)`;

                if (compassTextLayer) {
                    compassTextLayer.style.transform = `rotate(${compassTurnDeg}deg)`;

                    // Keep the N/S/E/W markers beautifully upright no matter how the compass spins
                    compassTextLayer.querySelectorAll('.compass-marker').forEach(marker => {
                        if (marker.classList.contains('e') || marker.classList.contains('w')) {
                            marker.style.transform = `translateY(-50%) rotate(${-compassTurnDeg}deg)`;
                        } else {
                            marker.style.transform = `translateX(-50%) rotate(${-compassTurnDeg}deg)`;
                        }
                    });
                }
            }

            // === ANIMATE BUTTERFLY SPIRIT ===
            if (window._butterflySpirit) {
                window._butterflySpirit.position.y += Math.sin(frameCount * 0.05) * 0.005;
                window._butterflySpirit.rotation.y += delta * 0.5;
            }

            // --- PIP / MAIN SWAP RENDER (gated by FuzzyBrain) ---
            // Allow PIP strictly even when _isMapView is true so that FPV does not freeze at 1fps
            const shouldPIP = window._isAxeCameraCloned !== true && (typeof fuzzyBrain !== 'undefined' && fuzzyBrain ? fuzzyBrain.shouldRenderPIP() : true);
            let drewMapMain = false;

            if (typeof pipCamera !== 'undefined' && pipCamera) {
                // Animal Crossing Tilted Orthographic Map Perspective (35-degree tilt)
                const heightY = 150;
                const tiltZ = heightY * Math.tan(35 * Math.PI / 180); // Extreme Animal Crossing tilt
                if (!pipCamera.isPerspectiveCamera) {
                    pipCamera.position.set(
                        camera.position.x,
                        Math.max(camera.position.y + heightY, heightY),
                        camera.position.z + tiltZ
                    );
                    // Look exactly straight down (-Y)
                    pipCamera.up.set(0, 1, 0); // Force North facing UP
                    pipCamera.lookAt(camera.position.x, Math.max(camera.position.y, 0), camera.position.z);
                } else {
                    // Just trail it behind slightly
                    pipCamera.position.copy(camera.position);
                    pipCamera.rotation.copy(camera.rotation);
                }

                // Update Green Shader Time variables
                // Shader time updates handled natively inside RenderTarget passes below
                if (window._pipMat) window._pipMat.uniforms.time.value += delta;
                if (window._mapMat) window._mapMat.uniforms.time.value += delta;

                // SCENARIOS decoupled from execution to prevent z-fighting / erasing
                if (window._isMapView || window._swapModes) {
                    drewMapMain = true;
                    if (shouldPIP && !window._isLogbookOpen) window._pendingPipCamera = camera;
                    else window._pendingPipCamera = null;
                } else {
                    drewMapMain = false;
                    if (shouldPIP && !window._isLogbookOpen) window._pendingPipCamera = pipCamera;
                    else window._pendingPipCamera = null;
                }




                // No webGLCircularMask local definition. Hardware Blit will be executed before Main Render.
            } else {
                window._pendingPipCamera = null;
            }

            // --- TIPI JOURNAL FEED RENDER (Hardware Canvas Overlay) ---
            // --- USER REQUEST: DISABLE ALL LOGBOOK PIP FEEDS FOR 60 FPS RESTORATION ---
            if (false && window._isLogbookOpen && window.tipiCanvas2D && window.tipiCanvas2D.style.display === 'block') {
                // Add tiny procedural sway (Handheld camera effect)
                const swayT = performance.now() * 0.0005;
                const sx = Math.sin(swayT) * 0.15;
                const sy = Math.cos(swayT * 0.8) * 0.1;

                const target = window._tipiPipTarget;

                // --- PIP CAMERA ROUTING (Axe, Quest Cams, Portraits) ---
                let usePerspective = false;
                try {
                    let handled = false;
                    if (target === 'bringsHappinessGirlPortrait' && window._bhgGroup) {
                        const facePos = new THREE.Vector3();
                        if (window._bhgCharacterMesh) {
                            window._bhgCharacterMesh.getWorldPosition(facePos);
                        } else {
                            facePos.copy(window._bhgGroup.position);
                        }
                        facePos.y += 1.0; // Raise to face level

                        // For cam shot of Happiness girl, stand directly in front so we don't clip into the Tipi she is standing against.
                        const radius = 2.5 + Math.sin(swayT * 0.4) * 1.5; // Zoom in / out

                        tipiOrthoCam.position.set(
                            facePos.x + Math.sin(swayT * 0.3) * 0.5, // Slight side-to-side drift
                            facePos.y + Math.cos(swayT * 0.6) * 0.2,
                            facePos.z - radius // Always in front of her (she faces -Z)
                        );
                        tipiOrthoCam.lookAt(facePos.x, facePos.y - 0.2, facePos.z);
                        handled = true;


                        try {
                            if (window.bhgMixer && window.bhgMixer._actions && window.bhgMixer._actions.length > 0) {
                                let waveClip = window.bhgMixer._actions.find(a => (a.getClip ? a.getClip().name : a._clip.name).toLowerCase().includes('wave'));
                                if (!waveClip && window.bhgMixer._actions.length > 1) { waveClip = window.bhgMixer._actions[1]; }
                                if (waveClip && waveClip.getEffectiveWeight() < 0.9) {
                                    window.bhgMixer._actions.forEach(act => act.setEffectiveWeight(0.0));
                                    waveClip.setEffectiveWeight(1.0);
                                    waveClip.play();
                                }
                            }
                        } catch (animErr) { console.warn("[PIP] Waving anim failed:", animErr); }

                    } else if (target === 'axeZoomInTipi' && window._worldAxeMesh) {
                        // "get axe-- zoom in tipi 2 to have axe in page 6 cam"
                        const axePos = new THREE.Vector3();
                        window._worldAxeMesh.getWorldPosition(axePos);

                        const rot = swayT * 0.4; // Orbit around the axe inside the tipi
                        const zoom = 1.0 + Math.sin(swayT * 0.3) * 0.2; // Minor breathing zoom

                        tipiOrthoCam.position.set(
                            axePos.x + Math.sin(rot) * zoom,
                            axePos.y + 0.3,
                            axePos.z + Math.cos(rot) * zoom
                        );
                        tipiOrthoCam.lookAt(axePos.x, axePos.y, axePos.z);
                        handled = true;

                    } else if (target === 'bhg' && window._bhgGroup) {
                        const pos = new THREE.Vector3();
                        window._bhgGroup.getWorldPosition(pos);
                        // Tipi 2 is rotated 180 degrees (entrance facing -Z). 
                        // Position the camera in front of the entrance (-Z / North) to frame it perfectly.
                        tipiOrthoCam.position.set(pos.x - 3 + Math.sin(swayT) * 0.5, pos.y + 3 + Math.cos(swayT * 0.8) * 0.5, pos.z - 6);
                        tipiOrthoCam.lookAt(pos.x, pos.y + 1, pos.z);
                        handled = true;
                    } else if (target === 'bringsHappinessGirl') {
                        // User Request: Duplicate Page 5 Cam exactly for Page 6 Axe feed
                        if (window._bhgGroup) {
                            const facePos = new THREE.Vector3();
                            if (window._bhgCharacterMesh) {
                                window._bhgCharacterMesh.getWorldPosition(facePos);
                            } else {
                                facePos.copy(window._bhgGroup.position);
                            }
                            facePos.y += 1.0;

                            const sxPortrait = Math.sin(swayT * 2.5) * 0.05; // Kid holding camera jitter
                            const syPortrait = Math.cos(swayT * 3.1) * 0.03;

                            // Close-up like a kid would make. Stand in front (-Z) since she faces -Z
                            tipiOrthoCam.position.set(facePos.x + 0.3 + sxPortrait, facePos.y - 0.1 + syPortrait, facePos.z - 1.5);
                            tipiOrthoCam.lookAt(facePos.x, facePos.y - 0.2, facePos.z);


                            // User Request: Force waving animation whenever viewing her camera close up
                            if (window._bhgWaveAction && window.bhgSystem) {
                                window.bhgSystem.hasWaved = true; // Block world proximity from double-starting
                                window._bhgWaveAction.reset().play();
                            }

                            handled = true;
                        } else {
                            tipiOrthoCam.position.set(2.4, 2.0, 7.0);
                            tipiOrthoCam.lookAt(4.8, 1.0, 10.1);
                            handled = true;
                        }
                    } else if (target === 'yellowButterfly' && window._butterflySpirit) {
                        // Camera feed of the butterfly spirit model
                        const bPos = new THREE.Vector3();
                        window._butterflySpirit.getWorldPosition(bPos);
                        bPos.y += 1.0; // Center on body

                        const bRadius = 3.0 + Math.sin(swayT * 0.3) * 0.5;
                        const bAngle = swayT * 0.2;

                        tipiOrthoCam.position.set(
                            bPos.x + Math.sin(bAngle) * bRadius,
                            bPos.y + 0.5 + Math.cos(swayT * 0.5) * 0.2,
                            bPos.z + Math.cos(bAngle) * bRadius
                        );
                        tipiOrthoCam.lookAt(bPos.x, bPos.y, bPos.z);
                        handled = true;

                    } else if (target === 'axeGathering' && window._worldAxeMesh) {
                        // Detach axe from its parent (e.g., tipi) and add to global scene if not already
                        if (window._worldAxeMesh.parent !== scene) {
                            window._worldAxeMesh.getWorldPosition(window._worldAxeMesh.position); // Get current world position
                            window._worldAxeMesh.rotation.setFromQuaternion(window._worldAxeMesh.getWorldQuaternion(new THREE.Quaternion())); // Get current world rotation
                            scene.add(window._worldAxeMesh);
                        }

                        // Dynamically fly axe into bottom-left camera viewport
                        const axeTargetPos = new THREE.Vector3();
                        const screenWidth = window.innerWidth;
                        const screenHeight = window.innerHeight;

                        // Target screen position (e.g., bottom-left corner, slightly offset)
                        const targetScreenX = 0.15; // 15% from left
                        const targetScreenY = 0.15; // 15% from bottom

                        // Convert screen coordinates to world coordinates at a certain distance from camera
                        const distanceToAxe = 2.0; // Distance in front of camera
                        axeTargetPos.set(
                            (targetScreenX * 2 - 1) * (screenWidth / screenHeight), // X from -1 to 1, aspect ratio correction
                            (targetScreenY * 2 - 1), // Y from -1 to 1
                            -1 // Z for near plane
                        );
                        axeTargetPos.unproject(camera); // Convert to world space relative to camera

                        const camDir = new THREE.Vector3();
                        camera.getWorldDirection(camDir);
                        axeTargetPos.add(camDir.multiplyScalar(distanceToAxe)); // Move along camera direction

                        // Smoothly interpolate axe position
                        window._worldAxeMesh.position.lerp(axeTargetPos, 0.1); // Adjust lerp factor for speed

                        // Make axe face the camera
                        window._worldAxeMesh.lookAt(camera.position);
                        window._worldAxeMesh.rotation.y += Math.PI; // Adjust for model orientation if needed

                        // Position tipiOrthoCam to view the axe
                        tipiOrthoCam.position.copy(window._worldAxeMesh.position).add(new THREE.Vector3(0, 0.5, 1.5)); // Slightly above and behind axe
                        tipiOrthoCam.lookAt(window._worldAxeMesh.position);
                        handled = true;
                    } else if (target === 'nearestTree' && window._treeInstancedMeshes) {
                        let closestDist = Infinity;
                        let closestPos = new THREE.Vector3();
                        const camPos = camera.position;
                        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                        const dummy = new THREE.Matrix4();
                        const wp = new THREE.Vector3();

                        window._treeInstancedMeshes.forEach(({ instancedMesh }) => {
                            for (let i = 0; i < instancedMesh.count; i++) {
                                instancedMesh.getMatrixAt(i, dummy);
                                wp.setFromMatrixPosition(dummy);
                                if (wp.y < -100) continue; // Unused instance
                                const dist = wp.distanceTo(camPos);
                                const dir = new THREE.Vector3().subVectors(wp, camPos).normalize();
                                const dot = fwd.dot(dir);
                                const score = dist - (dot * 2.0);
                                if (dot > 0.0 && score < closestDist) {
                                    closestDist = score;
                                    closestPos.copy(wp);
                                }
                            }
                        });

                        if (closestDist !== Infinity) {
                            const tNow = performance.now() * 0.001;
                            const orbitX = Math.cos(tNow) * 4;
                            const orbitZ = Math.sin(tNow) * 4;
                            tipiOrthoCam.position.set(closestPos.x + orbitX, closestPos.y + 3.0, closestPos.z + orbitZ);
                            tipiOrthoCam.lookAt(closestPos.x, closestPos.y + 1.5, closestPos.z);
                            handled = true;
                        }
                    }

                    if (!handled) {
                        const tNow = performance.now() * 0.0005;
                        const orbitRadius = 12 + Math.sin(tNow * 0.5) * 4;
                        const orbitAngle = tNow * 0.2;
                        const sxOrbit = Math.cos(orbitAngle) * orbitRadius;
                        const syOrbit = Math.sin(tNow * 0.8) * 2.0;
                        const szOrbit = Math.sin(orbitAngle) * orbitRadius;
                        const tx = typeof TIPI_X !== 'undefined' ? TIPI_X : 0;
                        const tz = typeof TIPI_Z !== 'undefined' ? TIPI_Z : 0;
                        const ty = (window._tipiPlatformY || 0);

                        tipiOrthoCam.position.set(tx + sxOrbit, ty + 10 + syOrbit, tz + szOrbit);
                        tipiOrthoCam.lookAt(tx, ty + 2.0, tz);
                    }
                } catch (pipErr) {
                    console.error("[Camera] CRITICAL ERROR IN PIP RENDERER CAUGHT! Prevents game freeze:", pipErr);
                }


                // TEMPORARILY DISABLED WESTERN SHADER PROCESSING FOR FPS TESTING
                if (window.tipiCtx) {
                    const camToUse = usePerspective ? tipiPerspCam : tipiOrthoCam;

                    // Hardware accelerated blit from main WebGL context!
                    const w = window.tipiCanvas2D.width || 256;
                    const h = window.tipiCanvas2D.height || 256;

                    const origAutoClear = renderer.autoClear;
                    renderer.autoClear = false;

                    renderer.setScissorTest(true);
                    renderer.setScissor(0, 0, w, h);
                    renderer.setViewport(0, 0, w, h);

                    const oldClearColor = new THREE.Color();
                    const oldClearAlpha = renderer.getClearAlpha();
                    renderer.getClearColor(oldClearColor);

                    renderer.setClearColor(0x000000, 0.0); // Transparent
                    renderer.clear(true, true, true);

                    // Render UI logic into bottom left corner
                    renderer.render(scene, camToUse);

                    // Draw to 2D UI Canvas
                    window.tipiCtx.clearRect(0, 0, w, h);
                    window.tipiCtx.drawImage(renderer.domElement, 0, renderer.domElement.height - h, w, h, 0, 0, w, h);

                    // Cleanup corner
                    renderer.clear(true, true, true);
                    renderer.setClearColor(oldClearColor, oldClearAlpha);
                    renderer.setScissorTest(false);
                    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
                    renderer.autoClear = origAutoClear;
                }
            }

            // --- QUEST MARKER ANIMATION ---
            const ft = performance.now() * 0.001;
            if (window._questMarker) {
                const markerBob = Math.sin(ft * 3) * 0.15;
                window._questMarker.position.y = window._questMarker.userData.baseY + markerBob;
                window._questMarker.rotation.y = ft; // Spin

                window._questMarker.children.forEach(c => {
                    if (c.userData && c.userData.isQuestBloom) {
                        c.position.y = -5.95 - markerBob; // Counteract bob to stay completely flat on world dirt
                        if (c.material) {
                            c.material.opacity = 0.5 + Math.sin(ft * 1.5) * 0.4; // Glowing fade
                        }
                    }
                });
            }
            if (window._bhgBalloon && window._bhgBalloon.visible) {
                window._bhgBalloon.position.y = window._bhgBalloon.userData.baseY + Math.sin(ft * 3 + 1) * 0.15;
                window._bhgBalloon.rotation.y = ft;
            }

            // --- MOON DIAL UPDATE (throttled) ---
            if (frameCount % 60 === 0 && _moonFrame && _moonFrame.contentWindow) {
                // Use postMessage to avoid cross-origin frame reading blocks on file://
                _moonFrame.contentWindow.postMessage({ type: 'UPDATE_MOON', time: gameTime }, '*');
            }
            // --- WILDLIFE & WIND IN FPV ONLY ---
            if (!window._isMapView) {
                if (window.butterflySystem) window.butterflySystem.update(delta); // Visual fx keep full Hz
                if (window.natureSpiritSystem) window.natureSpiritSystem.update(delta); // Visual fx keep full Hz
                
                // NextGen Wildlife operate fluidly using dynamic delta
                if (window.rabbitSystem) window.rabbitSystem.update(delta, camera.position);
                if (window.horseSystem) window.horseSystem.update(delta, camera.position);
                
                // FORCE Dynamic LookAt
                if (window._yellowButterflyNPC) {
                   if (window.horseSystem && window.horseSystem.horse) {
                       const ybPos = window._yellowButterflyNPC.position;
                       const hPos = window.horseSystem.horse.position.clone();
                       hPos.y = ybPos.y;
                       
                       const pPos = window._playerAvatar ? window._playerAvatar.position.clone() : camera.position.clone();
                       pPos.y = ybPos.y;
                       
                       if (window.horseSystem.state === 'flee') {
                           // Trigger wave goodbye animation once
                           if (window.ybSystem && !window.ybSystem.hasWaved) {
                               window.ybSystem.hasWaved = true;
                               window.ybSystem.petTimer = 10.0; // Suspend random heart emotes
                               if (window.ybSystem.actions.wave) {
                                   window.ybSystem.actions.wave.reset().play();
                                   if (window.ybSystem.currentBaseAction) window.ybSystem.actions.wave.crossFadeFrom(window.ybSystem.currentBaseAction, 0.5, false);
                                   setTimeout(() => {
                                       if (window.ybSystem.currentBaseAction) {
                                           window.ybSystem.currentBaseAction.reset().play();
                                           window.ybSystem.currentBaseAction.crossFadeFrom(window.ybSystem.actions.wave, 1.0, false);
                                       }
                                   }, 3000); // 3 seconds of waving
                               }
                           }
                           
                           // Slowly turn to face player as the horse rides off
                           const distToHorse = ybPos.distanceTo(hPos);
                           const lookTarget = (distToHorse > 16.0) ? pPos : hPos; // Watch horse until it's far, then transition gaze to player
                           
                           const currentQuat = window._yellowButterflyNPC.quaternion.clone();
                           window._yellowButterflyNPC.lookAt(lookTarget);
                           const targetQuat = window._yellowButterflyNPC.quaternion.clone();
                           window._yellowButterflyNPC.quaternion.copy(currentQuat);
                           // Smooth cinematic slerp
                           window._yellowButterflyNPC.quaternion.slerp(targetQuat, 2.0 * delta);

                       } else {
                           // Normal tracking (watch the horse or interact)
                           if (window.ybSystem) window.ybSystem.hasWaved = false; // Reset ability to wave
                           
                           const currentQuat = window._yellowButterflyNPC.quaternion.clone();
                           window._yellowButterflyNPC.lookAt(hPos);
                           const targetQuat = window._yellowButterflyNPC.quaternion.clone();
                           window._yellowButterflyNPC.quaternion.copy(currentQuat);
                           window._yellowButterflyNPC.quaternion.slerp(targetQuat, 4.0 * delta);
                       }
                   }
                }
                if (window._bringsHappinessGirlNPC && window._playerAvatar) {
                   const pos = window._playerAvatar.position.clone();
                   pos.y = window._bringsHappinessGirlNPC.position.y;
                   window._bringsHappinessGirlNPC.lookAt(pos);
                }

                if (window.bhgSystem) window.bhgSystem.update(delta);
                if (window.ybSystem && window._yellowButterflyNPC) {
                    window.ybSystem.update(delta);
                    const sys = window.ybSystem;
                    
                    if (sys.proximityTimeout === undefined) sys.proximityTimeout = 3.0; // Initial delay before swapping
                    sys.proximityTimeout -= delta;
                    
                    // 10 feet = ~3.0 units in 3D coordinate mapping
                    const distToPlayer = camera.position.distanceTo(window._yellowButterflyNPC.position);
                    const isNear = distToPlayer < 4.0;
                    
                    // Dim NPC Glow when within 20 feet (6.0 units)
                    [window._yellowButterflyNPC, window._bhgCharacterMesh].forEach(npc => {
                        if (npc) {
                            const dCam = camera.position.distanceTo(npc.position);
                            const tIn = dCam < 6.0 ? 0.2 : 1.2;
                            const tOp = dCam < 6.0 ? 0.08 : 0.4;
                            npc.traverse(c => {
                                if (c.isPointLight) c.intensity += (tIn - c.intensity) * delta * 2.0;
                                if (c.isMesh && c.material && c.material.transparent && c.material.opacity < 0.9) {
                                    c.material.opacity += (tOp - c.material.opacity) * delta * 2.0;
                                }
                            });
                        }
                    });
                    
                    if (isNear && !sys.hasOpenedLogbook && !window._gameStartedCTA) {
                        sys.hasOpenedLogbook = true;
                        const panelFrame = document.getElementById('panel-frame');
                        if (panelFrame && panelFrame.contentWindow) {
                            panelFrame.contentWindow.postMessage({ type: 'FORCE_OPEN_JOURNAL' }, '*');
                            panelFrame.contentWindow.postMessage({ type: 'SYNC_LOGBOOK_PAGE', pageIdx: 2 }, '*'); // Open to Quest 1 Start Game Page
                        }
                    }
                    
                    if (isNear && !sys.hasPlayerWaved) {
                        sys.hasPlayerWaved = true;
                        if (window._avWaveAction && window._avIdleAction) {
                            window._avWaveAction.reset().play();
                            window._avWaveAction.crossFadeFrom(window._avIdleAction, 0.4, false);
                            setTimeout(() => {
                                window._avIdleAction.reset().play();
                                window._avIdleAction.crossFadeFrom(window._avWaveAction, 0.4, false);
                            }, 2500);
                        }
                    } else if (!isNear) {
                        sys.hasPlayerWaved = false;
                        sys.hasGreeted = false;
                    }
                    
                    // Ping-pong between idle and wait randomly every 5 to 10 seconds
                    if (sys.proximityTimeout <= 0) {
                        sys.proximityTimeout = 5.0 + (Math.random() * 5.0);
                        // If they are safe and far away, we can execute ambient swaps
                        if (sys.actions.idle && sys.actions.wait && sys.currentBaseAction) {
                            const targetAction = (sys.currentBaseAction === sys.actions.idle) ? sys.actions.wait : sys.actions.idle;
                            targetAction.reset().play();
                            targetAction.crossFadeFrom(sys.currentBaseAction, 1.0, false);
                            sys.currentBaseAction = targetAction;
                        }
                    }
                }

                // --- GLOBAL WILDLIFE COLLISION & INTERACTION SYSTEM ---
                // Ensures models do not walk into/through each other across all active classes.
                const colliders = [];
                const pushBank = (sys, configRadius) => {
                    if (sys && sys.rabbits) sys.rabbits.forEach(r => colliders.push({ ent: r, sys: sys, r: configRadius * Math.max(0.5, (r.baseScale || 1.0)) }));
                    if (sys && sys.deer) sys.deer.forEach(d => colliders.push({ ent: d, sys: sys, r: configRadius * Math.max(0.5, (d.baseScale || 1.0)) }));
                    if (sys && sys.horses) sys.horses.forEach(h => colliders.push({ ent: h, sys: sys, r: configRadius * Math.max(0.5, (h.baseScale || 1.0)) }));
                };

                // Base radii mappings
                pushBank(window.rabbitSystem, 0.4);
                pushBank(window.deerSystem, 1.3);
                pushBank(window.horseSystem, 1.8);

                for (let i = 0; i < colliders.length; i++) {
                    for (let j = i + 1; j < colliders.length; j++) {
                        const a = colliders[i];
                        const b = colliders[j];

                        // Ignore morphed/hidden/snuggling animals completely
                        if (a.sys && a.sys.STATES && (a.ent.state === a.sys.STATES.SNUGGLING || a.ent.state === a.sys.STATES.HIDDEN || a.ent.state === a.sys.STATES.EMERGING)) continue;
                        if (b.sys && b.sys.STATES && (b.ent.state === b.sys.STATES.SNUGGLING || b.ent.state === b.sys.STATES.HIDDEN || b.ent.state === b.sys.STATES.EMERGING)) continue;

                        const pA = a.ent.mesh.position;
                        const pB = b.ent.mesh.position;

                        // Extremely fast 2D distance squared 
                        const dx = pB.x - pA.x;
                        const dz = pB.z - pA.z;
                        const distSq = dx * dx + dz * dz;
                        const rSum = a.r + b.r;

                        if (distSq > 0 && distSq < rSum * rSum) {
                            const dist = Math.sqrt(distSq);
                            const overlap = rSum - dist;

                            // 1. Resolve Overlap (Simulated Physical Mass Push)
                            // Pushes half of the overlap to both, instantly clearing the collision for the next frame
                            const pushFraction = overlap * 0.51;
                            const nx = dx / dist; const nz = dz / dist;
                            pA.x -= nx * pushFraction;
                            pA.z -= nz * pushFraction;
                            pB.x += nx * pushFraction;
                            pB.z += nz * pushFraction;

                            // 2. Interaction State
                            const setInteract = (c, other) => {
                                if (c.sys && c.sys.STATES) {
                                    const stateEnum = c.sys.STATES;
                                    // Lock out if already happily greeting or safely resting
                                    if (c.ent.state === stateEnum.GREETING || c.ent.state === stateEnum.SLEEPING || c.ent.state === stateEnum.RESTING) return;

                                    // Instantly turn towards the target that bumped them to 'interact' naturally
                                    const dummy = new THREE.Object3D();
                                    dummy.position.copy(c.ent.mesh.position);
                                    if (c === a) dummy.lookAt(pB.x, dummy.position.y, pB.z);
                                    else dummy.lookAt(pA.x, dummy.position.y, pA.z);
                                    c.ent.mesh.rotation.y = dummy.rotation.y;

                                    // Determine reaction based on species
                                    if (a.sys === b.sys && stateEnum.GREETING !== undefined) {
                                        // Same species = Friendly greeting nose-boop
                                        c.ent.state = stateEnum.GREETING;
                                    } else if (stateEnum.ALERT !== undefined) {
                                        // Different species = Stop and stare at each other (Alert)
                                        c.ent.state = stateEnum.ALERT;
                                    } else if (stateEnum.IDLE !== undefined) {
                                        c.ent.state = stateEnum.IDLE;
                                    }

                                    // Suspend logic for ~2.0 seconds while interaction plays out
                                    // Suspend logic for ~2.0 seconds while interaction plays out
                                    c.ent.timer = 2.0;
                                }
                            };

                            setInteract(a, b);
                            setInteract(b, a);
                        }
                    }
                }

                // --- WIND SWAY Optimization ---
                const windTime = performance.now() * 0.001;
                if (window._globalTime) {
                    window._globalTime.value = windTime;
                }
                
                if (typeof swayTrees !== 'undefined' && swayTrees.length > 0) {
                    // Pre-calculate highly optimal world bounds for the camera
                    const camX = camera.position.x;
                    const camZ = camera.position.z;

                    for (let i = 0; i < swayTrees.length; i++) {
                        const t = swayTrees[i];
                        if (!t.visible) continue;

                        // ULTRA OPTIMIZATION: Do not use getWorldPosition inside loop! 
                        // Instead, we rigidly cached the true world spawn coordinates onto the leaf mesh userData during generateWorld().
                        // This entirely bypasses the deep structural nested GLTF zero-coordinates.
                        const pX = t.userData.worldX;
                        const pZ = t.userData.worldZ;
                        if (pX === undefined) continue; // safety check

                        const dx = pX - camX;
                        const dz = pZ - camZ;
                        const distToCamSq = (dx * dx) + (dz * dz);

                        if (distToCamSq > 10000) continue;

                        const phase = t.userData.windPhase;
                        const amp = t.userData.windAmp * 1.2; // Increased sway by 20% per user request

                        // t is guaranteed to be a non-trunk foliage branch mesh
                        t.rotation.x = t.userData.baseRotX + Math.sin(windTime * 1.5 + phase) * amp;
                        t.rotation.z = t.userData.baseRotZ + Math.cos(windTime * 1.2 + phase) * amp * 0.8;
                    }
                }
            }

            // --- FUZZYBRAIN AI UPDATE ---
            if (fuzzyBrain) {
                fuzzyBrain.update(delta);
            }

            // --- STATS HUD (throttled) ---
            if (frameCount % 15 === 0 && _statsEl) {
                // Determine true FPS (FuzzyBrain smooths the raw delta jumps out)
                const fps = fuzzyBrain ? fuzzyBrain.smoothFPS.toFixed(0) : (1 / delta).toFixed(0);

                // USER REQUEST: Provide live coordinates for waypoint plotting
                const cx = camera ? camera.position.x.toFixed(1) : '0';
                const cy = camera ? camera.position.y.toFixed(1) : '0';
                const cz = camera ? camera.position.z.toFixed(1) : '0';

                _statsEl.innerHTML = `FPS: ${fps}<br>X: ${cx}<br>Y: ${cy}<br>Z: ${cz}`;
            }

            // Update tipi screen position for fuzzy exemption
            if (window.tipiObj && humanEyePass) {
                const tipiWorldPos = new THREE.Vector3();
                window.tipiObj.getWorldPosition(tipiWorldPos);
                tipiWorldPos.y += 2; // Aim at tipi center, not base
                const projected = tipiWorldPos.clone().project(camera);
                // Convert from NDC (-1..1) to UV (0..1)
                const screenX = (projected.x + 1) * 0.5;
                const screenY = (projected.y + 1) * 0.5;
                // Only update if tipi is in front of camera
                if (projected.z > 0 && projected.z < 1) {
                    humanEyePass.uniforms.tipiScreenPos.value.set(screenX, screenY);
                    // Scale radius based on distance
                    const dist = camera.position.distanceTo(tipiWorldPos);
                    humanEyePass.uniforms.tipiScreenRadius.value = Math.min(0.15, 3.0 / Math.max(dist, 1));
                } else {
                    humanEyePass.uniforms.tipiScreenPos.value.set(-9, -9); // Offscreen
                }
            }

            // Animate campfire (sprites)
            if (window._fireData && window._fireData.flameMesh) {
                const fd = window._fireData;
                const ft = Date.now() * 0.003;

                // Animate Particle Sprites
                const positions = fd.flameMesh.geometry.attributes.position.array;
                const phases = fd.flameMesh.geometry.attributes.phase.array;
                const particleCount = phases.length;

                for (let i = 0; i < particleCount; i++) {
                    const idx = i * 3;
                    // Move up slower
                    positions[idx + 1] += delta * 0.8;
                    // Tighter wobble
                    positions[idx] += Math.sin(ft * 5 + phases[i]) * 0.005;
                    positions[idx + 2] += Math.cos(ft * 4 + phases[i]) * 0.005;

                    // Reset if too high (EXTREMELY reduced max height to keep the optical flare inside the stone ring)
                    if (positions[idx + 1] > fd.baseY + 0.4 + Math.random() * 0.3) {
                        positions[idx] = 0 + (Math.random() - 0.5) * 0.2;
                        positions[idx + 1] = fd.baseY + Math.random() * 0.1;
                        positions[idx + 2] = 0 + (Math.random() - 0.5) * 0.2;
                    }
                }
                fd.flameMesh.geometry.attributes.position.needsUpdate = true;

                // Animate Smoke Sprites
                if (fd.smokeMesh) {
                    const sPos = fd.smokeMesh.geometry.attributes.position.array;
                    const sPhases = fd.smokeMesh.geometry.attributes.phase.array;
                    for (let i = 0; i < sPhases.length; i++) {
                        const idx = i * 3;
                        // Float up slowly
                        sPos[idx + 1] += delta * 0.8;
                        // Drift in wind (mostly drift + wobble)
                        sPos[idx] += Math.sin(ft * 2 + sPhases[i]) * 0.01 + delta * 0.25; // Gentle wind push on X
                        sPos[idx + 2] += Math.cos(ft * 1.5 + sPhases[i]) * 0.01;

                        // Reset when high above the tipi
                        if (sPos[idx + 1] > fd.baseY + 6.5 + Math.random() * 1.0) {
                            sPos[idx] = 0 + (Math.random() - 0.5) * 0.25; // Re-cluster tightly at hole
                            sPos[idx + 1] = fd.baseY + 3.8 + Math.random() * 0.5;
                            sPos[idx + 2] = 0 + (Math.random() - 0.5) * 0.25;
                        }
                    }
                    fd.smokeMesh.geometry.attributes.position.needsUpdate = true;
                }

                // Flicker light intensity (calmer, non-looping)
                fd.fireLight.intensity = 2.0 + (Math.random() * 0.8 - 0.4);
                fd.fireFill.intensity = 0.8 + (Math.random() * 0.3 - 0.15);
                // Ember glow pulse (non-looping)
                fd.emberMesh.material.emissiveIntensity = 0.6 + Math.random() * 0.4;
            }
            
            // --- AVATAR UI RENDER PASS ---
            if (window._playerAvatar && window.avatarCtx && window.avatarCanvas2D && typeof window.avatarOrthoCam !== 'undefined') {
                // --- AVATAR NATIVE ANIMATION SYNC (ALWAYS RUN EVEN IF PIP UI IS HIDDEN) ---
                if (window._avIsWalking !== undefined && window._avWalkAction && window._avIdleAction) {
                    const isMoving = window._isKeyDown || window._activeDirection || window._joystickActive || window._autoWalkTarget;
                    if (isMoving && !window._avIsWalking) {
                        window._avIsWalking = true;
                        window._avWalkAction.reset().play();
                        window._avWalkAction.crossFadeFrom(window._avIdleAction, 0.3, false);
                    } else if (!isMoving && window._avIsWalking) {
                        window._avIsWalking = false;
                        window._avIdleAction.reset().play();
                        window._avIdleAction.crossFadeFrom(window._avWalkAction, 0.3, false);
                    }
                }

                const pFrame = document.getElementById('panel-frame');
                let targetRect = null;
                if (pFrame && pFrame.contentWindow) {
                    const tgt = pFrame.contentWindow.document.getElementById('avatar-pip-target');
                    if (tgt) {
                        const rect = tgt.getBoundingClientRect();
                        if (rect.width > 0) {
                            if (window.avatarCanvas2D.width !== Math.floor(rect.width)) {
                                window.avatarCanvas2D.width = Math.floor(rect.width);
                                window.avatarCanvas2D.height = Math.floor(rect.height);
                                window.avatarCanvas2D.style.position = 'absolute';
                                window.avatarCanvas2D.style.inset = '0';
                                window.avatarCanvas2D.style.pointerEvents = 'none';
                                tgt.appendChild(window.avatarCanvas2D);
                            }
                            targetRect = rect;
                        }
                    }
                }

                if (targetRect && targetRect.width > 0) {
                    const w = window.avatarCanvas2D.width;
                    const h = window.avatarCanvas2D.height;
                    
                    const pos = new THREE.Vector3();
                    window._playerAvatar.getWorldPosition(pos);
                    
                    const rot = performance.now() * 0.0003; 
                    window.avatarOrthoCam.position.set(pos.x + Math.sin(rot) * 2.5, pos.y + 1.2, pos.z + Math.cos(rot) * 2.5);
                    window.avatarOrthoCam.lookAt(pos.x, pos.y + 0.8, pos.z);

                    const origAutoClear = renderer.autoClear;
                    renderer.autoClear = false;

                    renderer.setScissorTest(true);
                    renderer.setScissor(0, 0, w, h);
                    renderer.setViewport(0, 0, w, h);

                    const oldClearColor = new THREE.Color();
                    const oldClearAlpha = renderer.getClearAlpha();
                    renderer.getClearColor(oldClearColor);

                    renderer.setClearColor(0x000000, 0.0);
                    renderer.clear(true, true, true);



                    renderer.render(scene, window.avatarOrthoCam);

                    window.avatarCtx.clearRect(0, 0, w, h);
                    window.avatarCtx.drawImage(renderer.domElement, 0, renderer.domElement.height - h, w, h, 0, 0, w, h);

                    renderer.clear(true, true, true);
                    renderer.setClearColor(oldClearColor, oldClearAlpha);
                    renderer.setScissorTest(false);
                    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
                    renderer.autoClear = origAutoClear;
                }
            }

            // --- EXPERIMENTAL SINGLE-PASS BLIT PIP RENDERING ---
            // Render the PiP *before* the main scene. It punches a temporary 256x256 scissor
            // hole in the backbuffer, copies it to the invisible Canvas2D in the moondial wrapper,
            // and then the Main Scene completely overdraws/erases the hole safely!
            if (window._pendingPipCamera && window.pipCtx && window.pipCanvas2D) {

            // --- NATIVE HARDWARE PIP SCISSOR RENDER ---
            if (window._pendingPipCamera && window._moondialWrapper && !window._isLogbookOpen) {
                const rect = window._moondialWrapper.getBoundingClientRect();
                const scX = rect.left;
                const scY = window.innerHeight - rect.bottom;
                const w = rect.width;
                const h = rect.height;

                const origAutoClear = renderer.autoClear;
                renderer.autoClear = false;

                // Scale up avatar 3x for PIP
                const oldAvatarScale = new THREE.Vector3(1, 1, 1);
                if (window._playerAvatar && window._isMapView) {
                    oldAvatarScale.copy(window._playerAvatar.scale);
                    window._playerAvatar.scale.multiplyScalar(3.0);
                    window._playerAvatar.updateMatrixWorld(true);
                }

                renderer.setScissorTest(true);
                renderer.setScissor(scX, scY, w, h);
                renderer.setViewport(scX, scY, w, h);

                const oldClearColor = new THREE.Color();
                const oldClearAlpha = renderer.getClearAlpha();
                renderer.getClearColor(oldClearColor);
                renderer.setClearColor(0x000000, 1.0);
                renderer.clear(true, true, true);
                
                const oldTipiGodrayAlpha = window._tipiGodray ? window._tipiGodray.material.opacity : null;
                const oldTipiGodray2Alpha = window._tipiGodray2 ? window._tipiGodray2.material.opacity : null;
                
                toggleFX(false);
                if (window._tipiGodray) window._tipiGodray.material.opacity = 0.8;
                if (window._tipiGodray2) window._tipiGodray2.material.opacity = 0.8;
                if (window.butterflySystem && window.butterflySystem.mesh) window.butterflySystem.mesh.visible = true;
                if (window.natureSpiritSystem && window.natureSpiritSystem.mesh) window.natureSpiritSystem.mesh.visible = true;

                const oldFogDensity = window._sceneFog ? window._sceneFog.density : 0;
                if (window._sceneFog) window._sceneFog.density = 0;

                const culledTrees = [];
                if (window.allTrees) {
                    window.allTrees.forEach((tData, idx) => {
                        const m = tData.mesh ? tData.mesh : tData;
                        if (idx % 2 === 0 && m && m.visible !== false) {
                            culledTrees.push(m);
                            m.visible = false;
                        }
                    });
                }
                
                const oldShadowAutoUpdate = renderer.shadowMap.autoUpdate;
                renderer.shadowMap.autoUpdate = false; 

                const origAspect = window._pendingPipCamera.aspect;
                if (window._pendingPipCamera.isPerspectiveCamera) {
                    window._pendingPipCamera.aspect = 1.0;
                    window._pendingPipCamera.updateProjectionMatrix();
                }

                renderer.render(scene, window._pendingPipCamera);

                if (window._pendingPipCamera.isPerspectiveCamera) {
                    window._pendingPipCamera.aspect = origAspect;
                    window._pendingPipCamera.updateProjectionMatrix();
                }

                renderer.shadowMap.autoUpdate = oldShadowAutoUpdate;
                
                if (window._playerAvatar && window._isMapView) {
                    window._playerAvatar.scale.copy(oldAvatarScale);
                    window._playerAvatar.updateMatrixWorld(true);
                }
                
                culledTrees.forEach(m => m.visible = true);
                culledTrees.length = 0;
                
                if (window._sceneFog) window._sceneFog.density = oldFogDensity;
                if (window._tipiGodray && oldTipiGodrayAlpha !== null) window._tipiGodray.material.opacity = oldTipiGodrayAlpha;
                if (window._tipiGodray2 && oldTipiGodray2Alpha !== null) window._tipiGodray2.material.opacity = oldTipiGodray2Alpha;

                renderer.setClearColor(oldClearColor, oldClearAlpha);
                renderer.setScissorTest(false);
                renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
                renderer.autoClear = origAutoClear;
                
                if (window._globalFlare) window._globalFlare.visible = true;
            }

            // --- SMART TARGETED CULLING ---
            function toggleFX(show) {
                if (window._globalFlare) window._globalFlare.visible = show;
                if (window._butterflySpirit) window._butterflySpirit.visible = show;
                if (window._tipiGodray2) window._tipiGodray2.visible = show;
                if (window.butterflySystem && window.butterflySystem.mesh) window.butterflySystem.mesh.visible = show;
                if (window.natureSpiritSystem && window.natureSpiritSystem.mesh) window.natureSpiritSystem.mesh.visible = show;
            }

            // Render Main View
            let activeMainCam = camera;
            
            let mainFogRestore = null;
            // Define renderer override profiles to suppress heavy FPV passes or align logic
            if (window._swapModes) {
                // If Logbook overlay is open, cull FPV background entirely and only render PIP scale internally to save FPS
                if (typeof pipCamera !== 'undefined' && pipCamera) activeMainCam = pipCamera;
                toggleFX(false);
            } else if (window._isMapView) {
                // Physically assign the Widescreen Map Camera to the Renderer
                if (window._nativeMapCam) {
                    activeMainCam = window._nativeMapCam;

                    // Dynamically map its coordinates 150 feet directly above the physically active player camera
                    const heightY = 150;
                    const tiltZ = heightY * Math.tan(35 * Math.PI / 180);
                    activeMainCam.position.set(
                        camera.position.x,
                        Math.max(camera.position.y + heightY, heightY),
                        camera.position.z + tiltZ
                    );
                    activeMainCam.up.set(0, 1, 0); 
                    activeMainCam.lookAt(camera.position.x, Math.max(camera.position.y, 0), camera.position.z);
                }
                toggleFX(false);
                
                // CRITICAL FIX: Disable thick atmospheric fog in Map View, otherwise the high top-down 
                // orthographic camera looks through thick fog and the whole screen greys out!
                if (window._sceneFog) {
                    mainFogRestore = window._sceneFog.density;
                    window._sceneFog.density = 0;
                }
            } else {
                toggleFX(true);
            }

            // NEXT-GEN ARCHITECTURE FIX: Bypass `EffectComposer` fully.
            // On High DPI Mac Retina displays, rendering physical geometries into a massive offscreen WebGLRenderTarget 
            // and applying a full-screen fragment pass absolutely destroys the Fill-Rate, capping the game at ~19FPS.
            if (false && window.fuzzyBrain && window.fuzzyBrain.postProcess) {
                // Dynamically route Composer to active main camera (Map or FPV)
                const passes = window.fuzzyBrain.postProcess.composer.passes;
                if (passes && passes.length > 0 && passes[0].camera) {
                    passes[0].camera = activeMainCam;
                }
                window.fuzzyBrain.postProcess.composer.render(delta);
            } else if (renderer) {
                // Dynamic scale injection to combat Orthographic "Low Res" sizing
                const activeScaleMult = window._isMapView ? 1.5 : 1.0;
                const oa = new THREE.Vector3();
                const oh = new THREE.Vector3();
                const ob = new THREE.Vector3();
                if (window._isMapView) {
                    if (window._playerAvatar) { oa.copy(window._playerAvatar.scale); window._playerAvatar.scale.multiplyScalar(activeScaleMult); window._playerAvatar.updateMatrixWorld(true); }
                    if (window.horseSystem && window.horseSystem.horse) { oh.copy(window.horseSystem.horse.scale); window.horseSystem.horse.scale.multiplyScalar(activeScaleMult); window.horseSystem.horse.updateMatrixWorld(true); }
                    if (window._yellowButterflyNPC) { ob.copy(window._yellowButterflyNPC.scale); window._yellowButterflyNPC.scale.multiplyScalar(activeScaleMult); window._yellowButterflyNPC.updateMatrixWorld(true); }
                }

                renderer.render(scene, activeMainCam);

                // Restore original scale matrices
                if (window._isMapView) {
                    if (window._playerAvatar) { window._playerAvatar.scale.copy(oa); window._playerAvatar.updateMatrixWorld(true); }
                    if (window.horseSystem && window.horseSystem.horse) { window.horseSystem.horse.scale.copy(oh); window.horseSystem.horse.updateMatrixWorld(true); }
                    if (window._yellowButterflyNPC) { window._yellowButterflyNPC.scale.copy(ob); window._yellowButterflyNPC.updateMatrixWorld(true); }
                }
            }
            
            // Restore Fog Density
            if (mainFogRestore !== null && window._sceneFog) {
                window._sceneFog.density = mainFogRestore;
            }
            
            // Restore visibility after all frames render so logical updates don't break
            toggleFX(true);

            // PIP was moved to render natively before Main View.
            // --- AXE LOGBOOK OVERLAY RENDER ---
            if (!drewMapMain && window._isAxeCameraCloned && window._axeRect && axeRenderer && typeof axePipCam !== 'undefined') {
                // Bespoke cinematic Perspective Camera for the Axe UI.
                axeRenderer.setViewport(0, 0, window._axeRect.width, window._axeRect.height);
                axeRenderer.setScissorTest(false);
                axeRenderer.render(scene, axePipCam);
            }
        } // animate()

        // --- ERROR TRAPPING & INIT ---
        window.onerror = function (msg, url, line, col, error) {
            const ld = document.getElementById('loading');
            if (ld) {
                ld.innerHTML = `< h2 > CRITICAL ERROR</h2 > <p style="color:red; font-family:monospace; padding:20px;">${msg}<br>Line: ${line}</p>`;
                ld.style.background = '#000';
                ld.style.zIndex = 99999;
                ld.style.opacity = 1;

                const bg = document.getElementById('bg-video');
                if (bg) bg.remove();
            }
            console.error("Critical Error Trapped:", msg, error);
            return false;
        };

        window.startGameIfReady = () => {
            if (window.documentReady && window.customScriptsReady && !window._initFired) {
                window._initFired = true;
                if (!window.masterAI) {
                    window.masterAI = new MasterAI();
                    window.masterAI.bootstrap(() => {
                        try {
                            init();
                        } catch (e) {
                            window.onerror(e.message, null, null, null, e);
                        }
                    });
                }
            }
        };

        window.onload = () => {
            console.log("TRACE 8: Window onload fired");
            window.documentReady = true;
            window.startGameIfReady();
        };

        // Attempt startup immediately if promises already resolved
        if (document.readyState === 'complete') {
            window.documentReady = true;
            window.startGameIfReady();
        }
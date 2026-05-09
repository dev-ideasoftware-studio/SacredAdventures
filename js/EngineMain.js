window._DEBUG_MIDNIGHT = true; // SET TO FALSE TO SYNC DAY/NIGHT WITH YOUR REAL WORLD COMPUTER TIME!

        
        import * as THREE from 'three';
        // INTERCEPT ALL THREE.JS LOADERS (Realistic Tracking)
        THREE.DefaultLoadingManager.onProgress = function (url, itemsLoaded, itemsTotal) {
            const progress = (itemsLoaded / itemsTotal) * 100;
            const shortUrl = url.split('/').pop();
            if (window.logSystem) {
                // Update the "Loading..." bar (pAssets)
                window.logSystem(`Loading Asset: ${shortUrl}`, 100, progress, 0, 0);
            }
        };

        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
        import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
        import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
        import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
        
        // Expose loaders globally for classic script components (like RabbitSystem)
        window.GLTFLoader = GLTFLoader;
        window.OBJLoader = OBJLoader;

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

        // --- GC-FREE VECTOR POOL (hoisted from per-frame allocations) ---
        const _pool = {
            v1: null, v2: null, v3: null, v4: null,
            c1: null,
            init() {
                this.v1 = new THREE.Vector3();
                this.v2 = new THREE.Vector3();
                this.v3 = new THREE.Vector3();
                this.v4 = new THREE.Vector3();
                this.c1 = new THREE.Color();
            }
        };

        ;
        let axeRenderer,
            pipCamera, _pipRenderTarget, _pipQuad, _pipPostScene, _pipPostCam;
        let tipiRenderer,
            tipiOrthoCam, tipiPerspCam, axePipCam, _tipiRenderTarget, _tipiQuad, _tipiPostScene, _selfieRenderTarget; // Native UI Camera Pipline
        let gameTime = 8.0; // 8 AM start
        let sunLight;
        // Wildlife variables removed
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
        window._assetFactory = null;
        const vegData = { bushes: [], trees: [] };

        

        function init() {
            // Unify tracking of progressive events
            window.SacredState = window.SacredState || { questLevel: 0 };

            // 1. SCENE
            scene = new THREE.Scene();
            _pool.init(); // Initialize GC-free vector pool

            // 2. CAMERA
            camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(0, 1.7, 5);
            camera.rotation.order = 'YXZ'; // Important for independent yaw and pitch
            camera.rotation.x = -0.235; // Default look down 15% (13.5 degrees)
            // MASKING: FPV Camera exclusively sees Layer 0 (Environment) and Layer 3 (High Poly Trees). 
            // Layer 1 is for the player avatar model.
            // FPV: Show avatar as third-person (camera offset 2ft behind)
            camera.layers.enable(1);
            camera.layers.enable(3);
            window.camera = camera;
            window.allTrees = allTrees;
            window.swayTrees = swayTrees;

            // --- PLAYER AVATAR INJECTION DEFERRED ---
            // The massive 78MB Avatar2.glb is now loaded sequentially AFTER the world is built.
            const loadPlayerAvatar = () => {
                return new Promise((resolve) => {
                    const gltfLoader = window.GLTFLoader ? new window.GLTFLoader() : new THREE.GLTFLoader();
                    const dracoLoader = window.THREE.DRACOLoader ? new window.THREE.DRACOLoader() : new DRACOLoader();
                    dracoLoader.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
                    gltfLoader.setDRACOLoader(dracoLoader);
                    
                    gltfLoader.load("Assets/Avatar3.glb", (gltf) => {
                      const avatar = gltf.scene;
                      // Move entire avatar asset securely into Layer 1 (Ghost to FPV, Visible to Minimap)
                      avatar.traverse((child) => {
                        if (child.isMesh) {
                          child.layers.set(1);
                          child.castShadow = false; // Disable shadows for 78MB mesh to rescue FPS
                          child.receiveShadow = false;
                        }
                      });

                      // Fix scale to rigidly match `BringsHappinessGirl` NPC (1.14, 1.43, 1.14)
                      // User Request: Reduce by 15%
                      avatar.scale.set(0.969, 1.2155, 0.969);

                      // Attach pure black PIP directional marker (ghosted to Layer 1)
                      const playerMarker = new THREE.Group();
                      // Submerge group to ground level so it acts as a floor base!
                      playerMarker.position.y = 0.02;
                      // Counter-rotate the marker to cancel out the avatar's native mesh ROT_OFFSET (-90 deg)
                      playerMarker.rotation.y = Math.PI / 2;

                      // Raised platform
                      const pRadius = 0.375;
                      const pMarkerGeo = new THREE.CylinderGeometry(
                        pRadius,
                        pRadius,
                        0.02,
                        32,
                      );
                      const pMarkerMat = new THREE.MeshStandardMaterial({
                        color: 0x2e7d32,
                        roughness: 0.2,
                        metalness: 0.1,
                      });
                      const baseMesh = new THREE.Mesh(pMarkerGeo, pMarkerMat);
                      baseMesh.position.y = 0.01; // half thickness
                      baseMesh.layers.set(1);
                      playerMarker.add(baseMesh);

                      // Add brilliant white border around player platform
                      const borderGeo = new THREE.TorusGeometry(
                        pRadius,
                        0.02,
                        16,
                        48,
                      );
                      const borderMat = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        roughness: 0.1,
                        metalness: 0.1,
                      });
                      const borderMesh = new THREE.Mesh(borderGeo, borderMat);
                      borderMesh.rotation.x = Math.PI / 2;
                      borderMesh.position.y = 0.01; // Flush with base
                      borderMesh.layers.set(1);
                      playerMarker.add(borderMesh);

                      // Attach directional wedge pointing natively to Forward (Player Avatar faces +Z locally)
                      const arrowGeo = new THREE.ConeGeometry(0.08, 0.2, 32);
                      const arrowMat = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        roughness: 0.1,
                        metalness: 0.1,
                      });
                      const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
                      arrowMesh.rotation.set(Math.PI / 2, 0, 0); // Tip points forward (+Z) relative to avatar
                      // Flatten the cone vertically. After Math.PI/2 X-rotation, the world Y axis is the cone's local Z axis.
                      arrowMesh.scale.set(1.0, 1.0, 0.25); // 0.08 radius * 0.25 = 0.02, perfectly matching the Torus thickness
                      arrowMesh.position.set(0, 0.01, pRadius + 0.1); // Connected exactly to border (radius + half cone height)
                      arrowMesh.layers.set(1);

                      playerMarker.add(arrowMesh);
                      avatar.add(playerMarker);

                      // Boot up the native skeletal animation cycle
                      if (gltf.animations && gltf.animations.length > 0) {
                        window._playerAvatarMixer = new THREE.AnimationMixer(
                          avatar,
                        );

                        window._avIdleClip =
                          gltf.animations.length > 7
                            ? gltf.animations[7]
                            : gltf.animations[0];
                        window._avWalkClip =
                          gltf.animations.length > 5
                            ? gltf.animations[5]
                            : null;
                        window._avWaveClip =
                          gltf.animations.length > 1
                            ? gltf.animations[1]
                            : null;

                        // POPULATE ANIMATION PANEL FOR TESTING
                        const animPanel =
                          document.getElementById("animation-panel");
                        const animContainer =
                          document.getElementById("animation-buttons");
                        if (animPanel && animContainer) {
                          animPanel.style.display = "block"; // Show panel
                          animContainer.innerHTML = ""; // Clear old buttons

                          // Default to playing Idle so we know it works
                          if (window._currentAvAction)
                            window._currentAvAction.stop();
                          window._currentAvAction =
                            window._playerAvatarMixer.clipAction(
                              window._avIdleClip,
                            );
                          window._currentAvAction.setEffectiveWeight(1.0);
                          window._currentAvAction.play();

                          gltf.animations.forEach((clip, index) => {
                            const btn = document.createElement("button");
                            btn.textContent = `[${index}] ${clip.name}`;
                            btn.style.cssText =
                              "padding:6px; background:#4a3122; color:#fff; border:1px solid #a37c58; border-radius:4px; cursor:pointer; text-align:left; font-size:12px;";
                            btn.onclick = () => {
                              if (window._currentAvAction) {
                                window._currentAvAction.crossFadeTo(
                                  window._playerAvatarMixer.clipAction(clip),
                                  0.2,
                                  true,
                                );
                                window._currentAvAction =
                                  window._playerAvatarMixer.clipAction(clip);
                                window._currentAvAction.reset().play();
                              } else {
                                window._currentAvAction =
                                  window._playerAvatarMixer.clipAction(clip);
                                window._currentAvAction.play();
                              }
                            };
                            animContainer.appendChild(btn);
                          });
                        }

                        if (window._avIdleClip) {
                          window._avIdleAction =
                            window._playerAvatarMixer.clipAction(
                              window._avIdleClip,
                            );
                          window._avIdleAction.play();
                        }
                        if (window._avWalkClip) {
                          // Filter out X/Z root motion to prevent double-sliding, but preserve Y bounce
                          window._avWalkClip.tracks.forEach((track) => {
                            if (track.name.endsWith(".position")) {
                              const vals = track.values;
                              if (vals.length >= 3) {
                                const startX = vals[0];
                                const startZ = vals[2];
                                for (let i = 0; i < vals.length; i += 3) {
                                  vals[i] = startX;
                                  vals[i + 2] = startZ;
                                }
                              }
                            }
                          });
                          window._avWalkAction =
                            window._playerAvatarMixer.clipAction(
                              window._avWalkClip,
                            );
                          window._avWalkAction.play();
                          window._avWalkAction.setEffectiveWeight(0);
                        }
                        if (window._avWaveClip) {
                          window._avWaveAction =
                            window._playerAvatarMixer.clipAction(
                              window._avWaveClip,
                            );
                        }

                        window._avIsWalking = false;
                      }

                      window._playerAvatar = avatar;
                      window._playerAvatar.traverse((c) => c.layers.enable(1)); // Enable Layer 1 for entire subtree
                      scene.add(avatar);

                      // --- AVATAR PIP: Clone into dedicated mini scene ---
                      if (window._avatarPipScene && window._avatarPipRenderer) {
                        const pipClone = avatar.clone(true);
                        // Ground the clone
                        pipClone.updateMatrixWorld(true);
                        const pipBox = new THREE.Box3().setFromObject(pipClone);
                        pipClone.position.y = -pipBox.min.y + 0.02;
                        pipClone.position.x = 0;
                        pipClone.position.z = 0;
                        window._avatarPipScene.add(pipClone);
                        window._avatarPipClone = pipClone;
                        // Position camera: waist-up portrait framing
                        window.avatarOrthoCam.position.set(0, 1.2, 2.2);
                        window.avatarOrthoCam.lookAt(0, 0.9, 0);
                        // Inject renderer canvas into avatar-pip-target in panel-frame
                        const _injectPipCanvas = () => {
                          const pf = document.getElementById("panel-frame");
                          const pd = pf && pf.contentDocument;
                          const tgt =
                            pd && pd.getElementById("avatar-pip-target");
                          if (tgt) {
                            window._avatarPipRenderer.domElement.style.cssText =
                              "width:100%;height:100%;border-radius:50%;display:block;";
                            tgt.innerHTML = ""; // remove fallback img
                            tgt.appendChild(
                              window._avatarPipRenderer.domElement,
                            );
                          } else {
                            setTimeout(_injectPipCanvas, 500);
                          }
                        };
                        _injectPipCanvas();
                      }

                      resolve();
                    });
                });
            };

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

                // Honor explicit generation text if we are in the procedural building phase
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
                    const ld = document.getElementById('loading-iframe');
                    if (ld && !ld.dataset.ready) {
                        ld.dataset.ready = 'true';
                        
                        if (window.logSystem) window.logSystem("Initializing...", 100, 100, 100, 50);

                        setTimeout(() => {
                            // Force GPU to compile all materials right now
                            renderer.compile(scene, camera);
                            if (window._nativeMapCam) renderer.compile(scene, window._nativeMapCam);
                            if (typeof axePipCam !== 'undefined' && axePipCam) renderer.compile(scene, axePipCam);
                            if (typeof tipiOrthoCam !== 'undefined' && tipiOrthoCam) renderer.compile(scene, tipiOrthoCam);
                            if (typeof tipiPerspCam !== 'undefined' && tipiPerspCam) renderer.compile(scene, tipiPerspCam);
                            
                            // 3-Frame warm-up loop to ensure buffers are uploaded
                            let warmUpFrames = 3;
                            function warmUp() {
                                warmUpFrames--;
                                if (warmUpFrames > 0) {
                                    requestAnimationFrame(warmUp);
                                } else {
                                    if (window.startBirdsong) window.startBirdsong();

                                    if (window.logSystem) window.logSystem("Initializing...", 100, 100, 100, 100);
                                    setTimeout(() => {
                                        if (ld.contentWindow) {
                                            ld.contentWindow.postMessage({ type: 'LOADING_COMPLETE' }, '*');
                                        }
                                        ld.style.pointerEvents = 'none';
                                        ld.style.opacity = 0;
                                        
                                        // Automatically open the Logbook when scene is ready
                                        const panel = document.getElementById('panel-frame');
                                        if (panel && panel.contentWindow) {
                                            panel.contentWindow.postMessage({ type: 'START_LOGBOOK_ANIMATION' }, '*');
                                        }

                                        setTimeout(() => ld.remove(), 2000); 
                                    }, 1050);
                                }
                            }
                            requestAnimationFrame(warmUp);
                        }, 50); // Small 50ms delay to ensure the DOM paints "Pre-Processing..."
                    }
                }
            }

            THREE.DefaultLoadingManager.onLoad = () => {
                window._assetDownloadsComplete = true;
                checkReadyToStart();
            };

            assetFactory = new AssetFactoryNextGen(THREE.DefaultLoadingManager);
            window._assetFactory = assetFactory;

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
                if (window.logSystem)
                  window.logSystem(
                    "Processing... Avatar (22MB)",
                    100,
                    100,
                    50,
                    0,
                  );
                
                // CRITICAL FIX: Sequence heavy GLTF parsing after world gen
                loadPlayerAvatar().then(() => {
                  if (window.logSystem)
                    window.logSystem(
                      "Initializing... Avatar Loaded",
                      100,
                      100,
                      100,
                      20,
                    );
                  window._worldGenerationComplete = true;
                  window._isGeneratingWorld = false;
                  fuzzyBrain = new FuzzyBrain(renderer, null, scene);
                  window.fuzzyBrain = fuzzyBrain; // EXPOSE TO GLOBAL
                  fuzzyBrain.linkCamera(camera);
                  fuzzyBrain.linkSun(window.sunLight);
                  fuzzyBrain.linkPIP(
                    typeof axeRenderer !== "undefined" ? axeRenderer : null,
                    pipCamera,
                  );
                  if (assetFactory && assetFactory.treeMeshes) {
                    fuzzyBrain.linkTrees(assetFactory.treeMeshes);
                  }

                  // Link creature systems to master AI
                  if (window.rabbitSystem)
                    fuzzyBrain.linkCreatureSystem(
                      "rabbits",
                      window.rabbitSystem,
                    );
                  if (window.birdSystem)
                    fuzzyBrain.linkCreatureSystem("birds", window.birdSystem);

                  checkReadyToStart();

                  // Register all core systems with Universe.Anu sentient monitor
                  if (window.UniverseAnu) {
                    window.UniverseAnu.registerSystem(
                      "Renderer",
                      () => !!renderer && renderer.info.render.frame > 0,
                      true,
                    );
                    window.UniverseAnu.registerSystem(
                      "Scene",
                      () => !!scene && scene.children.length > 0,
                      true,
                    );
                    window.UniverseAnu.registerSystem(
                      "FuzzyBrain",
                      () => !!window.fuzzyBrain && window.fuzzyBrain.enabled,
                      true,
                    );
                    window.UniverseAnu.registerSystem(
                      "Avatar",
                      () => !!window._playerAvatar,
                      true,
                    );
                    window.UniverseAnu.registerSystem(
                      "MasterAI",
                      () => !!window.masterAI,
                      false,
                    );
                    window.UniverseAnu.registerSystem(
                      "MasterNPCAI",
                      () => !!window.MasterNPCAI,
                      false,
                    );
                    window.UniverseAnu.registerSystem(
                      "RabbitSystem",
                      () => !!window.rabbitSystem,
                      false,
                    );
                    window.UniverseAnu.registerSystem(
                      "HerdSystem",
                      () => !!window.herdSystem,
                      false,
                    );
                    window.UniverseAnu.registerSystem(
                      "Terrain",
                      () => typeof window._getGroundY === "function",
                      true,
                    );
                    window.UniverseAnu.registerSystem(
                      "HexGrid",
                      () => !!window._villageMapGrid,
                      false,
                    );
                    console.log(
                      "%c[Universe.Anu] All systems registered. World is alive.",
                      "color: #fbc02d; font-weight: bold;",
                    );
                    window.UniverseAnu.onWorldReady(); // Engage sentient monitoring
                  }

                  // CRITICAL FIX: Only start the massive 60FPS render loop AFTER all geometries are parsed and loaded!
                  requestAnimationFrame(animate);
                });
            });

            // 8. POST PROCESSING
            setupPostProcessing();

            // 9. CONTROLS
            setupInput();

            // 10. NEW FEATURES
            setupPIP();
            setupLensflare();

            // 11. NPC INTELLIGENCE (MasterAI Subset)
            if (window.MasterNPCAI) {
                window.npcMaster = new window.MasterNPCAI();
            }

            // 12. LOOP
            clock = new THREE.Clock();

            // FORCE REMOVE LOADING SCREEN (Now handled by DefaultLoadingManager.onLoad)
        }

        // setupLighting extracted to EnvironmentBuilder.js?v=1776936956';

        // setupLensflare and setupOpticalMask extracted to Component.PostProcessing.js
        function setupPIP() {
          // PIP Renderer REMOVED: Replaced with Native WebGL Scissor Pipeline
          const wrapper = document.getElementById("moondial-wrapper");

          // AXE LOGBOOK RENDERER (CONSOLIDATED INTO MAIN RENDERER)
          window.axeCanvas2D = document.createElement("canvas");
          window.axeCtx = window.axeCanvas2D.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
          });
          window.axeCanvas2D.style.pointerEvents = "none";
          // axeRenderer deleted to save WebGL context!

          // Cinematic Tilted Perspective Overhead Minimap Camera
          pipCamera = new THREE.PerspectiveCamera(40, 1.0, 0.1, 3000);
          pipCamera.layers.enable(1); // Enable Layer 1 so we can see the FPV Avatar
          pipCamera.updateProjectionMatrix();

          // NATIVE CANVAS2D UI BLITTING PIPELINE (Replaces 3D Layer Masking Hack)
          window.pipCanvas2D = document.createElement("canvas");
          window.pipCanvas2D.width = PIP_SIZE;
          window.pipCanvas2D.height = PIP_SIZE;
          window.pipCtx = window.pipCanvas2D.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
          });

          // Clean DOM swap: Ensure existing pipCanvas takes over rendering natively if it exists
          const frame = document.getElementById("panel-frame");
          const panelDoc = frame ? frame.contentDocument : null;
          const existingPip =
            document.getElementById("pipCanvas") ||
            (panelDoc ? panelDoc.getElementById("pipCanvas") : null);

          if (existingPip) {
            window.pipCanvas2D = existingPip;
            window.pipCanvas2D.width = PIP_SIZE;
            window.pipCanvas2D.height = PIP_SIZE;
            window.pipCtx = window.pipCanvas2D.getContext("2d", {
              alpha: true,
              willReadFrequently: true,
            });
          } else if (wrapper) {
            wrapper.appendChild(window.pipCanvas2D);
          }

          _pipRenderTarget = new THREE.WebGLRenderTarget(PIP_SIZE, PIP_SIZE, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            depthBuffer: true,
            stencilBuffer: false,
          });

          scene.add(pipCamera); // Add Camera to scene so its Mesh descendants evaluate during rendering

          // ----------------------------------------------------------------
          // TIPI HARDWARE OVERLAY (Secondary Renderer Pattern for Journal)
          // ----------------------------------------------------------------
          // TIPI HARDWARE OVERLAY (CONSOLIDATED INTO MAIN RENDERER)
          window.tipiCanvas2D = document.createElement("canvas");
          window.tipiCanvas2D.id = "tipi-hardware-canvas";
          window.tipiCtx = window.tipiCanvas2D.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
          });
          window.tipiCanvas2D.style.position = "absolute";
          window.tipiCanvas2D.style.zIndex = "10005";
          window.tipiCanvas2D.style.display = "none";
          window.tipiCanvas2D.style.pointerEvents = "none";
          window.tipiCanvas2D.style.borderRadius = "4px";
          window.tipiCanvas2D.style.filter = "sepia(0.12) contrast(1.1)";
          document.body.appendChild(window.tipiCanvas2D);
          // tipiRenderer deleted to save WebGL context!

          // ----------------------------------------------------------------
          // AVATAR SIDE-PANEL PIP — Dedicated renderer + mini scene
          // ----------------------------------------------------------------
          window._avatarPipRenderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: false,
            powerPreference: "low-power",
          });
          window._avatarPipRenderer.setPixelRatio(
            Math.min(window.devicePixelRatio, 1.5),
          );
          window._avatarPipRenderer.setSize(92, 92, false);
          window._avatarPipRenderer.setClearColor(0x000000, 0);

          window._avatarPipScene = new THREE.Scene();
          window._avatarPipAmbient = new THREE.AmbientLight(0xfff8e1, 1.8);
          window._avatarPipScene.add(window._avatarPipAmbient);
          const _avatarPipSun = new THREE.DirectionalLight(0xffffff, 2.5);
          _avatarPipSun.position.set(3, 5, 4);
          window._avatarPipScene.add(_avatarPipSun);

          window.avatarOrthoCam = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
          // Legacy compat — still checked as avatarOrthoCam exists
          window.avatarCanvas2D = document.createElement("canvas");
          window.avatarCtx = null; // not used — dedicated renderer handles output

          // Zoomed in 50% more (3.5 bounds instead of 7)
          tipiOrthoCam = new THREE.OrthographicCamera(
            -3.5,
            3.5,
            3.5,
            -3.5,
            0.1,
            1000,
          );
          tipiOrthoCam.position.set(0, 15, 15); // Above and angled down
          tipiOrthoCam.lookAt(0, 2.5, 0); // Looking at center to keep ground in frame

          axePipCam = new THREE.PerspectiveCamera(60, 1, 0.1, 20);
          axePipCam.position.set(4.7, 1.8, 10.0);
          axePipCam.lookAt(0, 1.2, 0); // Vector math corrected! Now faces the exact center of the Tipi where the axe floats

          tipiOrthoCam.layers.set(0); // Tipi / Base layers
          tipiPerspCam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
          tipiPerspCam.layers.set(0);
          axePipCam.layers.set(0); // NATIVE WEBGLL RENDERTARGET SETUP (Replaces ES6 EffectComposer)

          // ----------------------------------------------------------------
          // SELFIE CAM OVERLAY (For Journal Page 3)
          // ----------------------------------------------------------------
          window.selfieCanvas2D = document.createElement("canvas");
          window.selfieCanvas2D.id = "selfie-hardware-canvas";
          window.selfieCtx = window.selfieCanvas2D.getContext("2d", {
            alpha: true,
            willReadFrequently: true,
          });
          window.selfieCanvas2D.style.position = "absolute";
          window.selfieCanvas2D.style.zIndex = "10006";
          window.selfieCanvas2D.style.display = "none";
          window.selfieCanvas2D.style.pointerEvents = "none";
          window.selfieCanvas2D.style.borderRadius = "8px";
          document.body.appendChild(window.selfieCanvas2D);

          window.selfieCam = new THREE.OrthographicCamera(
            -2,
            2,
            3,
            -3,
            0.1,
            50,
          );
          window.selfieCam.position.set(0, 1.5, 5); // Base position, will be dynamically updated
          window.selfieCam.lookAt(0, 1.0, 0);
          window.selfieCam.layers.enable(0); // Environment
          window.selfieCam.layers.enable(1); // Player Avatar

          _selfieRenderTarget = new THREE.WebGLRenderTarget(256, 384, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
          });
          _pipRenderTarget = new THREE.WebGLRenderTarget(PIP_SIZE, PIP_SIZE, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
          });
          _tipiRenderTarget = new THREE.WebGLRenderTarget(256, 256, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
          });

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
              tDiffuse: { value: null },
              time: { value: 0.0 },
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
                `,
          };

          const vibrantMapShader = {
            uniforms: {
              tDiffuse: { value: null },
              time: { value: 0.0 },
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
                `,
          };

          const brightMapShader = {
            uniforms: {
              tDiffuse: { value: null },
              time: { value: 0.0 },
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
                `,
          };

          // Build ShaderMaterials from our configs to use natively on hardware Quads
          const mapMat = new THREE.ShaderMaterial({
            ...brightMapShader,
            uniforms: THREE.UniformsUtils.clone(brightMapShader.uniforms),
          });
          window._mapMat = mapMat;

          const pipMat = new THREE.ShaderMaterial({
            ...vibrantMapShader,
            uniforms: THREE.UniformsUtils.clone(vibrantMapShader.uniforms),
          });
          window._pipMat = pipMat;

          const tipiMat = new THREE.ShaderMaterial({
            ...westernFilmShader,
            uniforms: THREE.UniformsUtils.clone(westernFilmShader.uniforms),
          });
          window._tipiMat = tipiMat;
          _tipiQuad.material = tipiMat; // Tipi uses the Old Western shader permanently

          // Look down from angle
          pipCamera.position.set(20, 20, 20);
          pipCamera.lookAt(0, 0, 0);

          // PIP CLICK EVENTS: Forwarded to `wrapper` beneath

          // CLICK PIP TO SWAP MODES
          window._swapModes = false;
          if (wrapper) {
            wrapper.addEventListener("click", (event) => {
              event.stopPropagation();
              window._swapModes = !window._swapModes;
              console.log(
                `[PIP] Modes swapped: ${window._swapModes ? "FPV in PIP, Map Main" : "Map in PIP, FPV Main"} `,
              );
              // Force recalculation of aspect ratios and swap the root camera variable
              window.dispatchEvent(new Event("resize"));
            });
          }
        }

        // setupEnvironment extracted to EnvironmentBuilder.js?v=1776936956';
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

                // --- NLP ROUTER FOR JOURNAL INPUT ---
                if (msg.type === 'PROCESS_INPUT') {
                    const rawText = (msg.value || '').toLowerCase().trim();
                    if (['start game', 'start', 'begin', 'go'].includes(rawText) || rawText.includes('start game')) {
                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) {
                            panel.contentWindow.postMessage({ type: 'NLP_RESPONSE', msg: `Command accepted: Starting Game...` }, '*');
                        }
                        
                        // Close journal immediately and remove bloom from input
                        const logIframe = document.getElementById('logbookFrame');
                        if (logIframe && logIframe.contentWindow) {
                            logIframe.contentWindow.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*');
                        } else if (panel && panel.contentWindow) {
                            panel.contentWindow.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*'); 
                        }
                        
                        // Walk to Yellow Butterfly
                        window.postMessage({ type: 'REQ_AUTOWALK_TO_ENTITY', targetName: 'yellowbutterfly' }, '*');
                        return;
                    }

                    const text = rawText.replace(/[^\w\s]/gi, ''); // remove punctuation
                    const tokens = text.split(/\s+/).filter(t => t.length > 0);
                    if (tokens.length === 0) return;

                    // 1. Check if we have a valid verb
                    const commonVerbs = ["get", "take", "pet", "go", "walk", "find", "look", "chase", "follow", "enter", "grab", "touch", "sleep", "rest"];
                    let foundVerb = null;
                    for (const token of tokens) {
                        if (commonVerbs.includes(token)) {
                            foundVerb = token;
                            break;
                        }
                    }

                    // 2. Cross-reference entities with GameObjectsDatabase
                    let matchedEntity = null;
                    if (window.GameObjectsDatabase) {
                        for (const obj of window.GameObjectsDatabase) {
                            for (const token of tokens) {
                                if (obj.aliases.includes(token)) {
                                    matchedEntity = obj;
                                    break;
                                }
                            }
                            if (matchedEntity) break;
                        }
                    }

                    // 3. Execution
                    if (matchedEntity) {
                        // Check if verb is allowed (or just allow if no verb but entity mentioned)
                        const isActionAllowed = !foundVerb || matchedEntity.allowedActions.includes(foundVerb);
                        
                        if (isActionAllowed) {
                            console.log(`[NLP] Routing action '${foundVerb || 'go'}' to entity '${matchedEntity.targetName}'`);
                            
                            // Send feedback
                            const panel = document.getElementById('panel-frame');
                            if (panel && panel.contentWindow) {
                                panel.contentWindow.postMessage({ type: 'NLP_RESPONSE', msg: `Command accepted: Pathfinding to ${matchedEntity.aliases[0]}...` }, '*');
                            }

                            // Dispatch auto-walk
                            window.postMessage({ type: 'REQ_AUTOWALK_TO_ENTITY', targetName: matchedEntity.targetName }, '*');
                            
                            // Close Journal so player can see it happen
                            if (panel && panel.contentWindow) {
                                panel.contentWindow.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*');
                            }
                        } else {
                            const panel = document.getElementById('panel-frame');
                            if (panel && panel.contentWindow) panel.contentWindow.postMessage({ type: 'NLP_RESPONSE', msg: `You can't ${foundVerb} the ${matchedEntity.aliases[0]}.` }, '*');
                        }
                    } else {
                        // Fallback generic response
                        const panel = document.getElementById('panel-frame');
                        if (panel && panel.contentWindow) panel.contentWindow.postMessage({ type: 'NLP_RESPONSE', msg: 'System: Unrecognized object or command.' }, '*');
                    }
                    return;
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
                    window._logbookCooldown = performance.now() + 500; // Ignore all canvas clicks for 500ms after logbook closes
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
                    // console.log("[PIP_TRACE] REQ_ALIGN_TIPI Received!", JSON.stringify(msg.rect));
                    window._tipiPipTarget = msg.target || 'tipi';
                    if (window.tipiCanvas2D) {
                        const canvasNode = window.tipiCanvas2D;
                        canvasNode.style.display = 'block';
                        let wrapper = document.getElementById('tipi-canvas-wrapper');
                        if (!wrapper) {
                            wrapper = document.createElement('div');
                            wrapper.id = 'tipi-canvas-wrapper';
                            wrapper.style.position = 'absolute';
                            wrapper.style.zIndex = '999999'; // FPS FIX: Ensure it completely covers the 'FEED OFFLINE' DOM element
                            wrapper.style.borderRadius = '50%'; // USER FIX: Make it a perfect circle to match journal
                            wrapper.style.border = 'none';
                            wrapper.style.overflow = 'hidden';
                            wrapper.style.backgroundColor = "transparent";
                            wrapper.style.transform = 'translateZ(0)'; // Force WebKit clip
                            wrapper.style.opacity = '0';
                            wrapper.style.transition = 'opacity 0.4s ease-out';

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

                        if (wrapper.style.display === 'none' || wrapper.style.display === '') {
                            wrapper.style.display = 'block';
                            // Force reflow
                            void wrapper.offsetWidth;
                        }
                        
                        wrapper.style.opacity = '1';
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

                            // FPS FIX: Ensure Perspective camera aspect matches the PiP rect too
                            tipiPerspCam.aspect = aspect;
                            tipiPerspCam.updateProjectionMatrix();
                        }
                    }
                }

                if (msg.type === 'REQ_HIDE_TIPI') {
                    window._tipiPipTarget = null;
                    window._tipiRect = null;
                    const w = document.getElementById('tipi-canvas-wrapper');
                    if (w) {
                        w.style.opacity = '0';
                        setTimeout(() => {
                            if (w.style.opacity === '0') {
                                w.style.display = 'none';
                                if (window.tipiCanvas2D) window.tipiCanvas2D.style.display = 'none';
                            }
                        }, 400);
                    } else if (window.tipiCanvas2D) {
                        window.tipiCanvas2D.style.display = 'none';
                    }
                }

                if (msg.type === 'REQ_ALIGN_SELFIE' && msg.rect) {
                    window._selfieRect = msg.rect;
                    if (window.selfieCanvas2D) {
                        const canvasNode = window.selfieCanvas2D;
                        canvasNode.style.display = 'block';
                        
                        let wrapper = document.getElementById('selfie-overlay');
                        if (!wrapper) {
                            // index.html should have this, but fallback if not
                            wrapper = document.createElement('div');
                            wrapper.id = 'selfie-overlay';
                            wrapper.style.position = 'absolute';
                            wrapper.style.zIndex = '10006';
                            wrapper.style.pointerEvents = 'none';
                            wrapper.style.borderRadius = '8px';
                            wrapper.style.overflow = 'hidden';
                            wrapper.style.opacity = '0';
                            wrapper.style.transition = 'opacity 0.4s ease-out';
                            
                            // Build REC UI
                            const recDot = document.createElement('div');
                            recDot.style.cssText = 'position: absolute; top: 10px; right: 15px; display: flex; align-items: center; gap: 6px;';
                            recDot.innerHTML = '<div style="width:10px;height:10px;border-radius:50%;background-color:red;animation:blink 1s infinite;"></div><span style="color:white;font-family:monospace;font-weight:bold;font-size:14px;text-shadow:1px 1px 2px black;">REC</span>';
                            
                            const battery = document.createElement('div');
                            battery.style.cssText = 'position: absolute; top: 12px; left: 15px; color: white; font-size: 18px; text-shadow: 1px 1px 2px black;';
                            battery.innerHTML = '<i class="fa-solid fa-battery-three-quarters"></i>';
                            
                            wrapper.appendChild(recDot);
                            wrapper.appendChild(battery);
                            document.body.appendChild(wrapper);
                            
                            if (!document.getElementById('selfie-blink-style')) {
                                const style = document.createElement('style');
                                style.id = 'selfie-blink-style';
                                style.innerHTML = '@keyframes blink { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 1; } }';
                                document.head.appendChild(style);
                            }
                        }

                        // Clean defaults from canvas
                        canvasNode.style.position = 'absolute';
                        canvasNode.style.top = '0';
                        canvasNode.style.left = '0';
                        canvasNode.style.width = '100%';
                        canvasNode.style.height = '100%';
                        canvasNode.style.zIndex = '-1'; // Behind REC UI

                        if (canvasNode.parentElement !== wrapper) {
                            wrapper.appendChild(canvasNode);
                        }

                        const bookWrapper = document.getElementById('panel-frame');
                        const bwRect = bookWrapper ? bookWrapper.getBoundingClientRect() : { left: 0, top: 0 };

                        if (wrapper.style.display === 'none' || wrapper.style.display === '') {
                            wrapper.style.display = 'block';
                            void wrapper.offsetWidth;
                        }
                        
                        wrapper.style.opacity = '1';
                        wrapper.style.left = (bwRect.left + msg.rect.x) + 'px';
                        wrapper.style.top = (bwRect.top + msg.rect.y) + 'px';
                        wrapper.style.width = msg.rect.width + 'px';
                        wrapper.style.height = msg.rect.height + 'px';

                        const w = Math.floor(msg.rect.width);
                        const h = Math.floor(msg.rect.height);
                        if (canvasNode.width !== w || canvasNode.height !== h) {
                            window.selfieCanvas2D.width = w;
                            window.selfieCanvas2D.height = h;
                            const aspect = w / h;
                            const selfieFrustum = 6.0; // Captures two models
                            window.selfieCam.left = -selfieFrustum * aspect / 2;
                            window.selfieCam.right = selfieFrustum * aspect / 2;
                            window.selfieCam.top = selfieFrustum / 2;
                            window.selfieCam.bottom = -selfieFrustum / 2;
                            window.selfieCam.updateProjectionMatrix();
                        }
                    }
                }

                if (msg.type === 'REQ_HIDE_SELFIE') {
                    window._selfieRect = null;
                    const w = document.getElementById('selfie-overlay');
                    if (w) {
                        w.style.opacity = '0';
                        setTimeout(() => {
                            if (w.style.opacity === '0') {
                                w.style.display = 'none';
                                if (window.selfieCanvas2D) window.selfieCanvas2D.style.display = 'none';
                            }
                        }, 400);
                    } else if (window.selfieCanvas2D) {
                        window.selfieCanvas2D.style.display = 'none';
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
                    document.body.classList.toggle('is-map-view', isMap);
                    
                    const pFrame = document.getElementById('panel-frame');
                    if (pFrame && pFrame.contentWindow) {
                        pFrame.contentWindow.postMessage({ type: 'TOGGLE_MAP_VIEW', isMap: isMap }, '*');
                    }
                    
                    // Invalidate pipCanvas overlay cache so it's measured fresh each toggle
                    window._pipCanvasEl = null;
                    window._cachedTlRect = null;
                    window._tlRectAge = 0;

                    const curAspect = window.innerWidth / window.innerHeight;

                    if (isMap) {
                        // Enter MAP MODE
                        if (!window._mainFpvCam) window._mainFpvCam = camera;
                        if (!window._nativeMapCam || !window._nativeMapCam.isPerspectiveCamera) {
                            window._nativeMapCam = new THREE.PerspectiveCamera(20, curAspect, 0.1, 2500);
                            window._nativeMapCam.layers.enable(1); // Avatar visible in Village View
                            window._nativeMapCam.layers.enable(2); // Hex Grid visible in Village View
                            window._nativeMapCam.layers.enable(3); // Branches visible in Village View
                        }
                        
                        // Configure the Native Map Cam for narrow-FOV Diorama Projection
                        window._nativeMapCam.aspect = curAspect;
                        window._nativeMapCam.near = 0.1;
                        window._nativeMapCam.far = 2500;
                        window._nativeMapCam.updateProjectionMatrix();

                        // pipCamera stays as a PerspectiveCamera FPV mirror.
                        // Restore its aspect ratio to square for the moondial (PiP is square).
                        if (pipCamera.isPerspectiveCamera) {
                            pipCamera.aspect = 1.0;
                            pipCamera.updateProjectionMatrix();
                        }

                        // Clean Photorealistic Diorama Lighting
                        if (window.sunLight) {
                            window.sunLight.intensity = 2.0; 
                        }

                    } else {
                        // Exit MAP MODE -> Return to FPV
                        // Restore pipCamera aspect to square for moondial FPV mirror
                        if (pipCamera.isPerspectiveCamera) {
                            pipCamera.aspect = 1.0;
                            pipCamera.updateProjectionMatrix();
                        }

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
                                // m.userData._prevVisible = m.visible;
                                // m.visible = false;
                            } else {
                                // m.visible = m.userData._prevVisible !== undefined ? m.userData._prevVisible : true;
                            }
                        }
                    });
                    
                    // Globally toggle Instanced meshes independently
                    // Trees STAY VISIBLE in map view so the village diorama looks populated and lush.
                    // Only the non-instanced legacy trees (allTrees array) are hidden above.
                    if (window._treeInstancedMeshes) {
                        window._treeInstancedMeshes.forEach(im => {
                            if (im.instancedMesh) {
                                im.instancedMesh.visible = true; // Always visible — trees are the soul of the village
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

                    // 1. Search Wildlife (Horses, Rabbits, Spirit, Deer)
                    if (window._animals && window._animals.length > 0) {
                        for (const a of window._animals) {
                            if (search.includes('horse') && a.species === 'horse') { targetObj = a; break; }
                        }
                    }
                    if (!targetObj && search.includes('rabbit') && window.rabbitSystem && window.rabbitSystem.rabbits.length > 0) {
                        targetObj = window.rabbitSystem.rabbits[0]; // pick first rabbit
                    }
                    if (!targetObj && search.includes('deer') && window.deerSystem && window.deerSystem.deer.length > 0) {
                        targetObj = window.deerSystem.deer[0];
                    }
                    if (!targetObj && search.includes('spirit') && window.natureSpiritSystem && window.natureSpiritSystem.mesh) {
                        targetObj = { mesh: window.natureSpiritSystem.mesh };
                    }

                    // 2. Search Environment (Water, Trees, Tipi, Axe)
                    if (!targetObj) {
                        if ((search.includes('tipi') || search.includes('teepee')) && window._tipiMeshes && window._tipiMeshes.length > 0) targetObj = { mesh: window._tipiMeshes[0] };
                        if (search.includes('axe') && window._worldAxeMesh) targetObj = { mesh: window._worldAxeMesh, isAxe: true };
                        if ((search.includes('yellowbutterfly') || search.includes('butterfly')) && window._yellowButterflyNPC) targetObj = { mesh: window._yellowButterflyNPC, isYB: true };
                        if (search.includes('bringshappinessgirl') && window._bhgCharacterMesh) targetObj = { mesh: window._bhgCharacterMesh, isBHG: true };
                    }

                    if (targetObj) {
                        // Extract position
                        let pos = new THREE.Vector3();
                        if (targetObj.mesh) targetObj.mesh.getWorldPosition(pos);
                        else if (targetObj.position) pos.copy(targetObj.position);

                        if (pos.lengthSq() > 0) {
                            if (targetObj.isYB) {
                                // YB is at (-2.0, 2.4). We want to stop 1.5 units in front of her (+Z relative).
                                window._moveTarget = new THREE.Vector3(pos.x, 0, pos.z + 1.5);
                                window._lookTarget = new THREE.Vector3(pos.x, 1.5, pos.z);
                                window._autoWalkCompleteEvent = () => {
                                    if (window.ybSystem && window.ybSystem.actions && window.ybSystem.actions.wave) {
                                        window.ybSystem.actions.wave.reset().play();
                                        if (window.ybSystem.currentBaseAction) window.ybSystem.actions.wave.crossFadeFrom(window.ybSystem.currentBaseAction, 0.5, false);
                                    }
                                    const panel = document.getElementById('panel-frame');
                                    if (panel && panel.contentWindow) panel.contentWindow.postMessage({ type: 'YB_GREETING_ARRIVED' }, '*');
                                };
                            } else if (targetObj.isBHG) {
                                // BHG is at (12.0, 7.0) facing -Z. We want to stop 1.5 units in front of her (-Z).
                                window._moveTarget = new THREE.Vector3(pos.x, 0, pos.z - 1.5);
                                window._lookTarget = new THREE.Vector3(pos.x, 1.5, pos.z);
                                window._autoWalkCompleteEvent = () => {
                                    if (window.bhgSystem && window.bhgSystem.actions && window.bhgSystem.actions.wave) {
                                        window.bhgSystem.actions.wave.reset().play();
                                        if (window.bhgSystem.actions.idle) window.bhgSystem.actions.wave.crossFadeFrom(window.bhgSystem.actions.idle, 0.5, false);
                                    }
                                    if (window._avWaveAction) {
                                        window._avWaveAction.reset().play();
                                        if (window._avIdleAction) window._avWaveAction.crossFadeFrom(window._avIdleAction, 0.5, false);
                                    }
                                    const panel = document.getElementById('panel-frame');
                                    if (panel && panel.contentWindow) panel.contentWindow.postMessage({ type: 'BHG_GREETING_ARRIVED' }, '*');
                                };
                            } else if (targetObj.isAxe) {
                                // USER REQUEST: Hardcode axe walk target coordinates and facing East
                                // moveTarget is the ground position (y=0)
                                window._moveTarget = new THREE.Vector3(11.5, 0, 8.6);
                                // lookTarget faces East (+X axis) at height 1.8
                                window._lookTarget = new THREE.Vector3(21.5, 1.8, 8.6);
                                window._autoWalkCompleteEvent = null; // Clear any previous events
                            } else {
                                window._moveTarget = new THREE.Vector3(pos.x, 0, pos.z);
                            }
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

                // OBSERVE_WILDLIFE_ACTION removed

                if (msg.type === 'GATHER_ACTION') {
                    // Route the legacy panel GATHER action securely to the modern instanced tree chopping routine
                    window.postMessage({ type: 'REQ_CHOP_NEAREST_TREE' }, '*');
                    return;
                }

                // ONLY PROCESS CANVAS CLICKS BEYOND THIS POINT
                if (msg.type === 'CANVAS_CLICK') {
                    // Prevent interacting with the 3D ground/scene if the Logbook modal is actively consuming the screen
                    if (window._isLogbookOpen) return;
                    
                    // Prevent phantom clicks from passing through the logbook's close button directly onto the canvas underneath!
                    if (window._logbookCooldown && performance.now() < window._logbookCooldown) return;

                    // Convert normalized coords (0-1) to NDC (-1 to 1)
                    const _tunnelMouse = new THREE.Vector2(msg.x * 2 - 1, -(msg.y * 2 - 1));
                    const _tunnelRay = new THREE.Raycaster();
                    _tunnelRay.setFromCamera(_tunnelMouse, camera);

                    // Spirit click check
                    if (typeof deerSystem !== 'undefined' && deerSystem) {
                        _tunnelRay._clickPos = _tunnelMouse;
                        if (deerSystem.clickSpirit(_tunnelRay, camera)) return;
                    }

                    // Animal Raycast Check removed

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

                                    // Explicitly update the Guide Card to the Quest 2 objective.
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
                            // USER REQUEST: Remove click-to-move from map
                            // window._moveTarget = new THREE.Vector3(hit.point.x, 0, hit.point.z);
                            break;
                        }
                    }

                }
            }, false);

            // 1. Global Resize Handler
            window._lastBaseWidth = window.innerWidth;
            let resizeTimeout;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimeout);
                // Prevent continuous morphing by debouncing
                resizeTimeout = setTimeout(() => {
                    if (Math.abs(window.innerWidth - window._lastBaseWidth) > 300) {
                        // Viewport changed drastically (different device classification/orientation) -> Redraw scene cleanly
                        window._lastBaseWidth = window.innerWidth;
                    }
                    
                    if (camera && renderer) {
                        const aspect = window.innerWidth / window.innerHeight;

                        // Maintain standard FPV camera wide aspect ratio unless it's currently shrunk inside the PIP circle
                        if (!window._swapModes) {
                            camera.aspect = aspect;
                            camera.updateProjectionMatrix();
                        }
                        
                        if (window._nativeMapCam && window._nativeMapCam.isPerspectiveCamera) {
                            window._nativeMapCam.aspect = aspect;
                            window._nativeMapCam.updateProjectionMatrix();
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
                }, 250);
            });

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

            // BUILDING HIGHLIGHT SYSTEM
            window.clearBuildingHighlight = () => {
                if (window._selectedBuilding && window._selectedBuilding._outlineMesh) {
                    window._selectedBuilding.remove(window._selectedBuilding._outlineMesh);
                    window._selectedBuilding._outlineMesh.traverse(child => {
                        if (child.isMesh) {
                            if (child.geometry) child.geometry.dispose();
                            if (child.material) child.material.dispose();
                        }
                    });
                    window._selectedBuilding._outlineMesh = null;
                }
                window._selectedBuilding = null;
                
                const buildingBtn = document.getElementById('building-action-btn');
                if (buildingBtn) {
                    buildingBtn.classList.remove('active-glow');
                    buildingBtn.style.display = 'none';
                }
            };

            window.highlightBuilding = (building) => {
                window.clearBuildingHighlight();
                window._selectedBuilding = building;
                
                const outlineGroup = building.clone();
                const outlineMat = new THREE.MeshBasicMaterial({ 
                    color: 0xFFD700, 
                    side: THREE.BackSide, 
                    transparent: true,
                    opacity: window._isMapView ? 0.8 : 0.4, // Brighter in Village View
                    blending: THREE.AdditiveBlending // Added bloom-like effect
                });
                
                if (window._isMapView) {
                    // Send message to Journal to show building info
                    let tipiId = 1;
                    let ownerText = "This is the tipi of, it is Tipi 1 the main tipi.";
                    
                    // Identify which tipi was clicked
                    if (building === window._interactiveBuildings[2] || building === window._interactiveBuildings[3]) {
                        tipiId = 2;
                        ownerText = "This is the tipi of Brings Happiness Girl, her daughter.";
                    } else if (building === window._interactiveBuildings[4] || building === window._interactiveBuildings[5]) {
                        tipiId = 3;
                        ownerText = "This is the tipi of, it is Tipi 3.";
                    }
                    
                    const panel = document.getElementById('panel-frame');
                    if (panel && panel.contentWindow) {
                        panel.contentWindow.postMessage({ type: 'SHOW_BUILDING_INFO', tipiId, ownerText }, '*');
                    }
                    
                    // Show Action Sidebar and glow the tipi icon
                    const sidebar = document.getElementById('action-sidebar');
                    if (sidebar) sidebar.style.display = 'flex';
                    
                    const buildingBtn = document.getElementById('building-action-btn');
                    if (buildingBtn) {
                        buildingBtn.style.display = 'flex';
                        buildingBtn.classList.add('active-glow');
                    }
                }
                
                const toRemove = [];
                outlineGroup.traverse(child => {
                    if (child.isMesh) {
                        if (child.geometry && (child.geometry.type.includes('Cylinder') || child.geometry.type.includes('Torus'))) {
                            toRemove.push(child);
                        } else {
                            child.material = outlineMat;
                        }
                    }
                });
                toRemove.forEach(c => {
                    if (c.parent) c.parent.remove(c);
                });
                
                outlineGroup.position.set(0,0,0);
                outlineGroup.rotation.set(0,0,0);
                outlineGroup.scale.set(1.05, 1.05, 1.05);
                
                building.add(outlineGroup);
                building._outlineMesh = outlineGroup;
            };

            // 3. CLICK-TO-MOVE on main 3D viewport
            const _fpvRaycaster = new THREE.Raycaster();
            const _fpvMouse = new THREE.Vector2();
            renderer.domElement.addEventListener('click', (event) => {
                // PIP BLOCK: Prevent click-to-move inside the PiP overlay
                if (window._cachedPipRect && window._pipRectAge < 100 && window.pipCanvas2D && window.pipCanvas2D.style.display !== 'none') {
                    const pipRect = window._cachedPipRect;
                    const p = 30; // Padding to fully encompass the floating season dial ring
                    if (event.clientX >= (pipRect.left - p) && event.clientX <= (pipRect.right + p) &&
                        event.clientY >= (pipRect.top - p) && event.clientY <= (pipRect.bottom + p)) {
                        return; // Ignore click!
                    }
                }
                
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

                // 3c. BUILDING SELECTION (Village View & FPV)
                if (window._interactiveBuildings && window._interactiveBuildings.length > 0) {
                    const buildingHits = _fpvRaycaster.intersectObjects(window._interactiveBuildings, true);
                    if (buildingHits.length > 0) {
                        let building = buildingHits[0].object;
                        if (building.userData && building.userData.buildingRoot) {
                            building = building.userData.buildingRoot;
                        } else {
                            while (building.parent && !building.userData.isBuilding) {
                                building = building.parent;
                            }
                        }
                        if (building.userData && building.userData.isBuilding) {
                            if (window._selectedBuilding === building) {
                                window.clearBuildingHighlight();
                            } else {
                                window.highlightBuilding(building);
                            }
                            return; // Stop processing click (don't move or chop)
                        }
                    } else {
                        // Clicked away, clear selection
                        if (window.clearBuildingHighlight) window.clearBuildingHighlight();
                    }
                }

                // 3d. FOREST INTERACTION (Highlight & Chop)
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
                        // USER REQUEST: Remove click-to-move from map
                        // window._moveTarget = new THREE.Vector3(hit.point.x, 0, hit.point.z);
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
        const _matrix = new THREE.Matrix4();
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
          const delta = Math.min(clock.getDelta(), 0.1); // Cap delta to avoid physics explosions on tab switch
          frameCount++;

          // --- MASTER NPC INTELLIGENCE ---
          const _aiThrottle =
            window.fuzzyBrain && window.fuzzyBrain.aiThrottle > 1
              ? window.fuzzyBrain.aiThrottle
              : 1;
          if (
            window.npcMaster &&
            !window.npcMaster._paused &&
            frameCount % _aiThrottle === 0
          ) {
            window.npcMaster.update(delta * _aiThrottle);
          }

          // --- MOVEMENT LOGIC ---
          const SPEED = 5.0;
          const TURN_SPEED = 2.0;
          let isMoving = false;
          let oldPos = camera.position.clone();

          if (!window._isCinematic) {
            // 1. Rotation (Keyboard A/D + Arrows + Keypad)
            if (keys.arrowleft || keys.a) {
              camera.rotation.y += TURN_SPEED * delta;
              isMoving = true;
            }
            if (keys.arrowright || keys.d) {
              camera.rotation.y -= TURN_SPEED * delta;
              isMoving = true;
            }

            // 2. Direction Vectors (reuse pre-allocated)
            camera.getWorldDirection(_dir);
            _dir.y = 0;
            _dir.normalize();

            _right.crossVectors(_dir, _up).normalize();

            // 3. Move (WASD + Arrows)
            if (keys.w || keys.arrowup) {
              camera.position.addScaledVector(_dir, SPEED * delta);
              isMoving = true;
            }
            if (keys.s || keys.arrowdown) {
              camera.position.addScaledVector(_dir, -SPEED * delta);
              isMoving = true;
            }

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
                const currentSpeed = window._slowWalkcinematic
                  ? SPEED * 0.3
                  : SPEED;
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
                  if (
                    window._choppingTimer === undefined ||
                    window._choppingTimer === null
                  ) {
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
            } else if (
              isMoving &&
              (window._moveTarget || (window._choppingTimer || 0) > 0)
            ) {
              window._moveTarget = null; // Manual input cancels auto-walk
              window._lookTarget = null;
              window._activeLookTarget = null;
              window._choppingTarget = null;
              window._choppingTimer = 0;
            }

            // --- COLLISIONS ---
            // Tipi Collision Check
            const TIPI_RADIUS = 3.5;
            const checkTipiCollision = (px, pz) => {
              if (px * px + pz * pz < TIPI_RADIUS * TIPI_RADIUS) return true; // YB Tipi at 0,0
              const dx = px - -12;
              const dz = pz - 12;
              if (dx * dx + dz * dz < TIPI_RADIUS * TIPI_RADIUS) return true; // BHG Tipi at -12, 12
              return false;
            };

            // Tree Collision Check
            const TREE_RADIUS = 1.0;
            const checkTreeCollision = (px, pz) => {
              if (
                !window._treeInstancedMeshes ||
                window._treeInstancedMeshes.length === 0
              )
                return false;
              const dummy = new THREE.Object3D();
              for (const { instancedMesh } of window._treeInstancedMeshes) {
                for (let i = 0; i < instancedMesh.count; i++) {
                  instancedMesh.getMatrixAt(i, _matrix);
                  dummy.position.setFromMatrixPosition(_matrix);
                  const tdx = px - dummy.position.x;
                  const tdz = pz - dummy.position.z;
                  if (tdx * tdx + tdz * tdz < TREE_RADIUS * TREE_RADIUS)
                    return true;
                }
              }
              return false;
            };

            if (
              checkTipiCollision(camera.position.x, camera.position.z) ||
              checkTreeCollision(camera.position.x, camera.position.z)
            ) {
              camera.position.copy(oldPos);
            }
          } // End of !window._isCinematic wrapper

          // PASSIVE GRAVITY (Follow Terrain)
          const cx = camera.position.x;
          const cz = camera.position.z;
          const groundY = window._getGroundY
            ? window._getGroundY(cx, cz)
            : Math.sin(cx * 0.1) * Math.cos(cz * 0.1) * 2 +
              Math.sin(cx * 0.3 + cz * 0.2) * 0.5;

          // --- PROXIMITY QUEST TRIGGER (Manual Walking) ---
          if (
            window.SacredState &&
            window.SacredState.questLevel === 2 &&
            window._bhgGroup &&
            !window._isCinematic &&
            !window._pendingTipiGreeting
          ) {
            const dx = camera.position.x - window._bhgGroup.position.x;
            const dz = camera.position.z - window._bhgGroup.position.z;
            if (dx * dx + dz * dz < 144) {
              // 12 units radius
              window.SacredState.questLevel = 3;
              window._hasTriggeredGirlQuest = true; // Legacy binding support

              // Hide floating quest marker 2 if it exists since we are in the dialogue now
              if (window._questMarker2) window._questMarker2.visible = false;
              // OPEN JOURNAL TO PAGE 5 FOR THE QUEST
              setTimeout(() => {
                const panel = document.getElementById("panel-frame");
                if (panel && panel.contentWindow) {
                  panel.contentWindow.postMessage(
                    { type: "FORCE_OPEN_FOUND_HER" },
                    "*",
                  );
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
              window._equippedAxe.rotation.x =
                window._equippedAxe._baseRotation.x + Math.max(0, dip) * 1.5;
              window._equippedAxe.position.y = -0.6 - Math.max(0, dip) * 0.4;
            }

            if (window._choppingTarget) {
              // Legacy non-instanced tree shake
              window._choppingTarget.rotation.z =
                Math.sin(Date.now() * 0.05) * 0.03;
              // Face tree while chopping
              const t = window._choppingTarget.position;
              const c = camera.position;
              const angle = Math.atan2(t.x - c.x, t.z - c.z);
              camera.rotation.y = THREE.MathUtils.lerp(
                camera.rotation.y,
                angle,
                delta * 10,
              );
            } else if (
              window._chopTargetInstanceId !== null &&
              window._chopTargetInstanceId !== undefined
            ) {
              // Shake camera slightly on hit for instanced trees
              const dip = Math.sin((1.6 - window._choppingTimer) * Math.PI * 4);
              if (dip > 0.95)
                camera.rotation.x += Math.random() * 0.005 - 0.0025;
            }

            if (window._choppingTimer <= 0) {
              // Hide axe
              if (window._equippedAxe) window._equippedAxe.visible = false;

              if (window._choppingTarget) {
                if (typeof chopTree === "function")
                  chopTree(window._choppingTarget, scene);
                window._choppingTarget = null;
              } else if (
                window._chopTargetInstanceId !== null &&
                window._chopTargetInstanceId !== undefined
              ) {
                // Destroy Instanced Tree
                const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
                if (
                  window._chopTargetMesh &&
                  window._chopTargetMesh.userData &&
                  window._chopTargetMesh.userData.chunkSiblings
                ) {
                  window._chopTargetMesh.userData.chunkSiblings.forEach(
                    ({ instancedMesh }) => {
                      instancedMesh.setMatrixAt(
                        window._chopTargetInstanceId,
                        zeroMatrix,
                      );
                      instancedMesh.instanceMatrix.needsUpdate = true;
                    },
                  );
                }
                if (window._treeHighlightMesh)
                  window._treeHighlightMesh.visible = false;
                window._selectedTreeId = null;
                window._chopTargetInstanceId = null;

                if (window.parent)
                  window.parent.postMessage(
                    { type: "LOG_TEXT", text: "You chopped down a pine tree." },
                    "*",
                  );
                // Award Wood
                if (window.parent)
                  window.parent.postMessage(
                    { type: "RESOURCE_UPDATE", resource: "wood", amount: 1 },
                    "*",
                  );
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
              camera.rotation.y +=
                Math.sign(angleDiff) *
                Math.min(Math.abs(angleDiff), TURN_SPEED * 1.5 * delta);
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
            const groundAtTarget = window._getGroundY
              ? window._getGroundY(t.x, t.z)
              : Math.sin(t.x * 0.1) * Math.cos(t.z * 0.1) * 2 +
                Math.sin(t.x * 0.3 + t.z * 0.2) * 0.5;
            _marker.visible = false;
            _marker.position.set(t.x, groundAtTarget + 0.05, t.z);
            _marker.material.opacity =
              0.5 + Math.sin(performance.now() * 0.004) * 0.2;
          } else {
            _marker.visible = false;
          }

          // 3.5 Hover Physics for Tipi 2 Magical Axe
          if (window._worldAxeMesh) {
            window._worldAxeMesh.position.y =
              1.2 + Math.sin(performance.now() * 0.002) * 0.15;
            window._worldAxeMesh.rotation.y += delta * 0.5;
          }

          // 4. Head Bob Animation (Walking)
          let bobOffset = 0;
          if (isMoving || window._isCinematicWalking) {
            headBobTimer += delta * 12; // Walking frequency
            bobOffset = Math.sin(headBobTimer) * 0.15; // Amplitude

            // 4a. Update Quest Proximity (only while moving to save cycles)
            const panelFrame = document.getElementById("panel-frame");
            if (panelFrame && panelFrame.contentWindow) {
              let nearestDist = Infinity;
              let nearestId = "tipi";

              // Check Main Tipi (0, 0)
              if (!window._questMarker || window._questMarker.visible) {
                const dTipi = Math.sqrt(
                  Math.pow(camera.position.x - 0, 2) +
                    Math.pow(camera.position.z - 0, 2),
                );
                if (dTipi < nearestDist) {
                  nearestDist = dTipi;
                  nearestId = "tipi";
                }
              }

              // Check Brings Happiness Girl (35, 45)
              if (window._bhgBalloon && window._bhgBalloon.visible) {
                const dBhg = Math.sqrt(
                  Math.pow(camera.position.x - 35, 2) +
                    Math.pow(camera.position.z - 45, 2),
                );
                if (dBhg < nearestDist) {
                  nearestDist = dBhg;
                  nearestId = "bhg";
                }
              }

              if (nearestDist === Infinity) {
                nearestDist = Math.sqrt(
                  Math.pow(camera.position.x - 0, 2) +
                    Math.pow(camera.position.z - 0, 2),
                ); // fallback
              }

              // Convert meters to feet (1m = ~3.28ft)
              const distFeet = Math.round(nearestDist * 3.28084);

              // Throttle postMessage slightly using a simple frame counter or just send it since it's only while moving
              if (
                !window._lastDistFeet ||
                Math.abs(window._lastDistFeet - distFeet) >= 2 ||
                window._lastNearestId !== nearestId
              ) {
                window._lastDistFeet = distFeet;
                window._lastNearestId = nearestId;
                panelFrame.contentWindow.postMessage(
                  {
                    type: "QUEST_DISTANCE_UPDATE",
                    distance: distFeet,
                    nearestId: nearestId,
                  },
                  "*",
                );
              }
            }
          } else {
            headBobTimer = 0;
          }

          // 4b. Notify panel of movement state (for guide card transparency)
          if (isMoving !== window._lastMovingState) {
            window._lastMovingState = isMoving;
            const panelFrame = document.getElementById("panel-frame");
            if (panelFrame && panelFrame.contentWindow) {
              panelFrame.contentWindow.postMessage(
                { type: "playerMoving", moving: isMoving },
                "*",
              );
            }
          }

          // Apply Height (Terrain + Height + Bob)
          const BASE_HEIGHT = 1.2; // Lowered camera by 2 feet to see circle direction
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
            window._targetRing.position.set(
              window._moveTarget.x,
              window.envBuilder &&
                typeof window.envBuilder.getGroundY === "function"
                ? window.envBuilder.getGroundY(
                    window._moveTarget.x,
                    window._moveTarget.z,
                  ) + 0.1
                : 0.1,
              window._moveTarget.z,
            );
            window._targetRing.scale.setScalar(
              1.0 + Math.sin(gameTime * 10) * 0.1,
            );

            // Update Line
            const positions =
              window._pathLine.geometry.attributes.position.array;
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
                window._avWalkAction.reset().play();
                window._avWalkAction.crossFadeFrom(window._avIdleAction, 0.3, true);
                // Mirror onto pip clone
                if (window._avatarPipMixer && window._avWalkClip && window._avIdleClip) {
                  const pipWalk = window._avatarPipMixer.clipAction(window._avWalkClip);
                  const pipIdle = window._avatarPipMixer.clipAction(window._avIdleClip);
                  pipWalk.reset().play(); pipWalk.crossFadeFrom(pipIdle, 0.3, true);
                }
                const panelFrame = document.getElementById("panel-frame");
                if (panelFrame && panelFrame.contentWindow)
                  panelFrame.contentWindow.postMessage(
                    { type: "AVATAR_ANIM_CHANGE", anim: "walk" },
                    "*",
                  );
              } else if (!isMoving && window._avIsWalking) {
                window._avIsWalking = false;
                window._avIdleAction.reset().play();
                window._avIdleAction.crossFadeFrom(window._avWalkAction, 0.3, true);
                // Mirror onto pip clone
                if (window._avatarPipMixer && window._avIdleClip && window._avWalkClip) {
                  const pipIdle = window._avatarPipMixer.clipAction(window._avIdleClip);
                  const pipWalk = window._avatarPipMixer.clipAction(window._avWalkClip);
                  pipIdle.reset().play(); pipIdle.crossFadeFrom(pipWalk, 0.3, true);
                }
                const panelFrame = document.getElementById("panel-frame");
                if (panelFrame && panelFrame.contentWindow)
                  panelFrame.contentWindow.postMessage(
                    { type: "AVATAR_ANIM_CHANGE", anim: "idle" },
                    "*",
                  );
              }
            }
          }

          if (window.bhgMixer) {
            window.bhgMixer.update(delta);
          }
          if (window._playerAvatar) {
            camera.getWorldDirection(_pool.v1);

            // Place avatar at camera's XZ but at ground level (Y - 1.6 = eye height)
            window._playerAvatar.position.copy(camera.position);
            window._playerAvatar.position.y -= 1.6;

            // Push avatar forward by 0.6 units (2 feet) along the camera's view direction
            // This makes the FPV camera correctly trail 2 feet behind the avatar's back
            camera.getWorldDirection(_pool.v1);
            _pool.v1.y = 0;
            _pool.v1.normalize();
            _pool.v1.multiplyScalar(0.6);
            window._playerAvatar.position.add(_pool.v1);

            // Extract 2D Planar Yaw (XZ rotation)
            const ROT_OFFSET = -Math.PI / 2; // Turned 90 degrees right per USER request
            if (window._isMapView && isMoving && window._moveTarget) {
              _pool.v1.subVectors(
                window._moveTarget,
                window._playerAvatar.position,
              );
              window._playerAvatar.rotation.y =
                Math.atan2(_pool.v1.x, _pool.v1.z) + ROT_OFFSET;
            } else {
              camera.getWorldDirection(_pool.v1);
              _pool.v1.y = 0;
              _pool.v1.normalize();
              window._playerAvatar.rotation.y =
                Math.atan2(_pool.v1.x, _pool.v1.z) + ROT_OFFSET;
            }
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
            const ND = {
              t: [6, 11, 19],
              m: [13, 27, 42],
              b: [58, 69, 85],
              f: [58, 69, 85],
              i: 0.1,
            }; // Night Dark
            const DW = {
              t: [58, 90, 122],
              m: [125, 164, 199],
              b: [201, 213, 227],
              f: [201, 213, 227],
              i: 0.6,
            }; // Dawn
            const DY = {
              t: [255, 170, 34],
              m: [255, 213, 128],
              b: [255, 241, 202],
              f: [255, 241, 202],
              i: 1.0,
            }; // Day Happy
            const DK = {
              t: [65, 82, 112],
              m: [220, 140, 80],
              b: [255, 190, 120],
              f: [255, 190, 120],
              i: 0.4,
            }; // Dusk (Warm bright instead of purple)
            const GY = {
              t: [140, 145, 150],
              m: [160, 165, 170],
              b: [180, 185, 190],
              f: [180, 185, 190],
              i: 0.5,
            }; // Gray Overcast

            let p1, p2, prog;
            if (window._isOvercastMode) {
              p1 = GY;
              p2 = GY;
              prog = 1.0;
            } else if (gameTime >= 4 && gameTime < 8) {
              p1 = ND;
              p2 = DW;
              prog = (gameTime - 4) / 4;
            } // Night -> Dawn
            else if (gameTime >= 8 && gameTime < 11) {
              p1 = DW;
              p2 = DY;
              prog = (gameTime - 8) / 3;
            } // Dawn -> Day
            else if (gameTime >= 11 && gameTime < 17) {
              p1 = DY;
              p2 = DY;
              prog = 1.0;
            } // Day
            else if (gameTime >= 17 && gameTime < 20) {
              p1 = DY;
              p2 = DK;
              prog = (gameTime - 17) / 3;
            } // Day -> Dusk
            else if (gameTime >= 20 && gameTime < 22) {
              p1 = DK;
              p2 = ND;
              prog = (gameTime - 20) / 2;
            } // Dusk -> Night
            else {
              p1 = ND;
              p2 = ND;
              prog = 1.0;
            } // Night (22 to 4)

            // Lerp helper
            const lerpRGB = (arr1, arr2, p) =>
              new THREE.Color(
                (arr1[0] + (arr2[0] - arr1[0]) * p) / 255.0,
                (arr1[1] + (arr2[1] - arr1[1]) * p) / 255.0,
                (arr1[2] + (arr2[2] - arr1[2]) * p) / 255.0,
              );

            window._skyUniforms.topColor.value.copy(lerpRGB(p1.t, p2.t, prog));
            window._skyUniforms.midColor.value.copy(lerpRGB(p1.m, p2.m, prog));
            window._skyUniforms.bottomColor.value.copy(
              lerpRGB(p1.b, p2.b, prog),
            );

            const fogColor = lerpRGB(p1.f, p2.f, prog);
            window._sceneFog.color.copy(fogColor);
            window._sceneTarget.background.copy(fogColor);

            if (window.sunLight) {
              window.sunLight.intensity = Math.max(
                p1.i + (p2.i - p1.i) * prog,
                0.1,
              );
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
              fwd.y = 0;
              fwd.normalize();

              // Keep moon fixed at a comfortable angle in the player's FOV
              window._3dMoonGroup.position.set(
                camera.position.x + fwd.x * 250,
                camera.position.y + 60, // Lowered from 120 to 60 for better FPV visibility
                camera.position.z + fwd.z * 250,
              );

              if (
                window._3dMoonMesh &&
                window._currentForcePhase !== undefined
              ) {
                const phaseMod = Math.abs(window._currentForcePhase - 4) / 4;
                window._3dMoonMesh.scale.x =
                  window._currentForcePhase === 0 ? 0.01 : 1.0;
                window._3dMoonMesh.material.emissiveIntensity =
                  1.0 - phaseMod * 0.9;
              }
            }
          }

          // Update UI
          const hours = Math.floor(gameTime);
          const minutes = Math.floor((gameTime - hours) * 60);
          const ampm = hours >= 12 ? "PM" : "AM";
          const h12 = hours % 12 || 12;

          const timeStr = `${h12.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")} ${ampm} `;
          if (_timeEl) _timeEl.innerText = timeStr;

          // Update Grandfather Clock Sun Dial Rotation
          const celestialDial = document.getElementById("celestial-dial");
          if (celestialDial) {
            // Use the GAME time to drive the Sun Dial, not local PC time!
            // 12 (Noon) = 0deg (Sun at top), 0 (Midnight) = 180deg (Moon at top)
            const dialAngle = ((gameTime - 12) / 24) * 360;
            celestialDial.style.transform = `rotate(${dialAngle}deg)`;

            // Keep the emoji icons constantly pointing upwards despite the rotation
            const cSun = document.getElementById("c-sun");
            const cMoon = document.getElementById("c-moon");
            if (cSun)
              cSun.style.transform = `translateX(-50%) rotate(${-dialAngle}deg)`;
            // Moon started upside-down visually so we offset its reverse rotation by +180
            if (cMoon)
              cMoon.style.transform = `translateX(-50%) rotate(${-dialAngle + 180}deg)`;
          }

          // Constantly sync Moon Phase widget
          window.postMessage({ type: "UPDATE_MOON", time: gameTime }, "*");

          // Sync Compass UI to the player's world camera rotation
          const compassTurnDeg = THREE.MathUtils.radToDeg(camera.rotation.y);
          const panelFrame = document.getElementById("panel-frame");
          if (panelFrame && panelFrame.contentWindow) {
            panelFrame.contentWindow.postMessage(
              { type: "CAMERA_ROTATION", deg: compassTurnDeg },
              "*",
            );
          }

          // === ANIMATE BUTTERFLY SPIRIT ===
          if (window._butterflySpirit) {
            window._butterflySpirit.position.y +=
              Math.sin(frameCount * 0.05) * 0.005;
            window._butterflySpirit.rotation.y += delta * 0.5;
          }

          // --- PIP / MAIN SWAP RENDER ---
          // Allow PIP strictly even when _isMapView is true so that FPV does not freeze at 1fps
          // NATIVE WEBGL EXCEPTION: WebGL Overlay clears screen fully. Skipping PIP strobes the UI window.
          const shouldPIP = window._isAxeCameraCloned !== true;
          let drewMapMain = false;

          if (typeof pipCamera !== "undefined" && pipCamera) {
            // USER REQUEST: Custom PIP FPV Mirror inside the PIP
            if (window._isMapView && window._playerAvatar) {
              // Zoom into 3 feet behind avatar look ahead from just above the head, slight fish eye
              const avatar = window._playerAvatar;
              pipCamera.position.copy(avatar.position);

              // Avatar has a native 90-degree rotation offset, so its local +Z is right/left.
              // The main 'camera' object drives movement and its +Z is strictly backward.
              const backward = new THREE.Vector3(0, 0, 1);
              backward.applyQuaternion(camera.quaternion);
              backward.y = 0; // Flatten trajectory so we don't zoom into the sky/ground
              backward.normalize();

              pipCamera.position.addScaledVector(backward, 0.3); // 1 foot behind avatar
              pipCamera.position.y += 1.4; // Just above head

              // Look slightly down or straight ahead
              const lookPos = avatar.position.clone();
              lookPos.y += 1.6;
              const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
                avatar.quaternion,
              );
              lookPos.addScaledVector(forward, 2.0);

              pipCamera.lookAt(lookPos);
              pipCamera.fov = 85; // Slight fish eye
              pipCamera.updateProjectionMatrix();
            } else {
              pipCamera.position.copy(camera.position);
              pipCamera.quaternion.copy(camera.quaternion);
              pipCamera.fov = 40; // normal
              pipCamera.updateProjectionMatrix();
            }

            // Update Green Shader Time variables
            // Shader time updates handled natively inside RenderTarget passes below
            if (window._pipMat) window._pipMat.uniforms.time.value += delta;
            if (window._mapMat) window._mapMat.uniforms.time.value += delta;

            // SCENARIOS decoupled from execution to prevent z-fighting / erasing
            if (window._isMapView) {
              drewMapMain = true;
              // In map view: moondial PiP shows the top-down map camera feed,
              // FPV is rendered separately into the top-left-fpv scissor window.
              if (shouldPIP) window._pendingPipCamera = pipCamera;
              else window._pendingPipCamera = null;
            } else if (window._swapModes) {
              drewMapMain = true;
              window._pendingPipCamera = null;
            } else {
              drewMapMain = false;
              if (shouldPIP) window._pendingPipCamera = pipCamera;
              else window._pendingPipCamera = null;
            }

            // No webGLCircularMask local definition. Hardware Blit will be executed before Main Render.
          } else {
            window._pendingPipCamera = null;
          }

          // --- TIPI JOURNAL FEED RENDER (Hardware Canvas Overlay) ---
          // --- USER REQUEST: DISABLE ALL LOGBOOK PIP FEEDS FOR 60 FPS RESTORATION ---
          if (
            window._isLogbookOpen &&
            window.tipiCanvas2D &&
            window.tipiCanvas2D.style.display === "block"
          ) {
            // Add tiny procedural sway (Handheld camera effect)
            const swayT = performance.now() * 0.0005;
            const sx = Math.sin(swayT) * 0.15;
            const sy = Math.cos(swayT * 0.8) * 0.1;

            const target = window._tipiPipTarget;

            // --- PIP CAMERA ROUTING (Axe, Quest Cams, Portraits) ---
            let usePerspective = true;

            // State resets
            if (target !== "yellowButterfly") window._ybSelfieActive = false;

            try {
              let handled = false;
              if (
                target === "bringsHappinessGirlPortrait" ||
                target === "bringsHappinessGirl" ||
                target === "bhg"
              ) {
                // Selfie Cam feed for Brings Happiness Girl
                if (window._bhgGroup) {
                  const facePos = new THREE.Vector3();
                  if (window._bhgCharacterMesh) {
                    window._bhgCharacterMesh.getWorldPosition(facePos);
                  } else {
                    facePos.copy(window._bhgGroup.position);
                  }
                  facePos.y += 1.0; // Raise to face level

                  const radius =
                    target === "bhg" ? 6.0 : 2.5 + Math.sin(swayT * 0.4) * 1.5; // Zoom in / out or far view

                  tipiOrthoCam.position.set(
                    facePos.x + Math.sin(swayT * 0.3) * 0.5,
                    facePos.y +
                      (target === "bhg" ? 2.0 : Math.cos(swayT * 0.6) * 0.2),
                    facePos.z - radius, // She faces -Z, so stand in front of her
                  );
                  tipiOrthoCam.lookAt(facePos.x, facePos.y - 0.2, facePos.z);
                  handled = true;

                  // Trigger wave animation if close up
                  if (target !== "bhg") {
                    try {
                      if (window._bhgWaveAction && window.bhgSystem) {
                        window.bhgSystem.hasWaved = true; // Block world proximity from double-starting
                        window._bhgWaveAction.reset().play();
                      } else if (window.playBhgWelcome) {
                        window.playBhgWelcome();
                      }
                    } catch (animErr) {
                      console.warn("[PIP] Waving anim failed:", animErr);
                    }
                  }
                } else {
                  // Fallback if not loaded
                  tipiOrthoCam.position.set(0, 2, -10);
                  tipiOrthoCam.lookAt(0, 1, -10);
                  handled = true;
                }
              } else if (target === "yellowButterfly") {
                // Selfie Cam feed for Yellow Butterfly
                if (window._yellowButterflyNPC) {
                  // MATHEMATICAL RIG: Attach camera strictly to her local coordinate matrix
                  if (!window._ybCamPos) window._ybCamPos = new THREE.Vector3();
                  if (!window._ybLookPos)
                    window._ybLookPos = new THREE.Vector3();

                  window._ybCamPos.set(0.5, 1.4, -2.5); // 2.5m in front of her face, slightly elevated
                  window._ybLookPos.set(0, 1.2, 0); // Look exactly at her face height

                  window._yellowButterflyNPC.localToWorld(window._ybCamPos);
                  window._yellowButterflyNPC.localToWorld(window._ybLookPos);

                  tipiPerspCam.position.copy(window._ybCamPos);
                  tipiPerspCam.lookAt(window._ybLookPos);

                  tipiOrthoCam.position.copy(tipiPerspCam.position);
                  tipiOrthoCam.quaternion.copy(tipiPerspCam.quaternion);
                  usePerspective = true;
                  handled = true;
                  window._skipPerspSync = true;

                  // CLEAN STATE ARCHITECTURE: Trigger wave exactly once when the Logbook Page 2 opens
                  if (!window._ybSelfieActive) {
                    window._ybSelfieActive = true;
                    if (
                      window.ybSystem &&
                      window.ybSystem.actions &&
                      window.ybSystem.actions.wave
                    ) {
                      window.ybSystem.actions.wave.reset().play();
                      if (window.ybSystem.currentBaseAction) {
                        window.ybSystem.actions.wave.crossFadeFrom(
                          window.ybSystem.currentBaseAction,
                          0.5,
                          false,
                        );
                      }
                    }
                  }
                } else {
                  // Fallback if not loaded
                  const tx = typeof TIPI_X !== "undefined" ? TIPI_X : 0;
                  const tz = typeof TIPI_Z !== "undefined" ? TIPI_Z : 0;
                  tipiOrthoCam.position.set(tx + 2, 2, tz);
                  tipiOrthoCam.lookAt(tx, 0.5, tz);
                  handled = true;
                }
              } else if (
                target === "axeZoomInTipi" ||
                target === "axeGathering"
              ) {
                if (window._worldAxeMesh) {
                  // Detach axe from its parent (e.g., tipi) and add to global scene if not already
                  if (window._worldAxeMesh.parent !== scene) {
                    window._worldAxeMesh.getWorldPosition(
                      window._worldAxeMesh.position,
                    ); // Get current world position
                    window._worldAxeMesh.rotation.setFromQuaternion(
                      window._worldAxeMesh.getWorldQuaternion(
                        new THREE.Quaternion(),
                      ),
                    ); // Get current world rotation
                    scene.add(window._worldAxeMesh);
                  }

                  if (target === "axeGathering") {
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
                      targetScreenY * 2 - 1, // Y from -1 to 1
                      -1, // Z for near plane
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
                  }

                  // Position tipiOrthoCam to view the axe
                  tipiOrthoCam.position
                    .copy(window._worldAxeMesh.position)
                    .add(new THREE.Vector3(0, 0.5, 1.5)); // Slightly above and behind axe
                  tipiOrthoCam.lookAt(window._worldAxeMesh.position);
                  handled = true;
                } else {
                  // Fallback if not loaded
                  const tx = typeof TIPI_X !== "undefined" ? TIPI_X : 0;
                  const tz = typeof TIPI_Z !== "undefined" ? TIPI_Z : 0;
                  tipiOrthoCam.position.set(tx + 2, 2, tz);
                  tipiOrthoCam.lookAt(tx, 0.5, tz);
                  handled = true;
                }
              } else if (
                target === "nearestTree" &&
                window._treeInstancedMeshes
              ) {
                let closestDist = Infinity;
                let closestPos = new THREE.Vector3();
                const camPos = camera.position;
                const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
                  camera.quaternion,
                );
                const dummy = new THREE.Matrix4();
                const wp = new THREE.Vector3();

                window._treeInstancedMeshes.forEach(({ instancedMesh }) => {
                  for (let i = 0; i < instancedMesh.count; i++) {
                    instancedMesh.getMatrixAt(i, dummy);
                    wp.setFromMatrixPosition(dummy);
                    if (wp.y < -100) continue; // Unused instance
                    const dist = wp.distanceTo(camPos);
                    const dir = new THREE.Vector3()
                      .subVectors(wp, camPos)
                      .normalize();
                    const dot = fwd.dot(dir);
                    const score = dist - dot * 2.0;
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
                  tipiOrthoCam.position.set(
                    closestPos.x + orbitX,
                    closestPos.y + 3.0,
                    closestPos.z + orbitZ,
                  );
                  tipiOrthoCam.lookAt(
                    closestPos.x,
                    closestPos.y + 1.5,
                    closestPos.z,
                  );
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
                const tx = typeof TIPI_X !== "undefined" ? TIPI_X : 0;
                const tz = typeof TIPI_Z !== "undefined" ? TIPI_Z : 0;
                const ty = window._tipiPlatformY || 0;

                tipiOrthoCam.position.set(
                  tx + sxOrbit,
                  ty + 10 + syOrbit,
                  tz + szOrbit,
                );
                tipiOrthoCam.lookAt(tx, ty + 2.0, tz);
              }
            } catch (pipErr) {
              console.error(
                "[Camera] CRITICAL ERROR IN PIP RENDERER CAUGHT! Prevents game freeze:",
                pipErr,
              );
            }

            if (
              usePerspective &&
              typeof tipiPerspCam !== "undefined" &&
              tipiPerspCam &&
              !window._skipPerspSync
            ) {
              tipiPerspCam.position.copy(tipiOrthoCam.position);
              tipiPerspCam.quaternion.copy(tipiOrthoCam.quaternion);
            }
            window._skipPerspSync = false;

            // TEMPORARILY DISABLED WESTERN SHADER PROCESSING FOR FPS TESTING
            // FPS FIX: Throttle PIP rendering using FuzzyBrain to prevent double-rendering the massive scene at 60Hz
            if (
              window.tipiCtx &&
              window._isLogbookOpen &&
              window._tipiRect &&
              window._tipiRect.width > 0 &&
              (!fuzzyBrain || fuzzyBrain.shouldRenderPIP())
            ) {
              let camToUse = usePerspective ? tipiPerspCam : tipiOrthoCam;
              if (window._tipiPipTarget === "pip") {
                camToUse = window._nativeMapCam || window._pendingPipCamera;
              }

              // Hardware accelerated blit from main WebGL context!
              const w = window.tipiCanvas2D.width || 256;
              const h = window.tipiCanvas2D.height || 256;

              const dpr = renderer.getPixelRatio();
              const scW = w * dpr;
              const scH = h * dpr;

              const origAutoClear = renderer.autoClear;
              renderer.autoClear = false;

              renderer.setScissorTest(true);
              renderer.setScissor(0, 0, scW, scH);
              renderer.setViewport(0, 0, scW, scH);

              // Create a solid background plane to avoid FPS-crashing partial clear
              if (!window._tipiBgScene) {
                window._tipiBgScene = new THREE.Scene();
                window._tipiBgCam = new THREE.OrthographicCamera(
                  -1,
                  1,
                  1,
                  -1,
                  0,
                  1,
                );
                const bgMat = new THREE.MeshBasicMaterial({
                  color: 0xfff1ca,
                  depthWrite: false,
                  depthTest: false,
                });
                window._tipiBgMesh = new THREE.Mesh(
                  new THREE.PlaneGeometry(2, 2),
                  bgMat,
                );
                window._tipiBgScene.add(window._tipiBgMesh);
              }

              // Render background safely
              renderer.clearDepth(); // Only clear depth to prevent bleed
              renderer.render(window._tipiBgScene, window._tipiBgCam);

              // Render UI logic into bottom left corner
              if (camToUse) {
                try {
                  renderer.render(scene, camToUse);
                } catch (err) {}
              }

              // Draw to 2D UI Canvas
              window.tipiCtx.clearRect(0, 0, w, h);
              window.tipiCtx.drawImage(
                renderer.domElement,
                0,
                renderer.domElement.height - scH,
                scW,
                scH,
                0,
                0,
                w,
                h,
              );

              // Cleanup corner
              renderer.clearDepth();
              renderer.setScissorTest(false);
              renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
              renderer.autoClear = origAutoClear;
            }
          }

          // --- SELFIE CAM JOURNAL FEED RENDER ---
          if (
            window._isLogbookOpen &&
            window.selfieCanvas2D &&
            window.selfieCanvas2D.style.display === "block" &&
            window._selfieRect &&
            window._selfieRect.width > 0
          ) {
            // Dynamically position camera between YB and Player
            if (window._yellowButterflyNPC && window.selfieCam) {
              const ybPos = new THREE.Vector3();
              window._yellowButterflyNPC.getWorldPosition(ybPos);
              const playerPos = camera.position.clone();

              // Midpoint
              const midPos = ybPos.clone().lerp(playerPos, 0.5);

              // Offset camera to the side to capture both profiles
              const dirBetween = new THREE.Vector3()
                .subVectors(playerPos, ybPos)
                .normalize();
              const rightOffset = new THREE.Vector3(
                -dirBetween.z,
                0,
                dirBetween.x,
              )
                .normalize()
                .multiplyScalar(4.0);

              window.selfieCam.position.set(
                midPos.x + rightOffset.x,
                ybPos.y + 1.2,
                midPos.z + rightOffset.z,
              );
              window.selfieCam.lookAt(midPos.x, ybPos.y + 1.0, midPos.z);

              // Add slight handheld sway to the selfie cam
              const swayT = performance.now() * 0.001;
              window.selfieCam.position.x += Math.sin(swayT) * 0.05;
              window.selfieCam.position.y += Math.cos(swayT * 0.8) * 0.05;
              window.selfieCam.updateMatrixWorld();
            }

            const w = window.selfieCanvas2D.width || 256;
            const h = window.selfieCanvas2D.height || 384;

            const dpr = renderer.getPixelRatio();
            const scW = w * dpr;
            const scH = h * dpr;

            const origAutoClear = renderer.autoClear;
            renderer.autoClear = false;

            renderer.setScissorTest(true);
            renderer.setScissor(0, 0, scW, scH);
            renderer.setViewport(0, 0, scW, scH);

            // Background
            if (!window._selfieBgScene) {
              window._selfieBgScene = new THREE.Scene();
              window._selfieBgCam = new THREE.OrthographicCamera(
                -1,
                1,
                1,
                -1,
                0,
                1,
              );
              const bgMat = new THREE.MeshBasicMaterial({
                color: 0x87ceeb,
                depthWrite: false,
                depthTest: false,
              }); // Sky blue fallback
              window._selfieBgMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(2, 2),
                bgMat,
              );
              window._selfieBgScene.add(window._selfieBgMesh);
            }

            renderer.clearDepth();
            renderer.render(window._selfieBgScene, window._selfieBgCam);

            try {
              renderer.render(scene, window.selfieCam);
            } catch (err) {}

            window.selfieCtx.clearRect(0, 0, w, h);
            window.selfieCtx.drawImage(
              renderer.domElement,
              0,
              renderer.domElement.height - scH,
              scW,
              scH,
              0,
              0,
              w,
              h,
            );

            renderer.clearDepth();
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
            renderer.autoClear = origAutoClear;
          }

          // --- QUEST MARKER ANIMATION ---
          const ft = performance.now() * 0.001;
          if (window._questMarker) {
            const markerBob = Math.sin(ft * 3) * 0.15;
            window._questMarker.position.y =
              window._questMarker.userData.baseY + markerBob;
            window._questMarker.rotation.y = ft; // Spin

            window._questMarker.children.forEach((c) => {
              if (c.userData && c.userData.isQuestBloom) {
                c.position.y = -5.95 - markerBob; // Counteract bob to stay completely flat on world dirt
                if (c.material) {
                  c.material.opacity = 0.5 + Math.sin(ft * 1.5) * 0.4; // Glowing fade
                }
              }
            });
          }
          if (window._bhgBalloon && window._bhgBalloon.visible) {
            window._bhgBalloon.position.y =
              window._bhgBalloon.userData.baseY + Math.sin(ft * 3 + 1) * 0.15;
            window._bhgBalloon.rotation.y = ft;
          }

          // --- MOON DIAL UPDATE (throttled) ---
          if (frameCount % 60 === 0 && _moonFrame && _moonFrame.contentWindow) {
            // Use postMessage to avoid cross-origin frame reading blocks on file://
            _moonFrame.contentWindow.postMessage(
              { type: "UPDATE_MOON", time: gameTime },
              "*",
            );
          }
          // --- WILDLIFE & WIND IN FPV ONLY ---
          if (!window._isMapView) {
            if (window.butterflySystem) window.butterflySystem.update(delta); // Visual fx keep full Hz

            // --- SPIRIT GUIDE BUTTERFLY (Continuous Animation) ---
            if (window._butterflySpirit) {
              const b = window._butterflySpirit;
              const pPos = camera.position.clone();

              // Add erratic nature movement (hovering) always
              const time = performance.now() * 0.001;

              if (window._spiritGuideActive) {
                // Float 2m in front of player and 0.5m above eye level
                const forward = new THREE.Vector3(0, 0, -1);
                forward.applyQuaternion(camera.quaternion);
                const target = pPos
                  .add(forward.multiplyScalar(2.5))
                  .add(new THREE.Vector3(0, 0.5, 0));

                target.x += Math.sin(time * 3) * 0.6;
                target.y += Math.cos(time * 2) * 0.4;
                target.z += Math.sin(time * 2.5) * 0.6;

                b.position.lerp(target, delta * 2.0); // Smooth follow

                // Always face the direction of flight or the player
                const lookAtTarget = target.clone().add(forward);
                b.lookAt(lookAtTarget);
              } else {
                // Just hover in its base position
                b.position.y += Math.sin(time * 2) * 0.005;
                b.rotation.y += delta * 0.5;
              }
            }

            // Delegate wildlife logic to the new Fixed-Time-Step MasterAI Director
            if (
              window.masterAI &&
              !window.masterAI._anuPaused &&
              frameCount % _aiThrottle === 0
            ) {
              window.masterAI.update(delta * _aiThrottle);
            }

            // --- UNIVERSAL NPC PROXIMITY AI REMOVED ---
            // Centralized logic now handled by window.npcMaster.update(delta)
            // in the main animation loop to prevent duplicate updates and parameter errors.

            // --- WIND SWAY Optimization ---
            const windTime = performance.now() * 0.001;
            if (window._globalTime) {
              window._globalTime.value = windTime;
            }

            if (
              typeof swayTrees !== "undefined" &&
              swayTrees.length > 0 &&
              (_aiThrottle < 3 || frameCount % 2 === 0)
            ) {
              // Pre-calculate highly optimal world bounds for the camera
              const camX = camera.position.x;
              const camZ = camera.position.z;

              for (let i = 0; i < swayTrees.length; i++) {
                const t = swayTrees[i];
                if (!t.visible) continue;

                // ULTRA OPTIMIZATION: Avoid using getWorldPosition inside loop!
                // Instead, we rigidly cached the true world spawn coordinates onto the leaf mesh userData during generateWorld().
                // This entirely bypasses the deep structural nested GLTF zero-coordinates.
                const pX = t.userData.worldX;
                const pZ = t.userData.worldZ;
                if (pX === undefined) continue; // safety check

                const dx = pX - camX;
                const dz = pZ - camZ;
                const distToCamSq = dx * dx + dz * dz;

                if (distToCamSq > 10000) continue;

                const phase = t.userData.windPhase;
                const amp = t.userData.windAmp * 1.2; // Increased sway by 20% per user request

                // t is guaranteed to be a non-trunk foliage branch mesh
                t.rotation.x =
                  t.userData.baseRotX + Math.sin(windTime * 1.5 + phase) * amp;
                t.rotation.z =
                  t.userData.baseRotZ +
                  Math.cos(windTime * 1.2 + phase) * amp * 0.8;
              }
            }
          }

          // --- FUZZYBRAIN AI UPDATE ---
          if (fuzzyBrain) {
            fuzzyBrain.update(delta);
            if (window.UniverseAnu)
              window.UniverseAnu.senseFPS(fuzzyBrain.smoothFPS || 60);
          }

          // --- STATS HUD (throttled) ---
          if (frameCount % 15 === 0 && _statsEl) {
            // Determine true FPS (FuzzyBrain smooths the raw delta jumps out)
            const rawFps = (1 / delta).toFixed(0);
            const fps = fuzzyBrain ? fuzzyBrain.smoothFPS.toFixed(0) : rawFps;

            // USER REQUEST: Provide live coordinates for waypoint plotting
            const cx = camera ? camera.position.x.toFixed(1) : "0";
            const cy = camera ? camera.position.y.toFixed(1) : "0";
            const cz = camera ? camera.position.z.toFixed(1) : "0";

            _statsEl.innerHTML = `<span style="font-size:16px;color:#fff;font-weight:900;">${fps} FPS (Raw: ${rawFps})</span><br><span style="font-size:10px;color:#bcaaa4;">X:${cx} Y:${cy} Z:${cz}</span>`;
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
              humanEyePass.uniforms.tipiScreenRadius.value = Math.min(
                0.15,
                3.0 / Math.max(dist, 1),
              );
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
                positions[idx] = fd.tipiX + (Math.random() - 0.5) * 0.2;
                positions[idx + 1] = fd.baseY + Math.random() * 0.1;
                positions[idx + 2] = fd.tipiZ + (Math.random() - 0.5) * 0.2;
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
                sPos[idx] +=
                  Math.sin(ft * 2 + sPhases[i]) * 0.01 + delta * 0.25; // Gentle wind push on X
                sPos[idx + 2] += Math.cos(ft * 1.5 + sPhases[i]) * 0.01;

                // Reset when high above the tipi
                if (sPos[idx + 1] > fd.baseY + 6.5 + Math.random() * 1.0) {
                  sPos[idx] = fd.tipiX + (Math.random() - 0.5) * 0.25; // Re-cluster tightly at hole
                  sPos[idx + 1] = fd.baseY + 3.8 + Math.random() * 0.5;
                  sPos[idx + 2] = fd.tipiZ + (Math.random() - 0.5) * 0.25;
                }
              }
              fd.smokeMesh.geometry.attributes.position.needsUpdate = true;
            }

            // Flicker light intensity (calmer, non-looping)
            if (fd.fireLight)
              fd.fireLight.intensity = 2.0 + (Math.random() * 0.8 - 0.4);
            if (fd.fireFill)
              fd.fireFill.intensity = 0.8 + (Math.random() * 0.3 - 0.15);
            // Ember glow pulse (non-looping)
            fd.emberMesh.material.emissiveIntensity = 0.6 + Math.random() * 0.4;
          }

          // Avatar walk animation sync is handled earlier (line ~3020) using the correct isMoving flag

          // --- SMART TARGETED CULLING ---
          function toggleFX(show) {
            if (window._globalFlare) window._globalFlare.visible = show;
            if (window._butterflySpirit) window._butterflySpirit.visible = show;
            if (window._tipiGodray2) window._tipiGodray2.visible = show;
            if (window.butterflySystem && window.butterflySystem.mesh)
              window.butterflySystem.mesh.visible = show;
            if (window.natureSpiritSystem && window.natureSpiritSystem.mesh)
              window.natureSpiritSystem.mesh.visible = show;
          }

          // Render Main View
          let activeMainCam = camera;

          let mainFogRestore = null;
          // Ensure Map Camera always exists and is tracking position for PIP
          if (
            !window._nativeMapCam ||
            !window._nativeMapCam.isPerspectiveCamera
          ) {
            const curAspect = window.innerWidth / window.innerHeight;
            window._nativeMapCam = new THREE.PerspectiveCamera(
              20,
              curAspect,
              0.1,
              2500,
            );
            window._nativeMapCam.layers.enable(1); // USER FIX: Enable Layer 1 so avatar is visible in Map View
            window._nativeMapCam.layers.enable(2); // FIX: Ensure Village View can see Hex Grid (Layer 2)
            window._nativeMapCam.layers.enable(3); // Branches visible in Map View
          }

          // Dynamically map its coordinates directly above the physically active player camera
          if (typeof window._mapZoomLevel === "undefined") {
            window._mapZoomLevel = 120.0;
            window._currentMapZoom = window._mapZoomLevel;
          }

          // Smooth zoom spring physics
          window._currentMapZoom +=
            (window._mapZoomLevel - window._currentMapZoom) * delta * 5.0;

          const heightY = window._currentMapZoom;
          const tiltZ = 0; // Pure Top-Down map, no angle distortion
          window._nativeMapCam.position.set(
            camera.position.x,
            Math.max(camera.position.y + heightY, heightY),
            camera.position.z + tiltZ,
          );
          window._nativeMapCam.up.set(0, 0, -1); // Prevent Gimbal Lock; North stays Up on map
          window._nativeMapCam.lookAt(
            camera.position.x,
            Math.max(camera.position.y, 0),
            camera.position.z,
          );

          // Define renderer override profiles to suppress heavy FPV passes or align logic
          if (window._swapModes) {
            // If Logbook overlay is open, cull FPV background entirely and only render PIP scale internally to save FPS
            if (typeof pipCamera !== "undefined" && pipCamera)
              activeMainCam = pipCamera;
            toggleFX(false);
          } else if (window._isMapView) {
            // Physically assign the Widescreen Map Camera to the Renderer
            activeMainCam = window._nativeMapCam;
            toggleFX(false);

            // Aggressive Dynamic Culling:
            // Because the Map Camera looks straight down, anything beyond ~250 meters is strictly out of frame or obscured by fog.
            // Standard FPV far clipping is 2500. Using 300 perfectly culls hundreds of distant background trees saving rendering MS.
            if (window._nativeMapCam) {
              // Make far plane dynamic relative to zoom height to prevent z-plane clipping at max zoom (350+)
              const targetFar = window._currentMapZoom + 150;
              if (window._nativeMapCam.far !== targetFar) {
                window._nativeMapCam.far = targetFar;
                window._nativeMapCam.updateProjectionMatrix();
              }
            }

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
            // GC-free: reuse pool vectors for scale backup
            const oa = _pool.v3;
            const ob = _pool.v4;
            const oc = window.THREE.Vector3
              ? new window.THREE.Vector3()
              : new THREE.Vector3(); // extra backup
            let restoreMainAvatar = false;
            let restoreMainYB = false;
            let restoreMainBHG = false;

            if (window._isMapView) {
              if (window._playerAvatar) {
                oa.copy(window._playerAvatar.scale);
                window._playerAvatar.scale.multiplyScalar(3.5); // 30% smaller than old 5.0
                window._playerAvatar.updateMatrixWorld(true);
                restoreMainAvatar = true;
              }
              if (window._ybCharacterMesh) {
                ob.copy(window._ybCharacterMesh.scale);
                window._ybCharacterMesh.scale.multiplyScalar(3.5);
                window._ybCharacterMesh.updateMatrixWorld(true);
                restoreMainYB = true;
              }
              if (window._bhgCharacterMesh) {
                oc.copy(window._bhgCharacterMesh.scale);
                window._bhgCharacterMesh.scale.multiplyScalar(3.5);
                window._bhgCharacterMesh.updateMatrixWorld(true);
                restoreMainBHG = true;
              }
            } else {
              if (window._ybCharacterMesh) {
                ob.copy(window._ybCharacterMesh.scale);
                window._ybCharacterMesh.scale.multiplyScalar(1.0); // Normal size in FPV
                window._ybCharacterMesh.updateMatrixWorld(true);
                restoreMainYB = true;
              }
              if (window._bhgCharacterMesh) {
                oc.copy(window._bhgCharacterMesh.scale);
                window._bhgCharacterMesh.scale.multiplyScalar(1.0); // Normal size in FPV
                window._bhgCharacterMesh.updateMatrixWorld(true);
                restoreMainBHG = true;
              }
            }

            // Apply temporary 3rd person camera offset
            const camOrig = _pool.v2; // Re-use pool vector
            let offsetApplied = false;
            if (
              !window._isMapView &&
              window._playerAvatar &&
              activeMainCam === camera
            ) {
              camOrig.copy(camera.position);
              // Use local translation to move camera backwards from avatar (2 feet behind per user request)
              camera.translateZ(2.0);
              camera.position.y += 0.8;
              offsetApplied = true;
            }

            renderer.autoClear = true; // FORCE: Ensure main scene wipes residuals from PIP corner passes
            renderer.render(scene, activeMainCam);

            // Restore camera
            if (offsetApplied) {
              camera.position.copy(camOrig);
            }

            // Restore original scale matrices
            if (restoreMainAvatar && window._playerAvatar) {
              window._playerAvatar.scale.copy(oa);
              window._playerAvatar.updateMatrixWorld(true);
            }
            if (restoreMainYB && window._ybCharacterMesh) {
              window._ybCharacterMesh.scale.copy(ob);
              window._ybCharacterMesh.updateMatrixWorld(true);
            }
            if (restoreMainBHG && window._bhgCharacterMesh) {
              window._bhgCharacterMesh.scale.copy(oc);
              window._bhgCharacterMesh.updateMatrixWorld(true);
            }
          }

          // Restore Fog Density
          if (mainFogRestore !== null && window._sceneFog) {
            window._sceneFog.density = mainFogRestore;
          }

          // Restore visibility after all frames render so logical updates don't break
          toggleFX(true);

          // --- NATIVE HARDWARE PIP SCISSOR RENDER ---
          // CROSS-BOUNDARY PIP RECOVERY (Heaven Panel PIP)
          if (
            !window.pipCanvas2D ||
            (!document.contains(window.pipCanvas2D) &&
              (!window.pipCanvas2D.ownerDocument ||
                !window.pipCanvas2D.ownerDocument.contains(window.pipCanvas2D)))
          ) {
            const frame = document.getElementById("panel-frame");
            const panelDoc = frame ? frame.contentDocument : null;
            const framePip = panelDoc
              ? panelDoc.getElementById("pipCanvas")
              : null;
            if (framePip) {
              window.pipCanvas2D = framePip;
            }
          }

          // EVENT-DRIVEN LAYOUT FIX: Zero-cost asynchronous boundary updates
          if (
            window.pipCanvas2D &&
            !window._pipObserver &&
            window.ResizeObserver
          ) {
            window._cachedPipRect = window.pipCanvas2D.getBoundingClientRect();
            window._pipObserver = new ResizeObserver(() => {
              if (window.pipCanvas2D)
                window._cachedPipRect =
                  window.pipCanvas2D.getBoundingClientRect();
            });
            window._pipObserver.observe(window.pipCanvas2D);
          }

          // --- AVATAR PIP RENDER (dedicated renderer — no scissor, no framebuffer fights) ---
          if (
            window._avatarPipRenderer &&
            window._avatarPipScene &&
            window._avatarPipClone
          ) {
            // Init pip mixer once idle clip is available
            if (!window._avatarPipMixer && window._avIdleClip) {
              window._avatarPipMixer = new THREE.AnimationMixer(
                window._avatarPipClone,
              );
              window._avatarPipIdleAction = window._avatarPipMixer.clipAction(
                window._avIdleClip,
              );
              window._avatarPipIdleAction.play();
            }
            if (window._avatarPipMixer) window._avatarPipMixer.update(delta);

            // Self-healing: re-inject canvas if it got detached (every 120 frames)
            if (frameCount % 120 === 0) {
              const _pf = document.getElementById("panel-frame");
              const _pd = _pf && _pf.contentDocument;
              const _tgt = _pd && _pd.getElementById("avatar-pip-target");
              if (
                _tgt &&
                !_tgt.contains(window._avatarPipRenderer.domElement)
              ) {
                window._avatarPipRenderer.domElement.style.cssText =
                  "width:100%;height:100%;border-radius:50%;display:block;";
                _tgt.innerHTML = "";
                _tgt.appendChild(window._avatarPipRenderer.domElement);
              }
            }

            window._avatarPipRenderer.render(
              window._avatarPipScene,
              window.avatarOrthoCam,
            );
          }

          // Universe.Anu Engine Reconfiguration Listener
          window.addEventListener("message", (e) => {
            if (e.data && e.data.type === "REQ_WORLD_RECONFIG") {
              if (window.envBuilder && window._assetFactory) {
                console.log(
                  "[Universe.Anu] Triggering world reconfiguration...",
                );
                window.envBuilder.rebuildWorld(window._assetFactory);
              }
            }
          });

          // --- COMPASS / MAP PIP RENDER ---
          const compassPip = window.pipCanvas2D;
          if (compassPip && window._pendingPipCamera && window._cachedPipRect) {
            const rect = window._cachedPipRect;
            const w = Math.floor(rect.width);
            const h = Math.floor(rect.height);

            if (w > 0 && h > 0) {
              const scX = rect.left;
              const scY = window.innerHeight - rect.bottom;
              const origAutoClear = renderer.autoClear;

              renderer.setScissorTest(true);
              renderer.setScissor(scX, scY, w, h);
              renderer.setViewport(scX, scY, w, h);
              renderer.autoClear = false;

              const origAspect = window._pendingPipCamera.aspect;
              if (window._pendingPipCamera.isPerspectiveCamera) {
                const targetAspect = w / h;
                if (window._pendingPipCamera.aspect !== targetAspect) {
                  window._pendingPipCamera.aspect = targetAspect;
                  window._pendingPipCamera.updateProjectionMatrix();
                }
              }

              // Specific Render Hides/Shows
              toggleFX(false);
              const oldFogDensity = window._sceneFog
                ? window._sceneFog.density
                : 0;
              if (window._sceneFog) window._sceneFog.density = 0;

              if (window._tipiGodray) window._tipiGodray.visible = false;
              if (window._tipiGodray2) window._tipiGodray2.visible = false;
              if (window.butterflySystem && window.butterflySystem.mesh)
                window.butterflySystem.mesh.visible = true;
              if (window.natureSpiritSystem && window.natureSpiritSystem.mesh)
                window.natureSpiritSystem.mesh.visible = true;

              const oldShadowAutoUpdate = renderer.shadowMap.autoUpdate;
              renderer.shadowMap.autoUpdate = false;

              // CRITICAL FPS & MASK FIX: Prevent ThreeJS from implicitly clearing the color buffer
              // to scene.background inside the scissor. A partial clear on Apple Silicon TBDR flushes
              // the entire GPU tile buffer, tanking FPS to 14-30. It also paints a white square mask!
              const oldSceneBackground = scene.background;
              scene.background = null;

              // Execute PIP feed exactly inside scissor layout

              let pipCamToUse = null;
              if (window._isMapView) {
                // In map view: PiP should be a "spirit view" slightly above and behind the Avatar
                if (!window._spiritCam) {
                  window._spiritCam = new THREE.PerspectiveCamera(
                    40,
                    1,
                    0.1,
                    80,
                  ); // Zoomed in FOV for usable PIP!
                  window._spiritCam.layers.set(0);
                  window._spiritCam.layers.enable(1); // Enable Ghost Avatar
                  window._spiritCam.layers.enable(3); // Enable High-Poly Trees (Branches)
                  window._spiritCam.layers.disable(2); // CULL FIX: Prevent double-rendering boardgame HexGrid/UIs (Layer 2)
                }

                window._spiritCam.position.copy(camera.position);

                // FPV Over-the-shoulder Style: 1 foot directly behind the head
                const offset = new THREE.Vector3(0, 0.0, 0.3); // 0 up, 0.3 back (1 foot)
                offset.applyQuaternion(camera.quaternion);
                window._spiritCam.position.add(offset);

                // Look straight ahead, with a precise 5-degree down angle
                const lookPoint = camera.position.clone();
                // 10 units forward, -0.87 units down (tan(5 degrees) * 10 = ~0.87)
                const forward = new THREE.Vector3(0, -0.87, -10.0);
                forward.applyQuaternion(camera.quaternion);
                lookPoint.add(forward);

                window._spiritCam.lookAt(lookPoint);
                pipCamToUse = window._spiritCam;
              } else {
                // In FPV view: PiP should be the Top-Down diorama camera
                pipCamToUse = window._nativeMapCam || window._pendingPipCamera;
              }

              if (pipCamToUse) {
                // Inset 8px so the compass ring rim visually frames the PIP feed perfectly
                const inset = 8;
                const safeX = Math.max(0, scX + inset);
                const safeY = Math.max(0, scY + inset);
                const safeW = Math.max(1, w - inset * 2);
                const safeH = Math.max(1, h - inset * 2);

                renderer.setScissor(safeX, safeY, safeW, safeH);
                renderer.setViewport(safeX, safeY, safeW, safeH);
                // Explicitly clear depth strictly inside the active PiP region to prevent bleed! (Leave color buffer for circular mask)
                renderer.clearDepth();

                const origAspect = pipCamToUse.aspect;
                const origFov = pipCamToUse.fov;

                const targetPipAspect = safeW / safeH;
                let pipNeedsUpdate = false;

                if (pipCamToUse.aspect !== targetPipAspect) {
                  pipCamToUse.aspect = targetPipAspect;
                  pipNeedsUpdate = true;
                }
                if (pipCamToUse.isPerspectiveCamera) {
                  // Apply ~25% fisheye effect (widen the FOV slightly)
                  const targetFov = (origFov || 60) * 1.25;
                  if (pipCamToUse.fov !== targetFov) {
                    pipCamToUse.fov = targetFov;
                    pipNeedsUpdate = true;
                  }
                }
                if (pipNeedsUpdate) pipCamToUse.updateProjectionMatrix();

                const origSkyVisible = window._skyMesh
                  ? window._skyMesh.visible
                  : false;
                if (window._skyMesh) window._skyMesh.visible = false;

                // --- NATIVE WEBGL CIRCULAR DEPTH MASK ---
                // By rendering a mathematical circular hole into the depth buffer BEFORE the PiP scene renders,
                // any map terrain or trees outside the circle will fail the depth test and be physically discarded by the GPU!
                // This leaves the FPV sky completely untouched in the corners, perfectly masking the PiP into a circle.
                if (!window._pipMaskScene) {
                  window._pipMaskScene = new THREE.Scene();
                  window._pipMaskCam = new THREE.OrthographicCamera(
                    -1,
                    1,
                    1,
                    -1,
                    0,
                    1,
                  );
                  const maskGeom = new THREE.PlaneGeometry(2, 2);
                  const maskMat = new THREE.ShaderMaterial({
                    depthWrite: true,
                    depthTest: true, // CRITICAL: WebGL ignores depthWrite if depthTest is false!
                    colorWrite: false, // INVISIBLE WALL: only blocks depth!
                    vertexShader: `
                                varying vec2 vUv;
                                void main() {
                                    vUv = uv;
                                    // -0.99 to avoid near-plane clipping on Apple Silicon TBDR
                                    gl_Position = vec4(position.xy, -0.99, 1.0); 
                                }
                            `,
                    fragmentShader: `
                                varying vec2 vUv;
                                void main() {
                                    vec2 center = vec2(0.5, 0.5);
                                    if (distance(vUv, center) < 0.495) {
                                        discard;
                                    }
                                    gl_FragColor = vec4(1.0);
                                }
                            `,
                  });
                  const maskMesh = new THREE.Mesh(maskGeom, maskMat);
                  maskMesh.frustumCulled = false;
                  window._pipMaskScene.add(maskMesh);
                }

                // Render the Depth Mask FIRST to block the corners!
                renderer.render(window._pipMaskScene, window._pipMaskCam);

                // Render a solid sky-colored background plane so the Map ground doesn't show through the transparent FPV view
                if (!window._pipBgScene) {
                  window._pipBgScene = new THREE.Scene();
                  window._pipBgCam = new THREE.OrthographicCamera(
                    -1,
                    1,
                    1,
                    -1,
                    0,
                    1,
                  );
                  // A warm sky-blue color to match the atmosphere
                  const bgMat = new THREE.MeshBasicMaterial({
                    color: 0x9fbcd1,
                    depthTest: true,
                    depthWrite: false,
                  });
                  window._pipBgMesh = new THREE.Mesh(
                    new THREE.PlaneGeometry(2, 2),
                    bgMat,
                  );
                  window._pipBgMesh.position.z = -0.5; // CRITICAL: Push back so it fails depth test against the depth mask!
                  window._pipBgScene.add(window._pipBgMesh);
                }
                renderer.render(window._pipBgScene, window._pipBgCam);

                // Disable Layer 3 (High-Poly Trees) during PiP Map View to save GPU fill-rate at zero CPU cost!
                const isPipMap = pipCamToUse === window._nativeMapCam;
                // USER REQUEST: Add branches back to PIP map
                // if (isPipMap) pipCamToUse.layers.disable(3);

                // --- PIP AVATAR VISIBILITY FIX ---
                // If rendering the top-down minimap inside the FPV view, the avatar is a 1-pixel dot.
                // We must dynamically scale it up by 5x purely for this render pass!
                let pipScaleBackupA = null,
                  pipScaleBackupB = null;
                let restorePipAvatar = false,
                  restorePipYB = false;

                pipScaleBackupA = _pool.v1;
                pipScaleBackupB = _pool.v2;

                if (isPipMap) {
                  if (window._playerAvatar) {
                    pipScaleBackupA.copy(window._playerAvatar.scale);
                    window._playerAvatar.scale.multiplyScalar(5.0); // "Zoom in avatar by 5 feet"
                    window._playerAvatar.updateMatrixWorld(true);
                    restorePipAvatar = true;
                  }
                  if (window._yellowButterflyNPC) {
                    pipScaleBackupB.copy(window._yellowButterflyNPC.scale);
                    window._yellowButterflyNPC.scale.multiplyScalar(5.0 * 0.75); // Top down: -25%
                    window._yellowButterflyNPC.updateMatrixWorld(true);
                    restorePipYB = true;
                  }
                } else {
                  // PIP is FPV view
                  if (window._yellowButterflyNPC) {
                    pipScaleBackupB.copy(window._yellowButterflyNPC.scale);
                    window._yellowButterflyNPC.scale.multiplyScalar(1.5); // FPV: +50%
                    window._yellowButterflyNPC.updateMatrixWorld(true);
                    restorePipYB = true;
                  }
                }

                renderer.render(scene, pipCamToUse);

                // Restore PIP Avatar Scaling
                if (restorePipAvatar && window._playerAvatar) {
                  window._playerAvatar.scale.copy(pipScaleBackupA);
                  window._playerAvatar.updateMatrixWorld(true);
                }
                if (restorePipYB && window._yellowButterflyNPC) {
                  window._yellowButterflyNPC.scale.copy(pipScaleBackupB);
                  window._yellowButterflyNPC.updateMatrixWorld(true);
                }

                // if (isPipMap) pipCamToUse.layers.enable(3);

                // Restore Trees and Sky
                if (window._skyMesh) window._skyMesh.visible = origSkyVisible;

                // Restore
                let pipNeedsRestore = false;
                if (pipCamToUse.aspect !== origAspect) {
                  pipCamToUse.aspect = origAspect;
                  pipNeedsRestore = true;
                }
                if (
                  pipCamToUse.isPerspectiveCamera &&
                  pipCamToUse.fov !== origFov
                ) {
                  pipCamToUse.fov = origFov;
                  pipNeedsRestore = true;
                }
                if (pipNeedsRestore) pipCamToUse.updateProjectionMatrix();
              }

              // Hide the legacy top-left-fpv div — no longer needed (pipCanvas overlay used instead)
              const topLeftDom = document.getElementById("top-left-fpv");
              if (topLeftDom) topLeftDom.style.display = "none";

              // RESTORE DOM AND ENGINE GLOBALS
              // (No longer restoring pendingPipCamera here; handled safely inside pipCamToUse block)

              renderer.shadowMap.autoUpdate = oldShadowAutoUpdate;
              scene.background = oldSceneBackground;
              if (window._sceneFog) window._sceneFog.density = oldFogDensity;
              if (window._tipiGodray) window._tipiGodray.visible = true;
              if (window._tipiGodray2) window._tipiGodray2.visible = true;

              renderer.setScissorTest(false);
              renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
              renderer.autoClear = origAutoClear;

              if (window._globalFlare) window._globalFlare.visible = true;

              // RESTORE visibility after PIP pass so next frame's Main View isn't blank/whiteout!
              toggleFX(true);
            } // End of w > 0 && h > 0 culling check
          }

          // PIP was natively rendered here AFTER Main View.
          // --- AXE LOGBOOK OVERLAY RENDER ---
          const shouldAxeRender = window.fuzzyBrain
            ? window.fuzzyBrain.shouldRenderAxePIP()
            : true;
          if (
            !drewMapMain &&
            window._isAxeCameraCloned &&
            window._axeRect &&
            axeRenderer &&
            typeof axePipCam !== "undefined" &&
            shouldAxeRender
          ) {
            if (window._axeRect.width > 0 && window._axeRect.height > 0) {
              // Bespoke cinematic Perspective Camera for the Axe UI.
              axeRenderer.setViewport(
                0,
                0,
                window._axeRect.width,
                window._axeRect.height,
              );
              axeRenderer.setScissorTest(false);
              axeRenderer.render(scene, axePipCam);
            }
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
                if (bg) {
                    bg.pause();
                    bg.removeAttribute('src');
                    bg.load();
                    bg.remove();
                }
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
            
            window.documentReady = true;
            window.startGameIfReady();
        };

        // Attempt startup immediately if promises already resolved
        if (document.readyState === 'complete') {
            window.documentReady = true;
            window.startGameIfReady();
        }
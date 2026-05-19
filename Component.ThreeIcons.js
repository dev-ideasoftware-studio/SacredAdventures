
class ThreeIconManager {
    constructor() {
        this.scenes = [];
        this.cachedScenes = {}; // Global Flyweight Cache Map
        this.clock = new THREE.Clock();
        
        // Input State
        this.mouseRaw = new THREE.Vector2(0, 0); 
        this.mouseSmooth = new THREE.Vector2(0, 0); 
        this.lastMouseMoveTime = 0;

        // --- SHARED RENDERER SETUP ---
        // HUD overlay: keep fill-rate down (fullscreen clear each frame). Shadows off — tiny UI icons.
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: false,
            powerPreference: "low-power",
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = false;
        
        // Canvas Style (Fixed Background)
        const canvas = this.renderer.domElement;
        canvas.id = 'v2-guide-icons-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '9999'; // Overlay above Logbook (8000)
        canvas.style.pointerEvents = 'none'; // Pass clicks through
        document.body.appendChild(canvas);

        window.addEventListener('resize', () => {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // MOUSE TRACKING for eye follow
        document.addEventListener('mousemove', (e) => {
            const x = (e.clientX / window.innerWidth) * 2 - 1;
            const y = -(e.clientY / window.innerHeight) * 2 + 1;
            this.updateInput(x, y);
        });

        this.initLoop();
    }

    initLoop() {
        const animate = () => {
            requestAnimationFrame(animate);
            const dt = this.clock.getDelta();
            const time = this.clock.elapsedTime;
            const lerp = Math.min(dt * 6.0, 1);
            this.mouseSmooth.lerp(this.mouseRaw, lerp);

            // PREPARE SHARED RENDERER
            // We need to clear once per frame if we want a clean slate, 
            // but since we restart drawing for each scissor, we might not need global clear 
            // IF the scissors cover everything. Here they don't (sparse UI).
            // So we must manually clear the whole canvas or use `autoClear = false` and rely on alpha.
            // Actually, `renderer.clear()` clears everything.
            
            // Enable Scissor Test
            this.renderer.setScissorTest(true);
            this.renderer.clear(); // Clear whole screen (transparent)

            // GLOBAL UPDATE HEARTBEAT (Decoupled from render viewports)
            // Ensures heavy physics/rotations only advance exactly ONE tick per frame, 
            // even if multiple identical UI elements share the exact same cached Object3D mesh
            Object.values(this.cachedScenes).forEach(cached => {
                if (cached.update) cached.update(time, dt);
            });

            const transform = `translate(0, ${window.scrollY}px)`; // Handle scroll if any? (Body is overflow hidden usually)

            // Garbage collection: Remove scenes whose containers have been pruned from the DOM
            for (let i = this.scenes.length - 1; i >= 0; i--) {
                const item = this.scenes[i];
                if (!item.container || !item.container.isConnected) {
                    this.scenes.splice(i, 1);
                }
            }

            this.scenes.forEach(item => {
                const container = item.container;
                let rect = container.getBoundingClientRect();

                // Cross-iFrame Scissor Calculation Projection
                if (container.ownerDocument !== document) {
                    const iframes = document.querySelectorAll('iframe');
                    let frameEl = null;
                    for (let i of iframes) {
                        try {
                            if (i.contentDocument === container.ownerDocument || i.contentWindow === container.ownerDocument.defaultView) {
                                frameEl = i;
                                break;
                            }
                        } catch(e) {}
                    }

                    // Fallback fix for strict equality proxy mismatches across nested iframe boundaries
                    if (!frameEl && container.ownerDocument.defaultView) {
                        frameEl = document.getElementById('logbookFrame');
                    }

                    if (frameEl) {
                        const fStyle = window.getComputedStyle(frameEl);
                        const pStyle = frameEl.parentElement ? window.getComputedStyle(frameEl.parentElement) : fStyle;
                        
                        if (fStyle.display === 'none' || fStyle.visibility === 'hidden' || fStyle.opacity === '0' || pStyle.opacity === '0' || pStyle.visibility === 'hidden') {
                            return; // WebGL Scissor cull when Parent Logbook UI is dismissed or fading
                        }

                        const frameRect = frameEl.getBoundingClientRect();
                        
                        // Calculate CSS Transform scale ratios exactly to counter Logbook responsiveness
                        const scaleX = frameRect.width / frameEl.offsetWidth;
                        const scaleY = frameRect.height / frameEl.offsetHeight;

                        rect = {
                            left: frameRect.left + (rect.left * scaleX),
                            right: frameRect.left + (rect.right * scaleX),
                            top: frameRect.top + (rect.top * scaleY),
                            bottom: frameRect.top + (rect.bottom * scaleY),
                            width: rect.width * scaleX,
                            height: rect.height * scaleY
                        };
                    } else {
                        return; // Orphaned iframe container
                    }
                }
                
                // If off-screen or hidden, skip
                if (rect.bottom < 0 || rect.top > window.innerHeight || 
                    rect.right < 0 || rect.left > window.innerWidth || 
                    rect.width === 0 || rect.height === 0) {
                    return;
                }

                // Calculate Scissor Box (WebGl 0,0 is Bottom-Left)
                const width = rect.width;
                const height = rect.height;
                const left = rect.left;
                const bottom = window.innerHeight - rect.bottom;

                // Adjust Camera Aspect & Projection
                const aspect = width / height;
                if (item.camera.isOrthographicCamera) {
                    const d = 3.0; // Widen the orthographic viewport frustum to fit the 3.2x scaled axe
                    if (item.camera.right !== d * aspect) {
                        item.camera.left = -d * aspect;
                        item.camera.right = d * aspect;
                        item.camera.top = d;
                        item.camera.bottom = -d;
                        item.camera.updateProjectionMatrix();
                    }
                } else {
                    if (item.camera.aspect !== aspect) {
                        item.camera.aspect = aspect;
                        item.camera.updateProjectionMatrix();
                    }
                }

                // Set Viewport & Scissor
                this.renderer.setViewport(left, bottom, width, height);
                this.renderer.setScissor(left, bottom, width, height);

                // Render Scene using shared Flyweight
                this.renderer.render(item.scene, item.camera);
            });
            
            // Disable Scissor Test after loop to be safe (though we re-enable next frame)
            this.renderer.setScissorTest(false);
        };
        animate();
    }

    updateInput(x, y) {
        this.mouseRaw.set(x, y);
        this.lastMouseMoveTime = this.clock.getElapsedTime();
    }
    
    // WebGL Pre-Compilation Pipeline Hook
    preloadAll() {
        const types = ['QUEST', 'SEARCH', 'LOG', 'GATHER']; // Explicitly omit 'FISH' due to external async OBJ/MTL loader timing issues
        types.forEach(type => {
            const cached = this.getOrCreateScene(type);
            this.renderer.compile(cached.scene, cached.camera);
        });
    }

    // Factory specific caching layer (Replaces duplicate invocations)
    getOrCreateScene(type) {
        if (this.cachedScenes[type]) return this.cachedScenes[type];

        // Scene Setup
        const scene = new THREE.Scene();
        // Camera (Aspect will be updated in loop dynamically per viewport)
        let camera;
        if (type === 'GATHER') {
            camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
        } else {
            camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        }
        camera.position.z = 5;

        // --- LIGHTING (Per Shared Scene) ---
        scene.add(new THREE.AmbientLight(0xffffff, 1.2)); 
        const mainLight = new THREE.DirectionalLight(0xfff3e0, 2.5);
        mainLight.position.set(3, 5, 5);
        mainLight.castShadow = true;
        scene.add(mainLight);

        let updateFn = null;
        if (type === 'QUEST') updateFn = this.buildQuest(scene);
        else if (type === 'SEARCH') updateFn = this.buildSearch(scene);
        else if (type === 'LOG' || type === 'JOURNAL') updateFn = this.buildLog(scene);
        else if (type === 'GATHER') updateFn = this.buildGather(scene);
        else if (type === 'FISH') updateFn = this.buildFish(scene);

        // Persistent heartbeat wrap
        const finalUpdate = (time, dt) => {
            if(updateFn) updateFn(time, dt);
        };

        const cached = { scene, camera, update: finalUpdate, type, userData: scene.userData };
        this.cachedScenes[type] = cached;
        return cached;
    }

    createIcon(containerId, type) {
        let container = containerId;
        if (typeof containerId === 'string') {
            container = document.getElementById(containerId);
        }
        if (!container) return;

        // Clear existing canvas rendering attachments cleanly
        const existingCanvas = container.querySelector('canvas');
        if (existingCanvas) existingCanvas.remove();

        const cached = this.getOrCreateScene(type);

        const item = { scene: cached.scene, camera: cached.camera, container: container, type: type, userData: cached.userData };
        this.scenes.push(item);
        return item;
    }



    buildGather(scene) {
        const group = new THREE.Group();
        group.scale.set(1.0, 1.0, 1.0);
        scene.add(group);

        // --- TOMAHAWK (Clean Item Render) ---
        const axePivot = new THREE.Group();
        axePivot.position.set(0, -0.4, 0); // Center in view
        group.add(axePivot);

        const loader = new window.THREE.GLTFLoader();
        if (window.AXE_GLB_BASE64) {
            loader.load(window.AXE_GLB_BASE64, (gltf) => {
                const axe = gltf.scene;

                // Standardize size to fit perfectly in the UI card
                const axeBox = new THREE.Box3().setFromObject(axe);
                const axeSize = axeBox.getSize(new THREE.Vector3());
                const asf = 3.2 / Math.max(axeSize.y, 0.1); // 2x Bigger hero item size (was 1.6)
                axe.scale.set(asf, asf, asf);

                // Upright, slightly angled perspective
                axe.rotation.set(0.2, Math.PI / 4, 0);

                // Recompute box after scaling to find its accurate new center
                // This prevents the Axe from orbiting wildly off-screen if its native origin is uncentered
                const scaledBox = new THREE.Box3().setFromObject(axe);
                const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
                axe.position.set(-scaledCenter.x, -scaledCenter.y, -scaledCenter.z);
                
                // Ensure materials pop with lighting
                axe.traverse(child => {
                    if (child.isMesh && child.material) {
                        child.material.envMapIntensity = 1.5;
                        child.material.roughness = 0.4; // make it slightly shinier for UI readability
                    }
                });

                axePivot.add(axe);
            });
        } else {
            console.warn('[ThreeIcons] AXE_GLB_BASE64 missing! Axe will not render in FPV.');
        }

        return (time, dt) => {
            // Gentle UI hover bob
            group.position.y = Math.sin(time * 2) * 0.1;
            
            // Slow, majestic rotating showcase
            axePivot.rotation.y += dt * 0.4;
        };
    }

    buildSearch(scene) {
        const group = new THREE.Group();
        group.scale.set(0.65, 0.65, 0.65);
        scene.add(group);

        // Materials
        const scleraMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1 });
        const irisMat = new THREE.MeshStandardMaterial({ color: 0x5D4037, roughness: 0.6 }); 
        const pupilMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.0 });
        const lidMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.7 }); // Dark gray eyelids

        const createEye = (x) => {
            const eyeRoot = new THREE.Group();
            eyeRoot.position.x = x;

            const sclera = new THREE.Mesh(new THREE.SphereGeometry(1.2, 32, 32), scleraMat);
            eyeRoot.add(sclera);

            const iris = new THREE.Mesh(new THREE.SphereGeometry(0.65, 24, 8), irisMat);
            iris.scale.z = 0.2;
            iris.position.z = 1.1;
            eyeRoot.add(iris);

            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8), pupilMat);
            pupil.scale.z = 0.2;
            pupil.position.z = 1.22;
            eyeRoot.add(pupil);

            const lidGeo = new THREE.SphereGeometry(1.45, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
            
            const topLid = new THREE.Mesh(lidGeo, lidMat);
            topLid.rotation.x = -Math.PI / 2; 
            eyeRoot.add(topLid);

            const botLid = new THREE.Mesh(lidGeo, lidMat);
            botLid.rotation.x = -Math.PI / 2; 
            eyeRoot.add(botLid);

            return { root: eyeRoot, topLid, botLid };
        };

        const left = createEye(-1.2);
        const right = createEye(1.2);
        group.add(left.root, right.root);
        
        // Track last known mouse position to detect active delta movement
        let lastMouseX = 0;
        let lastMouseY = 0;

        // --- SHADOW MOUTH (Canvas-rendered dark smile / curious O) ---
        const MOUTH_SIZE = 128;
        const mouthCanvas = document.createElement('canvas');
        mouthCanvas.width = MOUTH_SIZE;
        mouthCanvas.height = MOUTH_SIZE;
        const mctx = mouthCanvas.getContext('2d');
        const mouthTex = new THREE.CanvasTexture(mouthCanvas);
        const mouthSprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: mouthTex,
            transparent: true,
            depthWrite: false
        }));
        mouthSprite.scale.set(4.0, 2.5, 1);  // Typical smiley face width
        mouthSprite.position.set(0, -1.9, 0.5);
        group.add(mouthSprite);

        // Draw mouth expression on canvas (blend 0=smile, 1=curious O)
        const drawMouth = (blend) => {
            mctx.clearRect(0, 0, MOUTH_SIZE, MOUTH_SIZE);
            const cx = MOUTH_SIZE / 2;
            const cy = MOUTH_SIZE / 2;

            mctx.save();
            mctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
            mctx.shadowBlur = 8;
            mctx.shadowOffsetY = 2;

            // Bold dark gray Minions-style mouth (matches card background)
            mctx.fillStyle = 'rgba(26, 26, 26, 0.9)';
            mctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
            mctx.lineWidth = 16;                           // Extra thick Minion grin
            mctx.lineCap = 'round';
            mctx.lineJoin = 'round';

            mctx.beginPath();
            if (blend < 0.5) {
                // Asymmetrical thick Minion smirk
                const t = blend * 2;
                const w = THREE.MathUtils.lerp(20, 12, t);
                const d = THREE.MathUtils.lerp(10, 4, t);
                const liftLeft = THREE.MathUtils.lerp(2, 0, t);
                const liftRight = THREE.MathUtils.lerp(8, 2, t); // Smirk higher on right

                mctx.moveTo(cx - w, cy - liftLeft);
                // Main smile curve, slightly offset control point for quirkiness
                mctx.quadraticCurveTo(cx + 2, cy + d + 4, cx + w, cy - liftRight);
                mctx.stroke();

                // No need for a messy globalAlpha fill on the smile, keep it a clean thick stroke
                mctx.fillStyle = mctx.strokeStyle; // prepare for O if needed
            } else {
                // Curious O - small round thick mouth
                const t = (blend - 0.5) * 2;
                const rx = THREE.MathUtils.lerp(10, 6, t);
                const ry = THREE.MathUtils.lerp(6, 10, t);
                mctx.beginPath();
                mctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                mctx.stroke();
                mctx.fill();
            }
            mctx.restore();
            mouthTex.needsUpdate = true;
        };

        // ZZZZ Particle System
        const zCanvas = document.createElement('canvas');
        zCanvas.width = 128; zCanvas.height = 128;
        const zctx = zCanvas.getContext('2d');
        zctx.font = 'bold 80px Arial';
        zctx.fillStyle = '#ffffff';
        zctx.textAlign = 'center';
        zctx.textBaseline = 'middle';
        zctx.shadowColor = 'rgba(0,0,0,0.8)';
        zctx.shadowBlur = 8;
        zctx.fillText('Z', 64, 64);
        const zTex = new THREE.CanvasTexture(zCanvas);
        
        const zGroup = new THREE.Group();
        zGroup.position.set(1.5, 0, 0.5);
        group.add(zGroup);

        const zParticles = [];
        const zMat = new THREE.SpriteMaterial({ map: zTex, transparent: true, opacity: 0 });
        for(let i=0; i<3; i++) {
            const zSprite = new THREE.Sprite(zMat.clone());
            zSprite.scale.set(0.6, 0.6, 1);
            zGroup.add(zSprite);
            zParticles.push({
                sprite: zSprite,
                life: i * -1.5, // staggered start
                xOff: Math.random()
            });
        }

        drawMouth(0); // Initial smile

        // Expression state
        let expressionBlend = 0;
        let targetExpression = 0;
        let stateTimer = 0;
        let isSleeping = false;
        
        let blinkTimer = 0;
        let isBlinking = false;
        let blinkPhase = 0;

        return (time, dt) => {
            group.position.y = Math.sin(time) * 0.1;
            const lidBase = -Math.PI / 2;

            if (isBlinking) {
                blinkPhase += dt * 4.0; // Slower, more deliberate blink
                let p = Math.sin(blinkPhase * Math.PI);
                if (blinkPhase >= 1.0) {
                    isBlinking = false;
                    p = 0;
                    blinkTimer = time + 2.0 + Math.random() * 4.0;
                }
                const closeAngle = p * (Math.PI / 2.0); // Close lids completely
                left.topLid.rotation.x = lidBase + closeAngle;
                left.botLid.rotation.x = lidBase - closeAngle;
                right.topLid.rotation.x = lidBase + closeAngle;
                right.botLid.rotation.x = lidBase - closeAngle;
            } else {
                left.topLid.rotation.x = lidBase;
                left.botLid.rotation.x = lidBase;
                right.topLid.rotation.x = lidBase;
                right.botLid.rotation.x = lidBase;
                if (time > blinkTimer && !isSleeping) {
                    isBlinking = true;
                    blinkPhase = 0;
                }
            }

            // Detect active mouse movement to wake up
            const mouseDelta = Math.abs(this.mouseRaw.x - lastMouseX) + Math.abs(this.mouseRaw.y - lastMouseY);
            if (mouseDelta > 0.005) {
                isSleeping = false;
                stateTimer = time + 5.0; // Stay awake for at least 5 seconds after moving mouse
                lastMouseX = this.mouseRaw.x;
                lastMouseY = this.mouseRaw.y;
            }

            // Sleep / Awake / Curious Logic
            if (time > stateTimer && !isBlinking) {
                const r = Math.random();
                if (r < 0.4) {
                    isSleeping = true;
                    targetExpression = 0; // Relaxed mouth
                    stateTimer = time + 5.0 + Math.random() * 5.0; // Sleep for a while
                } else if (r < 0.7) {
                    isSleeping = false;
                    targetExpression = 1; // Curious O mouth
                    stateTimer = time + 2.0 + Math.random() * 2.0;
                } else {
                    isSleeping = false;
                    targetExpression = 0; // Smile
                    stateTimer = time + 3.0 + Math.random() * 2.0;
                }
            }

            if (isSleeping) {
                // Keep eyes closed entirely
                left.topLid.rotation.x = lidBase + (Math.PI / 2.0);
                left.botLid.rotation.x = lidBase - (Math.PI / 2.0);
                right.topLid.rotation.x = lidBase + (Math.PI / 2.0);
                right.botLid.rotation.x = lidBase - (Math.PI / 2.0);
                
                // Zzzz Particles
                zParticles.forEach(p => {
                    p.life += dt;
                    if (p.life > 0) {
                        const prog = p.life / 3.0;
                        if (prog >= 1.0) p.life = -0.5; // Reset
                        p.sprite.position.y = prog * 2.5;
                        p.sprite.position.x = Math.sin(prog * Math.PI * 4 + p.xOff) * 0.4;
                        p.sprite.material.opacity = Math.sin(prog * Math.PI) * 0.8;
                        const s = 0.4 + prog * 0.6;
                        p.sprite.scale.set(s, s, 1);
                    } else {
                        p.sprite.material.opacity = 0;
                    }
                });
            } else {
                // Mouse Look — eyes follow cursor (reduced range for natural look)
                const lookX = this.mouseSmooth.x * 1.5;
                const lookY = this.mouseSmooth.y * 1.5;
                left.root.lookAt(lookX, lookY, 10);
                right.root.lookAt(lookX, lookY, 10);
                
                // Hide Zzzz
                zParticles.forEach(p => p.sprite.material.opacity = 0);
            }

            // Mouth expression cycling
            const prevBlend = expressionBlend;
            expressionBlend += (targetExpression - expressionBlend) * 0.08;
            if (Math.abs(expressionBlend - prevBlend) > 0.01) {
                drawMouth(expressionBlend);
            }
        };
    }

    buildQuest(scene) {
        const frontLight = new THREE.DirectionalLight(0xffffff, 3.0);
        frontLight.position.set(0, 2, 8);
        scene.add(frontLight);

        const group = new THREE.Group();
        group.scale.set(0.65, 0.65, 0.65);
        scene.add(group);

        const ballMat = new THREE.MeshStandardMaterial({
            color: 0xffd700,
            emissive: 0xffd700,
            emissiveIntensity: 0.25,
            metalness: 1.0,
            roughness: 0.3
        });

        const balloonPoints = [];
        for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            const y = Math.cos(t * Math.PI);
            let x = Math.sin(t * Math.PI);
            if (t > 0.5) {
                const pinchProgress = (t - 0.5) * 2.0;
                x *= Math.pow(1.0 - pinchProgress, 0.65);
            }
            balloonPoints.push(new THREE.Vector2(x * 2.1, y * 2.1));
        }
        const balloonGeo = new THREE.LatheGeometry(balloonPoints, 32);
        const ball = new THREE.Mesh(balloonGeo, ballMat);

        // Add knot
        const knotGeo = new THREE.ConeGeometry(0.35, 0.5, 12);
        const knot = new THREE.Mesh(knotGeo, ballMat);
        knot.position.y = -2.15;
        knot.rotation.x = Math.PI;
        ball.add(knot);

        group.add(ball);

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 120px serif';
        ctx.fillStyle = 'black';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', 64, 64);

        const tex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        sprite.scale.set(2.0, 2.0, 1);
        sprite.position.z = 2.4;
        group.add(sprite);

        const bloomGroup = new THREE.Group();
        group.add(bloomGroup);

        const bloomTex = new THREE.CanvasTexture((() => {
            const c = document.createElement('canvas');
            c.width = 64;
            c.height = 64;
            const t = c.getContext('2d');
            const g = t.createRadialGradient(32, 32, 0, 32, 32, 32);
            g.addColorStop(0, 'rgba(255, 200, 50, 0.8)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            t.fillStyle = g;
            t.fillRect(0, 0, 64, 64);
            return c;
        })());

        for (let i = 0; i < 6; i++) {
            const b = new THREE.Sprite(new THREE.SpriteMaterial({
                map: bloomTex,
                blending: THREE.AdditiveBlending,
                transparent: true,
                opacity: 0.6
            }));
            b.userData = {
                speed: 0.5 + Math.random() * 0.5,
                offset: Math.random() * 10,
                radius: 2.5
            };
            bloomGroup.add(b);
        }

        const sparkles = new THREE.Group();
        group.add(sparkles);
        const spGeo = new THREE.PlaneGeometry(0.12, 0.12);
        const spMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 });
        for (let i = 0; i < 15; i++) {
            const sp = new THREE.Mesh(spGeo, spMat);
            sp.userData = {
                phase: Math.random() * Math.PI * 2,
                speed: 1.0 + Math.random(),
                radius: 1.6 + Math.random() * 0.5,
                yBase: (Math.random() - 0.5) * 2.5
            };
            sparkles.add(sp);
        }

        const borderGeo = new THREE.TorusGeometry(3.0, 0.1, 16, 64);
        const borderMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.0,
            blending: THREE.AdditiveBlending
        });
        const border = new THREE.Mesh(borderGeo, borderMat);
        group.add(border);

        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture((() => {
                const c = document.createElement('canvas');
                c.width = 64;
                c.height = 64;
                const tx = c.getContext('2d');
                const g = tx.createRadialGradient(32, 32, 0, 32, 32, 32);
                g.addColorStop(0, 'rgba(0,100,255,0.8)');
                g.addColorStop(1, 'rgba(0,0,0,0)');
                tx.fillStyle = g;
                tx.fillRect(0, 0, 64, 64);
                return c;
            })()),
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0
        }));
        glow.scale.set(5, 5, 5);
        group.add(glow);

        return (time, dt) => {
            group.position.y = Math.sin(time) * 0.1;

            sparkles.children.forEach((sp) => {
                const u = sp.userData;
                const angle = time * u.speed + u.phase;
                sp.position.x = Math.cos(angle) * u.radius;
                sp.position.z = Math.sin(angle) * u.radius;
                sp.position.y = u.yBase + Math.sin(time * 2 + u.phase) * 0.3;
                sp.scale.setScalar(0.5 + 0.5 * Math.sin(time * 10 + u.phase));
                sp.lookAt(0, 0, 10);
            });

            const t = time % 5.0;
            if (t < 1.0) {
                const f = Math.sin(t * Math.PI);
                borderMat.opacity = f * 0.8;
                glow.material.opacity = f * 0.5;
                border.rotation.x = time;
                border.rotation.y = time * 0.5;
            } else {
                borderMat.opacity = 0;
                glow.material.opacity = 0;
            }

            ball.rotation.y -= dt * 0.5;
            ball.rotation.x = Math.sin(time * 0.5) * 0.2;
        };
    }

    buildFish(scene) {
        const group = new THREE.Group();
        scene.add(group);

        const fishWrapper = new THREE.Group();
        fishWrapper.position.z = -0.2;
        group.add(fishWrapper);

        const wiggleGroup = new THREE.Group();
        fishWrapper.add(wiggleGroup);

        const loader = new THREE.OBJLoader();
        const baseHref = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const fishUrl = `${baseHref}/Assets/Fish/fish.obj`;

        const fishMaterial = new THREE.MeshStandardMaterial({
            color: 0x2b6ffe,
            roughness: 0.35,
            metalness: 0.25
        });

        let fishModel = null;

        const onObjLoad = (obj) => {
            const box = new THREE.Box3().setFromObject(obj);
            const center = box.getCenter(new THREE.Vector3());
            obj.position.sub(center);

            obj.traverse((child) => {
                if (child.isMesh) {
                    child.material = fishMaterial;
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            obj.scale.setScalar(0.38);
            obj.rotation.set(0, 0, 0);
            obj.rotateX(-Math.PI / 2);
            obj.rotateZ(Math.PI);

            wiggleGroup.add(obj);
            fishModel = obj;
        };

        if (window.FISH_OBJ_DATA) {
            try {
                const obj = loader.parse(window.FISH_OBJ_DATA);
                onObjLoad(obj);
            } catch (e) {
                console.warn('Failed to parse embedded fish OBJ:', e);
            }
        } else {
            loader.load(fishUrl, onObjLoad, undefined, (error) => {
                console.warn('Failed to load fish OBJ:', error);
            });
        }

        // --- BUBBLES ---
        // New: Reduces to 2 very small bubbles.
        const bubbles = [];
        const bubbleGeo = new THREE.SphereGeometry(0.04, 8, 8); // Very small (4cm)
        const bubbleMat = new THREE.MeshStandardMaterial({
            color: 0xaaccff,
            transparent: true,
            opacity: 0.4,
            roughness: 0.1,
            metalness: 0.9
        });

        for (let i = 0; i < 2; i++) { // Only 2 bubbles
            const mesh = new THREE.Mesh(bubbleGeo, bubbleMat);
            // Random start
            const x = (Math.random() - 0.5) * 1.5; 
            const y = (Math.random() - 0.5) * 0.8;
            const z = (Math.random() - 0.5) * 0.5;
            mesh.position.set(x, y, z);
            group.add(mesh);
            // Sideways speed + wobble
            bubbles.push({
                mesh: mesh,
                speedX: 0.3 + Math.random() * 0.2, // Move right
                off: Math.random() * 10
            });
        }

        return (time) => {
            // Fish Wiggle & Swim
            let flowDir = -1; // Default flow opposite to movement
            if (fishModel) {
               // Simple sine rotation on Y for tail wiggle
               wiggleGroup.rotation.y = Math.sin(time * 1.5) * 0.15;
               
               // Stationary vertical bobbing (no x-axis roaming to prevent jerks)
               fishWrapper.position.x = 0;
               fishWrapper.position.y = Math.sin(time * 1.5) * 0.1;

               // Lock rotation to face strictly sideways to the right
               fishWrapper.rotation.y = 0;
               
               // Bubbles flow continuously to the left (-1) as fish faces right
               flowDir = -1;
            }

            // Bubbles Flow Sideways (opposite to head direction)
            bubbles.forEach(b => {
                const dt = 0.016; // approx step
                
                b.mesh.position.x += b.speedX * dt * 4.0 * flowDir; // Fast flow
                
                // Wrap around X cleanly without clamping randomness to one side
                if (b.mesh.position.x < -1.5) {
                    b.mesh.position.x += 3.0; // Shift back to right side
                    b.mesh.position.y = (Math.random() - 0.5) * 0.8;
                } else if (b.mesh.position.x > 1.5) {
                    b.mesh.position.x -= 3.0; // Shift back to left side
                    b.mesh.position.y = (Math.random() - 0.5) * 0.8;
                }
                
                // Bob Y
                b.mesh.position.y += Math.sin(time * 3 + b.off) * 0.002;
            });
        };
    }

    buildLog(scene) {
        // FLOATING OPEN SPELLBOOK + SPIN
        const group = new THREE.Group();
        group.rotation.x = 0.5; 
        scene.add(group);

        const coverColor = 0x3e2723;
        const pageColor = 0xffe0b2;

        // Covers
        const coverGeo = new THREE.BoxGeometry(1.2, 1.6, 0.05);
        const coverMat = new THREE.MeshStandardMaterial({ color: coverColor });
        const leftCover = new THREE.Mesh(coverGeo, coverMat); leftCover.position.set(-0.65, 0, 0); leftCover.rotation.y = 0.3; 
        const rightCover = new THREE.Mesh(coverGeo, coverMat); rightCover.position.set(0.65, 0, 0); rightCover.rotation.y = -0.3;
        group.add(leftCover, rightCover);

        // Pages
        const stackGeo = new THREE.BoxGeometry(1.1, 1.5, 0.05);
        const stackMat = new THREE.MeshStandardMaterial({ color: pageColor });
        const leftStack = new THREE.Mesh(stackGeo, stackMat); leftStack.position.set(0, 0, 0.06); leftCover.add(leftStack);
        const rightStack = new THREE.Mesh(stackGeo, stackMat); rightStack.position.set(0, 0, 0.06); rightCover.add(rightStack);

        // Flapping Page
        const pageGeo = new THREE.PlaneGeometry(1.1, 1.5);
        pageGeo.translate(0.55, 0, 0); 
        const pageAnimMat = new THREE.MeshStandardMaterial({ color: pageColor, side: THREE.DoubleSide });
        const pLeft = new THREE.Mesh(pageGeo, pageAnimMat); pLeft.position.set(0,0,0.06); group.add(pLeft);
        const pRight = new THREE.Mesh(pageGeo, pageAnimMat); pRight.position.set(0,0,0.06); group.add(pRight);

        // State
        let turning = false;
        let turnStart = 0;
        let closing = false;
        let closeStart = 0;
        let nextIdleTurn = null;

        const scheduleIdleTurn = (referenceTime) => {
            const base = typeof referenceTime === 'number' ? referenceTime : scene.userData.time || 0;
            nextIdleTurn = base + 5 + Math.random() * 6;
        };

        scene.userData.triggerTurn = () => {
            if (!turning && !closing) {
                turning = true;
                turnStart = scene.userData.time;
                nextIdleTurn = null;
            }
        };
        
        scene.userData.triggerClose = () => {
            closing = true;
            closeStart = scene.userData.time;
            turning = false; // Cancel turn
            nextIdleTurn = null;
        };

        return (time, dt) => {
            scene.userData.time = time;
            group.position.y = Math.sin(time) * 0.1;

            if (!turning && !closing) {
                if (nextIdleTurn === null) {
                    scheduleIdleTurn(time);
                } else if (time >= nextIdleTurn) {
                    turning = true;
                    turnStart = time;
                    nextIdleTurn = null;
                }
            }

            if(closing) {
                const t = (time - closeStart) / 0.5; // Fast close
                const closeT = t * (2 - t); // Ease out
                
                if(t >= 1) {
                    closing = false;
                    group.rotation.y = 0;
                    // Reset Pages to Closed
                    pRight.rotation.y = 0; 
                    pLeft.rotation.y = 0;
                    scheduleIdleTurn(time + 4);
                } else {
                    // Animate closing: Snap shut
                    // Target: Rotation 0, Pages 0.
                    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, 0, 0.1);
                    pRight.rotation.y = THREE.MathUtils.lerp(pRight.rotation.y, 0, 0.2);
                    pLeft.rotation.y = THREE.MathUtils.lerp(pLeft.rotation.y, 0, 0.2);
                }
            }
            else if(turning) {
                const t = (time - turnStart) / 0.8;
                const spinT = t * t * (3 - 2 * t);
                if(t >= 1) {
                    turning = false;
                    pRight.rotation.y = -0.3; 
                    // group.rotation.y = 0; 
                    scheduleIdleTurn(time + 4);
                } else {
                    pRight.rotation.y = -0.3 + t * (Math.PI + 0.6);
                    if(t > 0.4 && t < 0.6) { pageAnimMat.emissive.setHex(0xffffff); pageAnimMat.emissiveIntensity = 0.5; } 
                    else { pageAnimMat.emissiveIntensity = 0; }
                }
            } else {
                 // Idle state (Open book)
                 pLeft.rotation.y = 0.3; // Open left
                 // pRight.rotation.y = -0.3 + Math.sin(time*2.5)*0.02; 
                 // Subtle wobble
                 pRight.rotation.y = -0.3 + Math.sin(time*2.5)*0.02; 
                 
                 group.rotation.y *= 0.95;
                 group.rotation.z *= 0.95;
            }
        };
    }
}

if(typeof window !== 'undefined') {
    window.ThreeIconManager = ThreeIconManager;
}

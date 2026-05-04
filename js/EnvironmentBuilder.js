window.EnvironmentBuilder = class EnvironmentBuilder {
    constructor(scene) {
        this.scene = scene;
    }

    setupLighting() {
        // Hemisphere Light — warm sky, cool shadow
        const hemiLight = new THREE.HemisphereLight(0xfff4e6, 0x3a5f3a, 0.8);
        hemiLight.layers.enableAll();
        this.scene.add(hemiLight);

        // Directional Light (Sun) — warm golden hour
        const sunLight = new THREE.DirectionalLight(0xffe0a0, 2.0);
        sunLight.layers.enableAll();
        sunLight.position.set(40, 35, -20);
        sunLight.castShadow = false;
        sunLight.shadow.mapSize.width = 1024;
        sunLight.shadow.mapSize.height = 1024;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 200;
        sunLight.shadow.bias = -0.0001;

        const sCamSize = 100;
        sunLight.shadow.camera.left = -sCamSize;
        sunLight.shadow.camera.right = sCamSize;
        sunLight.shadow.camera.top = sCamSize;
        sunLight.shadow.camera.bottom = -sCamSize;

        this.scene.add(sunLight);
        this.scene.add(sunLight.target); // CRITICAL: Target must be in scene for floating frustum
        window.sunLight = sunLight;

        // Subtle fill light from opposite side
        const fillLight = new THREE.DirectionalLight(0xb0c4de, 0.4);
        fillLight.layers.enableAll();
        fillLight.position.set(-30, 20, 30);
        this.scene.add(fillLight);
    }

    setupEnvironment() {
        // VIBRANT SKY — Ethereal Happy Hunting Ground Spirit Glow
        const skyGeo = new THREE.SphereGeometry(400, 32, 32);
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            uniforms: {
                topColor: { value: new THREE.Color(0xffaa22) },    // Golden spirit glow
                midColor: { value: new THREE.Color(0xffd580) },    // Warm sun haze
                bottomColor: { value: new THREE.Color(0xfff1ca) }, // Ethereal horizon
                offset: { value: 20 },
                exponent: { value: 0.5 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 midColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    if (h < 0.0) {
                        gl_FragColor = vec4(bottomColor, 1.0);
                    } else if (h < 0.3) {
                        float t = h / 0.3;
                        gl_FragColor = vec4(mix(bottomColor, midColor, t), 1.0);
                    } else {
                        float t = (h - 0.3) / 0.7;
                        gl_FragColor = vec4(mix(midColor, topColor, pow(t, exponent)), 1.0);
                    }
                }
            `
        });
        const sky = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(sky);
        
        // Expose sky uniforms globally for Day/Night Cycle
        window._skyUniforms = skyMat.uniforms;
        window._skyMesh = sky; // Expose mesh so it can be hidden in MapView to prevent whiteout

        // Add atmospheric ethereal fog to simulate Depth of Field zero-cost
        this.scene.background = new THREE.Color(0xfff1ca);
        // FOG REMOVED PER USER REQUEST: no more seasonal haze blinding the models
        this.scene.fog = null;
        window._sceneFog = null;
        window._sceneTarget = this.scene;

        // SCENE EDITOR: 3D Miniature Tabletop Bases
        window._editorBases = [];
        window.createEditorBase = (radius, modelTrackerRef, color = 0x223344) => {
            const baseGroup = new THREE.Group();
            baseGroup.visible = !!window._isMapView; // Only visible if we are currently in Map View
            baseGroup.userData.isEditorBaseGroup = true;
            
            // Raised 3D Dias Platform (Boardgame miniature style)
            const cylGeo = new THREE.CylinderGeometry(radius, radius + 0.1, 0.3, 32);
            const ringMat = new THREE.MeshStandardMaterial({ 
                color: color, roughness: 0.9, metalness: 0.2 
            });
            const cyl = new THREE.Mesh(cylGeo, ringMat);
            cyl.position.y = 0.15; // Raised slightly so ground clipping doesn't hide it
            
            // Facing Arrow Guide (Yellow Cone)
            const arrowLength = radius * 0.8;
            const arrowGeo = new THREE.ConeGeometry(radius * 0.3, arrowLength, 5);
            // Rotate the cone so it points flat along the Z axis (Three.js standard forward)
            arrowGeo.rotateX(Math.PI / 2); 
            const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
            const arrow = new THREE.Mesh(arrowGeo, arrowMat);
            
            // Position arrow on top edge of the dias pointing local "forward" (+Z)
            arrow.position.set(0, 0.4, radius - (arrowLength * 0.3));
            
            baseGroup.add(cyl);
            baseGroup.add(arrow);
            
            // Interaction Tracking for Editor
            cyl.userData = { isEditorBase: true, type: 'TRANSLATE', modelRef: modelTrackerRef };
            arrow.userData = { isEditorBase: true, type: 'ROTATE', modelRef: modelTrackerRef };
            
            window._editorBases.push(baseGroup);
            return baseGroup;
        };

        // SCENE EDITOR: 25-Meter Boardgame Hex Tiles
        window.createVillageHexGrid = (getHeightFunc) => {
            if (window._hexGridMeshes && window._hexGridMeshes.length > 0) return window._hexGridMeshes;
            
            const RADIUS = 25; // 25 meter hexagons
            const GAP = 0.5;
            const size = RADIUS - GAP; // Leave a 1-meter visible trench between tiles
            
            // Hexagon geometry oriented point-up
            const hexGeo = new THREE.CylinderGeometry(size, size, 0.4, 6);
            
            const hexMat = new THREE.MeshStandardMaterial({
                color: 0x111611, roughness: 1.0, metalness: 0.0,
                transparent: true, opacity: 0.8
            });
            
            // Generate a grid mapping
            const rings = 8;
            const positions = [];
            const w = Math.sqrt(3) * RADIUS;
            const h = 1.5 * RADIUS;
            
            for (let q = -rings; q <= rings; q++) {
                for (let r = Math.max(-rings, -q - rings); r <= Math.min(rings, -q + rings); r++) {
                    const x = w * (q + r / 2);
                    const z = h * r;
                    // Ignore anything way outside immediate playable area
                    if (x * x + z * z < 250000) positions.push({ x, z });
                }
            }
            
            const chunkSize = 40; // 40 units per chunk
            const chunks = {};
            positions.forEach(pos => {
                const cx = Math.floor(pos.x / chunkSize);
                const cz = Math.floor(pos.z / chunkSize);
                const key = cx + '_' + cz;
                if (!chunks[key]) chunks[key] = [];
                chunks[key].push(pos);
            });

            window._hexGridMeshes = []; // Array to hold chunked meshes
            const dummy = new THREE.Object3D();

            for (const key in chunks) {
                const chunkPositions = chunks[key];
                const instancedMesh = new THREE.InstancedMesh(hexGeo, hexMat, chunkPositions.length);
                instancedMesh.visible = !!window._isMapView;
                instancedMesh.frustumCulled = true;
                
                chunkPositions.forEach((pos, i) => {
                    const groundY = getHeightFunc(pos.x, pos.z);
                    dummy.position.set(pos.x, groundY - 0.1, pos.z);
                    dummy.updateMatrix();
                    instancedMesh.setMatrixAt(i, dummy.matrix);
                });
                
                instancedMesh.instanceMatrix.needsUpdate = true;
                instancedMesh.computeBoundingSphere();
                window._hexGridMeshes.push(instancedMesh);
                this.scene.add(instancedMesh);
            }
            
            // To maintain compatibility, return the array wrapper (though most logic will now iterate _hexGridMeshes)
            return window._hexGridMeshes;
        };
    }
    highlightTree(tree) {
            tree.traverse(child => {
                if (child.isMesh) {
                    if (!child.userData.oldEmissive) child.userData.oldEmissive = child.material.emissive.clone();
                    child.material.emissive.set(0xffd700); // Gold Highlight
                    child.material.emissiveIntensity = 0.5;
                }
            });
        }

    deselectTree(tree) {
            if (!tree) return;
            tree.traverse(child => {
                if (child.isMesh && child.userData.oldEmissive) {
                    child.material.emissive.copy(child.userData.oldEmissive);
                    child.material.emissiveIntensity = 0;
                }
            });
        }

    chopTree(tree, scene) {
            // 1. Add Lumber
            const gain = 2 + Math.floor(Math.random() * 3);
            window.inventory.lumber += (window.inventory.lumber || 0) + gain;
            console.log(`[Gather] Tree chopped! + ${gain} lumber.Total: ${window.inventory.lumber} `);

            // Notify UI for +1 animation
            const pf = document.getElementById('panel-frame');
            if (pf && pf.contentWindow) {
                const btn = document.getElementById('card-gather-btn');
                const startRect = btn ? btn.getBoundingClientRect() : { left: window.innerWidth * 0.8, top: window.innerHeight * 0.8, width: 50, height: 50 };
                pf.contentWindow.postMessage({
                    type: 'RESOURCE_GAIN',
                    resource: 'wood',
                    item: 'wood',
                    amount: gain,
                    startRect: startRect
                }, '*');
            }

            // 2. Hide Tree Components
            if (tree.isInstanced) {
                const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
                if (tree.chunkSiblings) {
                    tree.chunkSiblings.forEach(({ instancedMesh }) => {
                        instancedMesh.setMatrixAt(tree.index, zeroMatrix);
                        instancedMesh.instanceMatrix.needsUpdate = true;
                    });
                }
            } else {
                tree.visible = false;
            }
            // Remove from sway update
            const idx = window.allTrees.indexOf(tree);
            if (idx !== -1) window.allTrees.splice(idx, 1);

            // 3. Place Stump
            const stumpGroup = new THREE.Group();
            stumpGroup.position.copy(tree.position);
            if (tree.rotation) stumpGroup.rotation.copy(tree.rotation);

            // Match stump radius to the tree's base scale, or fallback if it's an instanced plain metadata object
            const treeScaleX = tree.scale ? tree.scale.x : 1.0;
            const baseRadius = 0.4 * treeScaleX;
            const stumpColor = 0x332F2B;
            const woodMat = new THREE.MeshStandardMaterial({ color: stumpColor });
            // Slightly brighter core for the cut top
            const topMat = new THREE.MeshStandardMaterial({ color: 0x4A443F });
            const stumpGeo = new THREE.CylinderGeometry(baseRadius, baseRadius * 1.1, 0.6, 12);
            const stump = new THREE.Mesh(stumpGeo, [woodMat, topMat, woodMat]);
            stump.position.y = 0.3;
            stumpGroup.add(stump);
            scene.add(stumpGroup);
        }

        updateLoadingScreen(text) {
            if (window.logSystem) {
                window.logSystem(text);
            } else {
                const textEl = document.querySelector('.loading-text');
                if (textEl) {
                    textEl.innerText = text;
                    textEl.style.animation = 'none'; // Stop pulsing during final steps
                }
            }
        }

        

    async generateWorld(assetFactory) {
        // Yield to allow MP4 frames to paint and GC to run (15ms forces a physical frame gap to prevent browser crash heuristics)
        const waitFrame = () => new Promise(r => setTimeout(r, 15));
        const scene = this.scene;
        const camera = window.camera;
        const allTrees = window.allTrees;
        const swayTrees = window.swayTrees;
        const vegData = { bushes: [], trees: [] };
        
        window.createFPVFacingArrow = function(colorHex = 0xffa500, size = 1.0, dir = new THREE.Vector3(0, 0, -1), transparency = 1.0) {
            // High-fidelity standard 3D Arrow 
            const origin = new THREE.Vector3( 0, 0.2, 0 ); 
            // Tighten the arrowhead so it doesn't render as a floating detached diamond
            const arrowHelper = new THREE.ArrowHelper( dir, origin, size * 1.2, colorHex, size * 0.4, size * 0.15 );
            
            if (transparency !== 1.0) {
                if (arrowHelper.line && arrowHelper.line.material) {
                    arrowHelper.line.material.transparent = true;
                    arrowHelper.line.material.opacity = transparency;
                }
                if (arrowHelper.cone && arrowHelper.cone.material) {
                    arrowHelper.cone.material.transparent = true;
                    arrowHelper.cone.material.opacity = transparency;
                }
            }
            
            // FPV Layer targeting
            arrowHelper.layers.set(0);
            if (arrowHelper.line) arrowHelper.line.layers.set(0);
            if (arrowHelper.cone) arrowHelper.cone.layers.set(0);
            return arrowHelper;
        };
        
        window.createPIPMarker = function() {
            // Hexagon markers eradicated per USER request for a pure tile grid base
            return new THREE.Group();
        };

        
        this.updateLoadingScreen("Processing...");
        await waitFrame();

            // Ground — large terrain
            const ground = assetFactory.create('ground_chunk');
            ground.position.set(0, 0, 0);
            scene.add(ground);

            window._sacredGroundMesh = ground.children.find(c => c.isMesh && c.geometry.type === 'PlaneGeometry') || ground.children[0];
            window._sacredHazeMesh = ground.children[1];
            
            window.flattenTerrainAt = async function(targetX, targetZ, radius, forceY) {
                const targetY = (forceY !== undefined) ? forceY : (window._getGroundY ? window._getGroundY(targetX, targetZ) : 0);
                
                window._flattenedZones = window._flattenedZones || [];
                window._flattenedZones.push({ x: targetX, z: targetZ, radius: radius, y: targetY });

                const flattenMesh = async (mesh, offset) => {
                    if (!mesh) return;
                    const geo = mesh.geometry;
                    if (!geo.attributes || !geo.attributes.position) return;
                    const pos = geo.attributes.position;
                    let modified = false;
                    
                    const CHUNK_SIZE = 5000;
                    for (let i = 0; i < pos.count; i++) {
                        if (i > 0 && i % CHUNK_SIZE === 0) {
                            await waitFrame();
                        }
                        const vx = pos.getX(i);
                        const vz = pos.getZ(i);
                        const dist = Math.sqrt((vx - targetX)**2 + (vz - targetZ)**2);
                        if (dist < radius) {
                            let blend = 1.0;
                            // Make the perfectly flat zone larger (80% of radius instead of 60%)
                            if (dist > radius * 0.8) {
                                const t = (dist - radius * 0.8) / (radius * 0.2);
                                blend = 0.5 + 0.5 * Math.cos(t * Math.PI); 
                            }
                            const currentY = pos.getY(i);
                            pos.setY(i, currentY * (1 - blend) + (targetY + offset) * blend);
                            modified = true;
                        }
                    }
                    if (modified) {
                        pos.needsUpdate = true;
                        if (geo.attributes.normal) geo.computeVertexNormals();
                    }
                };

                await flattenMesh(window._sacredGroundMesh, 0);
                await flattenMesh(window._villageMapGrid, 0.01);
                await flattenMesh(window._sacredHazeMesh, 0.02); // Sink haze below the 0.1 height building platforms
            };

            window.getGroundNormal = function(x, z) {
                const delta = 0.5;
                const hL = window._getGroundY ? window._getGroundY(x - delta, z) : 0;
                const hR = window._getGroundY ? window._getGroundY(x + delta, z) : 0;
                const hD = window._getGroundY ? window._getGroundY(x, z - delta) : 0;
                const hU = window._getGroundY ? window._getGroundY(x, z + delta) : 0;
                const normal = new THREE.Vector3(hL - hR, delta * 2, hD - hU).normalize();
                return normal;
            };


            // ============================================
            // TERRAIN — tipi-centric sacred landscape
            // ============================================
            // Use absolute origin mathematically for flattening terrain so it exists before the boardgame grid boots
            const TIPI_X = 0, TIPI_Z = 0;
            const CLEARING_R = 30;   // 100-foot valley floor
            const HILL_INNER = 30;   // Where hills start
            const HILL_OUTER = 60;   // Pulled back to reduce steep angle
            const HILL_HEIGHT = 4.0; // Halved height to lower the angle of the surrounding valley

            const getGroundY = (gx, gz) => {
                // 1. BASE — gentle undulation everywhere
                let baseNoise = Math.sin(gx * 0.08) * Math.cos(gz * 0.1) * 1.5
                    + Math.sin(gx * 0.2 + gz * 0.15) * 0.4;

                let y = baseNoise;

                const dx = gx - TIPI_X, dz = gz - TIPI_Z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                // 2. SACRED CLEARING — 100-foot flat valley floor
                if (dist < CLEARING_R) { // Apply to the entire grass clearing
                    if (dist < 12.0) { // Extended flat radius to completely contain Tipi + front entrance
                        y = 0; // Completely flat ground for the Tipi interior and girl
                    } else {
                        // Smooth blend from 0 to full undulation
                        const t = (dist - 12.0) / (CLEARING_R - 12.0);
                        const flatten = 0.5 + 0.5 * Math.cos(t * Math.PI); // 1.0 at dist=12, 0.0 at dist=30
                        y = baseNoise * (1.0 - flatten);
                    }
                }

                // 2b. BRINGS HAPPINESS GIRL TIPI PLATEAU (Quest Tipi) & TIPI 3 PLATEAU
                const plateauX = 12, plateauZ = 12;
                const p3X = -12, p3Z = 12;
                
                const dx2 = gx - plateauX, dz2 = gz - plateauZ;
                const dist2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
                
                const dx3 = gx - p3X, dz3 = gz - p3Z;
                const dist3 = Math.sqrt(dx3 * dx3 + dz3 * dz3);
                
                if (dist2 < 12.0) {
                    const plateauY = Math.sin(plateauX * 0.08) * Math.cos(plateauZ * 0.1) * 1.5 + Math.sin(plateauX * 0.2 + plateauZ * 0.15) * 0.4;
                    if (dist2 < 8.0) {
                        y = plateauY; // Broadened flat ground for Tipi footprint
                    } else {
                        // Smooth blend from plateau to full undulation
                        const t2 = (dist2 - 8.0) / 4.0;
                        const flatten2 = 0.5 + 0.5 * Math.cos(t2 * Math.PI); // 1.0 at center, 0.0 at edge
                        y = y * (1.0 - flatten2) + plateauY * flatten2;
                    }
                } else if (dist3 < 12.0) {
                    const plateau3Y = Math.sin(p3X * 0.08) * Math.cos(p3Z * 0.1) * 1.5 + Math.sin(p3X * 0.2 + p3Z * 0.15) * 0.4;
                    if (dist3 < 8.0) {
                        y = plateau3Y;
                    } else {
                        const t3 = (dist3 - 8.0) / 4.0;
                        const flatten3 = 0.5 + 0.5 * Math.cos(t3 * Math.PI);
                        y = y * (1.0 - flatten3) + plateau3Y * flatten3;
                    }
                }

                // 3. PROTECTIVE HILLS — steep ring around the valley
                if (dist >= HILL_INNER && dist < HILL_OUTER) {
                    const t = (dist - HILL_INNER) / (HILL_OUTER - HILL_INNER);
                    const hillShape = Math.sin(t * Math.PI); // Peak at midpoint
                    const angle = Math.atan2(dz, dx);
                    // Natural variation — 3 lobes
                    const noise = 0.65 + 0.35 * Math.sin(angle * 3 + 0.8) * Math.sin(angle * 5 + 2.1) * 0.3;
                    const lobe = 0.7 + 0.3 * Math.sin(angle * 2.3 + 1.2);
                    y += HILL_HEIGHT * hillShape * (noise + 0.5) * lobe;
                }

                // 4. ROLLING HILLS — outer terrain
                if (dist > HILL_OUTER) {
                    const outerBlend = Math.min(1.0, (dist - HILL_OUTER) / 10);
                    const rollingH = Math.sin(gx * 0.06 + 1.0) * Math.cos(gz * 0.05 + 0.7) * 2.5
                        + Math.sin(gx * 0.12 + gz * 0.1) * 1.0;
                    y += rollingH * outerBlend;
                }

                // Edge flattening for modular tile maps (+/- 120)
                const edgeDistX = Math.max(0, Math.abs(gx) - 100); 
                const edgeDistZ = Math.max(0, Math.abs(gz) - 100); 
                const maxEdge = Math.max(edgeDistX, edgeDistZ); 
                if (maxEdge > 0) {
                    // Smoothly fade height to perfectly 0 over the last 20 units
                    const flattenT = Math.min(1.0, maxEdge / 20.0);
                    y = y * (1.0 - flattenT);
                }

                if (window._flattenedZones) {
                    for (let z of window._flattenedZones) {
                        const fdx = gx - z.x;
                        const fdz = gz - z.z;
                        const fdist = Math.sqrt(fdx*fdx + fdz*fdz);
                        if (fdist < z.radius) {
                            let blend = 1.0;
                            if (fdist > z.radius * 0.8) {
                                const t = (fdist - z.radius * 0.8) / (z.radius * 0.2);
                                blend = 0.5 + 0.5 * Math.cos(t * Math.PI);
                            }
                            y = y * (1.0 - blend) + z.y * blend;
                        }
                    }
                }

                return y;
            };
            window._getGroundY = getGroundY;


            // Board Game Tile Grid Setup (Village View ONLY)
            // 25-foot hexes (1 unit approx 3.29ft => ~7.6 units wide)
            // Increased by 10% per USER request (was 5.7)
            const hexRadius = 6.27;
            const hexThickness = 0.4;
            const sides = 6; // Standard Hexagon
            // ============================================
            // 2D CANVAS NEUMORPHIC HEX GRID
            // ============================================
            // We draw the grid mathematically to a high-res canvas, then drape it
            // across a single PlaneGeometry that perfectly hugs the terrain.
            window._hexCenters = [];
            
            const canvasSize = 2048;
            const ctxCanvas = document.createElement('canvas');
            ctxCanvas.width = canvasSize;
            ctxCanvas.height = canvasSize;
            const ctx = ctxCanvas.getContext('2d');
            
            const mapSize = 240;
            const ppu = canvasSize / mapSize;
            const hr = hexRadius * ppu;
            
            ctx.clearRect(0, 0, canvasSize, canvasSize);
            ctx.lineWidth = 0.3 * ppu; 
            ctx.strokeStyle = 'rgba(15, 20, 10, 0.5)'; // Soft, organic shadow
            ctx.lineJoin = 'round';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            ctx.shadowBlur = 5;
            ctx.beginPath();
            
            // Iterate radially using Axial Coordinates to guarantee a perfect grid centered at 0,0
            const maxRings = Math.ceil((mapSize / 2) / (hexRadius * 1.5)) + 2;
            
            for (let q = -maxRings; q <= maxRings; q++) {
                for (let r = -maxRings; r <= maxRings; r++) {
                    const cx = Math.sqrt(3) * hexRadius * (q + r/2);
                    const cz = 1.5 * hexRadius * r;
                    
                    if (Math.sqrt(cx*cx + cz*cz) > mapSize/2 + hexRadius*2) continue;
                    
                    window._hexCenters.push(new THREE.Vector2(cx, cz));
                    
                    // Map world XZ to canvas XY
                    const canvasX = (cx + mapSize/2) * ppu;
                    const canvasY = (cz + mapSize/2) * ppu;
                    
                    for (let i = 0; i <= 6; i++) {
                        const a = i * Math.PI * 2 / 6 + Math.PI / 6; // Flat top orientation (+30deg)
                        const px = canvasX + Math.cos(a) * hr;
                        const py = canvasY + Math.sin(a) * hr;
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                }
            }
            ctx.stroke();
            
            const gridTexture = new THREE.CanvasTexture(ctxCanvas);
            gridTexture.anisotropy = 4; // Keeps it crisp at low angles
            
            // ============================================
            // TERRAIN-HUGGING GEOMETRY
            // ============================================
            const hexGridGeo = new THREE.PlaneGeometry(mapSize, mapSize, 160, 160);
            hexGridGeo.rotateX(-Math.PI / 2);
            
            const pos = hexGridGeo.attributes.position;
            const CHUNK_SIZE = 5000;
            for (let i = 0; i < pos.count; i++) {
                if (i > 0 && i % CHUNK_SIZE === 0) {
                    await waitFrame();
                }
                const vx = pos.getX(i);
                const vz = pos.getZ(i);
                // The geometry physically deforms to match getGroundY perfectly!
                pos.setY(i, getGroundY(vx, vz) + 0.01); // Float 0.01 units above grass
            }
            hexGridGeo.computeVertexNormals();
            
            const hexGridMat = new THREE.MeshBasicMaterial({
                map: gridTexture,
                transparent: true,
                depthWrite: false // Guarantees 60 FPS
            });
            
            const hexGrid = new THREE.Mesh(hexGridGeo, hexGridMat);
            hexGrid.layers.set(1); // Explicitly lock to Village View layer ONLY
            scene.add(hexGrid);
            window._villageMapGrid = hexGrid;
            
            window.getNearestHexCenter = (tx, tz) => {
                if (!window._hexCenters || window._hexCenters.length === 0) return {x: tx, z: tz};
                let closest = window._hexCenters[0];
                let minDist = Infinity;
                for (const hc of window._hexCenters) {
                    const d = (hc.x - tx)*(hc.x - tx) + (hc.y - tz)*(hc.y - tz);
                    if (d < minDist) {
                        minDist = d;
                        closest = hc;
                    }
                }
                return {x: closest.x, z: closest.y};
            };


            function createNPCHalo(modelRef) {
                // Return our standard interactive 3D miniature base (size 1.2 for NPCs, nice deep gold color)
                return window.createEditorBase(1.2, modelRef, 0xFFD700);
            }

            function createQuestBalloon(markerText, questId) {
                const questGroup = new THREE.Group();

                const markerBallMat = new THREE.MeshStandardMaterial({
                    color: 0xFFD700, emissive: 0xFFD700, emissiveIntensity: 0.15,
                    metalness: 0.9, roughness: 0.3
                });

                const balloonPoints = [];
                for (let i = 0; i <= 40; i++) {
                    const t = i / 40;
                    const y = Math.cos(t * Math.PI);
                    let x = Math.sin(t * Math.PI);
                    if (t > 0.5) x *= Math.pow(1.0 - (t - 0.5) * 2.0, 0.65);
                    balloonPoints.push(new THREE.Vector2(x * 0.55, y * 0.65));
                }
                const balloonGeo = new THREE.LatheGeometry(balloonPoints, 32);
                const balloonBody = new THREE.Mesh(balloonGeo, markerBallMat);
                questGroup.add(balloonBody);

                const knotGeo = new THREE.ConeGeometry(0.08, 0.12, 12);
                const knot = new THREE.Mesh(knotGeo, markerBallMat);
                knot.position.y = -0.69; 
                knot.rotation.x = Math.PI;
                questGroup.add(knot);

                // Removed internal straight string to prevent double-string rendering when NPCs use custom slanted tethers

                const qCanvas = document.createElement('canvas');
                qCanvas.width = 128; qCanvas.height = 128;
                const qCtx = qCanvas.getContext('2d');
                qCtx.font = 'bold 90px Arial';
                qCtx.fillStyle = '#000000';
                qCtx.textAlign = 'center';
                qCtx.textBaseline = 'middle';
                qCtx.fillText('!', 64, 70);
                const qTex = new THREE.CanvasTexture(qCanvas);
                const qSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: qTex, transparent: true, depthWrite: false, depthTest: false }));
                qSprite.scale.set(1.5, 1.5, 1);
                qSprite.position.z = 0;
                qSprite.renderOrder = 999;
                questGroup.add(qSprite);
                const glowMat = new THREE.SpriteMaterial({
                    map: new THREE.TextureLoader().load('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAwAB/AL+f4R4AAAAAElFTkSuQmCC'), // dummy
                    color: 0xffddaa, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.8, depthWrite: false
                });
                // Dynamic canvas glow instead of base64
                const gCan = document.createElement('canvas'); gCan.width = 64; gCan.height = 64;
                const gCtx = gCan.getContext('2d');
                const grad = gCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
                grad.addColorStop(0, 'rgba(255, 220, 100, 0.8)');
                grad.addColorStop(1, 'rgba(255, 200, 50, 0.0)');
                gCtx.fillStyle = grad;
                gCtx.fillRect(0, 0, 64, 64);
                glowMat.map = new THREE.CanvasTexture(gCan);
                
                const balloonGlow = new THREE.Sprite(glowMat);
                balloonGlow.scale.set(1.5, 1.5, 1);
                balloonGlow.position.z = -0.1; // Behind marker
                questGroup.add(balloonGlow);


                questGroup.name = questId;
                questGroup.userData.questId = questId;

                return questGroup;
            }

            // Initialize the Village Editor Map Overlay
            window.createVillageHexGrid(getGroundY);

            // Player start — inside the valley, unobstructed view of the Tipi
            camera.rotation.order = 'YXZ';
            camera.position.set(0, 1.7, 20);
            camera.rotation.set(0, 0, 0); // rotation.y=0 → movement controller faces -Z → toward tipi

            // Establish the new baseline Y where the Tipi and Fire will rest
            window._tipiPlatformY = getGroundY(TIPI_X, TIPI_Z);

            this.updateLoadingScreen("Processing...");
            await waitFrame();
            // =============================================
            // TIPI — yellowbutterfly tipi at world center
            // =============================================
            await new Promise((resolveTipi) => {
                console.log("[generateWorld] Starting GLTFLoader for Tipi...");
                const gltfLoaderTipi = new GLTFLoader();
                gltfLoaderTipi.setPath('Assets/Tipi.yellowbutterfly/');
                gltfLoaderTipi.load('tipi.yellowbutterfly.glb', async (gltf) => {
                    const obj = gltf.scene;
                    console.log("[generateWorld] GLTFLoader finished for Tipi glb.");
                        // Scale to reasonable game size
                        const box = new THREE.Box3().setFromObject(obj);
                        const size = box.getSize(new THREE.Vector3());
                        const targetH = 7.2; // 20% larger
                        const sf = targetH / Math.max(size.y, 0.1);
                        obj.scale.set(sf, sf, sf);

                        // Face entrance fully towards camera +Z (Player spawn is Z=20)
                        obj.rotation.y = -Math.PI / 2;
                        obj.updateMatrixWorld(true);

                        // Recompute after scale and rotation
                        box.setFromObject(obj);
                        const center = box.getCenter(new THREE.Vector3());
                        
                        // User request: "building circles will be 75% size of hex tile" (6.27 * 0.75 = 4.7)
                        const platRadius = 4.7; 

                        // Place at clearing center
                        const hexPos = window.getNearestHexCenter ? window.getNearestHexCenter(TIPI_X, TIPI_Z) : {x: TIPI_X, z: TIPI_Z};
                        const platformY = window._tipiPlatformY;
                        
                        obj.position.set(
                            hexPos.x - center.x + obj.position.x,
                            platformY - box.min.y - 0.05, 
                            hexPos.z - center.z + obj.position.z
                        );

                        // Make interactive for clicking
                        obj.userData.isBuilding = true;
                        window._interactiveBuildings = window._interactiveBuildings || [];
                        window._interactiveBuildings.push(obj);

                        // NEW: Sacred Circle Platform directly under the Tipi
                        const platGeo = new THREE.CylinderGeometry(platRadius, platRadius + 0.15, 0.22, 32);
                        const platMat = new THREE.MeshStandardMaterial({ color: 0x1a2e1a, roughness: 0.9, metalness: 0.1 });
                        const platMesh = new THREE.Mesh(platGeo, platMat);
                        platMesh.position.set(hexPos.x, platformY + 0.05, hexPos.z); 
                        platMesh.castShadow = false;
                        platMesh.receiveShadow = true;
                        platMesh.layers.enable(1); // Renders in Village Map layer
                        platMesh.userData.isBuilding = true;
                        platMesh.userData.buildingRoot = obj;
                        window._interactiveBuildings.push(platMesh);
                        scene.add(platMesh);
                        // Increased radius to 10.0 to ensure wide plateau covers building footprint on hills
                        if (window.flattenTerrainAt) {
                            await window.flattenTerrainAt(hexPos.x, hexPos.z, 14.0, platformY);
                        }

                        // Matte materials — no shine, clean texture
                        obj.traverse(child => {
                            if (child.isMesh) {
                                child.castShadow = true; 
                                child.receiveShadow = true;
                                if (child.material) {
                                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                                    mats.forEach(m => {
                                        if (m.roughness !== undefined) m.roughness = 0.9;
                                        if (m.metalness !== undefined) m.metalness = 0.0;
                                        // Remove the baked-in emissive to preserve the canvas artwork
                                        if (m.emissive !== undefined) {
                                            m.emissive.setHex(0x000000);
                                            m.emissiveIntensity = 0.0;
                                        }
                                        // CRITICAL: Ensure no weird alpha transparency sorting bugs
                                        m.transparent = false;
                                        m.depthWrite = true;
                                    });
                                }
                            }
                        });

                        // removed haloMesh cinematic godray logic per user request

                        // Quest Marker removed from Tipi, dynamically re-anchored to YB below.

                        // Attach PIP marker (Building: 12ft diameter = ~1.8m radius)
                        // Do NOT attach to obj, because obj has a 6x scale multiplier which massively distorts the marker.
                        const tipiMarker = window.createPIPMarker(0x2e8b57, 1.6, 2.0);
                        tipiMarker.position.set(obj.position.x, obj.position.y, obj.position.z);
                        scene.add(tipiMarker);

                        // Force the Tipi structural geometry onto Layer 1 so it renders gracefully above its green circle in the PIP Map
                        obj.traverse(child => {
                            if (child.isMesh) {
                                child.layers.enable(1); 
                            }
                        });

                        scene.add(obj);
                        window.tipiObj = obj;
                        console.log(`[Tipi] Placed yellowbutterfly tipi at (${TIPI_X}, ${TIPI_Z}), height=${targetH.toFixed(1)}`);

                        // === BUTTERFLY SPIRIT (Optimized Placeholder) ===
                        // AVOID LOADING 78MB OBJ WHICH CRASHES PERFORMANCE.
                        const bObj = new THREE.Group();

                        // -- FAKE BLOOM EFFECT (Extremely fast FPS) --
                        function createGlowTexture() {
                            const canvas = document.createElement('canvas');
                            canvas.width = 64; canvas.height = 64;
                            const ctx = canvas.getContext('2d');
                            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
                            grad.addColorStop(0, 'rgba(255, 255, 200, 1.0)');
                            grad.addColorStop(0.3, 'rgba(255, 200, 50, 0.5)');
                            grad.addColorStop(1, 'rgba(255, 200, 50, 0.0)');
                            ctx.fillStyle = grad;
                            ctx.fillRect(0, 0, 64, 64);
                            return canvas;
                        }
                        const glowTex = new THREE.CanvasTexture(createGlowTexture());
                        const glowMat = new THREE.SpriteMaterial({
                            map: glowTex, color: 0xffee99, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8
                        });
                        const glowSprite = new THREE.Sprite(glowMat);
                        glowSprite.scale.set(6, 6, 1);
                        bObj.add(glowSprite);

                        // FPS FIX: Disabled localized point light on high-poly meshes
                        // const bLight = new THREE.PointLight(0xffdd66, 1.0, 15);
                        // bObj.add(bLight);

                        // Place on the ground in front of Tipi 1
                        const bx = TIPI_X;
                        const bz = TIPI_Z + 4.0; // In front of tipi entrance
                        const by = getGroundY(bx, bz) + 1.0; // slightly above ground
                        
                        bObj.position.set(bx, by, bz);
                        bObj.scale.set(1.5, 1.5, 1.5);
                        window._butterflySpirit = bObj; // Save for animation
                        
                        scene.add(bObj);
                        
                        // === YELLOW BUTTERFLY NPC ===
                        const ybGltfLoader = new GLTFLoader();
                        ybGltfLoader.load('Assets/animated.yellowbutterfly.glb', (gltf) => {
                            const ybModel = gltf.scene;
                            // User Request: Restore to reasonable size
                            ybModel.scale.set(1.728, 1.382, 1.728); 
                            
                            // Rigid wrapper to permanently correct the mesh orientation.
                            // Yellow Butterfly natively points -X locally. Rotate -90 degrees (CW) so her face aligns to -Z.
                            const meshRig = new THREE.Group();
                            meshRig.rotation.y = -Math.PI / 2; 
                            meshRig.add(ybModel);
                            
                            const ybX = -2.0;
                            const ybZ = 2.4;
                            const ybY = getGroundY(ybX, ybZ); // snap to ground to stop floating
                            
                            const ybGroup = new THREE.Group();
                            ybGroup.position.set(ybX, ybY, ybZ);
                            ybGroup.rotation.y = -Math.PI / 4;
                            ybGroup.add(meshRig);

                            ybModel.traverse(child => {
                                if (child.isMesh) {
                                    child.castShadow = false; // FPS FIX
                                    child.receiveShadow = false; // FPS FIX
                                    
                                    // Make faces and hands smooth
                                    if (child.material) {
                                        child.material.flatShading = false;
                                        child.material.needsUpdate = true;
                                    }
                                    // Remove destructive computeVertexNormals block that was overwriting rigged geometry smooth shading
                                }
                            });
                            
                            // FPS FIX: Disabled localized point light on high-poly meshes
                            // const ybLight = new THREE.PointLight(0xffeedd, 1.2, 8);
                            // Light should always be strictly behind head (-1.0 in local Z)
                            // ybLight.position.set(0, 3.5, -3.0);
                            // ybGroup.add(ybLight);
                            
                            // Attach aesthetic Halo proxy
                            const halo = createNPCHalo(ybGroup);
                            ybGroup.add(halo);
                            
                            // --- FLOATING QUEST MARKER ---
                            const questGroup = createQuestBalloon('1', 'quest_1_start_game');
                            // Move balloon to sit more intimately over her directly in FPV
                            questGroup.position.set(0, 4.4, 0);
                            questGroup.userData.baseY = 4.4; 
                            
                            // Slant the tether string to visually attach directly into her LEFT hand!
                            // USER REQUEST: 70% thinner (0.006 -> 0.0018) and 70% more transparent (0.8 -> 0.24)
                            const stringGeo = new THREE.CylinderGeometry(0.0018, 0.0018, 3.2, 4);
                            // By translating the geometry downwards by half its height, its active pivot locks exactly at its Top Point
                            stringGeo.translate(0, -1.6, 0);
                            const stringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24 });
                            const stringMesh = new THREE.Mesh(stringGeo, stringMat);
                            // Position the string precisely inside the bottom knot of the balloon so it stays attached under all circumstances
                            stringMesh.position.set(0, -0.69, 0); 
                            // Slant the string like a pendulum to terminate neatly at her left hand node
                            stringMesh.rotation.set(0.15, 0, 0.12);
                            
                            questGroup.add(stringMesh);

                            ybGroup.add(questGroup);
                            window._questMarker = questGroup; 
                            
                            // Attach PIP marker (NPC: 6ft diameter = ~0.9m radius), with facing arrow = true
                            const ybMarker = window.createPIPMarker(0x2e8b57, 0.8, 0.9, true);
                            ybGroup.add(ybMarker);
                            
                            // Attach styled golden circle under NPC
                            const npcCircle = new THREE.Group();
                            npcCircle.position.y = 0.02;
                            // Match the player's circle perfectly
                            npcCircle.scale.set(1.1046, 1.1085, 1.1046);
                            
                            const pRadius = 0.375;
                            const baseGeo = new THREE.CylinderGeometry(pRadius, pRadius, 0.02, 32);
                            const baseMat = new THREE.MeshStandardMaterial({ color: 0xFFD700, roughness: 0.4, metalness: 0.8 });
                            const baseMesh = new THREE.Mesh(baseGeo, baseMat);
                            baseMesh.position.y = 0.01;
                            baseMesh.receiveShadow = true;
                            npcCircle.add(baseMesh);

                            const borderGeo = new THREE.TorusGeometry(pRadius, 0.02, 16, 48);
                            const borderMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1 });
                            const borderMesh = new THREE.Mesh(borderGeo, borderMat);
                            borderMesh.rotation.x = Math.PI / 2;
                            borderMesh.position.y = 0.01;
                            npcCircle.add(borderMesh);

                            const arrowGeo = new THREE.ConeGeometry(0.08, 0.2, 32);
                            const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1 });
                            const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
                            arrowMesh.rotation.set(Math.PI / 2, 0, 0); 
                            arrowMesh.scale.set(1.0, 1.0, 0.25); // Flattened vertically
                            arrowMesh.position.set(0, 0.01, pRadius + 0.1); 
                            npcCircle.add(arrowMesh);
                            
                            ybGroup.add(npcCircle);
                            
                            // Save actual model mesh to scale during rendering without scaling circles
                            window._ybCharacterMesh = ybModel;

                            scene.add(ybGroup);
                            // Save to global for EngineMain
                            window._yellowButterflyNPC = ybGroup;

                            if (gltf.animations && gltf.animations.length > 0) {
                                window.ybMixer = new THREE.AnimationMixer(ybModel);
                                
                                // gltf.animations mapping:
                                // [0] Rest/Tpose, [1] Walk, [2] Idle, [3] Wait, [4] Heart, [5] Wave
                                const walkClip = gltf.animations.length > 1 ? gltf.animations[1] : null;
                                const idleClip = gltf.animations.length > 2 ? gltf.animations[2] : null;
                                const waitClip = gltf.animations.length > 3 ? gltf.animations[3] : null;
                                const heartClip = gltf.animations.length > 4 ? gltf.animations[4] : null;
                                const waveClip = gltf.animations.length > 5 ? gltf.animations[5] : null;

                                const system = {
                                    mixer: window.ybMixer,
                                    clips: { walk: walkClip, idle: idleClip, wait: waitClip, heart: heartClip, wave: waveClip },
                                    actions: {},
                                    hasGreeted: false,
                                    hasWaved: false,
                                    currentBaseAction: null,
                                    proximityTimeout: null,
                                    petTimer: 3.0,
                                    hasGreetedPlayer: false,
                                    // GC-free gaze pool — reused every frame instead of .clone()
                                    _gazeQuat: new THREE.Quaternion(),
                                    _gazeQuat2: new THREE.Quaternion(),
                                    _gazeTarget: new THREE.Vector3(),
                                    update(delta) {
                                        if (this.mixer) this.mixer.update(delta);
                                        
                                        const playerPos = window.camera ? window.camera.position : null;
                                        const playerDist = playerPos ? window._yellowButterflyNPC.position.distanceTo(playerPos) : Infinity;
                                        const isPlayerNear = playerDist <= 75.0; // 3 tiles (3 * 25m)

                                        // AI STATE MACHINE
                                        if (!this.aiState) {
                                            this.aiState = 'idle';
                                            this.stateTimer = Math.random() * 5 + 3;
                                            this.spawnPoint = window._yellowButterflyNPC.position.clone();
                                            this.walkTarget = new THREE.Vector3();
                                            this.hasWaved = false;
                                        }

                                        // High Priority: Player Proximity Waving
                                        if (isPlayerNear && playerPos) {
                                            if (this.aiState !== 'waving') {
                                                this.aiState = 'waving';
                                                this.hasWaved = true;
                                                if (this.actions.wave) {
                                                    this.actions.wave.reset().play();
                                                    if (this.currentBaseAction) this.actions.wave.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                                    this.currentBaseAction = this.actions.wave;
                                                }
                                            }
                                            
                                            // Smoothly track player with gaze
                                            this._gazeQuat.copy(window._yellowButterflyNPC.quaternion);
                                            this._gazeTarget.copy(playerPos);
                                            this._gazeTarget.y = window._yellowButterflyNPC.position.y;
                                            window._yellowButterflyNPC.lookAt(this._gazeTarget);
                                            this._gazeQuat2.copy(window._yellowButterflyNPC.quaternion);
                                            window._yellowButterflyNPC.quaternion.copy(this._gazeQuat);
                                            window._yellowButterflyNPC.quaternion.slerp(this._gazeQuat2, 4.0 * delta);
                                            
                                            return; // Halt other AI logic while interacting
                                        } else if (this.aiState === 'waving' && playerDist > 80.0) {
                                            // Player left the area
                                            this.aiState = 'idle';
                                            this.stateTimer = 2.0;
                                            if (this.actions.idle) {
                                                this.actions.idle.reset().play();
                                                if (this.currentBaseAction) this.actions.idle.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                                this.currentBaseAction = this.actions.idle;
                                            }
                                        }

                                        // Ambient AI: Idle and Random Walk
                                        if (this.aiState === 'idle') {
                                            this.stateTimer -= delta;
                                            if (this.stateTimer <= 0) {
                                                this.aiState = 'walking';
                                                // Pick a random destination within 15 meters of spawn point
                                                const angle = Math.random() * Math.PI * 2;
                                                const rad = Math.random() * 15;
                                                this.walkTarget.set(this.spawnPoint.x + Math.cos(angle)*rad, 0, this.spawnPoint.z + Math.sin(angle)*rad);
                                                
                                                if (this.actions.walk) {
                                                    this.actions.walk.reset().play();
                                                    if (this.currentBaseAction) this.actions.walk.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                                    this.currentBaseAction = this.actions.walk;
                                                }
                                            }
                                        } else if (this.aiState === 'walking') {
                                            const dx = this.walkTarget.x - window._yellowButterflyNPC.position.x;
                                            const dz = this.walkTarget.z - window._yellowButterflyNPC.position.z;
                                            const distToTarget = Math.sqrt(dx*dx + dz*dz);
                                            
                                            if (distToTarget < 1.0) {
                                                this.aiState = 'idle';
                                                this.stateTimer = Math.random() * 8 + 4;
                                                if (this.actions.idle) {
                                                    this.actions.idle.reset().play();
                                                    if (this.currentBaseAction) this.actions.idle.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                                    this.currentBaseAction = this.actions.idle;
                                                }
                                            } else {
                                                // Turn toward destination
                                                this._gazeQuat.copy(window._yellowButterflyNPC.quaternion);
                                                this._gazeTarget.copy(this.walkTarget);
                                                this._gazeTarget.y = window._yellowButterflyNPC.position.y;
                                                window._yellowButterflyNPC.lookAt(this._gazeTarget);
                                                this._gazeQuat2.copy(window._yellowButterflyNPC.quaternion);
                                                window._yellowButterflyNPC.quaternion.copy(this._gazeQuat);
                                                window._yellowButterflyNPC.quaternion.slerp(this._gazeQuat2, 4.0 * delta);
                                                
                                                // Translate forward
                                                window._yellowButterflyNPC.translateZ(1.5 * delta); // Normal walking speed
                                                
                                                // Ground Snapping
                                                if (typeof getGroundY !== 'undefined') {
                                                    window._yellowButterflyNPC.position.y = getGroundY(window._yellowButterflyNPC.position.x, window._yellowButterflyNPC.position.z);
                                                }
                                            }
                                        }
                                    }
                                };

                                // Cache Actions
                                if (walkClip) system.actions.walk = window.ybMixer.clipAction(walkClip);
                                if (idleClip) system.actions.idle = window.ybMixer.clipAction(idleClip);
                                if (waitClip) system.actions.wait = window.ybMixer.clipAction(waitClip);
                                if (heartClip) system.actions.heart = window.ybMixer.clipAction(heartClip);
                                if (waveClip) system.actions.wave = window.ybMixer.clipAction(waveClip);
                                
                                // Default settings
                                if (system.actions.heart) {
                                    system.actions.heart.setLoop(THREE.LoopOnce);
                                    system.actions.heart.clampWhenFinished = true;
                                }
                                if (system.actions.wave) {
                                    system.actions.wave.setLoop(THREE.LoopOnce);
                                    system.actions.wave.clampWhenFinished = true;
                                }

                                if (system.actions.idle) {
                                    system.currentBaseAction = system.actions.idle;
                                    system.actions.idle.play();
                                }
                                
                                window.ybSystem = system;
                                if (window.fuzzyBrain) {
                                    window.fuzzyBrain.linkNPC('yellowbutterfly', window._yellowButterflyNPC, window.ybSystem);
                                }
                            }
                            
                            console.log(`[NPC] Spawned YellowButterfly NPC at (${ybX}, ${ybZ})`);


                        });

                        // === NATURE SPIRIT (21 FEET TALL STAG) ===
                        const nsGltfLoader = new GLTFLoader();
                        nsGltfLoader.load('Assets/animated.stag.glb', (gltf) => {
                            const nsAsset = gltf.scene;
                            // Native head is securely proven to be +X. Do not rotate the asset mesh.
                            
                            const nsGroup = new THREE.Group();
                            // 21 feet = ~6.4 meters tall
                            // 21 feet = ~6.4 meters tall
                            nsGroup.scale.set(6.4, 6.4, 6.4);
                            
                            // Start from left side of view (-20 X, -10 Z)
                            const startX = -20;
                            const startZ = -10;
                            nsGroup.position.set(startX, getGroundY(startX, startZ) + 3.2, startZ);
                            
                            // CRITICAL RIG FIX: The Native Stag head points towards -X. 
                            // This -90deg rotation aligns the geometric face to the -Z mathematically,
                            // matching the lookAt direction so it walks forward!
                            const nsRig = new THREE.Group();
                            nsRig.rotation.y = -Math.PI / 2;
                            nsRig.add(nsAsset);
                            
                            // Initialize it fully facing its walking path (+X / East)
                            const initialTarget = nsGroup.position.clone();
                            initialTarget.x += 10.0;
                            nsGroup.lookAt(initialTarget);
                            nsGroup.add(nsRig);
                            
                            // Apply highly ethereal transparent material properties 
                            const myMaterials = [];
                            nsAsset.traverse(c => {
                                if (c.isMesh) {
                                    c.castShadow = false;
                                    c.receiveShadow = false;
                                    const origMat = c.material;
                                    if (origMat) {
                                        c.material = origMat.clone();
                                        c.material.transparent = true;
                                        c.material.opacity = 0.50; // Calibrated ethereal density
                                        c.material.depthWrite = false; // Ethereal ghosting
                                        c.material.depthTest = true;  // FIXED: Respect physical depth so it's hidden properly behind closer objects!
                                        c.material.emissive = new THREE.Color(0x33aaaa);
                                        c.material.emissiveIntensity = 0.5;
                                        myMaterials.push(c.material);
                                    }
                                }
                            });
                            
                            // FPS FIX: Disabled localized point light on high-poly meshes
                            // const spiritLight = new THREE.PointLight(0x77ffff, 1.5, 20);
                            // spiritLight.position.set(0, 0.5, 0); // Near the core
                            // nsGroup.add(spiritLight);
                            
                            // Attach PIP Marker (Giant Stag Animal: ~2m radius), with facing arrow = true
                            const nsMarker = window.createPIPMarker(0x4488ff, 1.8, 2.0, true, 0x4488ff, 0.4);
                            nsGroup.add(nsMarker);

                            scene.add(nsGroup);
                            if (gltf.animations && gltf.animations.length > 0) {
                                window.nsMixer = new THREE.AnimationMixer(nsAsset);
                                const walkClip = gltf.animations.find(a => a.name.toLowerCase().includes('walk')) || gltf.animations[0];
                                const idleClip = gltf.animations.find(a => a.name.toLowerCase().includes('idle')) || gltf.animations[0];
                                const bowClip = gltf.animations.find(a => a.name.toLowerCase().match(/bow|nod|greet|eat|graze/)) || idleClip;
                                
                                const walkAction = window.nsMixer.clipAction(walkClip);
                                const idleAction = window.nsMixer.clipAction(idleClip);
                                const bowAction = window.nsMixer.clipAction(bowClip);
                                
                                // Majestic slow motion
                                walkAction.setEffectiveTimeScale(0.35); 
                                bowAction.setEffectiveTimeScale(0.5); // Bowing happens gently
                                walkAction.play();
                                
                                // LOGBOOK OPENING REMOVED FROM HERE: Previously opened the logbook during asset loading,
                                // which caused it to bleed through the loading screen. Now handled exclusively
                                // by checkReadyToStart() in EngineMain.js AFTER loading screen has fully faded.

                                
                                window.natureSpiritSystem = {
                                    mixer: window.nsMixer,
                                    mesh: nsGroup,
                                    asset: nsAsset,
                                    materials: myMaterials,
                                    light: null, // FPS FIX: removed spiritLight
                                    state: 'walking_in', // Start walking immediately
                                    speed: 0.8, // Calibrated exactly to match 0.35 timescale footprints over 6.4m scale
                                    update(delta) {
                                        if (this.mixer) this.mixer.update(delta);
                                        
                                        // Dynamically re-anchor baseline to terrain while walking
                                        this.mesh.position.y = getGroundY(this.mesh.position.x, this.mesh.position.z) + 3.2;
                                        
                                        if (this.state === 'walking_in') {
                                            this.mesh.position.x += this.speed * delta;
                                            
                                            // Smoothly ensure it stays looking forward strictly along the movement path
                                            const marchTarget = this.mesh.position.clone();
                                            marchTarget.x += 10.0;
                                            const currentQuat = this.mesh.quaternion.clone();
                                            this.mesh.lookAt(marchTarget);
                                            const targetQuat = this.mesh.quaternion.clone();
                                            this.mesh.quaternion.copy(currentQuat);
                                            this.mesh.quaternion.slerp(targetQuat, 2.5 * delta);

                                            // Stop behind Tipi when aligned with Yellow Butterfly (-2 X)
                                            if (this.mesh.position.x >= -2) {
                                                this.state = 'bowing_turn'; // Begin smooth turn toward butterfly
                                                this.mixer.stopAllAction(); 
                                                
                                                // Yellow Butterfly waits eagerly
                                                if (window._yellowButterflyNPC && window.ybSystem && window.ybSystem.actions.wait) {
                                                    window.ybSystem.actions.wait.reset().play();
                                                    window.ybSystem.actions.wait.crossFadeFrom(window.ybSystem.currentBaseAction, 0.5, false);
                                                }

                                                // Wait 1.5 seconds to turn completely
                                                setTimeout(() => {
                                                    if (this.state === 'bowing_turn') {
                                                        this.state = 'bowing_action';
                                                        bowAction.reset().play(); // Nod
                                                        
                                                        // Yellow Butterfly enthusiastically waves
                                                        if (window._yellowButterflyNPC && window.ybSystem && window.ybSystem.actions.wave) {
                                                            setTimeout(() => {
                                                                if (window.ybSystem.actions.wave) {
                                                                    window.ybSystem.actions.wave.reset().play();
                                                                    window.ybSystem.actions.wave.crossFadeFrom(window.ybSystem.actions.wait, 0.5, false);
                                                                }
                                                            }, 1000); 
                                                        }
                                                        
                                                        setTimeout(() => { if (window.triggerYellowButterflyHeart) window.triggerYellowButterflyHeart(); }, 2500);
                                                        
                                                        // Finish bowing interaction, turn away
                                                        setTimeout(() => {
                                                            this.state = 'turning_away';
                                                            this.mixer.stopAllAction();
                                                            
                                                            // YB gently returns her rig to baseline Idle when the Stag turns
                                                            if (window.ybSystem && window.ybSystem.actions.idle) {
                                                                 window.ybSystem.actions.idle.reset().play();
                                                            }
                                                            
                                                            // Give 2.5 seconds to slowly turn away before walking
                                                            setTimeout(() => {
                                                                this.state = 'walking_out';
                                                                walkAction.reset().play();
                                                            }, 2500);
                                                            
                                                        }, 5000); // 5 seconds for greeting and nod interaction
                                                    }
                                                }, 1500);
                                            }
                                        } 
                                        else if (this.state === 'bowing_turn' || this.state === 'bowing_action') {
                                            if (window._yellowButterflyNPC) {
                                                const currentQuat = this.mesh.quaternion.clone();
                                                this.mesh.lookAt(window._yellowButterflyNPC.position);
                                                const targetQuat = this.mesh.quaternion.clone();
                                                this.mesh.quaternion.copy(currentQuat);
                                                this.mesh.quaternion.slerp(targetQuat, 2.5 * delta); // Smooth turn
                                            }
                                        }
                                        else if (this.state === 'turning_away' || this.state === 'walking_out') {
                                            const marchTarget = this.mesh.position.clone();
                                            marchTarget.x += 10.0;
                                            const currentQuat = this.mesh.quaternion.clone();
                                            this.mesh.lookAt(marchTarget);
                                            const targetQuat = this.mesh.quaternion.clone();
                                            this.mesh.quaternion.copy(currentQuat);
                                            this.mesh.quaternion.slerp(targetQuat, 2.0 * delta); // Smooth turn toward east
                                            
                                            if (this.state === 'walking_out') {
                                                this.mesh.position.x += this.speed * delta;
                                            }
                                            
                                            // Glow intensely after heart interaction
                                            if (this.state === 'walking_out') {
                                                this.materials.forEach(mat => {
                                                    if (mat.emissiveIntensity < 1.8) {
                                                        mat.emissiveIntensity += 0.5 * delta;
                                                    }
                                                });
                                                if (this.light && this.light.intensity < 3.0) this.light.intensity += 1.0 * delta;
                                                
                                                // Fade out as it passes deep into trees (X > 20)
                                                if (this.mesh.position.x > 20) {
                                                    let finished = false;
                                                    this.materials.forEach(mat => {
                                                        mat.opacity -= 0.15 * delta;
                                                        if (mat.opacity <= 0) finished = true;
                                                    });
                                                    if (this.light) this.light.intensity -= 1.0 * delta;
                                                    
                                                    if (finished) {
                                                        this.state = 'hidden';
                                                        this.mesh.visible = false;
                                                        console.log("[NPC] Nature Spirit departed. Waiting 10 minutes to return.");
                                                        
                                                        setTimeout(() => {
                                                            this.mesh.position.set(-20, getGroundY(-20, -10) + 3.2, -10);
                                                            const initialTarget = this.mesh.position.clone();
                                                            initialTarget.x += 10.0;
                                                            this.mesh.lookAt(initialTarget);
                                                            this.mesh.visible = true;
                                                            
                                                            this.materials.forEach(mat => {
                                                                mat.opacity = 0.50;
                                                                mat.emissiveIntensity = 0.5;
                                                            });
                                                            
                                                            this.state = 'walking_in';
                                                            this.mixer.stopAllAction();
                                                            walkAction.reset().play();
                                                            console.log("[NPC] Nature Spirit returned.");
                                                        }, 10 * 60 * 1000); // 10 minutes
                                                    }
                                                }
                                            }
                                        }
                                    }
                                };
                                if (window.fuzzyBrain) {
                                    window.fuzzyBrain.linkNPC('naturespirit', window.natureSpiritSystem.mesh, window.natureSpiritSystem);
                                }
                            }
                        });

                        // RESOLVE THE LOADING BLOCKER ONCE TEXTURES AND MESHES ARE READY
                        resolveTipi();
                });
            });
            this.updateLoadingScreen("Processing...");
            await waitFrame();

            // =============================================
            // Assets will be loaded relatively from the root
            // =============================================

            // =============================================
            // ANIME FOREST — anime.tree.glb × ~35 copies
            // Proper root burial, varied sizes, wind sway
            // =============================================
            const gltfLoader = new GLTFLoader();
            await new Promise((resolve, reject) => {
                gltfLoader.load('Assets/tree.glb', async (gltf) => {
                    const template = gltf.scene;

                // Measure full bounding box (including roots)
                const origBox = new THREE.Box3().setFromObject(template);
                const origSize = new THREE.Vector3();
                origBox.getSize(origSize);

                console.log(`[Forest] Template: ${origSize.x.toFixed(1)}×${origSize.y.toFixed(1)}×${origSize.z.toFixed(1)}, origin at trunk/root junction`);

                // --- FOREST LAYOUT ---
                const treePositions = [];
                // Helper to check for overlapping trees
                const minDistanceSq = 3.5 * 3.5;
                const tryAddPosition = (rawX, rawZ, scale, widthOverride = null) => {
                    const snapped = window.getNearestHexCenter ? window.getNearestHexCenter(rawX, rawZ) : {x: rawX, z: rawZ};
                    const x = snapped.x;
                    const z = snapped.z;
                    
                    // Because trees now snap to discrete hexes, multiple seeds might snap to the same hex.
                    // This distance check effectively enforces max 1 tree per hex center, perfect for board games!
                    for (let i = 0; i < treePositions.length; i++) {
                        const dx = treePositions[i].x - x;
                        const dz = treePositions[i].z - z;
                        if (dx * dx + dz * dz < minDistanceSq) return false;
                    }
                    treePositions.push({ x, z, scale, widthOverride });
                    return true;
                };

                // === TIPI ROLLED TREES — 1-3 random trees tight around the Tipi within 10 feet ===
                const numTipiTrees = 1 + Math.floor(Math.random() * 3);
                for (let i = 0; i < numTipiTrees; i++) {
                    const angle = Math.PI * 0.8 + Math.random() * Math.PI * 1.4;
                    const r = 7.0 + Math.random() * 3.0;
                    tryAddPosition(
                        TIPI_X + Math.cos(angle) * r,
                        TIPI_Z + Math.sin(angle) * r,
                        0.8 + Math.random() * 0.5
                    );
                }

                // === SACRED GROVE — dense forest ring on the protective hills ===
                for (let i = 0; i < 60; i++) {
                    const angle = (i / 60) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
                    const r = 31 + Math.random() * 5;
                    tryAddPosition(
                        Math.cos(angle) * r + (Math.random() - 0.5) * 1.5,
                        Math.sin(angle) * r + (Math.random() - 0.5) * 1.5,
                        0.9 + Math.random() * 0.8
                    );
                }

                for (let i = 0; i < 50; i++) {
                    const angle = (i / 50) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
                    const r = 36 + Math.random() * 9;
                    tryAddPosition(
                        Math.cos(angle) * r + (Math.random() - 0.5) * 2,
                        Math.sin(angle) * r + (Math.random() - 0.5) * 2,
                        1.0 + Math.random() * 0.7
                    );
                }

                // === SENTINEL TREES — a few tall guardians ===
                const sentinelAngles = [0.3, 1.2, 2.5, 3.8, 5.0];
                sentinelAngles.forEach(a => {
                    tryAddPosition(
                        Math.cos(a) * 28 + (Math.random() - 0.5),
                        Math.sin(a) * 28 + (Math.random() - 0.5),
                        1.6 + Math.random() * 0.5,
                        1.2
                    );
                });

                // === OUTER FOREST ===
                for (let i = 0; i < 60; i++) {
                    const angle = (i / 60) * Math.PI * 2 + (Math.random() - 0.4) * 0.2;
                    const r = 45 + Math.random() * 20;
                    tryAddPosition(
                        Math.cos(angle) * r,
                        Math.sin(angle) * r,
                        0.7 + Math.random() * 0.6
                    );
                }

                // === BACKGROUND FOREST ===
                for (let i = 0; i < 50; i++) {
                    const angle = (i / 50) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
                    const r = 40 + Math.random() * 25;
                    tryAddPosition(
                        Math.cos(angle) * r,
                        Math.sin(angle) * r,
                        0.5 + Math.random() * 0.7
                    );
                }
                for (let i = 0; i < 40; i++) {
                    const angle = (i / 40) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
                    const r = 65 + Math.random() * 25;
                    tryAddPosition(
                        Math.cos(angle) * r,
                        Math.sin(angle) * r,
                        0.4 + Math.random() * 0.5
                    );
                }

                const foliageColors = [
                    new THREE.Color(0xFFB7C5), // Cherry blossom pink (light)
                    new THREE.Color(0x7CFC00), // Lawn Green
                    new THREE.Color(0x98FB98), // Bright anime green
                    new THREE.Color(0x87CEFA), // Light blue/teal
                    new THREE.Color(0x32CD32), // Lime green
                    new THREE.Color(0xFF8C00), // Fall: Autumn Orange
                    new THREE.Color(0xDAA520), // Fall: Goldenrod Yellow
                    new THREE.Color(0xFF69B4), // Spring: Deep Blossom Pink
                ];

                // CENTER THE TEMPLATE SO ROTATION REVOLVES AROUND ITS TRUE CENTER
                const treeCenter = origBox.getCenter(new THREE.Vector3());
                template.position.set(-treeCenter.x, 0, -treeCenter.z);
                template.updateMatrixWorld(true);

                // FIND MESHES FOR INSTANCING
                const meshesToInstance = [];
                template.traverse(child => {
                    if (child.isMesh) {
                        meshesToInstance.push(child);
                    }
                });

                if (meshesToInstance.length > 0) {
                    const chunkSize = 40;
                    const chunks = {};
                    treePositions.forEach((pos, globalIdx) => {
                        const cx = Math.floor(pos.x / chunkSize);
                        const cz = Math.floor(pos.z / chunkSize);
                        const key = cx + '_' + cz;
                        if (!chunks[key]) chunks[key] = { positions: [] };
                        chunks[key].positions.push({ ...pos, globalIdx });
                    });

                    const allInstancedMeshes = [];

                    for (const key in chunks) {
                        const chunk = chunks[key];
                        chunk.instancedMeshes = [];

                        meshesToInstance.forEach((mesh) => {
                            let material = Array.isArray(mesh.material) ? mesh.material[0].clone() : mesh.material.clone();
                            material.roughness = 1.0;
                            material.metalness = 0.0;
                            if (material.shininess !== undefined) material.shininess = 0;
                            
                            const matName = material.name ? material.name.toLowerCase() : '';
                            const isLeaf = matName.includes('leaf') || matName.includes('leaves') || matName.includes('foliage');
                            
                            if (isLeaf) {
                                material.color.setHex(0xffffff); 
                                material.alphaTest = 0.5;
                                material.transparent = false;
                                material.depthWrite = true;
                                
                                if (!window._globalTime) window._globalTime = { value: 0 };
                                if (!window._entityTrackerUniform) {
                                    window._entityTrackerUniform = { value: [
                                        new THREE.Vector3(0,-1000,0), new THREE.Vector3(0,-1000,0), 
                                        new THREE.Vector3(0,-1000,0), new THREE.Vector3(0,-1000,0)
                                    ] };
                                }
                                material.onBeforeCompile = (shader) => {
                                    shader.uniforms.uTime = window._globalTime;
                                    shader.uniforms.uEntities = window._entityTrackerUniform;
                                    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;');
                                    let vertMods = `
                                    #include <begin_vertex>
                                    `;
                                    if (isLeaf) {
                                        vertMods += `
                                        float heightFactor = smoothstep(2.0, 6.0, position.y);
                                        float worldX = instanceMatrix[3][0];
                                        float worldZ = instanceMatrix[3][2];
                                        float phase = (worldX * 0.1) + (worldZ * 0.1);
                                        float windStr = 0.16;
                                        transformed.x += sin(uTime * 1.5 + phase) * windStr * heightFactor;
                                        transformed.z += cos(uTime * 1.2 + phase) * windStr * heightFactor;
                                        `;
                                    }
                                    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', vertMods);
                                };
                            }

                            const instancedMesh = new THREE.InstancedMesh(mesh.geometry, material, chunk.positions.length);
                            instancedMesh.castShadow = false;
                            instancedMesh.receiveShadow = false;
                            instancedMesh.frustumCulled = true;
                            instancedMesh.layers.set(3); // Hide from minimap PiP
                            
                            chunk.instancedMeshes.push({ instancedMesh, isLeaf });
                            allInstancedMeshes.push({ instancedMesh, isLeaf });
                            scene.add(instancedMesh);
                        });
                        
                        // Link the siblings together so raycasting can hide both trunk and leaves safely
                        chunk.instancedMeshes.forEach(m => {
                            m.instancedMesh.userData.chunkSiblings = chunk.instancedMeshes;
                        });
                    }

                    const matrix = new THREE.Matrix4();
                    const position = new THREE.Vector3();
                    const rotation = new THREE.Euler();
                    const quaternion = new THREE.Quaternion();
                    const sc = new THREE.Vector3();

                    let globalProcessedCount = 0;
                    
                    for (const key in chunks) {
                        const chunk = chunks[key];
                        for (let idx = 0; idx < chunk.positions.length; idx++) {
                            const pos = chunk.positions[idx];
                            
                            globalProcessedCount++;
                            if (globalProcessedCount % 50 === 0) {
                                this.updateLoadingScreen(`Processing... (${globalProcessedCount}/${treePositions.length})`);
                                await waitFrame();
                            }
                            
                            const baseScale = pos.scale;
                            const targetH = (8 + Math.random() * 8) * baseScale;
                            const sf = targetH / Math.max(origSize.y, 0.1);
                            const widthMult = pos.widthOverride || (0.8 + Math.random() * 0.5);

                            sc.set(sf * widthMult, sf, sf * widthMult);
                            const groundY = getGroundY(pos.x, pos.z);
                            position.set(pos.x, groundY, pos.z);
                            rotation.set(0, Math.random() * Math.PI * 2, 0);
                            quaternion.setFromEuler(rotation);

                            matrix.compose(position, quaternion, sc);

                            const tintColor = foliageColors[Math.floor(Math.random() * foliageColors.length)];

                            chunk.instancedMeshes.forEach(({ instancedMesh, isLeaf }) => {
                                instancedMesh.setMatrixAt(idx, matrix);
                                if (isLeaf) instancedMesh.setColorAt(idx, tintColor);
                            });

                            const dirtGroup = new THREE.Group();
                            const sd = 0.5;
                            const hC = groundY;
                            const hL = getGroundY(pos.x - sd, pos.z);
                            const hR = getGroundY(pos.x + sd, pos.z);
                            const hF = getGroundY(pos.x, pos.z - sd);
                            const hB = getGroundY(pos.x, pos.z + sd);
                            const avgY = (hC + hL + hR + hF + hB) / 5;
                            dirtGroup.position.set(pos.x, avgY + 0.03, pos.z);

                            const tangentX = new THREE.Vector3(sd * 2, hR - hL, 0);
                            const tangentZ = new THREE.Vector3(0, hB - hF, sd * 2);
                            const normal = new THREE.Vector3().crossVectors(tangentX, tangentZ).normalize();
                            dirtGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

                            const dirtRadius = baseScale * 0.8;
                            const dirtGeo = new THREE.CircleGeometry(dirtRadius, 16);
                            dirtGeo.rotateX(-Math.PI / 2);
                            const dirtMat = new THREE.MeshBasicMaterial({
                                color: 0x180b02,
                                side: THREE.DoubleSide,
                                depthWrite: false,
                                polygonOffset: true,
                                polygonOffsetFactor: -2,
                                polygonOffsetUnits: -2
                            });
                            const dirtMesh = new THREE.Mesh(dirtGeo, dirtMat);
                            dirtMesh.renderOrder = 1;
                            dirtGroup.add(dirtMesh);
                            scene.add(dirtGroup);

                            allTrees.push({
                                position: new THREE.Vector3(pos.x, groundY, pos.z),
                                isInstanced: true,
                                index: idx,
                                chunkSiblings: chunk.instancedMeshes
                            });
                            vegData.trees.push({ x: pos.x, z: pos.z });
                        }
                    }

                    allInstancedMeshes.forEach(({ instancedMesh, isLeaf }) => {
                        instancedMesh.instanceMatrix.needsUpdate = true;
                        if (isLeaf) instancedMesh.instanceColor.needsUpdate = true;
                        instancedMesh.computeBoundingSphere();
                    });
                    
                    window._treeInstancedMeshes = allInstancedMeshes;

                    console.log(`[Forest] Planted ${treePositions.length} INSTANCED trees in ${Object.keys(chunks).length} spatial chunks.`);
                }


                // BUSHES — scattered near trees, with wind sway (INSIDE forest callback so vegData.trees is populated)
                const bushLoader = new GLTFLoader();
                bushLoader.load('Assets/bush.glb', async (gltf) => {
                    const template = gltf.scene;

                    // Normalize bush size
                    const box = new THREE.Box3().setFromObject(template);
                    const size = box.getSize(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z);
                    const targetSize = 1.92;
                    template.scale.multiplyScalar(targetSize / maxDim);

                    // Find densest tree clusters for bush placement
                    // Score each tree by how many neighbors it has within 15 units
                    const treeDensity = vegData.trees.map((t, idx) => {
                        let neighbors = 0;
                        for (const other of vegData.trees) {
                            const dx = t.x - other.x, dz = t.z - other.z;
                            if (dx * dx + dz * dz < 225) neighbors++; // within 15 units
                        }
                        return { ...t, density: neighbors, idx };
                    });

                    // Pre-create 4 shared bush materials to prevent 190 draw calls due to unique clones
                    let baseMat = new THREE.MeshStandardMaterial({ roughness: 1.0 });
                    template.traverse(child => { if (child.isMesh && child.material) baseMat = child.material; });
                    const sharedBushMaterials = foliageColors.map(color => {
                        const mat = baseMat.clone();
                        mat.color.set(color);
                        mat.roughness = 1.0;
                        mat.metalness = 0.0;
                        // FIX: Prevent alpha overdraw on bushes
                        mat.transparent = false;
                        mat.alphaTest = 0.5;
                        return mat;
                    });

                    // Sort by density (most dense first) and pick top spots
                    treeDensity.sort((a, b) => b.density - a.density);
                    const clusterCount = Math.min(5, Math.max(3, Math.floor(vegData.trees.length * 0.1))); // Hard throttled to 5 MAX to save FPS
                    const clusterSpots = treeDensity.slice(0, clusterCount);
                    let totalBushes = 0;

                    for (let cIdx = 0; cIdx < clusterSpots.length; cIdx++) {
                        if (cIdx > 0 && cIdx % 8 === 0) {
                            this.updateLoadingScreen(`Processing... (${cIdx}/${clusterSpots.length})`);
                            await waitFrame();
                        }
                        
                        const spot = clusterSpots[cIdx];
                        // 1-2 bushes per cluster to preserve FPS
                        const bushesInCluster = 1 + Math.floor(Math.random() * 2);
                        // Place cluster center right at the tree base
                        const cx = spot.x + (Math.random() - 0.5) * 2;
                        const cz = spot.z + (Math.random() - 0.5) * 2;

                        for (let b = 0; b < bushesInCluster; b++) {
                            const bush = template.clone();

                            // Use shared materials instead of unique clones
                            const matIdx = Math.floor(Math.random() * sharedBushMaterials.length);
                            bush.traverse(child => {
                                if (child.isMesh) {
                                    child.material = sharedBushMaterials[matIdx];
                                    child.castShadow = false;
                                    child.receiveShadow = false;
                                }
                            });

                            // Tight placement — bushes touching each other (0.3-0.8 unit spread)
                            const spreadAngle = Math.random() * Math.PI * 2;
                            const spreadDist = 0.3 + Math.random() * 0.5;
                            const bx = cx + Math.cos(spreadAngle) * spreadDist;
                            const bz = cz + Math.sin(spreadAngle) * spreadDist;
                            const by = getGroundY(bx, bz);

                            bush.position.set(bx, by, bz);
                            bush.rotation.y = Math.random() * Math.PI * 2;

                            // Scale variation — center bush largest
                            const base = 0.7 + Math.random() * 0.5;
                            const s = b === 0 ? base * 1.3 : base;
                            bush.scale.multiplyScalar(s);

                            // Wind sway
                            bush.userData.baseRotX = 0;
                            bush.userData.baseRotZ = 0;
                            bush.userData.windPhase = Math.random() * Math.PI * 2;
                            bush.userData.windAmp = 0.015 + Math.random() * 0.012;
                            swayTrees.push(bush);
                            allTrees.push(bush);
                            
                            // PIP RENDER ARCHITECTURE FIX: Assign dynamic trees to Layer 3 for zero-cost GPU culling
                            bush.traverse(child => { child.layers.set(3); });

                            scene.add(bush);
                            totalBushes++;
                        }
                    }

                    console.log(`[Forest] Planted ${totalBushes} bushes in ${clusterCount} clusters at densest tree areas`);
                    
                    // Removed wildlife
                    resolve();
                });
            }, undefined, reject);
        });

        this.updateLoadingScreen("Processing...");
            await waitFrame();

            // Removed wildlife instantiations




            // =============================================
            // CAMPFIRE — glowing red-hot fire inside tipi
            // =============================================
            const fireY = window._tipiPlatformY;

            // Fire pit — thin ring of stones
            const pitGeo = new THREE.TorusGeometry(0.5, 0.04, 8, 24); // Shrunk tube radius from 0.1 to 0.04
            const pitMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1.0 });
            const pitMesh = new THREE.Mesh(pitGeo, pitMat);
            pitMesh.position.set(TIPI_X, fireY + 0.02, TIPI_Z); // Nestled low to the ground
            pitMesh.rotation.x = -Math.PI / 2;
            scene.add(pitMesh);

            // Ember bed — larger glowing bed
            const emberGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16);
            const emberMat = new THREE.MeshStandardMaterial({
                color: 0xff2200,
                emissive: 0xff1100,
                emissiveIntensity: 0.8,
                roughness: 0.8
            });
            const emberMesh = new THREE.Mesh(emberGeo, emberMat);
            emberMesh.position.set(TIPI_X, fireY + 0.05, TIPI_Z);
            scene.add(emberMesh);

            // Generate procedural soft particle texture for flames/sparks
            const pCanvas = document.createElement('canvas');
            pCanvas.width = 64; pCanvas.height = 64;
            const pCtx = pCanvas.getContext('2d');
            const pGrad = pCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
            // Tight hot core, massive soft translucent aura to create the "flare" overlap effect
            pGrad.addColorStop(0, 'rgba(255,255,255,1)');
            pGrad.addColorStop(0.1, 'rgba(255,200,100,0.8)');
            pGrad.addColorStop(0.3, 'rgba(255,50,0,0.4)');
            pGrad.addColorStop(1, 'rgba(0,0,0,0)');
            pCtx.fillStyle = pGrad;
            pCtx.fillRect(0, 0, 64, 64);
            const particleTex = new THREE.CanvasTexture(pCanvas);

            // Flame Sprite Particles
            const particleCount = 20; // Fewer particles to preserve FPS
            const fireGeo = new THREE.BufferGeometry();
            const firePos = new Float32Array(particleCount * 3);
            const firePhases = new Float32Array(particleCount);

            for (let i = 0; i < particleCount; i++) {
                // Tighter horizontal spread, EXTREMELY low starting height (hidden in stones)
                firePos[i * 3] = TIPI_X + (Math.random() - 0.5) * 0.15;
                firePos[i * 3 + 1] = fireY + Math.random() * 0.3;
                firePos[i * 3 + 2] = TIPI_Z + (Math.random() - 0.5) * 0.15;
                firePhases[i] = Math.random() * Math.PI * 2;
            }

            fireGeo.setAttribute('position', new THREE.BufferAttribute(firePos, 3));
            fireGeo.setAttribute('phase', new THREE.BufferAttribute(firePhases, 1));

            const fireMat = new THREE.PointsMaterial({
                map: particleTex,
                size: 1.2, // LARGE optical flare size so they overlap and don't look like distinct balls
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                color: 0xffddaa
            });

            const flameMesh = new THREE.Points(fireGeo, fireMat);
            scene.add(flameMesh);

            // Pretty wispy smoke texture with cloud-like puffs
            const sCanvas = document.createElement('canvas');
            sCanvas.width = 128; sCanvas.height = 128;
            const sCtx = sCanvas.getContext('2d');
            const sGrad = sCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
            sGrad.addColorStop(0, 'rgba(210, 215, 225, 0.6)');
            sGrad.addColorStop(0.5, 'rgba(190, 190, 200, 0.3)');
            sGrad.addColorStop(1, 'rgba(150, 150, 160, 0)');
            sCtx.fillStyle = sGrad;
            sCtx.fillRect(0, 0, 128, 128);

            // Add puffy overlapping shapes to break the perfect sphere
            sCtx.fillStyle = 'rgba(220, 220, 230, 0.4)';
            sCtx.beginPath(); sCtx.arc(45, 55, 30, 0, Math.PI*2); sCtx.fill();
            sCtx.beginPath(); sCtx.arc(75, 45, 25, 0, Math.PI*2); sCtx.fill();
            sCtx.beginPath(); sCtx.arc(55, 75, 35, 0, Math.PI*2); sCtx.fill();
            sCtx.beginPath(); sCtx.arc(85, 75, 20, 0, Math.PI*2); sCtx.fill();

            const smokeTex = new THREE.CanvasTexture(sCanvas);

            const smokeCount = 120; // Vastly increased count as requested
            const smokeGeo = new THREE.BufferGeometry();
            const smokePos = new Float32Array(smokeCount * 3);
            const smokePhases = new Float32Array(smokeCount);

            for (let i = 0; i < smokeCount; i++) {
                smokePos[i * 3] = TIPI_X + (Math.random() - 0.5) * 0.3;
                smokePos[i * 3 + 1] = fireY + 3.8 + Math.random() * 1.5; // Start near the top opening
                smokePos[i * 3 + 2] = TIPI_Z + (Math.random() - 0.5) * 0.3;
                smokePhases[i] = Math.random() * Math.PI * 2;
            }
            smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
            smokeGeo.setAttribute('phase', new THREE.BufferAttribute(smokePhases, 1));

            // GPU Accelerated Volumetric Smoke Shader
            // Handles size expansion and opacity fading natively on the GPU based on altitude
            const smokeMat = new THREE.ShaderMaterial({
                uniforms: {
                    map: { value: smokeTex },
                    baseY: { value: fireY + 3.8 } // starting height out of the chimney
                },
                vertexShader: [
                    "attribute float phase;",
                    "varying float vAlpha;",
                    "uniform float baseY;",
                    "void main() {",
                    "    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
                    "    float h = clamp((position.y - baseY) / 6.0, 0.0, 1.0);",
                    "    gl_PointSize = (40.0 + h * 260.0) * (1.0 / -mvPosition.z);",
                    "    gl_Position = projectionMatrix * mvPosition;",
                    "    vAlpha = 1.0 - pow(h, 1.5);",
                    "}"
                ].join('\n'),
                fragmentShader: [
                    "uniform sampler2D map;",
                    "varying float vAlpha;",
                    "void main() {",
                    "    vec4 texColor = texture2D(map, gl_PointCoord);",
                    "    gl_FragColor = vec4(texColor.rgb, texColor.a * vAlpha * 0.85);",
                    "}"
                ].join('\n'),
                transparent: true,
                depthWrite: false,
                blending: THREE.NormalBlending
            });
            const smokeMesh = new THREE.Points(smokeGeo, smokeMat);
            scene.add(smokeMesh);

            // FPS FIX: Disabled fire point lights to prevent GPU gridlock on 8M vertices
            // const fireLight = new THREE.PointLight(0xff3300, 2.5, 9, 2);
            // fireLight.position.set(TIPI_X, fireY + 0.5, TIPI_Z);
            // scene.add(fireLight);

            // Secondary warm fill
            // const fireFill = new THREE.PointLight(0xff8844, 0.8, 6, 2);
            // fireFill.position.set(TIPI_X, fireY + 0.3, TIPI_Z);
            // scene.add(fireFill);

            // Store fire refs for animation
            window._fireData = { flameMesh, smokeMesh, fireLight: null, fireFill: null, emberMesh, baseY: fireY };

            console.log('[Tipi] Campfire and smoke placed inside tipi');

            // ==========================================
            // BRINGS HAPPINESS GIRL (Quest Target)
            // ==========================================
            const bhgLoader = new OBJLoader();
            bhgLoader.load('Assets/tipi.bringshappiness.obj', async (obj) => {
                const bhgModel = obj;

                // Scale to tipi height
                const box = new THREE.Box3().setFromObject(bhgModel);
                const size = box.getSize(new THREE.Vector3());
                const targetH = 6.0; // Tipi height
                const sf = targetH / Math.max(size.y, 0.1);
                bhgModel.scale.set(sf, sf, sf);

                // Offset the model so its lowest point sits precisely on the ground (y=0 in local space)
                const scaledBox = new THREE.Box3().setFromObject(bhgModel);
                bhgModel.position.y = -scaledBox.min.y;

                const tipiMat = new THREE.MeshStandardMaterial({ color: 0xeaddcf, roughness: 0.9, metalness: 0.1 });
                bhgModel.traverse(child => {
                    if (child.isMesh) {
                        child.material = tipiMat;
                        child.material.flatShading = false;
                        child.material.needsUpdate = true;
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.geometry) {
                            try {
                                const merged = window.BufferGeometryUtils.mergeVertices(child.geometry, 0.001);
                                merged.computeVertexNormals();
                                child.geometry = merged;
                            } catch(e) {
                                child.geometry.computeVertexNormals();
                            }
                        }
                    }
                });

                // Position Brings Happiness Girl inside the Tipi
                const bhgX = 12;
                const bhgZ = 12;
                const bhgY = getGroundY(bhgX, bhgZ);
                const bhgHex = window.getNearestHexCenter ? window.getNearestHexCenter(bhgX, bhgZ) : {x: bhgX, z: bhgZ};

                scaledBox.setFromObject(bhgModel);
                const bhgCenter = scaledBox.getCenter(new THREE.Vector3());
                bhgModel.position.set(-bhgCenter.x, -scaledBox.min.y, -bhgCenter.z); // Center model in local space
                
                const bhgGroup = new THREE.Group();
                bhgGroup.add(bhgModel);
                bhgGroup.position.set(bhgHex.x, bhgY, bhgHex.z); 
                bhgGroup.rotation.y = Math.PI; // Rotated 180 degrees to face the player approach (-X / West)
                
                // Add smaller heavenly glow inside Tipi
                const tipiGlow = new THREE.PointLight(0xffe0a0, 1.5, 12);
                tipiGlow.position.set(0, 1.5, 0); // Inside center
                bhgGroup.add(tipiGlow);
                
                // Make interactive for clicking
                bhgGroup.userData.isBuilding = true;
                window._interactiveBuildings = window._interactiveBuildings || [];
                window._interactiveBuildings.push(bhgGroup);

                // --- NEW: Sacred Circle Platform directly under the BHG Tipi ---
                const platRadius2 = 4.7; // 75% of hexRadius 6.27
                
                const platGeo2 = new THREE.CylinderGeometry(platRadius2, platRadius2 + 0.15, 0.22, 32);
                const platMat2 = new THREE.MeshStandardMaterial({ color: 0x1a2e1a, roughness: 0.95, metalness: 0.05 });
                const platMesh2 = new THREE.Mesh(platGeo2, platMat2);
                platMesh2.position.set(bhgHex.x, bhgY + 0.05, bhgHex.z); 
                platMesh2.castShadow = false;
                platMesh2.receiveShadow = true;
                platMesh2.layers.enable(1); 
                platMesh2.userData.isBuilding = true;
                platMesh2.userData.buildingRoot = bhgGroup;
                window._interactiveBuildings.push(platMesh2);
                scene.add(platMesh2);

                // --- NEW: Third Tipi ---
                const tipi3X = -12;
                const tipi3Z = 12;
                const tipi3Y = getGroundY(tipi3X, tipi3Z);
                const tipi3Hex = window.getNearestHexCenter ? window.getNearestHexCenter(tipi3X, tipi3Z) : {x: tipi3X, z: tipi3Z};

                const tipi3Group = bhgGroup.clone();
                tipi3Group.position.set(tipi3Hex.x, tipi3Y, tipi3Hex.z);
                tipi3Group.rotation.y = 0; // Rotate to face East / center
                
                tipi3Group.userData.isBuilding = true;
                window._interactiveBuildings.push(tipi3Group);

                const platMesh3 = new THREE.Mesh(platGeo2, platMat2);
                platMesh3.position.set(tipi3Hex.x, tipi3Y + 0.05, tipi3Hex.z);
                platMesh3.castShadow = false;
                platMesh3.receiveShadow = true;
                platMesh3.layers.enable(1); 
                platMesh3.userData.isBuilding = true;
                platMesh3.userData.buildingRoot = tipi3Group;
                window._interactiveBuildings.push(platMesh3);

                scene.add(tipi3Group);
                scene.add(platMesh3);
                console.log(`[Tipi] Placed Tipi 3 at (${tipi3X}, ${tipi3Z})`);
                
                if (window.flattenTerrainAt) {
                    await window.flattenTerrainAt(bhgHex.x, bhgHex.z, 14.0, bhgY);
                    await window.flattenTerrainAt(tipi3Hex.x, tipi3Hex.z, 14.0, tipi3Y);
                }

                // --- CINEMATIC GODRAY 2 ---
                const haloGeo2 = new THREE.CylinderGeometry(0.5, 4.0, 20.0, 16, 1, true);
                const haloMat2 = new THREE.MeshBasicMaterial({
                    color: 0xffddaa, transparent: true, opacity: 0.15,
                    blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false
                });
                const haloMesh2 = new THREE.Mesh(haloGeo2, haloMat2);
                haloMesh2.renderOrder = 999; // Draws last to prevent turning tree alphas black
                haloMesh2.position.set(0, 10.0, 0); // Relative to bhgGroup model base
                window._tipiGodray2 = haloMesh2;
                bhgGroup.add(haloMesh2);

                // Attach PIP marker (Building: 12ft diameter = ~1.8m radius)
                const bhgTipiMarker = window.createPIPMarker(0x2e8b57, 1.6, 2.0);
                bhgGroup.add(bhgTipiMarker);

                // Redundant platform logic removed per USER request to fix "brown small circle error"


                // --- FLOATING QUEST MARKER 2 ---
                const questGroup2 = createQuestBalloon('2', 'quest_2_find_her');
                const markerY2 = bhgY + 3.5; // Lowered from 7.5 to float directly above the entrance
                // Offset quest marker to be squarely in front of the tipi entrance
                // bhgGroup rotated Math.PI (180deg). Thus +Z local is -Z global.
                const markerZ2 = bhgZ - 4.0;
                questGroup2.position.set(bhgX, markerY2, markerZ2);
                questGroup2.userData.baseY = markerY2;
                
                // Construct Tether string safely locked onto the balloon knot swinging down to her hand
                // USER REQUEST: 70% thinner (0.006 -> 0.0018) and 70% more transparent (0.8 -> 0.24)
                const stringGeo2 = new THREE.CylinderGeometry(0.0018, 0.0018, 3.2, 4);
                stringGeo2.translate(0, -1.6, 0); 
                const stringMat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24 });
                const stringMesh2 = new THREE.Mesh(stringGeo2, stringMat2);
                stringMesh2.position.set(0, -0.69, 0); 
                // Pitch it backwards along the Z-axis to cleanly span the 1.5m gap to her hand!
                stringMesh2.rotation.set(0.40, 0, 0);
                questGroup2.add(stringMesh2);
                
                questGroup2.visible = false; // Hidden until Quest 1 Pops!
                scene.add(questGroup2);
                window._questMarker2 = questGroup2;
                
                // Add Gathering Axe
                // Axe will be built and placed dynamically below, directly into the bhgGroup
                // so it can effortlessly lean against the tipi structure next to the girl.an effortlessly lean against the tipi structure next to the girl.

                // Load the actual girl model and place her at the Tipi entrance
                const gltfLoader = new GLTFLoader();
                gltfLoader.load('Assets/animated.bringshappiness.glb', (gltf) => {
                    const girlModel = gltf.scene;

                    // --- Avatar Scale Fix ---
                    // Hardcode scale instead of using Box3, as rigged armature bounds
                    // create massive invisible footprints that cause microscopic shrinkage.
                    window.targetGirlH = 1.3;
                    // User Request: Restore to the 100% increased size!
                    girlModel.scale.set(2.28, 2.86, 2.28); 
                    
                    const halo = createNPCHalo(girlModel);
                    girlModel.add(halo);
                    
                    if (gltf.animations && gltf.animations.length > 0) {
                        window.bhgMixer = new THREE.AnimationMixer(girlModel);
                        
                        // Default Blender Export places static Rest Pose at [0] inside NlaTrack strips.
                        window._bhgIdleClip = gltf.animations.find(a => a.name.toLowerCase().includes('idle')) || (gltf.animations.length > 1 ? gltf.animations[1] : gltf.animations[0]);
                        window._bhgWaveClip = gltf.animations.find(a => a.name.toLowerCase().includes('wave')) || (gltf.animations.length > 2 ? gltf.animations[2] : null);
                        window._bhgWalkClip = gltf.animations.find(a => a.name.toLowerCase().includes('walk')) || (gltf.animations.length > 3 ? gltf.animations[3] : null);
                        
                        window._bhgIdleAction = window.bhgMixer.clipAction(window._bhgIdleClip);
                        window._bhgIdleAction.play();
                        
                        if (window._bhgWaveClip) {
                            window._bhgWaveAction = window.bhgMixer.clipAction(window._bhgWaveClip);
                            window._bhgWaveAction.setLoop(THREE.LoopOnce, 1);
                            window._bhgWaveAction.clampWhenFinished = true;
                        }
                        if (window._bhgWalkClip) {
                            window._bhgWalkAction = window.bhgMixer.clipAction(window._bhgWalkClip);
                        }
                    }

                    // Position her exactly at the Tipi entrance (Local coords relative to bhgGroup)
                    // CRITICAL FIX: Because bhgGroup is rotated Math.PI, local +Z means global -Z
                    // This terrain slopes heavily. We MUST query the actual ground height at her specific foot-placement!
                    const globalZ = bhgZ - 5.5; // (since local +Z faces global -Z due to Math.PI rotation on bhgGroup)
                    const trueGroundY = typeof getGroundY !== 'undefined' ? getGroundY(bhgX, globalZ) : bhgY;
                    const localYOffset = trueGroundY - bhgY; // Difference from the Tipi's base zero-plane

                    // Fix: Set offset exactly to 0.0 so the animated girl's feet are perfectly anchored to the ground
                    girlModel.position.set(0, localYOffset + 0.0, 5.5);

                    // Rotate her directly to the right 90 degrees so she faces True Forward (+Z)
                    girlModel.rotation.y = -Math.PI / 2;

                    girlModel.traverse(child => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            
                            if (child.material) {
                                child.material.flatShading = false;
                                child.material.needsUpdate = true;
                            }
                        }
                    });

                    // Attach PIP Marker (NPC: 6ft diameter = ~0.9m radius), with facing arrow = true
                    const bhgSelfMarker = window.createPIPMarker(0x2e8b57, 0.8 / 1.14, 0.9 / 1.14, true);
                    
                    // Removed counter-rotation since avatar model is now facing the correct direction
                    girlModel.add(bhgSelfMarker);

                    // Attach styled golden circle under NPC
                    const bhgCircle = new THREE.Group();
                    bhgCircle.position.y = 0.02;
                    // Match the player's circle perfectly
                    bhgCircle.scale.set(1.1046, 1.1085, 1.1046);

                    const pRadius = 0.375;
                    const bhgBaseGeo = new THREE.CylinderGeometry(pRadius, pRadius, 0.02, 32);
                    const bhgBaseMat = new THREE.MeshStandardMaterial({ color: 0xFFD700, roughness: 0.4, metalness: 0.8 });
                    const bhgBaseMesh = new THREE.Mesh(bhgBaseGeo, bhgBaseMat);
                    bhgBaseMesh.position.y = 0.01;
                    bhgBaseMesh.receiveShadow = true;
                    bhgCircle.add(bhgBaseMesh);

                    const bhgBorderGeo = new THREE.TorusGeometry(pRadius, 0.02, 16, 48);
                    const bhgBorderMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1 });
                    const bhgBorderMesh = new THREE.Mesh(bhgBorderGeo, bhgBorderMat);
                    bhgBorderMesh.rotation.x = Math.PI / 2;
                    bhgBorderMesh.position.y = 0.01;
                    bhgCircle.add(bhgBorderMesh);

                    const bhgArrowGeo = new THREE.ConeGeometry(0.08, 0.2, 32);
                    const bhgArrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1 });
                    const bhgArrowMesh = new THREE.Mesh(bhgArrowGeo, bhgArrowMat);
                    bhgArrowMesh.rotation.set(Math.PI / 2, 0, 0); 
                    bhgArrowMesh.scale.set(1.0, 1.0, 0.25); // Flattened vertically
                    bhgArrowMesh.position.set(0, 0.01, pRadius + 0.1); 
                    bhgCircle.add(bhgArrowMesh);

                    bhgGroup.add(bhgCircle);

                    bhgGroup.add(girlModel);
                    window._bhgCharacterMesh = girlModel; // Save a reference for the camera to track
                    
                    // --- Build & Place 3D Axe ---
                    gltfLoader.load('Assets/axe.glb', (axeGltf) => {
                        const axe = axeGltf.scene;
                        // Determine scale (aiming for ~2ft relative to 6.0m tipi)
                        const axeBox = new THREE.Box3().setFromObject(axe);
                        const axeSize = axeBox.getSize(new THREE.Vector3());
                        const asf = 0.8 / Math.max(axeSize.y, 0.1); // ~0.8m total length
                        const customAsf = asf * 1.4; // Magnify visibility inside the dollhouse feed
                        axe.scale.set(customAsf, customAsf, customAsf);
                        
                        // Float outside the Tipi entrance externally
                        axe.position.set(-1.0, 1.2, -1.0);
                        axe.rotation.set(0.2, 0.5, 0.4);
                        
                        axe.traverse(child => {
                            if (child.isMesh) {
                                child.castShadow = true;
                                child.receiveShadow = true;
                                // Add slight outline/highlight bloom setup
                                child.userData.isInteractable = true;
                            }
                        });
                        
                        bhgGroup.add(axe);
                        window._worldAxeMesh = axe;
                    }, undefined, (err) => {
                        // Fallback: If axe model fails to load, create a primitive stick/rock axe
                        console.warn('Failed to load axe.glb, building primitive axe fallback.', err);
                        const axeGrp = new THREE.Group();
                        
                        const handleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8);
                        const handleMat = new THREE.MeshStandardMaterial({color: 0x5c4033, roughness: 0.9});
                        const handle = new THREE.Mesh(handleGeo, handleMat);
                        handle.position.y = 0.4;
                        handle.castShadow = true;
                        
                        const headGeo = new THREE.BoxGeometry(0.2, 0.15, 0.05);
                        const headMat = new THREE.MeshStandardMaterial({color: 0x555555, roughness: 0.7});
                        const head = new THREE.Mesh(headGeo, headMat);
                        head.position.set(0.08, 0.7, 0);
                        head.rotation.z = -0.2;
                        head.castShadow = true;
                        
                        axeGrp.add(handle);
                        axeGrp.add(head);
                        
                        axeGrp.position.set(1.5, 0.3, 4.4);
                        axeGrp.rotation.set(0.1, -0.4, 0.1);
                        bhgGroup.add(axeGrp);
                        window._worldAxeMesh = axeGrp;
                    });
                    
                    window.bhgSystem = {
                        mesh: girlModel,
                        mixer: window.bhgMixer,
                        hasWaved: false,
                        aiState: null,
                        stateTimer: 0,
                        spawnPoint: null,
                        walkTarget: new THREE.Vector3(),
                        _gazeQuat: new THREE.Quaternion(),
                        _gazeQuat2: new THREE.Quaternion(),
                        _gazeTarget: new THREE.Vector3(),
                        currentBaseAction: window._bhgIdleAction,
                        
                        update(delta) {
                            if (this.mixer) this.mixer.update(delta);
                            
                            const playerPos = window.camera ? window.camera.position : null;
                            
                            if (!this.aiState) {
                                this.aiState = 'idle';
                                this.stateTimer = Math.random() * 5 + 3;
                                const bhgWorldPos = new THREE.Vector3();
                                window._bhgCharacterMesh.getWorldPosition(bhgWorldPos);
                                this.spawnPoint = bhgWorldPos.clone();
                                this.hasWaved = false;
                            }
                            
                            const bhgPos = new THREE.Vector3();
                            window._bhgCharacterMesh.getWorldPosition(bhgPos);
                            const playerDist = playerPos ? playerPos.distanceTo(bhgPos) : Infinity;
                            const isPlayerNear = playerDist <= 75.0; // 3 tiles (3 * 25m)

                            // High Priority: Player Proximity Waving
                            if (isPlayerNear && playerPos) {
                                if (this.aiState !== 'waving') {
                                    this.aiState = 'waving';
                                    this.hasWaved = true;
                                    if (window._bhgWaveAction) {
                                        window._bhgWaveAction.reset().play();
                                        if (this.currentBaseAction) window._bhgWaveAction.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                        this.currentBaseAction = window._bhgWaveAction;
                                    }
                                }
                                
                                // Smoothly track player with gaze
                                this._gazeQuat.copy(window._bhgCharacterMesh.quaternion);
                                this._gazeTarget.copy(playerPos);
                                this._gazeTarget.y = window._bhgCharacterMesh.position.y;
                                window._bhgCharacterMesh.lookAt(this._gazeTarget);
                                this._gazeQuat2.copy(window._bhgCharacterMesh.quaternion);
                                window._bhgCharacterMesh.quaternion.copy(this._gazeQuat);
                                window._bhgCharacterMesh.quaternion.slerp(this._gazeQuat2, 4.0 * delta);
                                
                                return; // Halt other AI logic
                            } else if (this.aiState === 'waving' && playerDist > 80.0) {
                                this.aiState = 'idle';
                                this.stateTimer = 2.0;
                                if (window._bhgIdleAction) {
                                    window._bhgIdleAction.reset().play();
                                    if (this.currentBaseAction) window._bhgIdleAction.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                    this.currentBaseAction = window._bhgIdleAction;
                                }
                            }

                            // Ambient AI: Idle and Random Walk
                            if (this.aiState === 'idle') {
                                this.stateTimer -= delta;
                                if (this.stateTimer <= 0) {
                                    this.aiState = 'walking';
                                    // Pick random destination within 15 meters of spawn
                                    const angle = Math.random() * Math.PI * 2;
                                    const rad = Math.random() * 15;
                                    this.walkTarget.set(this.spawnPoint.x + Math.cos(angle)*rad, 0, this.spawnPoint.z + Math.sin(angle)*rad);
                                    
                                    if (window._bhgWalkAction) {
                                        window._bhgWalkAction.reset().play();
                                        if (this.currentBaseAction) window._bhgWalkAction.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                        this.currentBaseAction = window._bhgWalkAction;
                                    }
                                }
                            } else if (this.aiState === 'walking') {
                                // To calculate distance, we need the parent group because local mesh positions translate relative to parent
                                const dx = this.walkTarget.x - window._bhgGroup.position.x;
                                const dz = this.walkTarget.z - window._bhgGroup.position.z;
                                const distToTarget = Math.sqrt(dx*dx + dz*dz);
                                
                                if (distToTarget < 1.0) {
                                    this.aiState = 'idle';
                                    this.stateTimer = Math.random() * 8 + 4;
                                    if (window._bhgIdleAction) {
                                        window._bhgIdleAction.reset().play();
                                        if (this.currentBaseAction) window._bhgIdleAction.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                        this.currentBaseAction = window._bhgIdleAction;
                                    }
                                } else {
                                    // Turn toward destination (rotate entire group so mesh doesn't detach)
                                    this._gazeQuat.copy(window._bhgGroup.quaternion);
                                    this._gazeTarget.copy(this.walkTarget);
                                    this._gazeTarget.y = window._bhgGroup.position.y;
                                    window._bhgGroup.lookAt(this._gazeTarget);
                                    this._gazeQuat2.copy(window._bhgGroup.quaternion);
                                    window._bhgGroup.quaternion.copy(this._gazeQuat);
                                    window._bhgGroup.quaternion.slerp(this._gazeQuat2, 4.0 * delta);
                                    
                                    // Translate forward
                                    window._bhgGroup.translateZ(1.5 * delta); // Normal walking speed
                                    
                                    // Ground Snapping
                                    if (typeof getGroundY !== 'undefined') {
                                        window._bhgGroup.position.y = getGroundY(window._bhgGroup.position.x, window._bhgGroup.position.z);
                                    }
                                }
                            }
                        }
                    };
                    
                    if (window.fuzzyBrain) {
                        window.fuzzyBrain.linkNPC('bringshappinessgirl', window._bhgCharacterMesh, window.bhgSystem);
                    }
                });
                
                scene.add(bhgGroup);
                window._bhgGroup = bhgGroup;
                window._bhgBalloon = questGroup2;
                
                // === RABBIT SYSTEM ===
                if (typeof RabbitSystem !== 'undefined') {
                    window.rabbitSystem = new RabbitSystem(scene, camera, window._getGroundY);
                    if (window.fuzzyBrain) {
                        window.fuzzyBrain.linkCreatureSystem('rabbits', window.rabbitSystem);
                    }
                }

                console.log(`[Quest] Placed Brings Happiness Girl at (${bhgX}, ${bhgZ})`);
                
                // Avatar loading removed. EngineMain.js exclusively handles it to prevent duplication.
            });


        }
}

        // --- NO INPUT (Clean Slate) ---
        // --- INPUT & RESIZE HANDLERS ---



window.EnvironmentBuilder = class EnvironmentBuilder {
    constructor(scene) {
        this.scene = scene;
    }

    setupLighting() {
        // Hemisphere Light — warm sky, cool shadow
        const hemiLight = new THREE.HemisphereLight(0xfff4e6, 0x3a5f3a, 0.8);
        this.scene.add(hemiLight);

        // Directional Light (Sun) — warm golden hour
        const sunLight = new THREE.DirectionalLight(0xffe0a0, 2.0);
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
            if (window._hexGridMesh) return window._hexGridMesh;
            
            const RADIUS = 25; // 25 meter hexagons
            const GAP = 0.5;
            const size = RADIUS - GAP; // Leave a 1-meter visible trench between tiles
            
            // Neumorphic Hexagon geometry with bevels
            const hexShape = new THREE.Shape();
            for (let i = 0; i < 6; i++) {
                const a = i * Math.PI * 2 / 6;
                if (i === 0) hexShape.moveTo(Math.cos(a) * size, Math.sin(a) * size);
                else hexShape.lineTo(Math.cos(a) * size, Math.sin(a) * size);
            }
            hexShape.closePath();

            const hexGeo = new THREE.ExtrudeGeometry(hexShape, {
                depth: 0.2, 
                bevelEnabled: true,
                bevelSegments: 3,
                bevelSteps: 2,
                bevelSize: 0.3,
                bevelThickness: 0.2
            });
            hexGeo.rotateX(Math.PI / 2);
            
            const hexMat = new THREE.MeshStandardMaterial({
                color: 0x2e3b2e, 
                roughness: 0.6, 
                metalness: 0.4,
                transparent: true, 
                opacity: 0.9,
                flatShading: false
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
            
            const instancedMesh = new THREE.InstancedMesh(hexGeo, hexMat, positions.length);
            instancedMesh.visible = !!window._isMapView; // Hide immediately if not Map View
            
            const dummy = new THREE.Object3D();
            positions.forEach((pos, i) => {
                const groundY = getHeightFunc(pos.x, pos.z);
                // Contour exactly to the ground, minus half-height to sink it
                dummy.position.set(pos.x, groundY - 0.1, pos.z);
                // Random slightly offset rotation purely for tiny imperfect dirt feel? 
                // No, hex edges must align perfectly in a board!
                dummy.updateMatrix();
                instancedMesh.setMatrixAt(i, dummy.matrix);
            });
            
            instancedMesh.instanceMatrix.needsUpdate = true;
            window._hexGridMesh = instancedMesh;
            this.scene.add(instancedMesh);
            return instancedMesh;
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
            if (tree.isInstanced && window._treeInstancedMeshes) {
                const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
                window._treeInstancedMeshes.forEach(({ instancedMesh }) => {
                    instancedMesh.setMatrixAt(tree.index, zeroMatrix);
                    instancedMesh.instanceMatrix.needsUpdate = true;
                });
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
            const textEl = document.querySelector('.loading-text');
            if (textEl) {
                textEl.innerText = text;
                textEl.style.animation = 'none'; // Stop pulsing during final steps
            }
        }

        

    async generateWorld(assetFactory) {
        const waitFrame = () => new Promise(r => setTimeout(r, 80));
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

        
        this.updateLoadingScreen("Shaping Ancient Terrain...");
        await waitFrame();

            // Ground — large terrain
            const ground = assetFactory.create('ground_chunk');
            ground.position.set(0, 0, 0);
            scene.add(ground);

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

                // 2b. BRINGS HAPPINESS GIRL TIPI PLATEAU (Quest Tipi)
                const plateauX = 12;
                const plateauZ = 12;
                const dx2 = gx - plateauX, dz2 = gz - plateauZ;
                const dist2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
                
                if (dist2 < 12.0) {
                    const plateauY = Math.sin(plateauX * 0.08) * Math.cos(plateauZ * 0.1) * 1.5 + Math.sin(plateauX * 0.2 + plateauZ * 0.15) * 0.4;
                    if (dist2 < 6.0) {
                        y = plateauY; // Flat ground for the Tipi interior and girl
                    } else {
                        // Smooth blend from plateau to full undulation
                        const t2 = (dist2 - 6.0) / 6.0;
                        const flatten2 = 0.5 + 0.5 * Math.cos(t2 * Math.PI); // 1.0 at center, 0.0 at edge
                        y = y * (1.0 - flatten2) + plateauY * flatten2;
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

                return y;
            };
            window._getGroundY = getGroundY;


            // Board Game Tile Grid Setup (Village View ONLY)
            // 25-foot hexes (1 unit approx 3.29ft => ~7.6 units wide)
            const hexRadius = 4.38;
            const hexThickness = 0.4;
            const sides = 6; // Standard Hexagon
            
            const hexShape = new THREE.Shape();
            for (let i = 0; i < sides; i++) {
                const a = i * Math.PI * 2 / sides;
                if (i === 0) hexShape.moveTo(Math.cos(a) * hexRadius, Math.sin(a) * hexRadius);
                else hexShape.lineTo(Math.cos(a) * hexRadius, Math.sin(a) * hexRadius);
            }
            hexShape.closePath();

            // Re-cut the hollow center so the hex looks exactly like a board game border edge 
            // with beautiful physical shadows along the bevel overlay.
            const holePath = new THREE.Path();
            for (let i = 0; i < sides; i++) {
                const a = i * Math.PI * 2 / sides;
                const innerR = hexRadius * 0.98; // Razor thin 2% boundary shadow line instead of thick 10% wall
                if (i === 0) holePath.moveTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
                else holePath.lineTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
            }
            holePath.closePath();
            hexShape.holes.push(holePath);

            const hexGeo = new THREE.ExtrudeGeometry(hexShape, {
                depth: 0.1, // Thinner, perfectly flat shadow line
                bevelEnabled: false // Pure sharp overlay, no double-bevel W-shaped grooves
            });
            // Extrude physically pushes geometry up through Z, lay it flat!
            hexGeo.rotateX(Math.PI / 2);
            
            // Physical Topological Terrain Overlay Mesh
            const hexMat = new THREE.MeshStandardMaterial({
                color: 0x1a2e1a, // Very dark rich shadow base for neumorphism
                transparent: true,
                opacity: 0.85, // Highly visible so the rings pop out
                roughness: 0.9, 
                metalness: 0.2,
                depthWrite: false, 
                depthTest: true, // MUST physically intersect and act as ground
                flatShading: true
            });

            
            const mapSize = 240; // Substantial footprint to cover bounds
            const xOffset = Math.sqrt(3) * hexRadius;
            const zOffset = 1.5 * hexRadius;
            const cols = Math.ceil(mapSize / xOffset) + 1;
            const rows = Math.ceil(mapSize / zOffset) + 1;
            const totalHexes = cols * rows;
            
            const hexGrid = new THREE.InstancedMesh(hexGeo, hexMat, totalHexes);
            hexGrid.castShadow = true; 
            hexGrid.receiveShadow = true; // Act as a real surface
            hexGrid.layers.set(1); // Explicitly lock to Village View layer ONLY
            window._villageMapGrid = hexGrid; // Expose global to allow PiP overlays to scrub it out
            window._hexCenters = []; // Cache to allow snapping
            
            const dummy = new THREE.Object3D();
            const color = new THREE.Color();
            let hexIndex = 0;
            
            const startX = -mapSize / 2;
            const startZ = -mapSize / 2;
            
            for (let z = 0; z < rows; z++) {
                for (let x = 0; x < cols; x++) {
                    const isOddRow = z % 2 !== 0;
                    const px = startX + x * xOffset + (isOddRow ? xOffset / 2 : 0);
                    const pz = startZ + z * zOffset;
                    
                    window._hexCenters.push(new THREE.Vector2(px, pz));
                    
                    // Calculate terrain height exactly at this spot
                    const gy = getGroundY(px, pz);
                    
                    // Sample nearby points to construct a smooth terrain normal
                    const offset = 0.5;
                    const hL = getGroundY(px - offset, pz);
                    const hR = getGroundY(px + offset, pz);
                    const hU = getGroundY(px, pz - offset);
                    const hD = getGroundY(px, pz + offset);
                    
                    const normal = new THREE.Vector3(
                        hL - hR,
                        offset * 2,
                        hU - hD
                    ).normalize();

                    // Hover precisely flush against the grass to prevent severe Z-fighting
                    dummy.position.set(px, gy + 0.1, pz);
                    
                    // 1. Rotate 30 degrees to interlock flat edges
                    const euY = new THREE.Euler(0, Math.PI / 6, 0);
                    const qY = new THREE.Quaternion().setFromEuler(euY);
                    
                    // 2. Tilt the entire massive tile to physically match the terrain slant
                    const qTilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
                    
                    dummy.quaternion.copy(qTilt).multiply(qY);
                    dummy.scale.set(1.0, 1.0, 1.0); // 100% scale lets tiles touch flush, allowing pure bevel curvature to create 3D shadow boundaries
                    dummy.updateMatrix();
                    
                    hexGrid.setMatrixAt(hexIndex, dummy.matrix);
                    
                    // Dark shadowy overlay line color
                    color.setHex(0x111111);
                    color.offsetHSL(0.0, 0.0, (Math.random() - 0.5) * 0.05); 
                    hexGrid.setColorAt(hexIndex, color);
                    
                    hexIndex++;
                }
            }
            hexGrid.instanceMatrix.needsUpdate = true;
            if (hexGrid.instanceColor) hexGrid.instanceColor.needsUpdate = true;
            
            scene.add(hexGrid);
            
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
                // Return our standard interactive 3D miniature base (size 1.2 for NPCs, nice deep mahogany color)
                return window.createEditorBase(1.2, modelRef, 0x4a2a1a);
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

            this.updateLoadingScreen("Raising the Tipi...");
            await waitFrame();

            // =============================================
            // TIPI — yellowbutterfly tipi at world center
            // =============================================
            await new Promise((resolveTipi) => {
                console.log("[generateWorld] Starting GLTFLoader for Tipi...");
                const gltfLoaderTipi = new GLTFLoader();
                const dracoLoaderTipi = (typeof window.THREE !== 'undefined' && typeof window.THREE.DRACOLoader !== 'undefined')
                    ? new window.THREE.DRACOLoader()
                    : (typeof DRACOLoader !== 'undefined' ? new DRACOLoader() : null);
                if (dracoLoaderTipi) {
                    dracoLoaderTipi.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
                    gltfLoaderTipi.setDRACOLoader(dracoLoaderTipi);
                }
                gltfLoaderTipi.setPath('Assets/Tipi.yellowbutterfly/');
                gltfLoaderTipi.load('tipi.yellowbutterfly.glb', (gltf) => {
                    const obj = gltf.scene;
                    console.log("[generateWorld] GLTFLoader finished for Tipi glb.");
                        // Scale to reasonable game size (~4 units tall)
                        const box = new THREE.Box3().setFromObject(obj);
                        const size = box.getSize(new THREE.Vector3());
                        const targetH = 4.0;
                        const sf = targetH / Math.max(size.y, 0.1);
                        obj.scale.set(sf, sf, sf);

                        // Recompute after scale
                        box.setFromObject(obj);
                        const center = box.getCenter(new THREE.Vector3());

                        // Place at clearing center, resting on top of the Dirt Mound!
                        const platformY = window._tipiPlatformY;
                        obj.position.set(
                            TIPI_X - center.x,
                            platformY - box.min.y - 0.05, // Sunk just barely so no floating cracks
                            TIPI_Z - center.z
                        );

                        // Face entrance fully towards camera +Z (Player spawn is Z=20)
                        obj.rotation.y = -Math.PI / 2;

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

                        const bLight = new THREE.PointLight(0xffdd66, 1.0, 15);
                        bObj.add(bLight);

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
                        const ybDracoLoader = (typeof window.THREE !== 'undefined' && typeof window.THREE.DRACOLoader !== 'undefined')
                            ? new window.THREE.DRACOLoader()
                            : (typeof DRACOLoader !== 'undefined' ? new DRACOLoader() : null);
                        if (ybDracoLoader) {
                            ybDracoLoader.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
                            ybGltfLoader.setDRACOLoader(ybDracoLoader);
                        }
                        ybGltfLoader.load('Assets/animated.yellowbutterfly.glb', (gltf) => {
                            const ybModel = gltf.scene;
                            // The base mesh for yellow butterfly is incredibly small, so we use 1.728x scale.
                            // User Request: Make 25% thicker -> X/Z scaled up to 2.16
                            ybModel.scale.set(2.16, 1.728, 2.16); 
                            
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
                                    child.castShadow = true;
                                    child.receiveShadow = true;
                                    
                                    // Make faces and hands smooth
                                    if (child.material) {
                                        child.material.flatShading = false;
                                        child.material.needsUpdate = true;
                                    }
                                    // Remove destructive computeVertexNormals block that was overwriting rigged geometry smooth shading
                                }
                            });
                            
                            // Attach local lighting to prevent Ortho camera pitch black
                            const ybLight = new THREE.PointLight(0xffeedd, 1.2, 8);
                            // Light should always be strictly behind head (-1.0 in local Z)
                            ybLight.position.set(0, 3.5, -3.0);
                            ybGroup.add(ybLight);
                            
                            // Attach aesthetic Halo proxy
                            const halo = createNPCHalo(ybGroup);
                            ybGroup.add(halo);
                            
                            // --- FLOATING QUEST MARKER ---
                            const questGroup = createQuestBalloon('1', 'quest_1_start_game');
                            // Move balloon to sit more intimately over her directly in FPV
                            questGroup.position.set(0, 4.4, 0);
                            questGroup.userData.baseY = 4.4; 
                            
                            // Slant the tether string to visually attach directly into her LEFT hand!
                            const stringGeo = new THREE.CylinderGeometry(0.006, 0.006, 3.2, 4);
                            // By translating the geometry downwards by half its height, its active pivot locks exactly at its Top Point
                            stringGeo.translate(0, -1.6, 0);
                            const stringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
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
                            
                            // Attach FPV diagnostic visual arrow (Restored per User request 19x)
                            if (window.createFPVFacingArrow) {
                                // 25% transparent (0.75 opacity), perfectly referencing her forward -Z vector natively
                                const ybFpvArrow = window.createFPVFacingArrow(0x2e8b57, 1.2, new THREE.Vector3(0, 0, 1), 0.75);
                                ybGroup.add(ybFpvArrow);
                            }


                            scene.add(ybGroup);
                            // Save to global for EngineMain
                            window._yellowButterflyNPC = ybGroup;

                            if (gltf.animations && gltf.animations.length > 0) {
                                window.ybMixer = new THREE.AnimationMixer(ybModel);
                                
                                // gltf.animations mapping:
                                // [0] Rest/Tpose, [1] Walk, [2] Idle, [3] Wait, [4] Heart, [5] Wave
                                const idleClip = gltf.animations.length > 2 ? gltf.animations[2] : null;
                                const waitClip = gltf.animations.length > 3 ? gltf.animations[3] : null;
                                const heartClip = gltf.animations.length > 4 ? gltf.animations[4] : null;
                                const waveClip = gltf.animations.length > 5 ? gltf.animations[5] : null;

                                const system = {
                                    mixer: window.ybMixer,
                                    clips: { idle: idleClip, wait: waitClip, heart: heartClip, wave: waveClip },
                                    actions: {},
                                    hasGreeted: false,
                                    hasWaved: false,
                                    currentBaseAction: null,
                                    proximityTimeout: null,
                                    petTimer: 3.0,
                                    hasGreetedPlayer: false,
                                    update(delta) {
                                        if (this.mixer) this.mixer.update(delta);
                                        
                                        // Priority 1: Horse Gaze Anchoring 
                                        // Ensures she locks onto the horse without being hijacked by the Nature Spirit cinematic.
                                        
                                        // Player Proximity Greeting Interlayer
                                        const playerPos = window.player ? window.player.position : null;
                                        
                                        // Priority 1: HARD STARE LOCK TO HORSE
                                        // User specifically demanded they stare at each other. No player interruptions. No Stag interruptions.
                                        let isHorseNear = false;
                                        
                                        if (window.horseSystem && window.horseSystem.actions && window.horseSystem.horse) {
                                            const currentQuat = window._yellowButterflyNPC.quaternion.clone();
                                            const targetPosition = window.horseSystem.horse.position.clone();
                                            targetPosition.y = window._yellowButterflyNPC.position.y;
                                            window._yellowButterflyNPC.lookAt(targetPosition);
                                            const targetQuat = window._yellowButterflyNPC.quaternion.clone();
                                            window._yellowButterflyNPC.quaternion.copy(currentQuat);
                                            window._yellowButterflyNPC.quaternion.slerp(targetQuat, 2.5 * delta); 
                                            
                                            if (window._yellowButterflyNPC.position.distanceTo(window.horseSystem.horse.position) < 5.0) {
                                                isHorseNear = true;
                                            }
                                        }
                                            
                                            if (isHorseNear) {
                                                if (!this.pettingActive) {
                                                    this.pettingActive = true;
                                                    if (this.actions.wave) {
                                                        this.actions.wave.paused = false;
                                                        this.actions.wave.reset().play();
                                                        if (this.currentBaseAction) this.actions.wave.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                                    }
                                                } else if (this.actions.wave) {
                                                    // Freeze the animation at peak reach when hand is outstretched
                                                    const reachPeak = this.actions.wave.getClip().duration * 0.45;
                                                    if (this.actions.wave.time >= reachPeak && !this.actions.wave.paused) {
                                                        this.actions.wave.paused = true; // Hold out hand to touch horse
                                                    }
                                                }
                                            } else {
                                                if (this.pettingActive) {
                                                    this.pettingActive = false;
                                                    if (this.actions.wave) {
                                                        this.actions.wave.paused = false;
                                                        if (this.currentBaseAction) {
                                                            this.currentBaseAction.reset().play();
                                                            this.currentBaseAction.crossFadeFrom(this.actions.wave, 0.5, false);
                                                        }
                                                    }
                                                }
                                                
                                                this.petTimer -= delta;
                                                if (this.petTimer <= 0) {
                                                    this.petTimer = 8.0 + Math.random() * 6.0;
                                                    if (this.actions.heart) {
                                                        this.actions.heart.reset().play();
                                                        if (this.currentBaseAction) this.actions.heart.crossFadeFrom(this.currentBaseAction, 0.5, false);
                                                        
                                                        setTimeout(() => {
                                                            if (this.currentBaseAction) {
                                                                this.currentBaseAction.reset().play();
                                                                this.currentBaseAction.crossFadeFrom(this.actions.heart, 0.5, false);
                                                            }
                                                        }, 3000);
                                                    }
                                            }
                                        }
                                    }
                                };

                                // Cache Actions
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
                            
                            // Start behind the tipi (-15 X, -10 Z roughly)
                            const startX = -15;
                            const startZ = -10;
                            nsGroup.position.set(startX, getGroundY(startX, startZ) + 3.2, startZ);
                            
                            // CRITICAL RIG FIX: The Native Stag head points towards +X. 
                            // This -90deg (CW) rotation aligns the geometric face to the +Z mathematically.
                            // We MUST WRAP it so AnimationMixer doesn't aggressively overwrite the fix!
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
                                        c.material.depthTest = false;  // FULL X-RAY: Spirit has zero visual collision against ANY trees or landscape
                                        c.material.emissive = new THREE.Color(0x33aaaa);
                                        c.material.emissiveIntensity = 0.5;
                                        myMaterials.push(c.material);
                                    }
                                }
                            });
                            
                            // Attach a soft cyan light to physically project the Patronus effect onto trees
                            const spiritLight = new THREE.PointLight(0x77ffff, 1.5, 20);
                            spiritLight.position.set(0, 0.5, 0); // Near the core
                            nsGroup.add(spiritLight);
                            
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
                                
                                window.natureSpiritSystem = {
                                    mixer: window.nsMixer,
                                    mesh: nsGroup,
                                    asset: nsAsset,
                                    materials: myMaterials,
                                    light: spiritLight,
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
                                                this.state = 'bowing';
                                                
                                                this.mixer.stopAllAction();
                                                bowAction.play();
                                                
                                        if (this.state === 'bowing' && window._yellowButterflyNPC) {
                                            const currentQuat = this.mesh.quaternion.clone();
                                            this.mesh.lookAt(window._yellowButterflyNPC.position);
                                            const targetQuat = this.mesh.quaternion.clone();
                                            this.mesh.quaternion.copy(currentQuat);
                                            this.mesh.quaternion.slerp(targetQuat, 3.0 * delta); // Turn to face butterfly cleanly
                                        }
                                                if (window._yellowButterflyNPC && window.ybSystem) {
                                                    // YB runs Greeting Animation Followed by Wave
                                                    if (window.ybSystem.actions.wait) {
                                                        window.ybSystem.actions.wait.reset().play();
                                                        window.ybSystem.actions.wait.crossFadeFrom(window.ybSystem.currentBaseAction, 0.5, false);
                                                        
                                                        setTimeout(() => {
                                                            if (window.ybSystem.actions.wave) {
                                                                window.ybSystem.actions.wave.reset().play();
                                                                window.ybSystem.actions.wave.crossFadeFrom(window.ybSystem.actions.wait, 0.5, false);
                                                            }
                                                        }, 2000); // Wait 2s for greet, then wave
                                                    }
                                                }
                                                
                                                setTimeout(() => {
                                                    if (window.triggerYellowButterflyHeart) window.triggerYellowButterflyHeart();
                                                }, 4500); // Wait 2.5s after wave for heart
                                                
                                                // Pause 5 seconds (Wait for entire greeting to finish) then turn slowly and continue walking away
                                                setTimeout(() => {
                                                    this.state = 'walking_out';
                                                    this.mixer.stopAllAction();
                                                    walkAction.play(); // Feet move during turn
                                                    
                                                    // YB gently returns her rig to baseline Idle when the Stag turns
                                                    if (window.ybSystem && window.ybSystem.actions.idle) {
                                                         window.ybSystem.actions.idle.reset().play();
                                                    }
                                                }, 5000); // 5s total interaction time allows heart to trigger securely
                                            }
                                        }
                                        
                                        if (this.state === 'walking_out') {
                                            this.mesh.position.x += this.speed * delta;
                                            
                                            // Smoothly face walking direction (East) to prevent sudden snapping
                                            const marchTarget = this.mesh.position.clone();
                                            marchTarget.x += 10.0;
                                            const currentQuat = this.mesh.quaternion.clone();
                                            this.mesh.lookAt(marchTarget);
                                            const targetQuat = this.mesh.quaternion.clone();
                                            this.mesh.quaternion.copy(currentQuat);
                                            this.mesh.quaternion.slerp(targetQuat, 2.5 * delta);
                                            
                                            // Glow intensely after heart interaction
                                            this.materials.forEach(mat => {
                                                if (mat.emissiveIntensity < 1.8) {
                                                    mat.emissiveIntensity += 0.5 * delta;
                                                }
                                            });
                                            if (this.light.intensity < 3.0) this.light.intensity += 1.0 * delta;
                                            
                                            // Fade out as it passes deep into trees (X > 20)
                                            if (this.mesh.position.x > 20) {
                                                let finished = false;
                                                this.materials.forEach(mat => {
                                                    mat.opacity -= 0.15 * delta;
                                                    if (mat.opacity <= 0) finished = true;
                                                });
                                                this.light.intensity -= 1.0 * delta;
                                                
                                                if (finished) {
                                                    this.state = 'finished';
                                                    scene.remove(this.mesh);
                                                    this.asset.traverse(c => { if(c.geometry) c.geometry.dispose(); });
                                                    console.log("[NPC] Nature Spirit departed.");
                                                }
                                            }
                                        }
                                    }
                                };
                            }
                        });

                        // RESOLVE THE LOADING BLOCKER ONCE TEXTURES AND MESHES ARE READY
                        resolveTipi();
                });
            });
            this.updateLoadingScreen("Planting Sacred Forest...");
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

                // FIND MESHES FOR INSTANCING
                const meshesToInstance = [];
                template.traverse(child => {
                    if (child.isMesh) {
                        meshesToInstance.push(child);
                    }
                });

                if (meshesToInstance.length > 0) {
                    const instancedMeshes = [];
                    const matrix = new THREE.Matrix4();
                    const position = new THREE.Vector3();
                    const rotation = new THREE.Euler();
                    const quaternion = new THREE.Quaternion();
                    const sc = new THREE.Vector3();

                    // Create InstancedMesh for each constituent mesh
                    meshesToInstance.forEach((mesh) => {
                        // Clone material to allow tinting and wind
                        let material = Array.isArray(mesh.material) ? mesh.material[0].clone() : mesh.material.clone();
                        
                        // Force basic optimizations
                        material.roughness = 1.0;
                        material.metalness = 0.0;
                        if (material.shininess !== undefined) material.shininess = 0;
                        
                        const matName = material.name ? material.name.toLowerCase() : '';
                        const isLeaf = matName.includes('leaf') || matName.includes('leaves') || matName.includes('foliage');
                        
                        if (isLeaf) {
                            material.color.setHex(0xffffff); // White base for setColorAt
                            material.alphaTest = 0.5;
                            material.transparent = false;
                            material.depthWrite = true;
                            
                            // Apply wind sway to leaves
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
                                
                                // Removed fragment shader mods to restore Early-Z and fix 40 FPS drop
                            };
                        }

                        const instancedMesh = new THREE.InstancedMesh(mesh.geometry, material, treePositions.length);
                        instancedMesh.castShadow = false;
                        instancedMesh.receiveShadow = false;
                        instancedMesh.frustumCulled = false;
                        instancedMesh.layers.enable(1);
                        
                        instancedMeshes.push({ instancedMesh, isLeaf });
                        scene.add(instancedMesh);
                    });

                    for (let idx = 0; idx < treePositions.length; idx++) {
                        if (idx > 0 && idx % 20 === 0) {
                            this.updateLoadingScreen(`Growing Sacred Pines... (${idx}/${treePositions.length})`);
                            await waitFrame();
                        }
                        
                        const pos = treePositions[idx];
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

                        instancedMeshes.forEach(({ instancedMesh, isLeaf }) => {
                            instancedMesh.setMatrixAt(idx, matrix);
                            if (isLeaf) {
                                instancedMesh.setColorAt(idx, tintColor);
                            }
                        });

                        // Dirt group logic
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
                            index: idx
                        });
                        vegData.trees.push({ x: pos.x, z: pos.z });
                    }

                    instancedMeshes.forEach(({ instancedMesh, isLeaf }) => {
                        instancedMesh.instanceMatrix.needsUpdate = true;
                        if (isLeaf) instancedMesh.instanceColor.needsUpdate = true;
                    });
                    window._treeInstancedMeshes = instancedMeshes;

                    console.log(`[Forest] Planted ${treePositions.length} INSTANCED trees (Multi-Mesh)`);
                }


                console.warn('[Forest] Skipped corrupted bush model asset.');
                if (window.squirrelSystem) {
                    window.squirrelSystem.feedTrees(vegData.trees);
                }
                resolve();
            }, undefined, reject);
        });

        this.updateLoadingScreen("Awakening Wildlife...");
            await waitFrame();

            if (window.NextGenRabbitSystem) {
                window.rabbitSystem = new window.NextGenRabbitSystem(scene, getGroundY);
            }
            if (window.InteractiveHorseSystem) {
                // Horse initializes instantly and probes for Yellow Butterfly asynchronously during runtime ticks
                window.horseSystem = new window.InteractiveHorseSystem(scene, getGroundY);
            }
            if (window.BirdSystem) {
                window.birdSystem = new window.BirdSystem(scene, camera, getGroundY, window._treeInstancedMeshes || window._treePositions || []);
            }




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

            // ==========================================
            // VAPOROUS SMOKE OUT THE TOP (Y ~ 4.0)
            // ==========================================
            const sCanvas = document.createElement('canvas');
            sCanvas.width = 64; sCanvas.height = 64;
            const sCtx = sCanvas.getContext('2d');
            const sGrad = sCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
            sGrad.addColorStop(0, 'rgba(230, 230, 230, 0.4)');
            sGrad.addColorStop(0.5, 'rgba(180, 180, 180, 0.15)');
            sGrad.addColorStop(1, 'rgba(100, 100, 100, 0)');
            sCtx.fillStyle = sGrad;
            sCtx.fillRect(0, 0, 64, 64);
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

            const smokeMat = new THREE.PointsMaterial({
                map: smokeTex,
                size: 1.5,
                transparent: true,
                blending: THREE.NormalBlending, // Normal for smoke, not additive
                depthWrite: false,
                opacity: 0.5
            });
            const smokeMesh = new THREE.Points(smokeGeo, smokeMat);
            scene.add(smokeMesh);

            // Fire light — lower intensity and distance
            const fireLight = new THREE.PointLight(0xff3300, 2.5, 9, 2);
            fireLight.position.set(TIPI_X, fireY + 0.5, TIPI_Z);
            scene.add(fireLight);

            // Secondary warm fill
            const fireFill = new THREE.PointLight(0xff8844, 0.8, 6, 2);
            fireFill.position.set(TIPI_X, fireY + 0.3, TIPI_Z);
            scene.add(fireFill);

            // Store fire refs for animation
            window._fireData = { flameMesh, smokeMesh, fireLight, fireFill, emberMesh, baseY: fireY };

            console.log('[Tipi] Campfire and smoke placed inside tipi');

            // ==========================================
            // BRINGS HAPPINESS GIRL (Quest Target)
            // ==========================================
            const bhgLoader = new OBJLoader();
            bhgLoader.load('Assets/tipi.bringshappiness.obj', (obj) => {
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

                const bhgGroup = new THREE.Group();
                bhgGroup.add(bhgModel);
                bhgGroup.position.set(bhgX, bhgY, bhgZ); // Restored to 35, 45 worldwide
                bhgGroup.rotation.y = Math.PI; // Rotated 180 degrees to face the player approach (-X / West)
                
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

                // --- FLOATING QUEST MARKER 2 ---
                const questGroup2 = createQuestBalloon('2', 'quest_2_find_her');
                const markerY2 = bhgY + 3.5; // Lowered from 7.5 to float directly above the entrance
                // Offset quest marker to be squarely in front of the tipi entrance
                // bhgGroup rotated Math.PI (180deg). Thus +Z local is -Z global.
                const markerZ2 = bhgZ - 4.0;
                questGroup2.position.set(bhgX, markerY2, markerZ2);
                questGroup2.userData.baseY = markerY2;
                
                // Construct Tether string safely locked onto the balloon knot swinging down to her hand
                const stringGeo2 = new THREE.CylinderGeometry(0.006, 0.006, 3.2, 4);
                stringGeo2.translate(0, -1.6, 0); 
                const stringMat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
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
                    // User Request: Make 'less thick' -> Reduced X/Z width.
                    girlModel.scale.set(1.14, 1.43, 1.14); // Y keeps height increased by 30%
                    
                    const halo = createNPCHalo(girlModel);
                    girlModel.add(halo);
                    
                    if (gltf.animations && gltf.animations.length > 0) {
                        window.bhgMixer = new THREE.AnimationMixer(girlModel);
                        
                        // Default Blender Export places static Rest Pose at [0] inside NlaTrack strips.
                        window._bhgIdleClip = gltf.animations.find(a => a.name.toLowerCase().includes('idle')) || (gltf.animations.length > 1 ? gltf.animations[1] : gltf.animations[0]);
                        window._bhgWaveClip = gltf.animations.find(a => a.name.toLowerCase().includes('wave')) || (gltf.animations.length > 2 ? gltf.animations[2] : null);
                        
                        window._bhgIdleAction = window.bhgMixer.clipAction(window._bhgIdleClip);
                        window._bhgIdleAction.play();
                        
                        if (window._bhgWaveClip) {
                            window._bhgWaveAction = window.bhgMixer.clipAction(window._bhgWaveClip);
                            window._bhgWaveAction.setLoop(THREE.LoopOnce, 1);
                            window._bhgWaveAction.clampWhenFinished = true;
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

                    // Rotate her slightly outward
                    girlModel.rotation.y = Math.PI * 0.1;

                    girlModel.traverse(child => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            
                            if (child.material) {
                                child.material.flatShading = false;
                                child.material.needsUpdate = true;
                            }
                            // Delete forced computeVertexNormals to preserve native smooth geometry topology
                        }
                    });

                    // Attach PIP Marker (NPC: 6ft diameter = ~0.9m radius), with facing arrow = true
                    const bhgSelfMarker = window.createPIPMarker(0x2e8b57, 0.8 / 1.14, 0.9 / 1.14, true);
                    
                    // The animated avatar natively surfaces looking 90 degrees to the Left instead of True Forward (+Z).
                    // Counter-rotate the UI marker to mathematically compensate for the rigged armature!
                    bhgSelfMarker.rotation.y = -Math.PI / 2; 

                    girlModel.add(bhgSelfMarker);

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
                    
                    // Nature Spirit Proximity State Machine
                    window.bhgSystem = {
                        mesh: girlModel,
                        mixer: window.bhgMixer,
                        hasWaved: false,
                        
                        update(delta) {
                            if (this.mixer) this.mixer.update(delta);
                            
                            // Distance wave check based on global camera
                            if (window.camera && window._bhgWaveAction && window._bhgIdleAction) {
                                const bhgPos = new THREE.Vector3();
                                this.mesh.getWorldPosition(bhgPos);
                                const distToPlayer = window.camera.position.distanceTo(bhgPos);
                                
                                // Approach proximity trigger
                                if (distToPlayer < 12.0 && !this.hasWaved) {
                                    this.hasWaved = true; // Lockstate
                                    
                                    // Execute Wave override
                                    window._bhgWaveAction.reset();
                                    window._bhgWaveAction.play();
                                    window._bhgWaveAction.crossFadeFrom(window._bhgIdleAction, 0.5, false);
                                    
                                    // Decay back into Idle state upon wave sequence resolution
                                    const restoreIdle = (e) => {
                                        if (e.action === window._bhgWaveAction) {
                                            window._bhgIdleAction.reset();
                                            window._bhgIdleAction.play();
                                            window._bhgIdleAction.crossFadeFrom(window._bhgWaveAction, 0.5, false);
                                            this.mixer.removeEventListener('finished', restoreIdle);
                                        }
                                    };
                                    this.mixer.addEventListener('finished', restoreIdle);
                                    
                                } else if (distToPlayer > 18.0 && this.hasWaved) {
                                    // Release memory lock when player leaves the zone
                                    this.hasWaved = false; 
                                }
                            }
                        }
                    };
                });
                
                scene.add(bhgGroup);
                window._bhgGroup = bhgGroup;
                window._bhgBalloon = questGroup2;

                console.log(`[Quest] Placed Brings Happiness Girl at (${bhgX}, ${bhgZ})`);
                
                // Avatar loading removed. EngineMain.js exclusively handles it to prevent duplication.
            });

            // ==========================================
            // WATERFALL & ECOSYSTEM POND
            // ==========================================
            const pondLoader = new GLTFLoader();
            pondLoader.load('Assets/pond_with_waterfalls/scene.gltf', (gltf) => {
                const pond = gltf.scene;

                // Scale and Positioning
                const pondScale = 4.0; // Scaled down to fit comfortably as a local camp landmark
                pond.scale.set(pondScale, pondScale, pondScale);
                
                const pondX = 30;
                const pondZ = 15;
                const truePondY = typeof getGroundY !== 'undefined' ? getGroundY(pondX, pondZ) : 0;
                
                // Set initial position to compute accurate world bounding box
                pond.position.set(pondX, truePondY, pondZ);
                pond.updateMatrixWorld(true);
                
                // Offset by exact bounding box minimum to place it perfectly on the ground
                const pondBox = new THREE.Box3().setFromObject(pond);
                pond.position.y += (truePondY - pondBox.min.y) - 0.2; // -0.2 to sink banks slightly

                // Analyze parts: Separate water meshes for custom ShaderMaterial
                const waterMeshes = [];
                window._waterMeshesTelemetry = []; // Global telemetry for diagnostic scraping
                pond.traverse(child => {
                    if (child.isMesh) {
                        // SURGICAL CULL: The telemetry proved that 'Plane136_riples' and 'Plane137_riples' 
                        // expand over 2100+ world units. This violates the 1000-unit Far Clipping Plane native 
                        // to the FPV camera, guaranteeing depth-buffer Z-fighting and pitch-black occlusion 
                        // failure against the logarithmic fragment renderer.
                        if (child.name.includes('Plane136') || child.name.includes('Plane137')) {
                            child.visible = false;
                            return; // Vaporize the macro-ocean planes
                        }

                        child.castShadow = false; // TEMPORARILY DISABLED
                        child.receiveShadow = false; // TEMPORARILY DISABLED
                        const defaultMat = child.material;
                        const matName = (defaultMat && defaultMat.name) ? defaultMat.name.toLowerCase() : '';
                        
                        // "water" and "riples" as seen in the GLTF dump
                        if (matName.includes('water') || matName.includes('riple') || matName.includes('fall')) {
                            waterMeshes.push(child);
                            const wp = new THREE.Vector3();
                            child.getWorldPosition(wp);
                            window._waterMeshesTelemetry.push({
                                name: child.name,
                                matName: matName,
                                worldPos: { x: wp.x, y: wp.y, z: wp.z }
                            });
                        } else if (defaultMat) {
                            // Give rocks/banks a more solid earth shader
                            defaultMat.roughness = 0.85;
                            defaultMat.metalness = 0.05;
                            if (defaultMat.color) {
                                // Subtly tint towards the forest's warm lighting
                                defaultMat.color.multiplyScalar(0.9);
                            }
                        }
                    }
                });

                // Apply Flowing Procedural Water Shader
                if (window._globalTime === undefined) {
                    window._globalTime = { value: 0 };
                }

                if (waterMeshes.length > 0) {
                    const waterMat = new THREE.MeshBasicMaterial({
                        color: 0x44aaff,
                        transparent: true,
                        opacity: 0.6,
                        side: THREE.DoubleSide,
                        depthWrite: false
                    });

                    // We successfully removed the procedural UV scrolling shader because the standard 
                    // material compilation was failing to evaluate the missing texture map's UV definitions,
                    // which violently collapsed the entire mesh group's fragment lighting into pure pitch black shapes.

                    waterMeshes.forEach(mesh => {
                        mesh.material = waterMat;
                    });
                }
                
                // Procedural River/Waterfall Noise Audio Node
                if (window.camera) {
                    const listener = new THREE.AudioListener();
                    // Don't add multiple listeners if the camera already has one
                    let hasListener = false;
                    window.camera.children.forEach(c => { if (c.type === 'AudioListener') hasListener = true; });
                    if (!hasListener) window.camera.add(listener);

                    // Create Positional Audio object attached to the Pond
                    const waterfallAudio = new THREE.PositionalAudio(listener);
                    
                    // Synthesize continuous pink noise buffer for water crash
                    const sampleRate = 44100;
                    const bufferSize = sampleRate * 2; // 2 seconds loop
                    const noiseBuffer = listener.context.createBuffer(1, bufferSize, sampleRate);
                    const output = noiseBuffer.getChannelData(0);
                    let lastOut = 0;
                    for (let i = 0; i < bufferSize; i++) {
                        // Pink noise approximation filter
                        const white = Math.random() * 2 - 1;
                        output[i] = lastOut * 0.85 + white * 0.15;
                        lastOut = output[i];
                        output[i] *= 0.3; // Gain down
                    }
                    
                    waterfallAudio.setBuffer(noiseBuffer);
                    waterfallAudio.setLoop(true);
                    waterfallAudio.setRefDistance(15); // Rolloff curve distance
                    waterfallAudio.setVolume(1.8);
                    
                    // Wait for audio context resume (usually governed by First Interaction policy)
                    const playAudio = () => {
                        if (listener.context.state === 'suspended') {
                            listener.context.resume();
                        }
                        if (!waterfallAudio.isPlaying) {
                            waterfallAudio.play();
                        }
                    };
                    
                    // Attach interaction listener to bootstrap audio on browser restrictions
                    document.addEventListener('click', playAudio, { once: true });
                    document.addEventListener('keydown', playAudio, { once: true });
                    
                    pond.add(waterfallAudio);
                }

                // Append to World
                window._pondEcosystem = pond;
                window._pondCenter = new THREE.Vector3(pondX, truePondY, pondZ);
                window._pondExtents = 25.0; // Distance inside which animals graze

                scene.add(pond); // Restoring ecosystem and procedural audio
                console.log(`[Ecosystem] Spawned Pond Hub with procedural audio @ (${pondX}, ${truePondY.toFixed(1)}, ${pondZ}).`);
            });
        }
}

        // --- NO INPUT (Clean Slate) ---
        // --- INPUT & RESIZE HANDLERS ---


